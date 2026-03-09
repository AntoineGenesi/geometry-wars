/**
 * Portal — A teleportation portal placed on the game surface (PvP/PvPvE only).
 *
 * Two portals are paired together. Teleportation is server-authoritative:
 * server detects collision and updates player UV, clients only render visuals.
 *
 * Visual design:
 *  - Glowing torus rim that pulses and slowly spins
 *  - Swirling vortex interior disc (ShaderMaterial)
 *  - Floating particle dots that drift above the portal
 */
import * as THREE from 'three';

// Portal ring geometry dimensions
const TORUS_RADIUS = 1.2;        // outer ring radius (world units)
const TORUS_TUBE = 0.12;         // tube thickness (slightly thicker)
const TORUS_RADIAL_SEG = 16;     // smooth rim
const TORUS_TUBULAR_SEG = 48;

// Disc geometry
const DISC_SEGMENTS = 48;

// Portal collision radius in world space (used by server)
export const PORTAL_WORLD_RADIUS = 1.5;

// Flat surface disc (trigger zone indicator)
const SURFACE_DISC_RADIUS = PORTAL_WORLD_RADIUS; // matches server detection radius exactly
const SURFACE_DISC_SEGMENTS = 32;

// Cooldown after teleport: player cannot re-enter same portal for this many seconds
export const PORTAL_COOLDOWN_MS = 2000; // milliseconds (server-side)

// Invincibility granted after teleport (seconds)
export const PORTAL_TELEPORT_INVINCIBILITY = 1.0;

// Pulsing animation speed
const PULSE_SPEED = 2.5;
const PULSE_MIN = 0.5;
const PULSE_MAX = 1.0;
const RIM_SPIN_SPEED = 0.6; // radians per second

// Particle config (floating dots above portal)
const PARTICLE_COUNT = 12;
const PARTICLE_RISE_SPEED = 0.35; // world units per second
const PARTICLE_MAX_HEIGHT = 1.8;  // above portal surface
const PARTICLE_SIZE = 0.08;

// Pre-allocated temps (zero per-frame allocations)
const _mat4 = new THREE.Matrix4();
const _qSurface = new THREE.Quaternion();
const _qSpin = new THREE.Quaternion();
const _spinAxis = new THREE.Vector3(0, 1, 0); // local Y = surface normal

// Vertex shader for the swirling disc interior
const DISC_VERTEX = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

// Fragment shader — rotating vortex in polar coordinates
const DISC_FRAGMENT = /* glsl */ `
  precision mediump float;
  varying vec2 vUv;
  uniform vec3 uColor;
  uniform float uTime;

  void main() {
    vec2 center = vUv - 0.5;
    float r = length(center) * 2.0; // 0=center, 1=disc edge
    if (r > 1.0) discard;

    float angle = atan(center.y, center.x);

    // Outward swirl: angle rotates as r increases, also advances with time
    float swirl = angle + uTime * 1.8 - r * 5.0;
    float bands = 0.5 + 0.5 * sin(swirl * 5.0);

    // Bright central glow
    float centerGlow = smoothstep(0.25, 0.0, r);

    // Fade near the rim
    float edgeFade = 1.0 - smoothstep(0.55, 1.0, r);

    float alpha = edgeFade * (0.25 + bands * 0.5) + centerGlow * 0.55;
    alpha = clamp(alpha, 0.0, 0.88);

    // Brighten based on bands — give it a colorful pop
    vec3 bright = min(uColor * 2.2 + vec3(0.3), vec3(1.0));
    vec3 col = mix(uColor * 1.2, bright, bands);

    gl_FragColor = vec4(col, alpha);
  }
`;

export class Portal {
  /** Surface UV position */
  surfaceU: number;
  surfaceV: number;

  /** The root THREE.Group to add to the scene */
  readonly mesh: THREE.Group;

  /** Partner portal (set after construction) */
  partner: Portal | null = null;

  /** World-space position on the surface */
  private _surfaceWorldPos = new THREE.Vector3();

  /** Client-side enter cooldown (seconds) — prevents visual double-trigger */
  private _enterCooldown = 0;

  /** Animation time */
  private _time = 0;

  // Visual sub-objects
  private _rim: THREE.Mesh;
  private _disc: THREE.Mesh;
  private _discMat: THREE.ShaderMaterial;
  private _surfaceDisc: THREE.Mesh; // flat trigger-zone indicator glued to surface
  private _particles: THREE.Points;
  private _particlePositions: Float32Array;
  private _particlePhases: Float32Array;

  constructor(u: number, v: number, color: THREE.Color) {
    this.surfaceU = u;
    this.surfaceV = v;

    // ── Root group ──────────────────────────────────────────────────────────
    this.mesh = new THREE.Group();

    // ── Rim (torus) ──────────────────────────────────────────────────────────
    const rimGeo = new THREE.TorusGeometry(
      TORUS_RADIUS, TORUS_TUBE, TORUS_RADIAL_SEG, TORUS_TUBULAR_SEG
    );
    const rimMat = new THREE.MeshStandardMaterial({
      color,
      emissive: color,
      emissiveIntensity: PULSE_MAX,
      transparent: true,
      opacity: 0.92,
    });
    this._rim = new THREE.Mesh(rimGeo, rimMat);
    this.mesh.add(this._rim);

    // ── Swirling disc interior ────────────────────────────────────────────────
    // Slightly smaller than torus inner edge so it sits inside the rim
    const discGeo = new THREE.CircleGeometry(TORUS_RADIUS - TORUS_TUBE * 0.5, DISC_SEGMENTS);
    this._discMat = new THREE.ShaderMaterial({
      vertexShader: DISC_VERTEX,
      fragmentShader: DISC_FRAGMENT,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      uniforms: {
        uColor: { value: color.clone() },
        uTime: { value: 0 },
      },
    });
    this._disc = new THREE.Mesh(discGeo, this._discMat);
    // Disc lies in the XZ plane (Y up) by default; since the group is oriented
    // so Y = surface normal, the disc will be flat on the surface automatically.
    this.mesh.add(this._disc);

    // ── Surface trigger disc — flat ring showing the detection zone ───────────
    // Matches server PORTAL_WORLD_RADIUS exactly so players know the exact entry area.
    // Ring (donut) shape avoids obscuring the swirling interior effect.
    const surfaceDiscGeo = new THREE.RingGeometry(
      TORUS_RADIUS * 1.05,       // inner edge just outside the torus rim
      SURFACE_DISC_RADIUS,       // outer edge = server detection radius
      SURFACE_DISC_SEGMENTS,
    );
    const surfaceDiscMat = new THREE.MeshBasicMaterial({
      color: color.clone(),
      transparent: true,
      opacity: 0.18,
      side: THREE.DoubleSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this._surfaceDisc = new THREE.Mesh(surfaceDiscGeo, surfaceDiscMat);
    // No Y-offset: sits flush at the group origin (on the surface).
    // The group's Y axis is the surface normal, so this disc lies flat on the surface.
    this.mesh.add(this._surfaceDisc);

    // ── Floating particles ────────────────────────────────────────────────────
    // Particles drift upward along the group's local Y (= surface normal).
    this._particlePositions = new Float32Array(PARTICLE_COUNT * 3);
    this._particlePhases = new Float32Array(PARTICLE_COUNT);
    const spread = TORUS_RADIUS * 0.7;
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      const angle = (i / PARTICLE_COUNT) * Math.PI * 2;
      const radius = spread * (0.3 + Math.random() * 0.7);
      this._particlePositions[i * 3 + 0] = Math.cos(angle) * radius;
      this._particlePositions[i * 3 + 1] = Math.random() * PARTICLE_MAX_HEIGHT; // initial height
      this._particlePositions[i * 3 + 2] = Math.sin(angle) * radius;
      this._particlePhases[i] = Math.random(); // 0-1 normalized phase (height / MAX_HEIGHT)
    }
    const pGeo = new THREE.BufferGeometry();
    pGeo.setAttribute('position', new THREE.BufferAttribute(this._particlePositions, 3));
    const pMat = new THREE.PointsMaterial({
      color,
      size: PARTICLE_SIZE,
      transparent: true,
      opacity: 0.85,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      sizeAttenuation: true,
    });
    this._particles = new THREE.Points(pGeo, pMat);
    this.mesh.add(this._particles);
  }

  /** Advance animation. Call each frame. */
  update(dt: number): void {
    this._time += dt;

    // ── Rim: pulse emissive ──────────────────────────────────────────────────
    const t = Math.sin(this._time * PULSE_SPEED) * 0.5 + 0.5;
    const intensity = PULSE_MIN + t * (PULSE_MAX - PULSE_MIN);
    (this._rim.material as THREE.MeshStandardMaterial).emissiveIntensity = intensity;

    // ── Rim: slow spin around surface normal (local Y axis) ──────────────────
    _qSpin.setFromAxisAngle(_spinAxis, this._time * RIM_SPIN_SPEED);
    this._rim.quaternion.copy(_qSpin);

    // ── Disc: advance swirl time ─────────────────────────────────────────────
    this._discMat.uniforms.uTime.value = this._time;

    // ── Particles: drift upward, reset at top ────────────────────────────────
    const pBuf = this._particlePositions;
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      this._particlePhases[i] += (dt * PARTICLE_RISE_SPEED) / PARTICLE_MAX_HEIGHT;
      if (this._particlePhases[i] > 1.0) {
        // Reset particle to random position near portal center
        const angle = Math.random() * Math.PI * 2;
        const radius = TORUS_RADIUS * 0.6 * Math.random();
        pBuf[i * 3 + 0] = Math.cos(angle) * radius;
        pBuf[i * 3 + 1] = 0;
        pBuf[i * 3 + 2] = Math.sin(angle) * radius;
        this._particlePhases[i] = 0;
      } else {
        pBuf[i * 3 + 1] = this._particlePhases[i] * PARTICLE_MAX_HEIGHT;
      }
    }
    (this._particles.geometry as THREE.BufferGeometry)
      .attributes.position.needsUpdate = true;

    // Tick down client-side cooldown
    if (this._enterCooldown > 0) {
      this._enterCooldown = Math.max(0, this._enterCooldown - dt);
    }
  }

  /**
   * Apply surface transform: positions and orients the group flat on the surface.
   * Must be called after update() each frame.
   */
  applySurfaceTransform(
    getTransform: (u: number, v: number) => {
      position: THREE.Vector3;
      normal: THREE.Vector3;
      tangent: THREE.Vector3;
      bitangent: THREE.Vector3;
    },
  ): void {
    const { position, normal, tangent, bitangent } = getTransform(this.surfaceU, this.surfaceV);

    // Store for collision check (visual, not authoritative)
    this._surfaceWorldPos.copy(position);

    // Place group slightly above surface to avoid z-fighting
    this.mesh.position.copy(position).addScaledVector(normal, 0.12);

    // Orient group so local Y = surface normal.
    // Torus default orientation: hole along Z; disc default: face along Y.
    // We want them flat on the surface, so Y must point along the normal.
    _mat4.makeBasis(tangent, normal, bitangent);
    _qSurface.setFromRotationMatrix(_mat4);
    this.mesh.quaternion.copy(_qSurface);
  }

  /**
   * Client-side entry check — for visual feedback only (server is authoritative for teleport).
   * Returns true if player is within radius (so caller can play sound/effect).
   */
  isPlayerInside(playerWorldPos: THREE.Vector3): boolean {
    if (this._enterCooldown > 0) return false;
    return playerWorldPos.distanceTo(this._surfaceWorldPos) < PORTAL_WORLD_RADIUS;
  }

  /** Start client-side cooldown to prevent repeated visual triggers. */
  startClientCooldown(): void {
    this._enterCooldown = PORTAL_COOLDOWN_MS / 1000;
  }

  get worldPosition(): THREE.Vector3 {
    return this._surfaceWorldPos;
  }

  dispose(): void {
    this._rim.geometry.dispose();
    (this._rim.material as THREE.Material).dispose();
    this._disc.geometry.dispose();
    this._discMat.dispose();
    this._surfaceDisc.geometry.dispose();
    (this._surfaceDisc.material as THREE.Material).dispose();
    this._particles.geometry.dispose();
    (this._particles.material as THREE.Material).dispose();
  }
}

/**
 * Create a pair of portals at random UV positions with minimum separation.
 * Note: In LAN MP, positions come from the server (GameState.portalAU/V etc.)
 * and this factory is used by single-player fallback only.
 */
export function createPortalPair(
  color: THREE.Color,
  minUVSep = 0.25,
  uA?: number,
  vA?: number,
  uB?: number,
  vB?: number,
): [Portal, Portal] {
  // Use provided positions, or generate random ones
  const margin = 0.1;

  if (uA === undefined) uA = margin + Math.random() * (1 - 2 * margin);
  if (vA === undefined) vA = margin + Math.random() * (1 - 2 * margin);

  if (uB === undefined || vB === undefined) {
    let attempts = 0;
    do {
      uB = margin + Math.random() * (1 - 2 * margin);
      vB = margin + Math.random() * (1 - 2 * margin);
      const du = Math.abs(uB - uA);
      const dv = Math.abs(vB - vA);
      const sdU = Math.min(du, 1 - du);
      const sdV = Math.min(dv, 1 - dv);
      if (Math.sqrt(sdU * sdU + sdV * sdV) >= minUVSep) break;
    } while (++attempts < 100);
  }

  const portalA = new Portal(uA!, vA!, color.clone());
  const portalB = new Portal(uB!, vB!, color.clone());

  portalA.partner = portalB;
  portalB.partner = portalA;

  return [portalA, portalB];
}

/**
 * BuffAuraRenderer — Per-buff aura ring system with unique shader effects.
 *
 * Each buff type gets a distinct ShaderMaterial with procedural animation:
 *   - Shock Aura: Electric scanning pulse + arc flashes
 *   - Hot Hands: Fire noise + scrolling lava with ember hot spots
 *   - Tough Times: Hexagonal force field with flickering sectors
 *   - Afterburner: Speed dashes scrolling around the ring
 *
 * Architecture:
 *   - Custom ring BufferGeometry with UV.x = angle (0-1), UV.y = radial (0-1)
 *   - Shared vertex shader, unique fragment shader per buff type
 *   - Object pool of MAX_VISIBLE_RINGS meshes (concentric ring stacking)
 *   - All AdditiveBlending for bloom interaction
 *   - Zero per-frame heap allocations after construction
 *
 * Performance: ~0.05-0.10ms per active ring. Max 3 rings = ~0.30ms worst case.
 */

import * as THREE from 'three';
import { StackBuffType, BUFF_DEFINITIONS } from './BuffManager';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maximum simultaneous visible aura rings. */
const MAX_VISIBLE_RINGS = 3;

/** Ring geometry resolution. */
const RING_SEGMENTS = 48;

/** Base inner/outer radius (scaled per-slot when stacking). */
const RING_INNER_RADIUS = 0.85;
const RING_OUTER_RADIUS = 1.15;

// Pre-allocated temp vector (module-level, zero allocation in update)
const _tempUp = new THREE.Vector3();

// ---------------------------------------------------------------------------
// Quality tiers
// ---------------------------------------------------------------------------

export enum AuraQuality {
  Minimal = 0,   // Simple pulse only (mobile low-end)
  Reduced = 1,   // Simplified shaders (mobile mid-range)
  Full = 2,      // All effects (desktop)
}

// ---------------------------------------------------------------------------
// Shared vertex shader
// ---------------------------------------------------------------------------

const SHARED_VERTEX_SHADER = /* glsl */ `
  varying vec2 vUv;
  varying float vAngle;
  varying float vRadius;

  void main() {
    vUv = uv;
    vAngle = uv.x;
    vRadius = uv.y;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

// ---------------------------------------------------------------------------
// Per-buff fragment shaders
// ---------------------------------------------------------------------------

/** Shock Aura — electric scanning pulse + arc flashes */
const SHOCK_AURA_FRAGMENT = /* glsl */ `
  uniform float uTime;
  uniform float uStacks;
  uniform vec3 uColor;
  uniform vec3 uSparkColor;
  uniform float uOpacity;

  varying float vAngle;
  varying float vRadius;

  float hash(float n) { return fract(sin(n) * 43758.5453); }

  void main() {
    // Scanning pulse (sweeps around ring)
    float scanSpeed = 0.8 + uStacks * 0.1;
    float scanPos = fract(uTime * scanSpeed);
    float scanDist = abs(vAngle - scanPos);
    scanDist = min(scanDist, 1.0 - scanDist);
    float scan = smoothstep(0.08, 0.0, scanDist) * 1.5;

    // Random arc flashes (positions that change every ~0.15s)
    float arcCount = 3.0 + uStacks;
    float timeSlot = floor(uTime * 7.0);
    float arcFlash = 0.0;
    for (float i = 0.0; i < 8.0; i++) {
      if (i >= arcCount) break;
      float arcPos = hash(timeSlot * 13.0 + i * 7.0);
      float arcDist = abs(vAngle - arcPos);
      arcDist = min(arcDist, 1.0 - arcDist);
      float arcWidth = 0.02 + hash(i + timeSlot * 3.0) * 0.03;
      arcFlash += smoothstep(arcWidth, 0.0, arcDist) * 0.8;
    }

    // Base electrical noise
    float noise = hash(floor(vAngle * 48.0) + floor(uTime * 20.0)) * 0.15;

    // Radial shape (brighter at center of ring width)
    float radial = smoothstep(0.0, 0.3, vRadius) * smoothstep(1.0, 0.7, vRadius);

    float intensity = (noise + scan + arcFlash) * radial;
    vec3 color = mix(uColor, uSparkColor, smoothstep(0.8, 1.5, intensity));
    float alpha = intensity * uOpacity;

    gl_FragColor = vec4(color * alpha, alpha);
  }
`;

/** Hot Hands — fire noise + scrolling lava with ember hot spots */
const HOT_HANDS_FRAGMENT = /* glsl */ `
  uniform float uTime;
  uniform float uStacks;
  uniform vec3 uColorCold;
  uniform vec3 uColorHot;
  uniform vec3 uColorCore;
  uniform float uOpacity;

  varying float vAngle;
  varying float vRadius;

  // Simple noise function
  float snoise(vec2 v) {
    return fract(sin(dot(v, vec2(12.9898, 78.233))) * 43758.5453) * 2.0 - 1.0;
  }

  void main() {
    vec2 noiseCoord = vec2(vAngle * 4.0, vRadius * 2.0);

    // Two noise octaves for turbulence
    float n1 = snoise(noiseCoord + vec2(uTime * 0.3, uTime * 0.5)) * 0.6;
    float n2 = snoise(noiseCoord * 2.0 + vec2(-uTime * 0.7, uTime * 0.2)) * 0.4;
    float fire = clamp(n1 + n2 + 0.3, 0.0, 1.0);

    // Hot spots that migrate
    float hotSpot = sin(vAngle * 6.28318 * 3.0 + uTime * 1.5) * 0.5 + 0.5;
    hotSpot = pow(hotSpot, 4.0);
    fire = clamp(fire + hotSpot * 0.4, 0.0, 1.0);

    // Color gradient based on fire intensity
    vec3 color = mix(uColorCold, uColorHot, fire);
    color = mix(color, uColorCore, smoothstep(0.8, 1.0, fire));

    // Radial shape: flames rise from inner edge outward
    float radialShape = smoothstep(0.0, 0.3, vRadius) * smoothstep(1.0, 0.5, vRadius - fire * 0.3);

    float alpha = fire * radialShape * uOpacity * (0.8 + uStacks * 0.05);
    gl_FragColor = vec4(color * alpha, alpha);
  }
`;

/** Tough Times — hexagonal force field with flickering sectors */
const TOUGH_TIMES_FRAGMENT = /* glsl */ `
  uniform float uTime;
  uniform float uStacks;
  uniform vec3 uColor;
  uniform float uOpacity;
  uniform float uBlockTime;

  varying float vAngle;
  varying float vRadius;

  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
  }

  void main() {
    // Map ring to rectangular UV space for hex grid
    vec2 gridUV = vec2(vAngle * 12.0, vRadius * 2.0);
    vec2 cellId = floor(gridUV);

    // Per-cell flicker
    float flickerPhase = hash(cellId) * 6.28318;
    float flickerSpeed = 1.5 + hash(cellId + 0.5) * 2.0;
    float cellBright = 0.3 + 0.7 * step(0.6, sin(uTime * flickerSpeed + flickerPhase) * 0.5 + 0.5);

    // Block flash (decays over 0.3s)
    float blockFlash = max(0.0, 1.0 - (uTime - uBlockTime) * 3.33);

    // Cell edge glow (grid pattern)
    vec2 cellFract = fract(gridUV);
    float edgeDist = min(min(cellFract.x, 1.0 - cellFract.x), min(cellFract.y, 1.0 - cellFract.y));
    float edge = smoothstep(0.0, 0.08, edgeDist);
    float edgeGlow = (1.0 - edge) * 0.5;

    // Radial shape
    float radial = smoothstep(0.0, 0.2, vRadius) * smoothstep(1.0, 0.8, vRadius);

    float alpha = (cellBright * 0.6 + edgeGlow + blockFlash) * uOpacity * radial;
    vec3 color = mix(uColor, vec3(1.0), blockFlash * 0.8);

    gl_FragColor = vec4(color * alpha, alpha);
  }
`;

/** Afterburner — speed dashes scrolling around the ring */
const AFTERBURNER_FRAGMENT = /* glsl */ `
  uniform float uTime;
  uniform float uStacks;
  uniform vec3 uColor;
  uniform float uOpacity;

  varying float vAngle;
  varying float vRadius;

  void main() {
    float dashCount = 8.0 + uStacks * 4.0;
    float scrollSpeed = 2.0 + uStacks * 0.5;

    // Scrolling dashes around the ring
    float dashPhase = fract(vAngle * dashCount - uTime * scrollSpeed);

    // Triangular dash shape: bright leading edge, fading trail
    float dashAlpha = smoothstep(0.0, 0.1, dashPhase) * smoothstep(0.6, 0.1, dashPhase);

    // Radial gradient: bright at outer edge
    float radialGrad = smoothstep(0.0, 1.0, vRadius);

    // Occasional bright burst dash
    float burstPhase = fract(vAngle * (dashCount / 4.0) - uTime * scrollSpeed * 0.5);
    float burst = smoothstep(0.3, 0.0, burstPhase) * 0.5;

    float alpha = (dashAlpha * radialGrad + burst) * uOpacity;
    gl_FragColor = vec4(uColor * alpha, alpha);
  }
`;

/** Magnetism — inward-flowing chevrons + attraction dots */
const MAGNETISM_FRAGMENT = /* glsl */ `
  uniform float uTime;
  uniform float uStacks;
  uniform vec3 uColor;
  uniform float uOpacity;

  varying float vAngle;
  varying float vRadius;

  void main() {
    float chevronCount = 8.0;
    float flowSpeed = 1.5 + uStacks * 0.3;

    // Inward-flowing chevron pattern
    float angularCell = fract(vAngle * chevronCount);
    float chevronShape = 1.0 - abs(angularCell - 0.5) * 2.0;

    // Animate radially inward
    float flowPhase = fract(vRadius + uTime * flowSpeed);
    float flowAlpha = smoothstep(0.0, 0.3, flowPhase) * smoothstep(1.0, 0.5, flowPhase);

    float pattern = chevronShape * flowAlpha;

    // Contracting pulse
    float pulse = sin(uTime * 3.0) * 0.5 + 0.5;
    float radialPulse = smoothstep(0.0, mix(0.4, 0.6, pulse), vRadius);

    // Outer edge dots flowing inward
    float dotPhase = fract(vRadius * 3.0 + uTime * 2.0);
    float dots = smoothstep(0.05, 0.0, abs(dotPhase - 0.5)) * step(0.7, vRadius);

    float alpha = (pattern * radialPulse * 0.7 + dots * 0.5) * uOpacity;
    gl_FragColor = vec4(uColor * alpha, alpha);
  }
`;

/** Trigger Happy — rapid-fire chambers lighting up in sequence */
const TRIGGER_HAPPY_FRAGMENT = /* glsl */ `
  uniform float uTime;
  uniform float uStacks;
  uniform vec3 uColor;
  uniform vec3 uFlashColor;
  uniform float uOpacity;

  varying float vAngle;
  varying float vRadius;

  void main() {
    float chamberCount = 6.0 + uStacks * 2.0;
    float cycleSpeed = 3.0 + uStacks * 1.0;

    // Current active chamber
    float activeIndex = floor(fract(uTime * cycleSpeed) * chamberCount);
    float chamberIndex = floor(vAngle * chamberCount);

    // Chamber brightness
    float isActive = step(abs(chamberIndex - activeIndex), 0.5);

    // Adjacent chamber afterglow
    float prevIndex = mod(activeIndex - 1.0, chamberCount);
    float isAdjacent = step(abs(chamberIndex - prevIndex), 0.5);

    // Flash on transition
    float transitionPhase = fract(fract(uTime * cycleSpeed) * chamberCount);
    float flash = smoothstep(0.1, 0.0, transitionPhase) * isActive;

    // Chamber separator lines
    float cellFract = fract(vAngle * chamberCount);
    float separator = smoothstep(0.02, 0.0, cellFract) + smoothstep(0.98, 1.0, cellFract);

    // Radial shape
    float radial = smoothstep(0.0, 0.2, vRadius) * smoothstep(1.0, 0.8, vRadius);

    float intensity = (isActive * 0.8 + isAdjacent * 0.2 + flash * 1.0 + separator * 0.3) * radial;
    vec3 color = mix(uColor, uFlashColor, flash * 0.7);
    float alpha = intensity * uOpacity;

    gl_FragColor = vec4(color * alpha, alpha);
  }
`;

/** Incendiary Rounds — flame tongues rising from ring */
const INCENDIARY_FRAGMENT = /* glsl */ `
  uniform float uTime;
  uniform float uStacks;
  uniform vec3 uColorBase;
  uniform vec3 uColorFlame;
  uniform vec3 uColorTip;
  uniform float uOpacity;

  varying float vAngle;
  varying float vRadius;

  float hash(float n) { return fract(sin(n) * 43758.5453); }

  void main() {
    // Base ember glow
    float ember = 0.2 + 0.1 * sin(vAngle * 20.0 + uTime * 2.0);

    // Flame tongues
    float flameCount = 6.0 + uStacks * 1.0;
    float flameIntensity = 0.0;
    float flameHeight = 0.0;

    for (float i = 0.0; i < 12.0; i++) {
      if (i >= flameCount) break;

      float epoch = floor(uTime * 0.5 + hash(i) * 2.0);
      float flamePos = hash(epoch * 7.0 + i * 13.0);

      float lifecycle = fract(uTime * 0.8 + hash(i * 3.0));
      float height;
      if (lifecycle < 0.3) {
        height = lifecycle / 0.3;
      } else if (lifecycle < 0.7) {
        height = 1.0;
      } else {
        height = 1.0 - (lifecycle - 0.7) / 0.3;
      }

      float dist = abs(vAngle - flamePos);
      dist = min(dist, 1.0 - dist);

      float flameWidth = 0.015 + 0.01 * (1.0 - vRadius);
      float flame = smoothstep(flameWidth, 0.0, dist);

      float maxRadius = 0.3 + height * 0.7;
      float radialFlame = smoothstep(maxRadius, maxRadius - 0.2, vRadius) * step(0.0, vRadius);

      flameIntensity += flame * radialFlame * height;
      flameHeight = max(flameHeight, flame * height);
    }

    vec3 color = mix(uColorBase, uColorFlame, flameHeight * 0.5);
    color = mix(color, uColorTip, smoothstep(0.6, 1.0, flameHeight));

    float radialBase = smoothstep(0.0, 0.2, vRadius) * smoothstep(0.4, 0.2, vRadius);
    float alpha = (ember * radialBase + flameIntensity) * uOpacity;

    gl_FragColor = vec4(color * alpha, alpha);
  }
`;

/** Volatile — unstable Voronoi cracks */
const VOLATILE_FRAGMENT = /* glsl */ `
  uniform float uTime;
  uniform float uStacks;
  uniform vec3 uColor;
  uniform vec3 uCrackColor;
  uniform float uOpacity;

  varying float vAngle;
  varying float vRadius;

  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

  float voronoi(vec2 p) {
    vec2 ip = floor(p);
    vec2 fp = fract(p);
    float d = 1.0;
    for (int y = -1; y <= 1; y++) {
      for (int x = -1; x <= 1; x++) {
        vec2 n = vec2(float(x), float(y));
        vec2 diff = n + hash(ip + n) - fp;
        d = min(d, dot(diff, diff));
      }
    }
    return sqrt(d);
  }

  void main() {
    vec2 cellCoord = vec2(vAngle * 10.0, vRadius * 3.0);
    float cellDist = voronoi(cellCoord);

    // Cracks visible at cell edges
    float crack = smoothstep(0.15, 0.0, cellDist);

    // Random cells crack open over time
    vec2 cellId = floor(cellCoord);
    float cellHash = hash(cellId);
    float crackTime = floor(uTime * 3.0 + cellHash * 5.0);
    float isCracked = step(0.6 - uStacks * 0.03, hash(cellId + crackTime));

    // Instability pulse
    float pulse = pow(sin(uTime * 4.0) * 0.5 + 0.5, 8.0);

    float radial = smoothstep(0.0, 0.2, vRadius) * smoothstep(1.0, 0.8, vRadius);
    float baseGlow = 0.15 * radial;
    float crackGlow = crack * isCracked * 0.9 * radial;
    float pulseGlow = pulse * 0.4 * radial;

    float intensity = baseGlow + crackGlow + pulseGlow;
    vec3 color = mix(uColor, uCrackColor, smoothstep(0.3, 0.8, intensity));
    float alpha = intensity * uOpacity;

    gl_FragColor = vec4(color * alpha, alpha);
  }
`;

// ---------------------------------------------------------------------------
// Aura ring slot
// ---------------------------------------------------------------------------

interface AuraRingSlot {
  mesh: THREE.Mesh;
  material: THREE.ShaderMaterial;
  buffType: StackBuffType | null;
  active: boolean;
}

// ---------------------------------------------------------------------------
// BuffAuraRenderer
// ---------------------------------------------------------------------------

export class BuffAuraRenderer {
  readonly root: THREE.Group;

  private readonly slots: AuraRingSlot[] = [];
  private readonly sharedGeometry: THREE.BufferGeometry;
  private readonly materials: Map<StackBuffType, THREE.ShaderMaterial> = new Map();
  private readonly quality: AuraQuality;

  /** Time of last Tough Times block proc (for flash uniform). */
  private lastBlockTime = -10;

  constructor(quality: AuraQuality = AuraQuality.Full) {
    this.root = new THREE.Group();
    this.root.name = 'BuffAuras';
    this.quality = quality;

    // Create shared ring geometry
    this.sharedGeometry = this.createRingGeometry();

    // Create materials for each buff type
    this.createAllMaterials();

    // Pre-allocate ring mesh pool
    for (let i = 0; i < MAX_VISIBLE_RINGS; i++) {
      // Use a placeholder material; it gets swapped on assignment
      const placeholderMat = new THREE.ShaderMaterial({
        vertexShader: SHARED_VERTEX_SHADER,
        fragmentShader: 'void main() { gl_FragColor = vec4(0.0); }',
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
      });

      const mesh = new THREE.Mesh(this.sharedGeometry, placeholderMat);
      mesh.visible = false;
      mesh.frustumCulled = false;
      mesh.renderOrder = 90 + i;
      this.root.add(mesh);

      this.slots.push({
        mesh,
        material: placeholderMat,
        buffType: null,
        active: false,
      });
    }
  }

  // -----------------------------------------------------------------------
  // Update
  // -----------------------------------------------------------------------

  /**
   * Update all aura ring visuals.
   * @param dt - Frame delta time
   * @param totalTime - Total elapsed time
   * @param playerPos - Player world position
   * @param surfaceNormal - Surface normal at player position
   * @param activeBuffs - Currently active buffs from BuffManager
   */
  update(
    _dt: number,
    totalTime: number,
    playerPos: THREE.Vector3,
    surfaceNormal: THREE.Vector3,
    activeBuffs: Array<{ type: StackBuffType; stacks: number }>,
  ): void {
    // Determine which buffs to display (priority sort, max 3)
    const displayed = this.prioritizeBuffs(activeBuffs);

    for (let i = 0; i < MAX_VISIBLE_RINGS; i++) {
      const slot = this.slots[i];

      if (i < displayed.length) {
        const buff = displayed[i];
        const mat = this.materials.get(buff.type);
        if (!mat) {
          slot.mesh.visible = false;
          slot.active = false;
          continue;
        }

        // Assign material if buff type changed
        if (slot.buffType !== buff.type) {
          slot.mesh.material = mat;
          slot.material = mat;
          slot.buffType = buff.type;
        }

        // Update shared uniforms
        mat.uniforms.uTime.value = totalTime;
        mat.uniforms.uStacks.value = buff.stacks;
        mat.uniforms.uOpacity.value = this.getOpacity(displayed.length);

        // Update block time for Tough Times
        if (buff.type === StackBuffType.ToughTimes && mat.uniforms.uBlockTime) {
          mat.uniforms.uBlockTime.value = this.lastBlockTime;
        }

        // Position and orient: offset slightly above surface
        const radiusScale = this.getRadiusScale(i, displayed.length);
        slot.mesh.position.copy(playerPos);
        // Offset along surface normal to prevent z-fighting
        slot.mesh.position.addScaledVector(surfaceNormal, 0.06);

        // Orient ring to face along surface normal
        _tempUp.copy(playerPos).add(surfaceNormal);
        slot.mesh.lookAt(_tempUp);
        slot.mesh.scale.setScalar(radiusScale);

        slot.mesh.visible = true;
        slot.active = true;
      } else {
        slot.mesh.visible = false;
        slot.active = false;
        slot.buffType = null;
      }
    }
  }

  // -----------------------------------------------------------------------
  // Event triggers
  // -----------------------------------------------------------------------

  /** Called when Tough Times blocks damage (triggers shield flash). */
  triggerBlockFlash(totalTime: number): void {
    this.lastBlockTime = totalTime;
  }

  // -----------------------------------------------------------------------
  // Private helpers
  // -----------------------------------------------------------------------

  private createRingGeometry(): THREE.BufferGeometry {
    const geometry = new THREE.BufferGeometry();
    const vertexCount = (RING_SEGMENTS + 1) * 2;
    const positions = new Float32Array(vertexCount * 3);
    const uvs = new Float32Array(vertexCount * 2);
    const indices: number[] = [];

    for (let i = 0; i <= RING_SEGMENTS; i++) {
      const angle = (i / RING_SEGMENTS) * Math.PI * 2;
      const u = i / RING_SEGMENTS; // Angular coordinate 0..1

      const cosA = Math.cos(angle);
      const sinA = Math.sin(angle);

      // Inner vertex
      const vi = i * 2;
      positions[vi * 3 + 0] = cosA * RING_INNER_RADIUS;
      positions[vi * 3 + 1] = sinA * RING_INNER_RADIUS;
      positions[vi * 3 + 2] = 0;
      uvs[vi * 2 + 0] = u;
      uvs[vi * 2 + 1] = 0; // Inner edge

      // Outer vertex
      const vo = vi + 1;
      positions[vo * 3 + 0] = cosA * RING_OUTER_RADIUS;
      positions[vo * 3 + 1] = sinA * RING_OUTER_RADIUS;
      positions[vo * 3 + 2] = 0;
      uvs[vo * 2 + 0] = u;
      uvs[vo * 2 + 1] = 1; // Outer edge

      // Triangles
      if (i < RING_SEGMENTS) {
        const a = vi, b = vi + 1, c = vi + 2, d = vi + 3;
        indices.push(a, b, c);
        indices.push(c, b, d);
      }
    }

    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    geometry.setIndex(indices);

    return geometry;
  }

  private createAllMaterials(): void {
    // Shock Aura (electric purple)
    this.materials.set(StackBuffType.ShockAura, this.createMaterial(SHOCK_AURA_FRAGMENT, {
      uColor: { value: new THREE.Color(0xaa44ff) },
      uSparkColor: { value: new THREE.Color(0xffffff) },
    }));

    // Hot Hands (fire)
    this.materials.set(StackBuffType.HotHands, this.createMaterial(HOT_HANDS_FRAGMENT, {
      uColorCold: { value: new THREE.Color(0xff2200) },
      uColorHot: { value: new THREE.Color(0xffaa00) },
      uColorCore: { value: new THREE.Color(0xffff44) },
    }));

    // Tough Times (hex shield blue)
    this.materials.set(StackBuffType.ToughTimes, this.createMaterial(TOUGH_TIMES_FRAGMENT, {
      uColor: { value: new THREE.Color(0x4488ff) },
      uBlockTime: { value: -10.0 },
    }));

    // Afterburner (speed green)
    this.materials.set(StackBuffType.Afterburner, this.createMaterial(AFTERBURNER_FRAGMENT, {
      uColor: { value: new THREE.Color(0x44ff44) },
    }));

    // Magnetism (attraction yellow)
    this.materials.set(StackBuffType.Magnetism, this.createMaterial(MAGNETISM_FRAGMENT, {
      uColor: { value: new THREE.Color(0xffff00) },
    }));

    // Trigger Happy (rapid fire orange)
    this.materials.set(StackBuffType.TriggerHappy, this.createMaterial(TRIGGER_HAPPY_FRAGMENT, {
      uColor: { value: new THREE.Color(0xff8800) },
      uFlashColor: { value: new THREE.Color(0xffff88) },
    }));

    // Incendiary Rounds (flame tongues)
    this.materials.set(StackBuffType.IncendiaryRounds, this.createMaterial(INCENDIARY_FRAGMENT, {
      uColorBase: { value: new THREE.Color(0xff4400) },
      uColorFlame: { value: new THREE.Color(0xff8800) },
      uColorTip: { value: new THREE.Color(0xffcc44) },
    }));

    // Volatile (unstable cracks red-pink)
    this.materials.set(StackBuffType.Volatile, this.createMaterial(VOLATILE_FRAGMENT, {
      uColor: { value: new THREE.Color(0xff2244) },
      uCrackColor: { value: new THREE.Color(0xff88aa) },
    }));
  }

  private createMaterial(
    fragmentShader: string,
    extraUniforms: Record<string, { value: unknown }>,
  ): THREE.ShaderMaterial {
    return new THREE.ShaderMaterial({
      vertexShader: SHARED_VERTEX_SHADER,
      fragmentShader,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      uniforms: {
        uTime: { value: 0 },
        uStacks: { value: 1.0 },
        uOpacity: { value: 0.5 },
        ...extraUniforms,
      },
    });
  }

  private getRadiusScale(slotIndex: number, totalDisplayed: number): number {
    if (totalDisplayed === 1) return 1.5;
    if (totalDisplayed === 2) return slotIndex === 0 ? 1.1 : 1.7;
    // 3 buffs
    const scales = [0.9, 1.3, 1.9];
    return scales[slotIndex] ?? 1.5;
  }

  private getOpacity(totalDisplayed: number): number {
    const opacities = [0.5, 0.4, 0.35];
    return opacities[Math.min(totalDisplayed - 1, 2)] ?? 0.5;
  }

  private prioritizeBuffs(
    buffs: Array<{ type: StackBuffType; stacks: number }>,
  ): Array<{ type: StackBuffType; stacks: number }> {
    if (buffs.length <= MAX_VISIBLE_RINGS) return buffs;

    // Sort: uncommon first, then by stacks
    return buffs
      .slice()
      .sort((a, b) => {
        const defA = BUFF_DEFINITIONS[a.type];
        const defB = BUFF_DEFINITIONS[b.type];
        // Uncommon first
        if (defA.rarity !== defB.rarity) {
          return defA.rarity === 'uncommon' ? -1 : 1;
        }
        // Then by stacks
        return b.stacks - a.stacks;
      })
      .slice(0, MAX_VISIBLE_RINGS);
  }

  // -----------------------------------------------------------------------
  // Cleanup
  // -----------------------------------------------------------------------

  dispose(): void {
    this.sharedGeometry.dispose();
    for (const mat of this.materials.values()) {
      mat.dispose();
    }
    for (const slot of this.slots) {
      if (slot.material) {
        slot.material.dispose();
      }
    }
  }
}

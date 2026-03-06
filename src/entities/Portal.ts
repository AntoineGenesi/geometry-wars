/**
 * Portal — A teleportation portal placed on the game surface.
 *
 * Two portals are paired together. Walking into one teleports the player
 * to the other. After teleporting, a brief cooldown prevents re-entering.
 * Visually: a glowing torus ring with inverse theme color, pulsing.
 */
import * as THREE from 'three';

// Portal ring geometry dimensions
const TORUS_RADIUS = 1.2;        // outer ring radius (world units)
const TORUS_TUBE = 0.1;          // tube thickness
const TORUS_RADIAL_SEG = 8;
const TORUS_TUBULAR_SEG = 32;

// Portal collision radius in world space
export const PORTAL_WORLD_RADIUS = 1.5;

// Cooldown: player cannot re-enter same portal for this many seconds after teleporting
const ENTER_COOLDOWN = 2.0;

// Invincibility granted after teleport (seconds)
export const PORTAL_TELEPORT_INVINCIBILITY = 1.0;

// Pulsing animation speed
const PULSE_SPEED = 2.5;
const PULSE_MIN = 0.55;
const PULSE_MAX = 0.95;

// Pre-allocated temps (zero per-frame allocations)
const _mat4 = new THREE.Matrix4();
const _qSurface = new THREE.Quaternion();

export class Portal {
  /** Surface UV position */
  surfaceU: number;
  surfaceV: number;

  /** The THREE.Mesh representing the portal ring */
  readonly mesh: THREE.Mesh;

  /** World-space position on the surface (updated each frame via applySurfaceTransform) */
  private _surfaceWorldPos = new THREE.Vector3();

  /** Timer tracking how long since THIS portal was last exited through (cooldown) */
  private _enterCooldown = 0;

  /** Animation time accumulator */
  private _time = 0;

  /** The paired partner portal (set after construction) */
  partner: Portal | null = null;

  constructor(u: number, v: number, color: THREE.Color) {
    this.surfaceU = u;
    this.surfaceV = v;

    const geo = new THREE.TorusGeometry(TORUS_RADIUS, TORUS_TUBE, TORUS_RADIAL_SEG, TORUS_TUBULAR_SEG);
    const mat = new THREE.MeshStandardMaterial({
      color,
      emissive: color,
      emissiveIntensity: PULSE_MAX,
      transparent: true,
      opacity: 0.85,
    });
    this.mesh = new THREE.Mesh(geo, mat);
  }

  /** Advance animation. Call each frame. */
  update(dt: number): void {
    this._time += dt;

    // Pulse emissive intensity
    const t = Math.sin(this._time * PULSE_SPEED) * 0.5 + 0.5; // 0–1
    const intensity = PULSE_MIN + t * (PULSE_MAX - PULSE_MIN);
    (this.mesh.material as THREE.MeshStandardMaterial).emissiveIntensity = intensity;

    // Tick down cooldown
    if (this._enterCooldown > 0) {
      this._enterCooldown = Math.max(0, this._enterCooldown - dt);
    }
  }

  /**
   * Apply surface transform: positions and orients the ring flat on the surface.
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

    // Store surface world position for collision detection
    this._surfaceWorldPos.copy(position);

    // Place ring slightly above surface to avoid z-fighting
    this.mesh.position.copy(position).addScaledVector(normal, 0.12);

    // Orient ring so its face aligns with the surface normal
    // The torus lies in the XZ plane by default, so we set basis = (tangent, normal, bitangent)
    _mat4.makeBasis(tangent, normal, bitangent);
    _qSurface.setFromRotationMatrix(_mat4);
    this.mesh.quaternion.copy(_qSurface);
  }

  /**
   * Check whether a player at the given world position should be teleported.
   * Returns the partner portal's UV position if teleport should occur, or null.
   *
   * @param playerWorldPos — player world-space position
   * @returns { u, v } of the exit portal, or null
   */
  checkTeleport(playerWorldPos: THREE.Vector3): { u: number; v: number } | null {
    if (!this.partner) return null;
    if (this._enterCooldown > 0) return null;

    const dist = playerWorldPos.distanceTo(this._surfaceWorldPos);
    if (dist < PORTAL_WORLD_RADIUS) {
      return { u: this.partner.surfaceU, v: this.partner.surfaceV };
    }
    return null;
  }

  /**
   * Called when this portal is used as the EXIT of a teleport.
   * Starts the cooldown so the player doesn't instantly re-enter.
   */
  startExitCooldown(): void {
    this._enterCooldown = ENTER_COOLDOWN;
  }

  /** Get the surface world position (for debug / external checks). */
  get worldPosition(): THREE.Vector3 {
    return this._surfaceWorldPos;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}

/**
 * Create a pair of portals at random UV positions with minimum separation.
 *
 * @param color — portal ring color
 * @param minUVSep — minimum UV-space separation between portals (default 0.25)
 * @returns [portalA, portalB]
 */
export function createPortalPair(
  color: THREE.Color,
  minUVSep = 0.25,
): [Portal, Portal] {
  // Choose first portal at a random UV position away from edges
  const margin = 0.1;

  const uA = margin + Math.random() * (1 - 2 * margin);
  const vA = margin + Math.random() * (1 - 2 * margin);

  // Choose second portal far enough away from the first
  let uB: number, vB: number;
  let attempts = 0;
  do {
    uB = margin + Math.random() * (1 - 2 * margin);
    vB = margin + Math.random() * (1 - 2 * margin);
    const du = Math.abs(uB - uA);
    const dv = Math.abs(vB - vA);
    // Seam-safe shortest path
    const sdU = Math.min(du, 1 - du);
    const sdV = Math.min(dv, 1 - dv);
    if (Math.sqrt(sdU * sdU + sdV * sdV) >= minUVSep) break;
    attempts++;
  } while (attempts < 100);

  const portalA = new Portal(uA, vA, color.clone());
  const portalB = new Portal(uB, vB, color.clone());

  // Link them
  portalA.partner = portalB;
  portalB.partner = portalA;

  return [portalA, portalB];
}

/**
 * PlasmaExplosionEffect — Expanding shockwave ring for Plasma Mortar impacts.
 *
 * Creates a visible world-space ring that expands outward from the blast center,
 * damaging any enemies it passes through. Unlike the instant AoE blast (radius 3),
 * this ring sweeps through enemies over ~0.4s, creating a secondary damage wave.
 *
 * Features:
 *   - Up to 4 simultaneous rings (pre-allocated, zero GC after construction)
 *   - Ring oriented along impact surface normal (outward from origin)
 *   - Fades out as it expands (opacity decays with radius)
 *   - Tracks which enemies were hit to prevent double-damage
 *   - Damage applies only to enemies in the current ring band (prevRadius → currentRadius)
 *
 * Performance: 4 draw calls max (one per active ring). Ring geometry is shared.
 */

import * as THREE from 'three';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_RINGS = 4;

/** Inner radius ratio of the ring geometry (0..1 relative to unit circle). */
const RING_INNER_RATIO = 0.80;

/** Outer radius (unit circle). */
const RING_OUTER_RATIO = 1.0;

/** Ring segments — enough for smooth circle, cheap to render. */
const RING_SEGMENTS = 40;

/** Max radius the ring expands to (world units). */
const RING_MAX_RADIUS = 10.0;

/** Expansion speed (world units / second). */
const RING_SPEED = 22.0;

/** Total lifetime of the ring in seconds (stops when max radius reached). */
const RING_MAX_AGE = RING_MAX_RADIUS / RING_SPEED; // ~0.45s

/** Damage dealt to each enemy the ring passes through. */
const RING_DAMAGE = 8.0;

/** Ring color — plasma green matching the mortar weapon. */
const RING_COLOR = new THREE.Color(0x44ff88);

// Pre-allocated temp vectors
const _up = new THREE.Vector3(0, 1, 0);
const _tempNormal = new THREE.Vector3();
const _rotAxis = new THREE.Vector3();

// ---------------------------------------------------------------------------
// Ring slot
// ---------------------------------------------------------------------------

interface RingSlot {
  /** Additive ring mesh (scaled each frame). */
  mesh: THREE.Mesh;
  /** Impact center in world space. */
  center: THREE.Vector3;
  /** Outward normal at impact point (for ring orientation). */
  normal: THREE.Vector3;
  /** Ring radius at start of current frame. */
  prevRadius: number;
  /** Ring radius at end of current frame. */
  currentRadius: number;
  /** Maximum radius before deactivating. */
  maxRadius: number;
  /** Ring expansion speed in world units / second. */
  speed: number;
  /** Age in seconds (for fade). */
  age: number;
  /** Max age for fade calculation. */
  maxAge: number;
  /** Damage dealt to enemies in the ring band. */
  damage: number;
  /** Enemies already hit by this ring — tracked by object reference for stable identity. */
  hitEnemies: Set<object>;
  /** Whether this slot is active. */
  active: boolean;
}

// ---------------------------------------------------------------------------
// PlasmaExplosionEffect
// ---------------------------------------------------------------------------

export class PlasmaExplosionEffect {
  /** All ring meshes parented to this group — add to scene once. */
  readonly root: THREE.Group;

  private readonly slots: RingSlot[];
  private readonly ringGeometry: THREE.RingGeometry;
  private readonly ringMaterial: THREE.MeshBasicMaterial;

  constructor() {
    this.root = new THREE.Group();
    this.root.name = 'PlasmaExplosionEffect';

    // Shared geometry for all rings (unit circle, scaled per-slot)
    this.ringGeometry = new THREE.RingGeometry(RING_INNER_RATIO, RING_OUTER_RATIO, RING_SEGMENTS);

    // Additive blending for plasma energy look — see-through, glows against dark bg
    this.ringMaterial = new THREE.MeshBasicMaterial({
      color: RING_COLOR,
      transparent: true,
      opacity: 0.9,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });

    // Pre-allocate all ring slots
    this.slots = [];
    for (let i = 0; i < MAX_RINGS; i++) {
      // Each slot gets its own mesh (can't reuse since they may differ in position/scale)
      const mesh = new THREE.Mesh(this.ringGeometry, this.ringMaterial.clone());
      mesh.visible = false;
      mesh.frustumCulled = false;
      this.root.add(mesh);

      this.slots.push({
        mesh,
        center: new THREE.Vector3(),
        normal: new THREE.Vector3(0, 1, 0),
        prevRadius: 0,
        currentRadius: 0,
        maxRadius: RING_MAX_RADIUS,
        speed: RING_SPEED,
        age: 0,
        maxAge: RING_MAX_AGE,
        damage: RING_DAMAGE,
        hitEnemies: new Set(),
        active: false,
      });
    }
  }

  /**
   * Spawn a new plasma explosion ring at the given world position.
   *
   * @param position - Impact point in world space
   * @param damage   - Damage to apply per enemy (default: RING_DAMAGE)
   */
  spawn(position: THREE.Vector3, damage: number = RING_DAMAGE): void {
    // Find inactive slot (steal oldest if all busy)
    let slot: RingSlot | null = null;
    for (const s of this.slots) {
      if (!s.active) {
        slot = s;
        break;
      }
    }
    if (!slot) {
      // All slots busy — steal the most-expired one
      let maxAge = -1;
      for (const s of this.slots) {
        if (s.age > maxAge) {
          maxAge = s.age;
          slot = s;
        }
      }
    }
    if (!slot) return;

    slot.center.copy(position);
    slot.prevRadius = 0;
    slot.currentRadius = 0;
    slot.maxRadius = RING_MAX_RADIUS;
    slot.speed = RING_SPEED;
    slot.age = 0;
    slot.maxAge = RING_MAX_AGE;
    slot.damage = damage;
    slot.active = true;
    slot.hitEnemies.clear();

    // Orient ring perpendicular to the outward direction from scene origin.
    // For surface-based games, this approximates the surface normal.
    _tempNormal.copy(position).normalize();
    if (_tempNormal.lengthSq() < 0.0001) {
      _tempNormal.set(0, 1, 0);
    }
    slot.normal.copy(_tempNormal);

    // Orient the mesh so it faces along the surface normal.
    // RingGeometry lies in the XY plane by default (normal = +Z).
    // We rotate to align +Z with the surface normal.
    const angle = Math.acos(Math.min(1, Math.max(-1, _up.dot(_tempNormal))));
    if (Math.abs(angle) > 0.001 && Math.abs(angle - Math.PI) > 0.001) {
      _rotAxis.crossVectors(_up, _tempNormal).normalize();
      slot.mesh.quaternion.setFromAxisAngle(_rotAxis, angle);
    } else if (angle > Math.PI / 2) {
      // 180 degrees flip
      slot.mesh.quaternion.setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI);
    } else {
      slot.mesh.quaternion.identity();
    }

    slot.mesh.position.copy(position);
    slot.mesh.scale.setScalar(0.001); // Near-zero start (avoid flicker at scale=0)
    slot.mesh.visible = true;
    (slot.mesh.material as THREE.MeshBasicMaterial).opacity = 0.9;
  }

  /**
   * Update all active rings. Call once per fixed update frame.
   *
   * @param dt       - Delta time in seconds
   * @param enemies  - Current enemy list (for damage testing). Pass BaseEnemy[] directly
   *                   so enemy object references serve as stable hit-tracking identities.
   * @param onDamage - Callback to apply damage to an enemy object
   */
  update(
    dt: number,
    enemies: Array<{ position: THREE.Vector3; alive: boolean }>,
    onDamage: (enemy: { position: THREE.Vector3; alive: boolean }, damage: number) => void,
  ): void {
    for (const slot of this.slots) {
      if (!slot.active) continue;

      slot.age += dt;

      // Advance ring front
      slot.prevRadius = slot.currentRadius;
      slot.currentRadius = Math.min(slot.maxRadius, slot.prevRadius + slot.speed * dt);

      // Deactivate when ring has expanded to max radius
      if (slot.prevRadius >= slot.maxRadius) {
        slot.active = false;
        slot.mesh.visible = false;
        continue;
      }

      // Update mesh scale (RingGeometry unit circle → scale = currentRadius)
      slot.mesh.scale.setScalar(Math.max(0.001, slot.currentRadius));

      // Fade opacity as ring expands (starts at 0.9, ends at 0)
      const lifeFraction = 1.0 - slot.age / slot.maxAge;
      (slot.mesh.material as THREE.MeshBasicMaterial).opacity = 0.9 * Math.max(0, lifeFraction);

      // Apply damage to enemies in the ring band [prevRadius, currentRadius].
      // The sweeping band naturally prevents double-hits, but we also track by
      // object reference as a safety net for edge cases (e.g. enemy teleports backward).
      const prevR = slot.prevRadius;
      const currR = slot.currentRadius;

      for (const enemy of enemies) {
        if (!enemy.alive) continue;
        if (slot.hitEnemies.has(enemy)) continue; // already hit

        const dist = slot.center.distanceTo(enemy.position);
        if (dist >= prevR && dist < currR) {
          slot.hitEnemies.add(enemy);
          onDamage(enemy, slot.damage);
        }
      }
    }
  }

  /** Number of currently active rings (for debugging/testing). */
  getActiveRingCount(): number {
    let count = 0;
    for (const s of this.slots) {
      if (s.active) count++;
    }
    return count;
  }

  dispose(): void {
    this.ringGeometry.dispose();
    for (const slot of this.slots) {
      slot.active = false;
      slot.mesh.visible = false;
      (slot.mesh.material as THREE.MeshBasicMaterial).dispose();
    }
    this.ringMaterial.dispose();
  }
}

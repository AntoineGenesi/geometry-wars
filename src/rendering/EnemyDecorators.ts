import * as THREE from 'three';
import { BaseEnemy } from '../entities/enemies/BaseEnemy';

/**
 * EnemyDecorators - Manages additional visual elements that follow enemies.
 *
 * Since InstancedMesh shares one geometry/material per enemy type, we can't
 * change individual enemy shapes. Instead, this system adds SEPARATE visual
 * elements that orbit, pulse, and trail around enemies:
 *
 * - Orbiting motes: tiny glowing spheres that circle enemies
 * - Inner cores: bright point-light-like centers visible through the wireframe
 * - Trailing wisps: short particle tails that follow enemy movement
 *
 * All decorators are pre-allocated (object pool) and assigned to enemies on
 * registration. When an enemy dies, its decorators are recycled.
 *
 * Performance budget:
 * - Max 200 decorator particles total across all enemies
 * - Each decorator type is ONE InstancedMesh (1 draw call)
 * - Zero per-frame JS allocations
 */

// ---------------------------------------------------------------------------
// Configuration per enemy type
// ---------------------------------------------------------------------------

export interface DecoratorConfig {
  /** Number of orbiting motes around this enemy. */
  orbitingMotes: number;
  /** Orbit radius for motes. */
  orbitRadius: number;
  /** Orbit speed (radians/sec). */
  orbitSpeed: number;
  /** Color of the motes. */
  moteColor: number;
  /** Mote size. */
  moteSize: number;
  /** Whether to show an inner glowing core. */
  innerCore: boolean;
  /** Inner core color. */
  coreColor: number;
  /** Inner core size multiplier (relative to enemy radius). */
  coreSize: number;
  /** Core pulse speed. */
  corePulseSpeed: number;
}

const DEFAULT_CONFIG: DecoratorConfig = {
  orbitingMotes: 0,
  orbitRadius: 0.15,
  orbitSpeed: 2.0,
  moteColor: 0xffffff,
  moteSize: 0.02,
  innerCore: false,
  coreColor: 0xffffff,
  coreSize: 0.3,
  corePulseSpeed: 3.0,
};

/** Decorator configs per enemy type name. */
const DECORATOR_CONFIGS: Record<string, Partial<DecoratorConfig>> = {
  // Lava lamp enemies: warm orbiting motes + bright core
  Wanderer: {
    orbitingMotes: 3,
    orbitRadius: 0.2,
    orbitSpeed: 2.5,
    moteColor: 0xff6600,
    moteSize: 0.018,
    innerCore: true,
    coreColor: 0xffaa44,
    coreSize: 0.25,
    corePulseSpeed: 2.0,
  },
  Helix: {
    orbitingMotes: 2,
    orbitRadius: 0.15,
    orbitSpeed: 3.0,
    moteColor: 0x00eeff,
    moteSize: 0.015,
    innerCore: true,
    coreColor: 0x00ccff,
    coreSize: 0.2,
    corePulseSpeed: 4.0,
  },
  Lurker: {
    orbitingMotes: 2,
    orbitRadius: 0.18,
    orbitSpeed: 1.5,
    moteColor: 0x884488,
    moteSize: 0.02,
    innerCore: true,
    coreColor: 0xaa44aa,
    coreSize: 0.3,
    corePulseSpeed: 1.5,
  },

  // Crystal enemies: sharp orbiting specks + bright faceted core
  Grunt: {
    orbitingMotes: 2,
    orbitRadius: 0.18,
    orbitSpeed: 1.8,
    moteColor: 0x6666ff,
    moteSize: 0.015,
    innerCore: true,
    coreColor: 0x8888ff,
    coreSize: 0.2,
    corePulseSpeed: 5.0,
  },
  Weaver: {
    orbitingMotes: 3,
    orbitRadius: 0.2,
    orbitSpeed: 2.2,
    moteColor: 0x22ff66,
    moteSize: 0.015,
    innerCore: true,
    coreColor: 0x44ff88,
    coreSize: 0.22,
    corePulseSpeed: 3.5,
  },
  Duck: {
    orbitingMotes: 2,
    orbitRadius: 0.15,
    orbitSpeed: 2.0,
    moteColor: 0xffff00,
    moteSize: 0.015,
    innerCore: true,
    coreColor: 0xffee44,
    coreSize: 0.18,
    corePulseSpeed: 4.0,
  },

  // Pulse enemies: rhythmic motes + pulsing core
  Spinner: {
    orbitingMotes: 4,
    orbitRadius: 0.22,
    orbitSpeed: 3.5,
    moteColor: 0xff44ff,
    moteSize: 0.02,
    innerCore: true,
    coreColor: 0xff88ff,
    coreSize: 0.25,
    corePulseSpeed: 4.0,
  },
  SpinnerSpawn: {
    orbitingMotes: 2,
    orbitRadius: 0.12,
    orbitSpeed: 4.0,
    moteColor: 0xff66ff,
    moteSize: 0.012,
    innerCore: false,
    coreColor: 0xff88ff,
    coreSize: 0.15,
    corePulseSpeed: 5.0,
  },
  Rocket: {
    orbitingMotes: 2,
    orbitRadius: 0.16,
    orbitSpeed: 2.5,
    moteColor: 0xff9900,
    moteSize: 0.018,
    innerCore: true,
    coreColor: 0xffbb44,
    coreSize: 0.2,
    corePulseSpeed: 6.0,
  },
  Neutron: {
    orbitingMotes: 3,
    orbitRadius: 0.2,
    orbitSpeed: 2.0,
    moteColor: 0x44aaff,
    moteSize: 0.018,
    innerCore: true,
    coreColor: 0x66ccff,
    coreSize: 0.25,
    corePulseSpeed: 3.0,
  },

  // Nebula enemies: scattered motes + diffuse core
  Virus: {
    orbitingMotes: 4,
    orbitRadius: 0.25,
    orbitSpeed: 1.5,
    moteColor: 0x88ff88,
    moteSize: 0.022,
    innerCore: true,
    coreColor: 0xaaffaa,
    coreSize: 0.3,
    corePulseSpeed: 2.0,
  },
  Orbiter: {
    orbitingMotes: 3,
    orbitRadius: 0.2,
    orbitSpeed: 2.8,
    moteColor: 0xffaa00,
    moteSize: 0.02,
    innerCore: true,
    coreColor: 0xffcc44,
    coreSize: 0.25,
    corePulseSpeed: 2.5,
  },
  Splitter: {
    orbitingMotes: 3,
    orbitRadius: 0.22,
    orbitSpeed: 2.0,
    moteColor: 0xff4444,
    moteSize: 0.02,
    innerCore: true,
    coreColor: 0xff6666,
    coreSize: 0.28,
    corePulseSpeed: 3.0,
  },
};

/** Get the full decorator config for an enemy type. */
function getDecoratorConfig(typeName: string): DecoratorConfig {
  const partial = DECORATOR_CONFIGS[typeName];
  if (!partial) return DEFAULT_CONFIG;
  return { ...DEFAULT_CONFIG, ...partial };
}

// ---------------------------------------------------------------------------
// Pool sizes
// ---------------------------------------------------------------------------

/** Max orbiting motes across all enemies. */
const MAX_MOTES = 150;
/** Max inner cores across all enemies. */
const MAX_CORES = 80;

// ---------------------------------------------------------------------------
// Pre-allocated temp objects
// ---------------------------------------------------------------------------

const _tempMoteMatrix = new THREE.Matrix4();
const _tempMotePos = new THREE.Vector3();
const _tempMoteQuat = new THREE.Quaternion();
const _tempMoteScale = new THREE.Vector3();
const _zeroScale = new THREE.Vector3(0, 0, 0);
const _tempCoreAxis = new THREE.Vector3(); // Pre-allocated axis for core rotation (was .clone() per core per frame)

// ---------------------------------------------------------------------------
// Mote data (orbiting particles)
// ---------------------------------------------------------------------------

interface MoteSlot {
  active: boolean;
  /** Enemy this mote belongs to. */
  owner: BaseEnemy | null;
  /** Phase offset for this mote's orbit. */
  phaseOffset: number;
  /** Vertical offset oscillation phase. */
  verticalPhase: number;
  /** Config from the owner's type. */
  orbitRadius: number;
  orbitSpeed: number;
}

// ---------------------------------------------------------------------------
// Core data (inner glowing centers)
// ---------------------------------------------------------------------------

interface CoreSlot {
  active: boolean;
  owner: BaseEnemy | null;
  pulseSpeed: number;
  coreSize: number;
}

// ---------------------------------------------------------------------------
// EnemyDecoratorSystem
// ---------------------------------------------------------------------------

export class EnemyDecoratorSystem {
  private scene: THREE.Scene;

  // -- Mote pool (InstancedMesh) --
  private moteMesh: THREE.InstancedMesh;
  private moteSlots: MoteSlot[] = [];
  private moteNextFree = 0;

  // -- Core pool (InstancedMesh) --
  private coreMesh: THREE.InstancedMesh;
  private coreSlots: CoreSlot[] = [];
  private coreNextFree = 0;

  // -- Enemy -> slot index mapping --
  private enemyMotes: Map<BaseEnemy, number[]> = new Map();
  private enemyCores: Map<BaseEnemy, number> = new Map();

  constructor(scene: THREE.Scene) {
    this.scene = scene;

    // Create mote InstancedMesh (small glowing spheres)
    const moteGeo = new THREE.SphereGeometry(1, 6, 6); // Unit sphere, scaled per instance
    const moteMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      emissive: new THREE.Color(0xffffff),
      emissiveIntensity: 2.5,
      metalness: 0,
      roughness: 0.2,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.moteMesh = new THREE.InstancedMesh(moteGeo, moteMat, MAX_MOTES);
    this.moteMesh.count = 0;
    this.moteMesh.frustumCulled = false;
    this.moteMesh.name = 'enemy-decorator-motes';

    // Initialize all mote slots
    for (let i = 0; i < MAX_MOTES; i++) {
      _tempMoteMatrix.compose(_tempMotePos.set(0, 0, 0), _tempMoteQuat.identity(), _zeroScale);
      this.moteMesh.setMatrixAt(i, _tempMoteMatrix);
      this.moteMesh.setColorAt(i, new THREE.Color(0xffffff));
      this.moteSlots.push({
        active: false,
        owner: null,
        phaseOffset: 0,
        verticalPhase: 0,
        orbitRadius: 0,
        orbitSpeed: 0,
      });
    }
    this.moteMesh.instanceMatrix.needsUpdate = true;
    if (this.moteMesh.instanceColor) {
      this.moteMesh.instanceColor.needsUpdate = true;
    }
    this.scene.add(this.moteMesh);

    // Create core InstancedMesh (bright inner glowing point)
    const coreGeo = new THREE.IcosahedronGeometry(1, 1); // Unit icosahedron, scaled per instance
    const coreMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      emissive: new THREE.Color(0xffffff),
      emissiveIntensity: 3.0,
      metalness: 1.0,
      roughness: 0,
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.coreMesh = new THREE.InstancedMesh(coreGeo, coreMat, MAX_CORES);
    this.coreMesh.count = 0;
    this.coreMesh.frustumCulled = false;
    this.coreMesh.name = 'enemy-decorator-cores';

    for (let i = 0; i < MAX_CORES; i++) {
      _tempMoteMatrix.compose(_tempMotePos.set(0, 0, 0), _tempMoteQuat.identity(), _zeroScale);
      this.coreMesh.setMatrixAt(i, _tempMoteMatrix);
      this.coreMesh.setColorAt(i, new THREE.Color(0xffffff));
      this.coreSlots.push({
        active: false,
        owner: null,
        pulseSpeed: 3.0,
        coreSize: 0.06,
      });
    }
    this.coreMesh.instanceMatrix.needsUpdate = true;
    if (this.coreMesh.instanceColor) {
      this.coreMesh.instanceColor.needsUpdate = true;
    }
    this.scene.add(this.coreMesh);
  }

  /**
   * Register an enemy for decorators. Allocates mote and core slots based
   * on the enemy type's decorator config.
   */
  register(enemy: BaseEnemy): void {
    const typeName = enemy.constructor.name;
    const config = getDecoratorConfig(typeName);

    // Skip if no decorators for this type
    if (config.orbitingMotes === 0 && !config.innerCore) return;

    // Already registered?
    if (this.enemyMotes.has(enemy) || this.enemyCores.has(enemy)) return;

    // Allocate mote slots
    if (config.orbitingMotes > 0) {
      const moteIndices: number[] = [];
      for (let i = 0; i < config.orbitingMotes; i++) {
        const idx = this.allocateMoteSlot();
        if (idx < 0) break; // Pool full

        const slot = this.moteSlots[idx];
        slot.active = true;
        slot.owner = enemy;
        slot.phaseOffset = (i / config.orbitingMotes) * Math.PI * 2;
        slot.verticalPhase = i * 1.3;
        slot.orbitRadius = config.orbitRadius;
        slot.orbitSpeed = config.orbitSpeed;

        // Set color
        const color = new THREE.Color(config.moteColor);
        this.moteMesh.setColorAt(idx, color);

        moteIndices.push(idx);
      }
      if (moteIndices.length > 0) {
        this.enemyMotes.set(enemy, moteIndices);
      }
    }

    // Allocate core slot
    if (config.innerCore) {
      const idx = this.allocateCoreSlot();
      if (idx >= 0) {
        const slot = this.coreSlots[idx];
        slot.active = true;
        slot.owner = enemy;
        slot.pulseSpeed = config.corePulseSpeed;
        slot.coreSize = config.coreSize * enemy.radius;

        const color = new THREE.Color(config.coreColor);
        this.coreMesh.setColorAt(idx, color);

        this.enemyCores.set(enemy, idx);
      }
    }

    // Mark color buffers dirty
    if (this.moteMesh.instanceColor) {
      this.moteMesh.instanceColor.needsUpdate = true;
    }
    if (this.coreMesh.instanceColor) {
      this.coreMesh.instanceColor.needsUpdate = true;
    }
  }

  /**
   * Unregister an enemy — frees all decorator slots.
   */
  unregister(enemy: BaseEnemy): void {
    // Free mote slots
    const moteIndices = this.enemyMotes.get(enemy);
    if (moteIndices) {
      for (const idx of moteIndices) {
        this.freeMoteSlot(idx);
      }
      this.enemyMotes.delete(enemy);
    }

    // Free core slot
    const coreIdx = this.enemyCores.get(enemy);
    if (coreIdx !== undefined) {
      this.freeCoreSlot(coreIdx);
      this.enemyCores.delete(enemy);
    }
  }

  /**
   * Update all decorator positions. Call once per frame.
   *
   * @param time     Total game time for animation.
   * @param enemies  All active enemies (for position lookup).
   */
  update(time: number, enemies: BaseEnemy[]): void {
    // Update motes — orbit around their owner enemy
    let maxMoteIdx = -1;
    for (let i = 0; i < MAX_MOTES; i++) {
      const slot = this.moteSlots[i];
      if (!slot.active || !slot.owner) continue;

      const enemy = slot.owner;
      if (!enemy.active || !enemy.alive || !enemy.mesh) {
        this.freeMoteSlot(i);
        continue;
      }

      // Skip materializing enemies
      if (enemy.isMaterializing) {
        _tempMoteMatrix.compose(_tempMotePos.set(0, 0, 0), _tempMoteQuat.identity(), _zeroScale);
        this.moteMesh.setMatrixAt(i, _tempMoteMatrix);
        continue;
      }

      // Get enemy world position
      enemy.mesh.updateWorldMatrix(false, false);
      _tempMotePos.setFromMatrixPosition(enemy.mesh.matrixWorld);

      // Orbit position
      const angle = time * slot.orbitSpeed + slot.phaseOffset;
      const vertBob = Math.sin(time * 2.0 + slot.verticalPhase) * 0.03;

      const orbitX = Math.cos(angle) * slot.orbitRadius;
      const orbitY = vertBob;
      const orbitZ = Math.sin(angle) * slot.orbitRadius;

      _tempMotePos.x += orbitX;
      _tempMotePos.y += orbitY;
      _tempMotePos.z += orbitZ;

      // Scale with subtle pulse
      const pulse = 0.015 + Math.sin(time * 4.0 + slot.phaseOffset) * 0.005;
      _tempMoteScale.set(pulse, pulse, pulse);

      _tempMoteMatrix.compose(_tempMotePos, _tempMoteQuat.identity(), _tempMoteScale);
      this.moteMesh.setMatrixAt(i, _tempMoteMatrix);

      if (i > maxMoteIdx) maxMoteIdx = i;
    }

    // Update cores — sit at enemy center, pulse in size
    let maxCoreIdx = -1;
    for (let i = 0; i < MAX_CORES; i++) {
      const slot = this.coreSlots[i];
      if (!slot.active || !slot.owner) continue;

      const enemy = slot.owner;
      if (!enemy.active || !enemy.alive || !enemy.mesh) {
        this.freeCoreSlot(i);
        continue;
      }

      // Skip materializing enemies
      if (enemy.isMaterializing) {
        _tempMoteMatrix.compose(_tempMotePos.set(0, 0, 0), _tempMoteQuat.identity(), _zeroScale);
        this.coreMesh.setMatrixAt(i, _tempMoteMatrix);
        continue;
      }

      // Get enemy world position
      enemy.mesh.updateWorldMatrix(false, false);
      _tempMotePos.setFromMatrixPosition(enemy.mesh.matrixWorld);

      // Pulse scale
      const baseCoreSize = slot.coreSize;
      const pulse = baseCoreSize + Math.sin(time * slot.pulseSpeed) * baseCoreSize * 0.3;
      _tempMoteScale.set(pulse, pulse, pulse);

      // Slow rotation for visual interest (use pre-allocated axis, not .clone())
      _tempCoreAxis.copy(_tempMotePos).normalize();
      _tempMoteQuat.setFromAxisAngle(
        _tempCoreAxis,
        time * 1.5,
      );

      _tempMoteMatrix.compose(_tempMotePos, _tempMoteQuat, _tempMoteScale);
      this.coreMesh.setMatrixAt(i, _tempMoteMatrix);

      if (i > maxCoreIdx) maxCoreIdx = i;
    }

    // Flush
    this.moteMesh.instanceMatrix.needsUpdate = true;
    this.moteMesh.count = maxMoteIdx + 1;

    this.coreMesh.instanceMatrix.needsUpdate = true;
    this.coreMesh.count = maxCoreIdx + 1;
  }

  /**
   * Dispose all resources.
   */
  dispose(): void {
    this.scene.remove(this.moteMesh);
    this.moteMesh.geometry.dispose();
    (this.moteMesh.material as THREE.Material).dispose();
    this.moteMesh.dispose();

    this.scene.remove(this.coreMesh);
    this.coreMesh.geometry.dispose();
    (this.coreMesh.material as THREE.Material).dispose();
    this.coreMesh.dispose();

    this.enemyMotes.clear();
    this.enemyCores.clear();
  }

  /**
   * Get decorator statistics.
   */
  getStats(): { activeMotes: number; activeCores: number; totalDrawCalls: number } {
    let activeMotes = 0;
    let activeCores = 0;
    for (const slot of this.moteSlots) {
      if (slot.active) activeMotes++;
    }
    for (const slot of this.coreSlots) {
      if (slot.active) activeCores++;
    }
    return {
      activeMotes,
      activeCores,
      totalDrawCalls: 2, // One for motes, one for cores
    };
  }

  // -- Private helpers --

  private allocateMoteSlot(): number {
    for (let i = this.moteNextFree; i < MAX_MOTES; i++) {
      if (!this.moteSlots[i].active) {
        this.moteNextFree = i + 1;
        return i;
      }
    }
    for (let i = 0; i < this.moteNextFree; i++) {
      if (!this.moteSlots[i].active) {
        this.moteNextFree = i + 1;
        return i;
      }
    }
    return -1;
  }

  private freeMoteSlot(idx: number): void {
    this.moteSlots[idx].active = false;
    this.moteSlots[idx].owner = null;
    // Hide by zero scale
    _tempMoteMatrix.compose(_tempMotePos.set(0, 0, 0), _tempMoteQuat.identity(), _zeroScale);
    this.moteMesh.setMatrixAt(idx, _tempMoteMatrix);
  }

  private allocateCoreSlot(): number {
    for (let i = this.coreNextFree; i < MAX_CORES; i++) {
      if (!this.coreSlots[i].active) {
        this.coreNextFree = i + 1;
        return i;
      }
    }
    for (let i = 0; i < this.coreNextFree; i++) {
      if (!this.coreSlots[i].active) {
        this.coreNextFree = i + 1;
        return i;
      }
    }
    return -1;
  }

  private freeCoreSlot(idx: number): void {
    this.coreSlots[idx].active = false;
    this.coreSlots[idx].owner = null;
    _tempMoteMatrix.compose(_tempMotePos.set(0, 0, 0), _tempMoteQuat.identity(), _zeroScale);
    this.coreMesh.setMatrixAt(idx, _tempMoteMatrix);
  }
}

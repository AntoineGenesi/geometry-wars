import * as THREE from 'three';
import type { MeshWalker } from '../experimental/mesh-movement/MeshWalker';
import type { MeshSurface } from '../experimental/mesh-movement/MeshSurface';
import type { KillTracker } from './KillTracker';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AuraBuff {
  /** Damage multiplier (1.0 = no bonus, 1.5 = +50%) */
  damageMultiplier: number;
  /** Heal rate in HP/sec */
  healRate: number;
}

interface AuraTierConfig {
  /** Kill+assist count required */
  threshold: number;
  /** Outer radius (world units) */
  outerRadius: number;
  /** Outer buff */
  outerBuff: AuraBuff;
  /** Inner radius (0 = no inner ring) */
  innerRadius: number;
  /** Inner buff (stronger, only when innerRadius > 0) */
  innerBuff: AuraBuff;
}

// ---------------------------------------------------------------------------
// Tier configuration
// ---------------------------------------------------------------------------

const AURA_TIERS: AuraTierConfig[] = [
  // Tier 0: no aura
  { threshold: 0, outerRadius: 0, outerBuff: { damageMultiplier: 1.0, healRate: 0 }, innerRadius: 0, innerBuff: { damageMultiplier: 1.0, healRate: 0 } },
  // Tier 1: single ring
  { threshold: 10, outerRadius: 3.0, outerBuff: { damageMultiplier: 1.15, healRate: 0.5 }, innerRadius: 0, innerBuff: { damageMultiplier: 1.0, healRate: 0 } },
  // Tier 2: wider single ring
  { threshold: 25, outerRadius: 4.0, outerBuff: { damageMultiplier: 1.25, healRate: 1.0 }, innerRadius: 0, innerBuff: { damageMultiplier: 1.0, healRate: 0 } },
  // Tier 3: two rings
  { threshold: 50, outerRadius: 5.0, outerBuff: { damageMultiplier: 1.20, healRate: 1.0 }, innerRadius: 2.5, innerBuff: { damageMultiplier: 1.40, healRate: 2.0 } },
  // Tier 4: two rings, stronger
  { threshold: 80, outerRadius: 6.0, outerBuff: { damageMultiplier: 1.25, healRate: 1.5 }, innerRadius: 3.0, innerBuff: { damageMultiplier: 1.50, healRate: 3.0 } },
  // Tier 5: max tier
  { threshold: 120, outerRadius: 7.0, outerBuff: { damageMultiplier: 1.30, healRate: 2.0 }, innerRadius: 4.0, innerBuff: { damageMultiplier: 1.60, healRate: 4.0 } },
];

const NO_BUFF: AuraBuff = { damageMultiplier: 1.0, healRate: 0 };

/** HP accumulator threshold to gain +1 life */
const HEAL_THRESHOLD = 30;

/** Number of angular segments for the projected ring */
const RING_SEGMENTS = 32;

/** Ring ribbon width as a fraction of radius (inner edge = radius * (1 - RING_WIDTH_FRAC)) */
const RING_WIDTH_FRAC = 0.1;

/** Height above surface to prevent z-fighting */
const SURFACE_OFFSET = 0.05;

// ---------------------------------------------------------------------------
// Per-player aura state
// ---------------------------------------------------------------------------

interface PlayerAuraState {
  tier: number;
  /** Accumulated heal HP toward next life */
  healAccumulator: number;
  /** Active buff being received from allies */
  activeBuff: AuraBuff;
  /** Outer ring visual mesh (surface-projected ribbon) */
  outerRing: THREE.Mesh | null;
  /** Inner ring visual mesh (surface-projected ribbon) */
  innerRing: THREE.Mesh | null;
}

// ---------------------------------------------------------------------------
// SurfaceProjectedRing - builds a ribbon geometry projected onto a MeshSurface
// ---------------------------------------------------------------------------

/**
 * Creates and manages a ring geometry that is projected onto a mesh surface.
 * Instead of a flat disc, the ring samples points at a radius around the player
 * and projects each one onto the surface via BVH, then builds a triangle-strip
 * ribbon. The result follows surface curvature (sphere, cube edges, torus, etc.).
 */
class SurfaceProjectedRing {
  readonly mesh: THREE.Mesh;
  private readonly geometry: THREE.BufferGeometry;
  private readonly positionArray: Float32Array;
  private readonly normalArray: Float32Array;
  private readonly indexArray: Uint16Array;

  // Pre-allocated temp vectors (zero per-frame GC)
  private readonly _innerPoint = new THREE.Vector3();
  private readonly _outerPoint = new THREE.Vector3();
  private readonly _projectedNormal = new THREE.Vector3();

  constructor(material: THREE.Material) {
    // Vertex count: 2 vertices per segment (inner + outer) + 2 to close the loop
    const vertexCount = (RING_SEGMENTS + 1) * 2;
    // Triangle count: 2 triangles per segment
    const triangleCount = RING_SEGMENTS * 2;

    this.positionArray = new Float32Array(vertexCount * 3);
    this.normalArray = new Float32Array(vertexCount * 3);
    this.indexArray = new Uint16Array(triangleCount * 3);

    // Build index buffer (static - triangle strip topology)
    for (let i = 0; i < RING_SEGMENTS; i++) {
      const baseVert = i * 2;
      const baseIdx = i * 6;

      // Triangle 1: inner[i], outer[i], inner[i+1]
      this.indexArray[baseIdx + 0] = baseVert;
      this.indexArray[baseIdx + 1] = baseVert + 1;
      this.indexArray[baseIdx + 2] = baseVert + 2;

      // Triangle 2: inner[i+1], outer[i], outer[i+1]
      this.indexArray[baseIdx + 3] = baseVert + 2;
      this.indexArray[baseIdx + 4] = baseVert + 1;
      this.indexArray[baseIdx + 5] = baseVert + 3;
    }

    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.positionArray, 3));
    this.geometry.setAttribute('normal', new THREE.BufferAttribute(this.normalArray, 3));
    this.geometry.setIndex(new THREE.BufferAttribute(this.indexArray, 1));

    this.mesh = new THREE.Mesh(this.geometry, material);
    this.mesh.frustumCulled = false;
  }

  /**
   * Update the ring geometry by projecting sample points onto the mesh surface.
   *
   * @param center - Player's position on the surface
   * @param surfaceNormal - Surface normal at player position
   * @param tangent - Tangent vector (from walker's tangent frame)
   * @param bitangent - Bitangent vector (from walker's tangent frame)
   * @param radius - Ring outer radius
   * @param meshSurface - The mesh surface for BVH projection
   */
  update(
    center: THREE.Vector3,
    surfaceNormal: THREE.Vector3,
    tangent: THREE.Vector3,
    bitangent: THREE.Vector3,
    radius: number,
    meshSurface: MeshSurface | null,
  ): void {
    const innerRadius = radius * (1 - RING_WIDTH_FRAC);
    const positions = this.positionArray;
    const normals = this.normalArray;

    for (let i = 0; i <= RING_SEGMENTS; i++) {
      const angle = (i / RING_SEGMENTS) * Math.PI * 2;
      const cosA = Math.cos(angle);
      const sinA = Math.sin(angle);

      // Sample direction in tangent plane
      // sampleDir = tangent * cos(angle) + bitangent * sin(angle)
      const dirX = tangent.x * cosA + bitangent.x * sinA;
      const dirY = tangent.y * cosA + bitangent.y * sinA;
      const dirZ = tangent.z * cosA + bitangent.z * sinA;

      // Outer point: center + sampleDir * radius
      this._outerPoint.set(
        center.x + dirX * radius,
        center.y + dirY * radius,
        center.z + dirZ * radius,
      );

      // Inner point: center + sampleDir * innerRadius
      this._innerPoint.set(
        center.x + dirX * innerRadius,
        center.y + dirY * innerRadius,
        center.z + dirZ * innerRadius,
      );

      // Project onto surface if available
      if (meshSurface) {
        const outerResult = meshSurface.closestPointOnSurface(this._outerPoint);
        if (outerResult) {
          this._outerPoint.copy(outerResult.point);
          this._projectedNormal.copy(outerResult.normal);
          // Lift above surface to prevent z-fighting
          this._outerPoint.addScaledVector(this._projectedNormal, SURFACE_OFFSET);
        } else {
          this._projectedNormal.copy(surfaceNormal);
          this._outerPoint.addScaledVector(this._projectedNormal, SURFACE_OFFSET);
        }

        const innerResult = meshSurface.closestPointOnSurface(this._innerPoint);
        if (innerResult) {
          this._innerPoint.copy(innerResult.point);
          this._projectedNormal.copy(innerResult.normal);
          this._innerPoint.addScaledVector(this._projectedNormal, SURFACE_OFFSET);
        } else {
          this._projectedNormal.copy(surfaceNormal);
          this._innerPoint.addScaledVector(this._projectedNormal, SURFACE_OFFSET);
        }
      } else {
        // Fallback: flat ring (no surface projection)
        this._projectedNormal.copy(surfaceNormal);
        this._outerPoint.addScaledVector(surfaceNormal, SURFACE_OFFSET);
        this._innerPoint.addScaledVector(surfaceNormal, SURFACE_OFFSET);
      }

      // Write inner vertex
      const vi = i * 2;
      const idx3Inner = vi * 3;
      positions[idx3Inner + 0] = this._innerPoint.x;
      positions[idx3Inner + 1] = this._innerPoint.y;
      positions[idx3Inner + 2] = this._innerPoint.z;
      normals[idx3Inner + 0] = this._projectedNormal.x;
      normals[idx3Inner + 1] = this._projectedNormal.y;
      normals[idx3Inner + 2] = this._projectedNormal.z;

      // Write outer vertex
      const idx3Outer = (vi + 1) * 3;
      positions[idx3Outer + 0] = this._outerPoint.x;
      positions[idx3Outer + 1] = this._outerPoint.y;
      positions[idx3Outer + 2] = this._outerPoint.z;
      normals[idx3Outer + 0] = this._projectedNormal.x;
      normals[idx3Outer + 1] = this._projectedNormal.y;
      normals[idx3Outer + 2] = this._projectedNormal.z;
    }

    const posAttr = this.geometry.getAttribute('position') as THREE.BufferAttribute;
    posAttr.needsUpdate = true;
    const normAttr = this.geometry.getAttribute('normal') as THREE.BufferAttribute;
    normAttr.needsUpdate = true;
  }

  dispose(): void {
    this.geometry.dispose();
  }
}

// ---------------------------------------------------------------------------
// AuraManager
// ---------------------------------------------------------------------------

export class AuraManager {
  private playerStates: Map<number, PlayerAuraState> = new Map();
  readonly root = new THREE.Group();

  /** Callback when a player gains a life from healing */
  onHeal: ((playerId: number) => void) | null = null;
  /** Callback when a player's aura tier changes */
  onTierChange: ((playerId: number, newTier: number) => void) | null = null;

  private readonly outerMaterial: THREE.MeshBasicMaterial;
  private readonly innerMaterial: THREE.MeshBasicMaterial;

  /** MeshSurface for BVH projection of ring points onto the playing surface */
  private meshSurface: MeshSurface | null = null;

  /** Projected ring objects per player (reused, geometry updated each frame) */
  private outerProjectedRings: Map<number, SurfaceProjectedRing> = new Map();
  private innerProjectedRings: Map<number, SurfaceProjectedRing> = new Map();

  private pulseTime = 0;

  constructor() {
    this.root.name = 'AuraSystem';

    this.outerMaterial = new THREE.MeshBasicMaterial({
      color: 0x00ffff,
      transparent: true,
      opacity: 0.15,
      side: THREE.DoubleSide,
      depthWrite: false,
      blending: THREE.NormalBlending,
    });

    this.innerMaterial = new THREE.MeshBasicMaterial({
      color: 0xff00ff,
      transparent: true,
      opacity: 0.20,
      side: THREE.DoubleSide,
      depthWrite: false,
      blending: THREE.NormalBlending,
    });
  }

  /**
   * Set the mesh surface used for projecting aura rings onto the playing surface.
   * Must be called before update() for surface-following to work.
   */
  setMeshSurface(surface: MeshSurface): void {
    this.meshSurface = surface;
  }

  /**
   * Initialize or reset aura state for a player.
   */
  registerPlayer(playerId: number): void {
    const existing = this.playerStates.get(playerId);
    if (existing) {
      // Clean up old visuals
      if (existing.outerRing) this.root.remove(existing.outerRing);
      if (existing.innerRing) this.root.remove(existing.innerRing);
    }

    // Clean up projected ring objects
    const oldOuter = this.outerProjectedRings.get(playerId);
    if (oldOuter) {
      this.root.remove(oldOuter.mesh);
      oldOuter.dispose();
      this.outerProjectedRings.delete(playerId);
    }
    const oldInner = this.innerProjectedRings.get(playerId);
    if (oldInner) {
      this.root.remove(oldInner.mesh);
      oldInner.dispose();
      this.innerProjectedRings.delete(playerId);
    }

    this.playerStates.set(playerId, {
      tier: 0,
      healAccumulator: 0,
      activeBuff: { ...NO_BUFF },
      outerRing: null,
      innerRing: null,
    });
  }

  /**
   * Main update. Call each frame.
   *
   * @param dt - Delta time
   * @param walkers - Map of playerId -> MeshWalker (position/normal)
   * @param killTracker - For reading each player's totalKillAssists
   * @param playerLives - Map of playerId -> current lives (for heal cap)
   * @param maxLives - Maximum lives a player can have
   */
  update(
    dt: number,
    walkers: Map<number, MeshWalker>,
    killTracker: KillTracker,
    playerLives: Map<number, number>,
    maxLives: number = 9,
  ): void {
    this.pulseTime += dt;

    // 1. Update tiers based on kill+assist counts
    for (const [playerId, state] of this.playerStates) {
      const stats = killTracker.getPlayerStats(playerId);
      const newTier = this.computeTier(stats.totalKillAssists);
      if (newTier !== state.tier) {
        state.tier = newTier;
        this.updateVisuals(playerId, state);
        this.onTierChange?.(playerId, newTier);
      }
    }

    // 2. Compute buffs for each player from all nearby allies
    for (const [_playerId, state] of this.playerStates) {
      state.activeBuff = { ...NO_BUFF };
    }

    const playerIds = Array.from(this.playerStates.keys());
    for (let i = 0; i < playerIds.length; i++) {
      for (let j = i + 1; j < playerIds.length; j++) {
        const pidA = playerIds[i];
        const pidB = playerIds[j];
        const walkerA = walkers.get(pidA);
        const walkerB = walkers.get(pidB);
        if (!walkerA || !walkerB) continue;

        const dist = walkerA.position.distanceTo(walkerB.position);

        // A's aura affects B
        this.applyAuraBuff(pidA, pidB, dist);
        // B's aura affects A
        this.applyAuraBuff(pidB, pidA, dist);
      }
    }

    // 3. Apply healing from buffs
    for (const [playerId, state] of this.playerStates) {
      if (state.activeBuff.healRate > 0) {
        state.healAccumulator += state.activeBuff.healRate * dt;
        const lives = playerLives.get(playerId) ?? 0;
        if (state.healAccumulator >= HEAL_THRESHOLD && lives < maxLives) {
          state.healAccumulator -= HEAL_THRESHOLD;
          this.onHeal?.(playerId);
        }
      }
    }

    // 4. Update visual positions and animations
    for (const [playerId, state] of this.playerStates) {
      const walker = walkers.get(playerId);
      if (!walker) continue;
      this.positionRings(playerId, state, walker);
    }
  }

  /**
   * Get the buff currently active on a player (from allies' auras).
   */
  getBuffForPlayer(playerId: number): AuraBuff {
    const state = this.playerStates.get(playerId);
    return state?.activeBuff ?? { ...NO_BUFF };
  }

  /**
   * Get current aura tier for a player.
   */
  getTier(playerId: number): number {
    return this.playerStates.get(playerId)?.tier ?? 0;
  }

  // -----------------------------------------------------------------------
  // Private
  // -----------------------------------------------------------------------

  private computeTier(totalKillAssists: number): number {
    let tier = 0;
    for (let i = AURA_TIERS.length - 1; i >= 0; i--) {
      if (totalKillAssists >= AURA_TIERS[i].threshold) {
        tier = i;
        break;
      }
    }
    return tier;
  }

  /**
   * Apply sourcePlayer's aura buff to targetPlayer based on distance.
   */
  private applyAuraBuff(sourceId: number, targetId: number, distance: number): void {
    const sourceState = this.playerStates.get(sourceId);
    const targetState = this.playerStates.get(targetId);
    if (!sourceState || !targetState || sourceState.tier === 0) return;

    const tierConfig = AURA_TIERS[sourceState.tier];

    // Check inner ring first (stronger buff)
    if (tierConfig.innerRadius > 0 && distance <= tierConfig.innerRadius) {
      targetState.activeBuff = {
        damageMultiplier: Math.max(targetState.activeBuff.damageMultiplier, tierConfig.innerBuff.damageMultiplier),
        healRate: Math.max(targetState.activeBuff.healRate, tierConfig.innerBuff.healRate),
      };
      return;
    }

    // Check outer ring
    if (distance <= tierConfig.outerRadius) {
      targetState.activeBuff = {
        damageMultiplier: Math.max(targetState.activeBuff.damageMultiplier, tierConfig.outerBuff.damageMultiplier),
        healRate: Math.max(targetState.activeBuff.healRate, tierConfig.outerBuff.healRate),
      };
    }
  }

  private updateVisuals(playerId: number, state: PlayerAuraState): void {
    // Remove old projected rings
    const oldOuter = this.outerProjectedRings.get(playerId);
    if (oldOuter) {
      this.root.remove(oldOuter.mesh);
      oldOuter.dispose();
      this.outerProjectedRings.delete(playerId);
    }
    const oldInner = this.innerProjectedRings.get(playerId);
    if (oldInner) {
      this.root.remove(oldInner.mesh);
      oldInner.dispose();
      this.innerProjectedRings.delete(playerId);
    }

    // Clear references on state (outerRing/innerRing point to projected mesh now)
    state.outerRing = null;
    state.innerRing = null;

    const tierConfig = AURA_TIERS[state.tier];
    if (tierConfig.outerRadius <= 0) return;

    // Create outer projected ring
    const outerRing = new SurfaceProjectedRing(this.outerMaterial.clone());
    this.outerProjectedRings.set(playerId, outerRing);
    this.root.add(outerRing.mesh);
    state.outerRing = outerRing.mesh;

    // Create inner projected ring if tier has one
    if (tierConfig.innerRadius > 0) {
      const innerRing = new SurfaceProjectedRing(this.innerMaterial.clone());
      this.innerProjectedRings.set(playerId, innerRing);
      this.root.add(innerRing.mesh);
      state.innerRing = innerRing.mesh;
    }
  }

  private positionRings(playerId: number, state: PlayerAuraState, walker: MeshWalker): void {
    const pos = walker.position;
    const normal = walker.normal;
    const frame = walker.getTangentFrame();

    // Pulse animation
    const pulse = 1.0 + Math.sin(this.pulseTime * 2.0) * 0.03;

    const outerProjected = this.outerProjectedRings.get(playerId);
    if (outerProjected) {
      const tierConfig = AURA_TIERS[state.tier];
      outerProjected.update(
        pos, normal,
        frame.tangent, frame.bitangent,
        tierConfig.outerRadius * pulse,
        this.meshSurface,
      );

      // Opacity: brighter when giving buff
      const mat = outerProjected.mesh.material as THREE.MeshBasicMaterial;
      mat.opacity = state.activeBuff.damageMultiplier > 1.0 ? 0.25 : 0.15;
    }

    const innerProjected = this.innerProjectedRings.get(playerId);
    if (innerProjected) {
      const tierConfig = AURA_TIERS[state.tier];
      innerProjected.update(
        pos, normal,
        frame.tangent, frame.bitangent,
        tierConfig.innerRadius * pulse,
        this.meshSurface,
      );

      const mat = innerProjected.mesh.material as THREE.MeshBasicMaterial;
      mat.opacity = state.activeBuff.damageMultiplier > 1.2 ? 0.30 : 0.20;
    }
  }

  dispose(): void {
    for (const [id, _state] of this.playerStates) {
      const outerProj = this.outerProjectedRings.get(id);
      if (outerProj) {
        this.root.remove(outerProj.mesh);
        outerProj.dispose();
      }
      const innerProj = this.innerProjectedRings.get(id);
      if (innerProj) {
        this.root.remove(innerProj.mesh);
        innerProj.dispose();
      }
    }
    this.outerProjectedRings.clear();
    this.innerProjectedRings.clear();
    this.playerStates.clear();
    this.outerMaterial.dispose();
    this.innerMaterial.dispose();
  }
}

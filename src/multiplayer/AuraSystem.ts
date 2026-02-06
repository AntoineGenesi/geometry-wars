import * as THREE from 'three';
import type { MeshWalker } from '../experimental/mesh-movement/MeshWalker';
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

// ---------------------------------------------------------------------------
// Per-player aura state
// ---------------------------------------------------------------------------

interface PlayerAuraState {
  tier: number;
  /** Accumulated heal HP toward next life */
  healAccumulator: number;
  /** Active buff being received from allies */
  activeBuff: AuraBuff;
  /** Outer ring visual mesh */
  outerRing: THREE.Mesh | null;
  /** Inner ring visual mesh */
  innerRing: THREE.Mesh | null;
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
  private readonly ringGeometry: THREE.RingGeometry;

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

    // Ring geometry: inner=0.9, outer=1.0 (scaled per tier)
    this.ringGeometry = new THREE.RingGeometry(0.9, 1.0, 32);
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
    for (const [playerId, state] of this.playerStates) {
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
      this.positionRings(state, walker);
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
    // Remove old rings
    if (state.outerRing) {
      this.root.remove(state.outerRing);
      state.outerRing = null;
    }
    if (state.innerRing) {
      this.root.remove(state.innerRing);
      state.innerRing = null;
    }

    const tierConfig = AURA_TIERS[state.tier];
    if (tierConfig.outerRadius <= 0) return;

    // Create outer ring
    state.outerRing = new THREE.Mesh(this.ringGeometry, this.outerMaterial.clone());
    state.outerRing.scale.setScalar(tierConfig.outerRadius);
    this.root.add(state.outerRing);

    // Create inner ring if tier has one
    if (tierConfig.innerRadius > 0) {
      state.innerRing = new THREE.Mesh(this.ringGeometry, this.innerMaterial.clone());
      state.innerRing.scale.setScalar(tierConfig.innerRadius);
      this.root.add(state.innerRing);
    }
  }

  private positionRings(state: PlayerAuraState, walker: MeshWalker): void {
    const pos = walker.position;
    const normal = walker.normal;

    // Pulse animation
    const pulse = 1.0 + Math.sin(this.pulseTime * 2.0) * 0.03;

    if (state.outerRing) {
      state.outerRing.position.copy(pos).addScaledVector(normal, 0.05);
      state.outerRing.lookAt(pos.clone().add(normal));
      const tierConfig = AURA_TIERS[state.tier];
      state.outerRing.scale.setScalar(tierConfig.outerRadius * pulse);

      // Opacity: brighter when giving buff
      const mat = state.outerRing.material as THREE.MeshBasicMaterial;
      mat.opacity = state.activeBuff.damageMultiplier > 1.0 ? 0.25 : 0.15;
    }

    if (state.innerRing) {
      state.innerRing.position.copy(pos).addScaledVector(normal, 0.05);
      state.innerRing.lookAt(pos.clone().add(normal));
      const tierConfig = AURA_TIERS[state.tier];
      state.innerRing.scale.setScalar(tierConfig.innerRadius * pulse);

      const mat = state.innerRing.material as THREE.MeshBasicMaterial;
      mat.opacity = state.activeBuff.damageMultiplier > 1.2 ? 0.30 : 0.20;
    }
  }

  dispose(): void {
    for (const [_id, state] of this.playerStates) {
      if (state.outerRing) this.root.remove(state.outerRing);
      if (state.innerRing) this.root.remove(state.innerRing);
    }
    this.playerStates.clear();
    this.ringGeometry.dispose();
    this.outerMaterial.dispose();
    this.innerMaterial.dispose();
  }
}

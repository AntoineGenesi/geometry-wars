/**
 * Entity and quality limits derived from GPU capability tier.
 *
 * Consumed by spawning systems, particle emitters, and the post-processing
 * pipeline to keep frame rates stable on lower-end hardware.
 */

export interface EntityLimits {
  /** Maximum concurrent enemies on the surface. */
  maxEnemies: number;
  /** Maximum active bullets in the pool. */
  maxBullets: number;
  /** Maximum GPU particles (ParticleSystem capacity). */
  maxParticles: number;
  /** Maximum geoms (score multiplier gems) on the surface. */
  maxGeoms: number;
  /** Whether bloom post-processing should be enabled. */
  bloomEnabled: boolean;
  /** Whether shadow maps should be enabled (future use). */
  shadowsEnabled: boolean;
}

/** Default limits per tier. */
const TIER_LIMITS: Record<'high' | 'medium' | 'low', EntityLimits> = {
  high: {
    maxEnemies: 500,
    maxBullets: 2000,
    maxParticles: 10000,
    maxGeoms: 1000,
    bloomEnabled: true,
    shadowsEnabled: true,
  },
  medium: {
    maxEnemies: 200,
    maxBullets: 800,
    maxParticles: 5000,
    maxGeoms: 500,
    bloomEnabled: true,
    shadowsEnabled: false,
  },
  low: {
    maxEnemies: 80,
    maxBullets: 300,
    maxParticles: 2000,
    maxGeoms: 200,
    bloomEnabled: false,
    shadowsEnabled: false,
  },
};

/**
 * Get entity and quality limits for a given GPU capability tier.
 *
 * Returns a frozen copy so callers cannot accidentally mutate the defaults.
 */
export function getEntityLimits(tier: 'high' | 'medium' | 'low'): EntityLimits {
  return { ...TIER_LIMITS[tier] };
}

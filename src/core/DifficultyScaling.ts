// ---------------------------------------------------------------------------
// Difficulty Scaling System
//
// Exponential difficulty that keeps pace with player power growth from
// buff stacking, combo multipliers, and score-based damage boosts.
//
// Design principles:
//   1. Enemy TYPES scale, not the same basic enemies getting tougher
//   2. Early game (Tier 0) stays easy and fun
//   3. Tier 1+ enemies use color variants of the same geometry
//   4. Splitting enemies appear much more often at higher tiers
//   5. Exponential curve matches buff stacking (not linear)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Difficulty tier: determines enemy stat multipliers and visual variant
// ---------------------------------------------------------------------------

export interface DifficultyTier {
  /** Tier index (0 = base, 1 = hardened, 2+ = elite/nightmare) */
  readonly tier: number;
  /** Display name for logging/debug */
  readonly name: string;
  /** HP multiplier (exponential) */
  readonly healthMultiplier: number;
  /** Speed multiplier (mild, capped to stay fair) */
  readonly speedMultiplier: number;
  /** Scale multiplier (bigger = more imposing) */
  readonly scaleMultiplier: number;
  /** Score value multiplier */
  readonly scoreMultiplier: number;
  /** Geom drop multiplier */
  readonly geomMultiplier: number;
  /** Tint color (applied on top of base color to visually distinguish) */
  readonly tintColor: number;
  /** Number of children spawned on death (0 = no splitting) */
  readonly splitCount: number;
  /** Tier of children spawned on death (-1 = same base type at tier 0) */
  readonly splitChildTier: number;
}

// ---------------------------------------------------------------------------
// Pre-defined tiers
// ---------------------------------------------------------------------------

const TIERS: readonly DifficultyTier[] = [
  {
    tier: 0,
    name: 'Normal',
    healthMultiplier: 1.0,
    speedMultiplier: 1.0,
    scaleMultiplier: 1.0,
    scoreMultiplier: 1.0,
    geomMultiplier: 1.0,
    tintColor: 0x000000, // no tint (use base color)
    splitCount: 0,
    splitChildTier: -1,
  },
  {
    tier: 1,
    name: 'Hardened',
    healthMultiplier: 3.0,
    speedMultiplier: 1.15,
    scaleMultiplier: 1.15,
    scoreMultiplier: 2.0,
    geomMultiplier: 1.5,
    tintColor: 0xff6600, // orange tint
    splitCount: 0,
    splitChildTier: -1,
  },
  {
    tier: 2,
    name: 'Veteran',
    healthMultiplier: 8.0,
    speedMultiplier: 1.25,
    scaleMultiplier: 1.3,
    scoreMultiplier: 4.0,
    geomMultiplier: 2.0,
    tintColor: 0xff2200, // red tint
    splitCount: 2,
    splitChildTier: 0,
  },
  {
    tier: 3,
    name: 'Elite',
    healthMultiplier: 20.0,
    speedMultiplier: 1.35,
    scaleMultiplier: 1.5,
    scoreMultiplier: 8.0,
    geomMultiplier: 3.0,
    tintColor: 0xff00ff, // magenta tint
    splitCount: 3,
    splitChildTier: 1,
  },
  {
    tier: 4,
    name: 'Nightmare',
    healthMultiplier: 50.0,
    speedMultiplier: 1.45,
    scaleMultiplier: 1.7,
    scoreMultiplier: 15.0,
    geomMultiplier: 4.0,
    tintColor: 0xffffff, // white-hot tint
    splitCount: 4,
    splitChildTier: 2,
  },
];

/** Get tier data by index (clamped to valid range). */
export function getDifficultyTier(tier: number): DifficultyTier {
  const clamped = Math.max(0, Math.min(tier, TIERS.length - 1));
  return TIERS[clamped];
}

/** Total number of defined tiers. */
export const MAX_TIER = TIERS.length - 1;

// ---------------------------------------------------------------------------
// Difficulty level: computed from player state
// ---------------------------------------------------------------------------

export interface DifficultyInput {
  /** Player's current score */
  score: number;
  /** Elapsed game time in seconds */
  elapsedTime: number;
  /** Current combo count */
  combo: number;
  /** Total kills */
  totalKills: number;
  /** Player level (0-9) */
  playerLevel: number;
}

/**
 * Compute a continuous difficulty level from player state.
 *
 * The formula uses logarithmic score scaling (base-10) combined with
 * time and combo bonuses. The result is a floating-point "difficulty level"
 * where integer boundaries correspond to tier thresholds.
 *
 * Score contribution (dominant factor):
 *   - 0-10K:      ~0.0 - 1.0 (Tier 0 territory)
 *   - 10K-100K:   ~1.0 - 2.0 (Tier 1 starts)
 *   - 100K-1M:    ~2.0 - 3.0 (Tier 2 starts)
 *   - 1M-10M:     ~3.0 - 4.0 (Tier 3 starts)
 *   - 10M-100M:   ~4.0 - 5.0 (Tier 4 starts)
 *   - 100M+:      ~5.0+       (deep Tier 4)
 *
 * Time adds a slow ramp (1 level per 5 minutes) so difficulty
 * increases even if the player camps.
 *
 * Combo adds a temporary spike to create tense moments during
 * long kill streaks.
 */
export function computeDifficultyLevel(input: DifficultyInput): number {
  // Score-based (logarithmic, base-10, offset so <10K = level 0)
  const scoreLevel = input.score > 10_000
    ? Math.log10(input.score / 10_000)
    : 0;

  // Time-based (linear ramp: +1 level per 5 minutes = 300 seconds)
  const timeLevel = input.elapsedTime / 300;

  // Combo spike (temporary difficulty bump during kill streaks)
  // Kicks in at combo 50+, maxes out at combo 500+
  const comboLevel = input.combo > 50
    ? Math.min(1.5, (input.combo - 50) / 300)
    : 0;

  // Player level contributes a small amount (0-9 maps to 0-0.9)
  const levelBonus = input.playerLevel * 0.1;

  // Combine: score is dominant, time ensures progression, combo creates spikes
  return scoreLevel + timeLevel * 0.5 + comboLevel + levelBonus;
}

/**
 * Get the maximum tier that should be spawned at this difficulty level.
 * Returns 0 for easy, up to MAX_TIER for extreme difficulty.
 */
export function getMaxSpawnTier(difficultyLevel: number): number {
  return Math.min(MAX_TIER, Math.floor(difficultyLevel));
}

// ---------------------------------------------------------------------------
// Wave composition: what mix of enemies and tiers to spawn
// ---------------------------------------------------------------------------

export interface ScaledWaveEntry {
  type: string;
  count: number;
  tier: number;
}

/**
 * Enemy type pools organized by base difficulty.
 * The spawner picks from these based on wave number and difficulty level.
 */
const BASIC_TYPES = ['grunt', 'wanderer', 'duck'];
const MID_TYPES = ['weaver', 'spinner', 'rocket', 'neutron', 'mayfly'];
const HARD_TYPES = ['snake', 'repulsor', 'gravity_well', 'spawner'];
const ELITE_TYPES = ['gate', 'virus', 'painter'];
const SPLITTING_TYPES = [
  'giant_wanderer', 'giant_rocket', 'giant_snake', 'giant_neutron',
  'titan_grunt', 'titan_spinner', 'titan_weaver',
];

/**
 * Generate a scaled endless wave based on wave number and difficulty level.
 *
 * Key behaviors:
 *   - Base counts grow with wave number (linear)
 *   - Enemy tier distribution shifts upward with difficulty level
 *   - Splitting enemies appear more frequently at higher difficulty
 *   - At high difficulty, even "basic" enemy types get promoted to higher tiers
 */
export function generateScaledEndlessWave(
  waveNum: number,
  difficultyLevel: number,
): ScaledWaveEntry[] {
  const enemies: ScaledWaveEntry[] = [];
  const maxTier = getMaxSpawnTier(difficultyLevel);
  const baseCount = 3 + Math.floor(waveNum * 0.8);

  // -- Basic enemies: always present, tier scales with difficulty --
  const basicType = BASIC_TYPES[waveNum % BASIC_TYPES.length];
  const basicTier = Math.min(maxTier, Math.max(0, maxTier - 1));
  enemies.push({
    type: basicType,
    count: Math.min(baseCount, 12),
    tier: basicTier,
  });

  // -- Mid-tier from wave 3+, higher tier at higher difficulty --
  if (waveNum >= 3) {
    const midType = MID_TYPES[(waveNum - 3) % MID_TYPES.length];
    const midTier = Math.min(maxTier, Math.max(0, maxTier));
    enemies.push({
      type: midType,
      count: Math.min(Math.floor(baseCount * 0.6), 8),
      tier: midTier,
    });
  }

  // -- Hard enemies from wave 5+ (earlier than before) --
  if (waveNum >= 5) {
    const hardType = HARD_TYPES[(waveNum - 5) % HARD_TYPES.length];
    const hardTier = Math.min(maxTier, Math.max(0, maxTier));
    enemies.push({
      type: hardType,
      count: Math.min(Math.floor(baseCount * 0.4), 5),
      tier: hardTier,
    });
  }

  // -- Splitting enemies from wave 6+ (much earlier & more frequent) --
  if (waveNum >= 6) {
    const splitType = SPLITTING_TYPES[(waveNum - 6) % SPLITTING_TYPES.length];
    // Splitting enemies get extra count at higher difficulty
    const splitBonus = Math.floor(difficultyLevel * 0.5);
    enemies.push({
      type: splitType,
      count: Math.min(2 + splitBonus, 6),
      tier: 0, // Titans/Giants are already scaled; their children inherit tier
    });
  }

  // -- Elite enemies from wave 8+ --
  if (waveNum >= 8) {
    const eliteType = ELITE_TYPES[(waveNum - 8) % ELITE_TYPES.length];
    enemies.push({
      type: eliteType,
      count: Math.min(Math.floor(baseCount * 0.3), 4),
      tier: Math.min(maxTier, Math.max(0, maxTier - 1)),
    });
  }

  // -- At high difficulty (3+), add extra waves of tiered basic enemies --
  // These are the "color variant stronger versions" the user wants
  if (difficultyLevel >= 2) {
    const variantType = BASIC_TYPES[(waveNum + 1) % BASIC_TYPES.length];
    enemies.push({
      type: variantType,
      count: Math.min(4 + Math.floor(difficultyLevel), 10),
      tier: maxTier,
    });
  }

  // -- At extreme difficulty (4+), add massive splitting swarms --
  if (difficultyLevel >= 3.5) {
    const swarmType = SPLITTING_TYPES[(waveNum + 2) % SPLITTING_TYPES.length];
    enemies.push({
      type: swarmType,
      count: Math.min(3 + Math.floor(difficultyLevel - 3), 8),
      tier: 0,
    });
  }

  return enemies;
}

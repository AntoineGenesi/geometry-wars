// ---------------------------------------------------------------------------
// Difficulty Scaling System
//
// Creates a challenging experience that keeps up with player power scaling.
// Player accumulates buffs (hot hands, trigger happy, shock aura, incendiary)
// that multiply their damage output dramatically — difficulty must match.
//
// Design principles:
//   1. Enemy TYPES scale, not the same basic enemies getting tougher
//   2. Early game (first ~30-60s) stays easy — gentle on-ramp
//   3. Tier 1+ enemies use color variants of the same geometry
//   4. Splitting enemies are a core challenge mechanic — use them
//   5. Player should feel powerful but under PRESSURE at high scores
//   6. At 100M+ score, the screen should always have threats
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
    healthMultiplier: 3.0,   // 2.0→3.0: takes 2-3x more shots (player has ~2x damage by now)
    speedMultiplier: 1.10,   // 1.05→1.10: noticeably faster
    scaleMultiplier: 1.1,
    scoreMultiplier: 2.0,
    geomMultiplier: 1.5,
    tintColor: 0xff6600, // orange tint
    splitCount: 0,
    splitChildTier: -1,
  },
  {
    tier: 2,
    name: 'Veteran',
    healthMultiplier: 8.0,   // 4.0→8.0: player has ~4-5x damage, these take sustained fire
    speedMultiplier: 1.18,   // 1.10→1.18: clearly faster movement
    scaleMultiplier: 1.2,
    scoreMultiplier: 4.0,
    geomMultiplier: 2.0,
    tintColor: 0xff2200, // red tint
    splitCount: 2,
    splitChildTier: 0,
  },
  {
    tier: 3,
    name: 'Elite',
    healthMultiplier: 20.0,  // 10.0→20.0: player has ~6-8x damage, still killable but tanky
    speedMultiplier: 1.28,   // 1.18→1.28: fast, requires kiting
    scaleMultiplier: 1.35,
    scoreMultiplier: 8.0,
    geomMultiplier: 3.0,
    tintColor: 0xff00ff, // magenta tint
    splitCount: 3,           // 2→3: more children = more pressure
    splitChildTier: 1,       // 0→1: children are hardened, not trivial
  },
  {
    tier: 4,
    name: 'Nightmare',
    healthMultiplier: 50.0,  // 25.0→50.0: player has 8-10x damage, these are real threats
    speedMultiplier: 1.35,   // 1.25→1.35: aggressive speed, forces movement
    scaleMultiplier: 1.5,
    scoreMultiplier: 15.0,
    geomMultiplier: 4.0,
    tintColor: 0xffffff, // white-hot tint
    splitCount: 4,           // 3→4: death swarms
    splitChildTier: 2,       // 1→2: children are veterans, real threats
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
 * time, combo, and kill count bonuses. The result is a floating-point
 * "difficulty level" where integer boundaries correspond to tier thresholds.
 *
 * Tuned so that a skilled player with buffs hits each tier earlier and
 * the difficulty keeps pressure on even at very high scores.
 *
 * Score contribution (dominant factor):
 *   - 0-25K:       ~0.0 - 0.5  (Tier 0 — easy on-ramp)
 *   - 25K-250K:    ~0.5 - 1.5  (Tier 1 starts around 50K)
 *   - 250K-2.5M:   ~1.5 - 2.5  (Tier 2 starts around 500K)
 *   - 2.5M-25M:    ~2.5 - 3.5  (Tier 3 starts around 5M)
 *   - 25M-250M:    ~3.5 - 4.5  (Tier 4 starts around 50M)
 *
 * Time adds a moderate ramp (1 level per 5 minutes) so difficulty
 * increases even if the player camps.
 *
 * Combo adds a meaningful spike during long kill streaks.
 *
 * Kill count adds a steady ramp that rewards aggressive play with
 * harder enemies (kills = buffs = more power = harder enemies).
 */
export function computeDifficultyLevel(input: DifficultyInput): number {
  // Score-based (logarithmic, base-10, offset so <25K = near level 0)
  // Lower threshold (25K vs 50K) means tier transitions happen sooner
  const scoreLevel = input.score > 25_000
    ? Math.log10(input.score / 25_000)
    : input.score > 5_000
      ? (input.score - 5_000) / 20_000 * 0.3  // gentle ramp 0→0.3 from 5K→25K
      : 0;

  // Time-based (linear ramp: +1 level per 5 minutes = 300 seconds)
  // Faster time ramp ensures difficulty doesn't stagnate during long games
  const timeLevel = input.elapsedTime / 300;

  // Combo spike (temporary difficulty bump during kill streaks)
  // Kicks in at combo 50+, contributes up to 1.5 levels
  const comboLevel = input.combo > 50
    ? Math.min(1.5, (input.combo - 50) / 300)
    : 0;

  // Player level contributes moderately (0-9 maps to 0-0.9)
  // Higher level = more buffs = player can handle harder enemies
  const levelBonus = input.playerLevel * 0.10;

  // Kill count ramp: every 500 kills adds 0.5 difficulty level
  // Players with 1400 kills should face noticeably harder enemies
  const killBonus = Math.min(2.0, input.totalKills / 1000);

  // Combine: score is dominant, time is moderate, combo/kills contribute
  return scoreLevel + timeLevel * 0.5 + comboLevel + levelBonus + killBonus;
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
const MID_TYPES = ['weaver', 'spinner', 'rocket', 'neutron', 'mayfly', 'helix', 'swarm', 'lurker', 'orbiter', 'approach_glow'];
const HARD_TYPES = ['snake', 'repulsor', 'gravity_well', 'spawner', 'cluster', 'fractal', 'phaser', 'stealth_stalker'];
const ELITE_TYPES = ['gate', 'virus', 'painter'];
const SPLITTING_TYPES = [
  'giant_wanderer', 'giant_rocket', 'giant_snake', 'giant_neutron',
  'titan_grunt', 'titan_spinner', 'titan_weaver', 'splitter',
];

/**
 * Generate a scaled endless wave based on wave number and difficulty level.
 *
 * Tuned for aggressive scaling that matches player power growth.
 * A player with stacked buffs (hot hands 5, trigger happy, shock aura 3,
 * incendiary 3) has ~9x effective damage — waves must compensate.
 *
 * Key behaviors:
 *   - Base counts grow with wave number and scale with difficulty
 *   - Enemy tier distribution pushes to max tier at high difficulty
 *   - Splitting enemies appear by wave 6 (not 12) — they're a core mechanic
 *   - Hard/elite types introduced earlier and in larger numbers
 *   - At high difficulty, multiple enemy groups per wave create real pressure
 */
export function generateScaledEndlessWave(
  waveNum: number,
  difficultyLevel: number,
): ScaledWaveEntry[] {
  const enemies: ScaledWaveEntry[] = [];
  const maxTier = getMaxSpawnTier(difficultyLevel);
  // Base count grows with wave number AND difficulty level
  // At difficulty 4+, each wave has substantially more enemies
  const difficultyCountBonus = Math.floor(difficultyLevel * 1.5);
  const baseCount = Math.min(18, 4 + Math.floor(Math.sqrt(waveNum) * 2) + difficultyCountBonus);

  // -- Basic enemies: always present, tier scales with difficulty --
  const basicType = BASIC_TYPES[waveNum % BASIC_TYPES.length];
  // Basic enemies get tiered earlier: at difficulty 1+ they start scaling
  const basicTier = difficultyLevel >= 1
    ? Math.min(maxTier, Math.max(0, maxTier - 1))
    : 0;
  enemies.push({
    type: basicType,
    count: Math.min(baseCount, 18),
    tier: basicTier,
  });

  // -- Mid-tier from wave 2+ (earlier introduction) --
  if (waveNum >= 2) {
    const midType = MID_TYPES[(waveNum - 2) % MID_TYPES.length];
    const midTier = Math.min(maxTier, Math.max(0, maxTier - 1));
    enemies.push({
      type: midType,
      count: Math.min(Math.floor(baseCount * 0.6), 10),
      tier: midTier,
    });
  }

  // -- Hard enemies from wave 5+ (earlier than 8) --
  if (waveNum >= 5) {
    const hardType = HARD_TYPES[(waveNum - 5) % HARD_TYPES.length];
    const hardTier = maxTier; // hard enemies at max tier — they should be threatening
    enemies.push({
      type: hardType,
      count: Math.min(Math.floor(baseCount * 0.4), 6),
      tier: hardTier,
    });
  }

  // -- Splitting enemies from wave 6+ and difficulty 1+ --
  if (waveNum >= 6 && difficultyLevel >= 1.0) {
    const splitType = SPLITTING_TYPES[(waveNum - 6) % SPLITTING_TYPES.length];
    enemies.push({
      type: splitType,
      count: Math.min(1 + Math.floor(difficultyLevel * 0.5), 5),
      tier: Math.min(maxTier, 1), // splitting enemies get at least tier 1 when available
    });
  }

  // -- Elite enemies from wave 8+ (earlier than 15) --
  if (waveNum >= 8) {
    const eliteType = ELITE_TYPES[(waveNum - 8) % ELITE_TYPES.length];
    enemies.push({
      type: eliteType,
      count: Math.min(Math.floor(baseCount * 0.3), 4),
      tier: maxTier,
    });
  }

  // -- At difficulty 2+, add tiered color-variant basic enemies --
  // These are tanky versions that force the player to prioritize
  if (difficultyLevel >= 2) {
    const variantType = BASIC_TYPES[(waveNum + 1) % BASIC_TYPES.length];
    enemies.push({
      type: variantType,
      count: Math.min(4 + Math.floor(difficultyLevel), 12),
      tier: maxTier,
    });
  }

  // -- At difficulty 3+, add a second group of hard enemies --
  // More variety and pressure from multiple dangerous types
  if (difficultyLevel >= 3) {
    const hardType2 = HARD_TYPES[(waveNum + 3) % HARD_TYPES.length];
    enemies.push({
      type: hardType2,
      count: Math.min(Math.floor(baseCount * 0.3), 5),
      tier: maxTier,
    });
  }

  // -- At difficulty 3.5+, splitting enemy swarm --
  if (difficultyLevel >= 3.5) {
    const swarmType = SPLITTING_TYPES[(waveNum + 2) % SPLITTING_TYPES.length];
    enemies.push({
      type: swarmType,
      count: Math.min(2 + Math.floor(difficultyLevel - 3), 6),
      tier: Math.min(maxTier, 1),
    });
  }

  // -- At difficulty 5+, a SECOND elite group + extra splitting --
  // Beyond Nightmare tier: relentless enemy mix
  if (difficultyLevel >= 5) {
    const eliteType2 = ELITE_TYPES[(waveNum + 1) % ELITE_TYPES.length];
    enemies.push({
      type: eliteType2,
      count: Math.min(2 + Math.floor(difficultyLevel - 5), 4),
      tier: maxTier,
    });
  }

  return enemies;
}

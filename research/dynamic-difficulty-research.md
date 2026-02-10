# Dynamic Difficulty Adjustment (DDA) Research

## Research & System Design for Geometry Wars 3D Browser

February 2026

---

## 1. Reference Game Analysis

### 1.1 Left 4 Dead: The AI Director (Gold Standard)

**Source:** Michael Booth, Valve - "AI Systems of Left 4 Dead" (GDC 2009)

The AI Director is the most cited DDA system in game design. Its core innovation is the **emotional intensity model** -- it does not simply track whether the player is winning or losing, but models the player's emotional state as a continuous variable.

**Core Mechanic: The Intensity Metric**

- Each Survivor has an `intensity` value ranging from 0.0 (calm) to 1.0 (maximum stress).
- Intensity increases when: taking damage, being surrounded by infected, teammates going down, being in darkness.
- Intensity decays naturally over time (exponential decay).
- The Director reads the **group average** and **individual maximums** to make spawn decisions.

**Pacing Phases:**

1. **Build-Up:** Director spawns wandering infected and specials at increasing rates. Lasts until group intensity reaches ~0.6-0.8.
2. **Peak:** The climax. A large horde event or tank spawn. Infected stop spawning passively during this phase.
3. **Relax:** After Peak, the Director pauses all spawning. No wanderers, no specials, no mobs. Survivors can heal and reload. Lasts until intensity drops below ~0.3.

**What It Adjusts:**
- Number and density of zombie hordes (more when team is doing well, fewer when struggling)
- Availability of health kits, ammo, pipe bombs (more supplies for struggling teams)
- Special infected spawn timing and frequency
- Tank and Witch placement on the map

**Key Design Insight:** The system creates **tension arcs** -- alternating between high and low intensity. Players who are struggling get longer relax periods and more supplies. Players dominating get shorter relax periods and bigger hordes. The rhythm is the adjustment, not just the raw difficulty.

**Relevance to GW3D:**
- The intensity metric concept maps directly to our needs -- we track per-player "stress" based on enemy proximity, close calls, and death rate.
- The pacing phases concept could inform wave composition -- give struggling players a "breather" wave with easier enemies before ramping up again.
- The group vs. individual tracking is directly applicable to multiplayer.

### 1.2 Resident Evil 4: Invisible Difficulty Scaling

**Source:** Undisclosed until post-launch analysis by fans

RE4 is the canonical example of DDA done so invisibly that players had no idea it existed for years. Capcom never publicly documented the system.

**How It Works:**
- An internal "performance ranking" (0-10 scale) tracks the player continuously.
- Ranking increases when: player scores headshots, uses minimal healing, progresses without dying, achieves high accuracy.
- Ranking decreases when: player dies, uses excessive healing, low accuracy, takes many hits.

**What Changes:**
- Enemy aggression (how quickly they attack, how coordinated their AI is)
- Enemy damage output
- Enemy spawn count (at low ranking, some enemy spawns are skipped entirely -- e.g., two archers in the gondola area are removed)
- Item drop rates and health pickups (more supplies at lower rankings)

**Anti-Detection Strategy:**
- The system was never publicly acknowledged by Capcom during the game's marketing.
- Changes are gradual -- ranking shifts by at most ~0.5 per encounter.
- Adjustments affect AI behavior (harder to notice than health/damage numbers).
- Players attribute success to their own skill improvement, not the system helping them.
- Disabled entirely on Professional difficulty (hardest mode), which signals to skilled players: "this is the real game."

**Relevance to GW3D:**
- The "skip certain enemy spawns" mechanic is directly applicable: instead of spawning a Fractal near a struggling player, spawn a Grunt.
- The gradual 0-10 ranking system could inspire our per-player performance percentile.
- Disabling DDA on the highest difficulty tier (Nightmare) is a great idea.

### 1.3 Mario Kart: Rubber-Banding

**Source:** US Patent 7278913 (Mario Kart: Double Dash), public game analysis

Mario Kart's rubber-banding is the most transparent DDA system -- and arguably the most controversial. It demonstrates the risks of detectable DDA.

**Two Systems:**
1. **Speed Adjustment:** CPU racers speed up when behind and slow down when ahead. The further behind, the larger the speed boost.
2. **Item Distribution:** Items are distributed based on race position. First place gets weak items (green shells, coins). Last place gets devastating items (blue shells, bullet bills, star power).

**Why Players Notice:**
- The speed changes can be extreme and feel unfair ("I was 15 seconds ahead and they caught up instantly").
- Blue shells explicitly target the leader -- this is DDA that openly punishes success.
- Players learn to intentionally stay in second place to avoid blue shells, which means the system is visible and exploitable.

**Key Lesson for GW3D:**
- Mario Kart shows what happens when DDA is detectable: frustration and strategic exploitation.
- Our system must NEVER punish top performers. Only ease up on struggling players.
- Never make adjustments large enough to be noticed in a single moment.

### 1.4 Crash Bandicoot: Jason Rubin's "Inclusive Difficulty"

**Source:** Jason Rubin (lead designer), retrospective interviews

Crash Bandicoot's DDA is the cleanest design in the reference set -- minimal, targeted, and impossible to detect.

**How It Works:**
- Track deaths per checkpoint section.
- After ~5-6 deaths in the same section: spawn an extra Aku Aku mask (health item) in the next attempt.
- In chase sequences (where health items make no sense): slow down the boulder/bear by a small amount.
- The slowdown is small enough that the player cannot consciously detect it but large enough to provide a real advantage.

**Key Quote (Rubin):**
> "We called all this DDA, Dynamic Difficulty Adjustment, and at the time the extent to which we did it was pretty novel. It would lead later Crash games to be the inclusive, perfectly balanced games they became. Good player, bad player, everyone loved Crash games. They never realized it is because they were all playing a slightly different game, balanced for their specific needs."

**Relevance to GW3D:**
- The "provide more resources to struggling players" approach maps to our plan for increased geom/buff spawn rates near struggling players.
- The "slow down obstacles imperceptibly" maps to our plan for slightly reducing enemy speed in a struggling player's zone.
- The death counter approach is simpler than a full performance model but may be too reactive for our needs (deaths are infrequent in GW3D).

### 1.5 Other Relevant Systems

**XCOM: Enemy Unknown (Hidden Accuracy Bonuses)**
- On Easy difficulty, displayed accuracy is 100% of actual value, but actual hit chance is 120%.
- After consecutive misses or teammate deaths, player accuracy temporarily increases.
- After consecutive hits, alien accuracy temporarily decreases.
- This is "always on" DDA layered on top of the difficulty setting.

**Devil May Cry (Off-Screen Throttling)**
- Enemies not visible to the player slow down or stop attacking entirely.
- This prevents unfair "blindside" damage and makes the game feel more fair without players realizing why.
- Directly applicable: enemies outside a player's immediate area could have reduced aggression.

**Half-Life (Simultaneous Attack Limiting)**
- Maximum 2 enemies attack the player simultaneously; others flank or wait.
- This caps the maximum danger at any moment, preventing overwhelm.
- Applicable: we could limit how many hard enemies actively pursue a struggling player at once.

---

## 2. Metrics Design: What Signals Predict "Struggling"

### 2.1 Primary Performance Metrics

| Metric | Formula | Update Rate | Why It Matters |
|--------|---------|-------------|----------------|
| **Kill Rate** | kills / time_window | Per second | Low kill rate = struggling offensively |
| **Death Rate** | deaths / time_window | Per death event | Rising death rate = spiraling |
| **Score Rate** | score_delta / time_window | Per second | Captures overall effectiveness |
| **Close Call Frequency** | near_misses / time_window | Per frame check | High frequency = barely surviving |
| **Average Enemy Proximity** | avg(distance to N nearest enemies) | Per frame | Low value = constantly pressured |
| **Time at Low Health** | frames_at_low_hp / total_frames | Per frame | Sustained danger, not momentary spikes |
| **Buff/Geom Pickup Rate** | pickups / time_window | Per pickup event | Low rate = too busy surviving to collect |

### 2.2 Danger Signals (Struggling Indicators)

These are the composite signals that trigger DDA adjustment:

**Immediate Danger (weight: 0.4)**
- Average distance to 3 nearest enemies < threshold (e.g., 0.15 UV distance)
- More than 5 enemies within close proximity simultaneously
- Currently at 1 life remaining

**Trend Danger (weight: 0.35)**
- Kill rate below 25th percentile of session players (rolling 30s window)
- Score rate below 25th percentile of session players
- Death rate above 75th percentile (more deaths than others)
- Deaths per minute increasing over last 3 minutes

**Sustained Danger (weight: 0.25)**
- More than 50% of recent time window spent at low health (<= 1 HP)
- Buff/geom pickup rate below 50th percentile (cannot collect resources)
- Below median multiplier (score multiplier has been reset by deaths)

### 2.3 Rolling Window vs. All-Time Tracking

**Recommendation: Use a 30-second rolling window with exponential smoothing.**

- **All-time average** is too slow to react. A player who dominated for 5 minutes and then starts struggling will still have a high all-time average.
- **Instantaneous values** are too noisy. A single death spike shouldn't trigger DDA.
- **30-second rolling window** captures sustained trends while filtering out momentary events.
- **Exponential Moving Average (EMA)** with alpha=0.05 (~20s half-life) provides smooth transitions.

**Formula:**
```
EMA_new = alpha * current_value + (1 - alpha) * EMA_previous
```

Where:
- `alpha = 0.05` for most metrics (smooth, 20s half-life)
- `alpha = 0.15` for death rate (react faster to dying)
- `alpha = 0.02` for score rate (very smooth, ignore spikes)

### 2.4 "Close Call" Detection

A close call is defined as an enemy that:
1. Was within lethal collision distance (< 0.5 world units) of the player
2. Was killed by the player or missed the player
3. Occurred within the last 0.5 seconds

Close calls are a leading indicator -- they predict upcoming deaths. A player with high close call frequency is moments away from dying even if they haven't died yet.

**Implementation:**
- Each frame, check enemies within a "close call radius" (slightly larger than kill radius)
- If an enemy enters the close call radius and then leaves (killed or moved away), increment the close call counter
- Track as events per minute with EMA smoothing

---

## 3. Statistical Model: Comparing Players Fairly

### 3.1 Per-Player Performance Score

Combine the metrics into a single continuous score per player:

```
performanceScore =
  (killRate_percentile * 0.25) +
  (scoreRate_percentile * 0.20) +
  (survivalRate_percentile * 0.20) +
  (closeCallInverse_percentile * 0.15) +
  (proximityInverse_percentile * 0.10) +
  (pickupRate_percentile * 0.10)
```

Where `_percentile` is the player's rank among all session players for that metric, normalized to 0.0-1.0.

- 1.0 = best in session
- 0.5 = median
- 0.0 = worst in session

`survivalRate_percentile` = inverse of death rate (fewer deaths = higher score)
`closeCallInverse_percentile` = inverse of close call frequency (fewer close calls = higher score)
`proximityInverse_percentile` = inverse of enemy proximity (farther from enemies = higher score)

### 3.2 Handling Different Player Counts

**2 Players:**
- With only 2 players, percentile ranking is binary (best/worst).
- Use absolute thresholds as a fallback: if both players are struggling (both below absolute baseline), apply DDA to both.
- Absolute baseline: kill rate > 3/min, death rate < 2/min, average enemy proximity > 0.2 UV.

**3-4 Players:**
- Full percentile ranking works well.
- Bottom 25th percentile player gets maximum DDA assistance.
- Below median (50th) gets moderate assistance.
- Above median gets no adjustment.

**Single Player:**
- Compare against historical personal bests (stored in localStorage).
- If no history, compare against predefined "expected performance" curves based on wave number.
- DDA triggers when performance drops below 60% of expected for current wave.

### 3.3 Z-Score for Outlier Detection

To identify players who are dramatically behind (not just slightly below median):

```
z_score = (player_metric - session_mean) / session_std_deviation
```

- z < -1.0: Moderately struggling (apply gentle DDA)
- z < -2.0: Severely struggling (apply maximum DDA)
- z > 1.0: Dominant player (definitely no adjustment)

Z-scores are recalculated every 5 seconds using the EMA-smoothed metrics.

---

## 4. Adjustment Mechanisms: What Changes Subtly

### 4.1 Enemy Type Mix Modification (Primary Mechanism)

This is the most important and most invisible adjustment. Instead of changing enemy properties, change which enemies spawn near the struggling player.

**Enemy Difficulty Classification:**

| Category | Types | Difficulty Score |
|----------|-------|-----------------|
| Easy | Grunt, Wanderer, Duck, Mayfly | 1-2 |
| Medium | Weaver, Spinner, Rocket, Helix, Swarm, Lurker, Orbiter | 3-5 |
| Hard | Snake, Repulsor, GravityWell, Spawner, Cluster, Fractal, Phaser | 6-8 |
| Elite | Gate, Virus, Painter | 9 |
| Boss/Splitting | Titans, Giants, Boss variants | 10 |

**DDA Mix Adjustment:**

When the DDA system determines a player is struggling, it modifies the spawn probabilities for enemies near that player:

| Player State | Easy Mix | Medium Mix | Hard Mix | Elite Mix |
|-------------|----------|------------|----------|-----------|
| Normal (no DDA) | Wave default | Wave default | Wave default | Wave default |
| Mildly struggling | +20% | +5% | -15% | -10% |
| Moderately struggling | +35% | +10% | -25% | -20% |
| Severely struggling | +50% | +15% | -35% | -30% |

This means: for a wave that would normally spawn 5 Grunts and 3 Snakes near a struggling player, the system might instead spawn 7 Grunts and 1 Snake.

### 4.2 Enemy Speed Modifier (Secondary Mechanism)

**Range: 0.85x to 1.0x** (never faster than normal, never slower than 85%)

Apply a speed multiplier to enemies within a radius of the struggling player:

- Normal: 1.0x
- Mildly struggling: 0.95x (5% slower -- imperceptible)
- Moderately struggling: 0.90x (10% slower -- barely noticeable)
- Severely struggling: 0.85x (15% slower -- noticeable if specifically watching for it)

The speed modifier applies only to enemies within 0.3 UV distance of the struggling player. Enemies far from the player are unaffected.

### 4.3 Spawn Density Adjustment (Tertiary Mechanism)

Reduce the number of enemies that spawn in the struggling player's quadrant of the surface.

**Implementation:**
- Divide the surface into regions based on player positions (Voronoi-like partitioning by UV distance to each player).
- Reduce spawn count in the struggling player's region by 10-25%.
- Increase spawn count in the dominant player's region by 0-10% (optional, to compensate).

### 4.4 Resource Spawn Rate Boost

Increase the rate of geom and buff pickups near struggling players:

- Geom drop rate: +10% to +30% (enemies killed near struggling player drop more geoms)
- Buff spawn proximity: Buff pickups that would spawn randomly are biased to spawn within the struggling player's region
- Extra geom attraction range: +10% to +20% (struggling player's pickup radius slightly increased)

### 4.5 Collision Hitbox Generosity (Subtle)

Slightly enlarge the struggling player's bullet hitboxes for collision detection:

- Normal: 1.0x bullet radius
- Struggling: 1.05x to 1.15x bullet radius

This makes the player slightly more effective at killing enemies without them knowing why. The visual bullet size does not change -- only the collision detection radius.

**Warning:** This is the most controversial adjustment. If detected, it feels like cheating. Use sparingly (max 1.15x) and only for severely struggling players.

---

## 5. Anti-Detection Strategy

### 5.1 Core Principles

1. **Gradual transitions (10-20 second ramps):** Never apply an adjustment instantly. Ramp it in over 10-20 seconds using a lerp or smooth step function.

2. **Randomization within adjusted parameters:** Don't deterministically replace every Hard enemy with an Easy one. Instead, increase the *probability* of Easy spawns. The randomness masks the adjustment.

3. **Never remove existing enemies:** If a hard enemy is already on screen, never despawn it or change its behavior mid-life. Only affect future spawns and new enemy behavior.

4. **Mix adjustment, not replacement:** Don't replace 100% of hard enemies with easy ones. At maximum DDA, the mix shifts by ~50% -- there are still hard enemies, just fewer of them.

5. **Return to normal when player improves:** If the player's performance score rises above the DDA threshold, gradually remove the adjustments over 15-20 seconds. The system should oscillate naturally.

### 5.2 Specific Anti-Detection Techniques

**Spawn Variation Masking:**
- Even without DDA, add 10-15% random variation to spawn counts and types.
- When DDA is active, the adjustments are hidden within the natural variation range.
- Players cannot distinguish "DDA adjusted this spawn" from "random variation."

**Zone-Based Application:**
- Apply adjustments per-zone, not globally. Enemies near the struggling player are affected; enemies near the dominant player are not.
- This means the dominant player never sees the system working -- their experience is unchanged.

**Temporal Staggering:**
- Don't adjust all parameters simultaneously. Stagger them:
  - First: enemy mix shifts (0-5 seconds after threshold crossed)
  - Then: speed modifier ramps in (5-10 seconds)
  - Then: spawn density reduces (10-15 seconds)
  - Then: resource boost activates (15-20 seconds)
- If the player recovers before all stages activate, only partial adjustment was applied.

**Hysteresis (Deadband):**
- Use different thresholds for activating and deactivating DDA.
- Activate DDA when performance score < 0.3 (30th percentile).
- Deactivate DDA when performance score > 0.45 (45th percentile).
- This 15-point deadband prevents rapid oscillation (flickering on/off).

### 5.3 Debug Visibility

For development and testing, a debug mode should expose:
- Current DDA level per player (0-3: none, mild, moderate, severe)
- Performance score breakdown (which metrics are triggering)
- Active adjustments (speed modifier, mix shift, resource boost)
- Accessible via the existing F3 debug overlay

### 5.4 Disable on Highest Difficulty

Following RE4's design, DDA should be completely disabled when:
- The game is running on Nightmare tier (tier 4)
- Difficulty Contracts are active (voluntary hard mode means the player wants the real challenge)
- A "disable DDA" option exists in settings for purists (hidden in advanced settings, not prominent)

---

## 6. Architecture: Integration with Existing Code

### 6.1 System Overview

```
┌─────────────────────────────────────────────────────────────┐
│                    DDA System Architecture                    │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  ┌─────────────────┐    ┌──────────────────────┐            │
│  │  PerformanceTracker │ → │  DDADecisionEngine   │           │
│  │  (per player)       │    │  (reads metrics,     │           │
│  │                     │    │   outputs adjustments)│           │
│  │  - Kill rate EMA    │    │                      │           │
│  │  - Death rate EMA   │    │  - Mix modifier      │           │
│  │  - Score rate EMA   │    │  - Speed modifier    │           │
│  │  - Close call freq  │    │  - Density modifier  │           │
│  │  - Proximity avg    │    │  - Resource modifier │           │
│  │  - Pickup rate EMA  │    │  - Hitbox modifier   │           │
│  └─────────────────┘    └──────────┬───────────┘            │
│                                     │                         │
│                          ┌──────────▼───────────┐            │
│                          │  DDASpawnModifier     │            │
│                          │  (hooks into          │            │
│                          │   EnemySpawner)       │            │
│                          │                       │            │
│                          │  - Modifies WaveEnemy │            │
│                          │    type/count before   │            │
│                          │    spawning            │            │
│                          │  - Per-player zones    │            │
│                          └───────────────────────┘            │
│                                                               │
└─────────────────────────────────────────────────────────────┘
```

### 6.2 New Modules

#### `src/difficulty/PerformanceTracker.ts` (~200 lines)

Tracks per-player performance metrics using exponential moving averages.

**Interface:**
```typescript
interface PerformanceSnapshot {
  killRate: number;           // kills per minute (EMA)
  deathRate: number;          // deaths per minute (EMA)
  scoreRate: number;          // score per minute (EMA)
  closeCallFreq: number;     // close calls per minute (EMA)
  avgEnemyProximity: number;  // average UV distance to 3 nearest enemies (EMA)
  pickupRate: number;         // pickups per minute (EMA)
  timeAtLowHealth: number;    // fraction of recent time at low HP (EMA)
}

class PerformanceTracker {
  constructor(playerId: number);

  // Called each frame
  update(dt: number, playerU: number, playerV: number,
         enemies: BaseEnemy[], playerHealth: number, maxHealth: number): void;

  // Called on events
  recordKill(scoreValue: number): void;
  recordDeath(): void;
  recordPickup(type: 'geom' | 'buff'): void;
  recordCloseCall(): void;

  // Read current state
  getSnapshot(): PerformanceSnapshot;
  getPerformanceScore(): number;  // 0.0-1.0 composite

  // Reset (new wave, respawn, etc.)
  reset(): void;
}
```

**Key Implementation Detail:**
- Uses pre-allocated objects for zero GC pressure (matching codebase conventions).
- EMA alpha values configurable per metric.
- Enemy proximity calculated using the existing SpatialHash (no new spatial queries needed -- can query from player position).

#### `src/difficulty/DDADecisionEngine.ts` (~250 lines)

Takes performance snapshots from all players, computes percentile rankings, and outputs DDA adjustment levels.

**Interface:**
```typescript
interface DDALevel {
  level: 0 | 1 | 2 | 3;  // 0=none, 1=mild, 2=moderate, 3=severe
  mixModifier: EnemyMixModifier;
  speedModifier: number;        // 0.85 - 1.0
  densityModifier: number;      // 0.75 - 1.0
  resourceModifier: number;     // 1.0 - 1.3
  hitboxModifier: number;       // 1.0 - 1.15
}

interface EnemyMixModifier {
  easyBias: number;    // 0.0 - 0.5 (additional probability for easy enemies)
  hardPenalty: number;  // 0.0 - 0.35 (probability reduction for hard enemies)
}

class DDADecisionEngine {
  constructor(config?: DDAConfig);

  // Called every 1-2 seconds (not every frame)
  update(trackers: Map<number, PerformanceTracker>): void;

  // Get current adjustment for a player
  getAdjustment(playerId: number): DDALevel;

  // Enable/disable
  setEnabled(enabled: boolean): void;
  isEnabled(): boolean;
}
```

**Key Implementation Details:**
- Recalculates every 2 seconds (not every frame) to save CPU.
- Uses hysteresis (deadband) to prevent oscillation.
- Implements 10-20 second ramp for all adjustments.
- Disabled when difficulty tier >= 4 (Nightmare) or contracts are active.

#### `src/difficulty/DDASpawnModifier.ts` (~150 lines)

Hooks into EnemySpawner to modify wave composition before spawning.

**Interface:**
```typescript
class DDASpawnModifier {
  constructor(engine: DDADecisionEngine);

  // Modify a wave's enemies based on DDA for a specific player zone
  modifyWaveForPlayer(
    waveEnemies: WaveEnemy[],
    playerId: number,
    playerU: number,
    playerV: number
  ): WaveEnemy[];

  // Check if a spawn position is in a player's zone
  getPlayerZone(spawnU: number, spawnV: number, players: PlayerPosition[]): number;
}
```

### 6.3 Integration Points

**EnemySpawner.ts (modified):**
- Before calling `spawnWave()`, pass the wave through `DDASpawnModifier.modifyWaveForPlayer()` for each player's zone.
- Enemies spawned in a struggling player's zone use the modified wave composition.

**EnemySpawner.update() (modified):**
- Apply speed modifier to enemies based on their proximity to struggling players.
- The speed modifier is a multiplier on the enemy's `speed` property, applied each frame.

**Game.ts or main loop (modified):**
- Create PerformanceTracker per player.
- Feed events (kills, deaths, pickups) to the appropriate tracker.
- Call DDADecisionEngine.update() every 2 seconds.

**Player.ts (read-only integration):**
- PerformanceTracker reads player position, health, score from Player instances.
- No modifications to Player.ts itself.

**DifficultyScaling.ts (integration point):**
- DDA is a separate system from the existing 5-tier difficulty scaling.
- DDA operates "on top of" difficulty scaling: tiers determine the base enemy composition, DDA adjusts the composition per-player.
- DDA adjustments are bounded: even at maximum DDA, enemies are still appropriate for the current wave number (no tier-1 enemies in wave 20).

### 6.4 Per-Player Zones on 3D Surfaces

The surface is divided into zones based on player positions using UV-space Voronoi partitioning:

1. For each spawn position (u, v), calculate UV distance to each player.
2. The spawn position belongs to the zone of the nearest player.
3. DDA adjustments for that zone's player are applied to enemies spawning there.

For single player, the entire surface is one zone (all adjustments apply everywhere).

For 2 players, each half of the surface (by UV distance) belongs to one player. Enemies spawning near Player A use Player A's DDA adjustments; enemies near Player B use Player B's.

For 3-4 players, the same distance-based partitioning creates 3-4 zones.

**Edge Case: Players Close Together**
When players are close, their zones overlap. In this case, use the more lenient (lower difficulty) adjustment for shared zones. This prevents a situation where a struggling player standing next to a dominant player gets no help.

### 6.5 Data Flow

```
Per Frame:
  Player state → PerformanceTracker.update() → EMA metrics updated

Per Event:
  Kill event → PerformanceTracker.recordKill()
  Death event → PerformanceTracker.recordDeath()
  Pickup event → PerformanceTracker.recordPickup()

Every 2 Seconds:
  All trackers → DDADecisionEngine.update() → Per-player DDA levels computed

Per Wave Spawn:
  Wave definition → DDASpawnModifier.modifyWaveForPlayer() → Modified wave
  Modified wave → EnemySpawner.spawnWave() → Enemies spawned

Per Enemy Update:
  Enemy position → Zone check → Apply speed modifier from zone's DDA level
```

---

## 7. Recommended Configuration

### 7.1 Default Tuning Values

```typescript
const DDA_CONFIG = {
  // EMA smoothing alphas
  killRateAlpha: 0.05,        // ~20s half-life
  deathRateAlpha: 0.15,       // ~5s half-life (react fast to dying)
  scoreRateAlpha: 0.02,       // ~50s half-life (very smooth)
  closeCallAlpha: 0.08,       // ~12s half-life
  proximityAlpha: 0.10,       // ~10s half-life
  pickupRateAlpha: 0.05,      // ~20s half-life
  lowHealthAlpha: 0.08,       // ~12s half-life

  // Threshold for DDA activation (performance score)
  mildThreshold: 0.35,        // below 35th percentile
  moderateThreshold: 0.20,    // below 20th percentile
  severeThreshold: 0.10,      // below 10th percentile

  // Hysteresis (deactivation thresholds)
  mildDeactivate: 0.50,
  moderateDeactivate: 0.35,
  severeDeactivate: 0.25,

  // Ramp time (seconds to reach full adjustment)
  rampUpTime: 15,             // 15 seconds to fully activate
  rampDownTime: 20,           // 20 seconds to fully deactivate

  // Adjustment bounds
  maxSpeedReduction: 0.15,    // 15% max speed reduction
  maxDensityReduction: 0.25,  // 25% max spawn reduction
  maxResourceBoost: 0.30,     // 30% max resource increase
  maxHitboxBoost: 0.15,       // 15% max hitbox increase
  maxEasyBias: 0.50,          // 50% max easy enemy bias
  maxHardPenalty: 0.35,       // 35% max hard enemy penalty

  // Recalculation interval
  updateInterval: 2.0,        // seconds between engine recalculations

  // Close call detection
  closeCallRadius: 0.08,      // UV distance for close call detection

  // Single player baseline (kills per minute by wave)
  singlePlayerBaseline: [
    5, 8, 12, 15, 18, 22, 25, 28, 30, 32,  // waves 1-10
    35, 38, 40, 42, 44, 45, 46, 47, 48, 50, // waves 11-20
  ],

  // Disable conditions
  disableOnTier: 4,           // disable on Nightmare
  disableWithContracts: true, // disable when any contract is active
};
```

### 7.2 Single Player Mode

In single player, there are no other players to compare against. The system uses:

1. **Historical baseline:** Compare against the player's own best performance on this surface/wave combination (stored in localStorage).
2. **Expected performance curve:** If no history exists, compare against a predefined curve of expected kill rate by wave number.
3. **Absolute thresholds:** If kill rate drops below 3/min or death rate exceeds 3/min, apply mild DDA regardless of percentile.

---

## 8. Edge Cases and Failure Modes

### 8.1 All Players Struggling

If all players are below the absolute baseline, apply DDA to everyone. The percentile ranking becomes irrelevant -- use absolute thresholds instead.

### 8.2 Player Intentionally Playing Badly

A player who stops moving will have terrible metrics but doesn't need DDA help. The system should detect extended inactivity (no movement input for > 5 seconds) and exclude that player from DDA calculations.

### 8.3 Player Exploiting DDA

If a player discovers DDA and intentionally plays badly to get easier enemies, the system limits on adjustments (max 50% mix shift) prevent this from being a significant advantage. Additionally, the performance score uses multiple metrics -- gaming just one (e.g., dying intentionally) while keeping others normal (high kill rate) won't trigger DDA.

### 8.4 Very Short Sessions

DDA needs data to work. For the first 30 seconds of a session, disable DDA entirely and let the EMA values stabilize. Display a "calibrating" state in debug mode.

### 8.5 Player Skill Fluctuation

Players naturally have good and bad moments. The EMA smoothing and hysteresis deadband handle this:
- A single death doesn't trigger DDA (death rate EMA doesn't spike enough from one event).
- A brief period of struggling that resolves naturally won't activate DDA (ramp time is 15 seconds).
- Only sustained poor performance (30+ seconds of being below threshold) triggers meaningful adjustment.

---

## 9. Implementation Priority

### Phase 1: Core Metrics (Estimated 1-2 days)
- `PerformanceTracker` with all EMA metrics
- Close call detection using SpatialHash
- Debug overlay integration (F3 shows per-player performance score)

### Phase 2: Decision Engine (Estimated 1-2 days)
- `DDADecisionEngine` with percentile ranking
- Hysteresis and ramp logic
- Single player baseline comparison

### Phase 3: Spawn Integration (Estimated 1-2 days)
- `DDASpawnModifier` hooked into EnemySpawner
- Enemy type classification and mix modification
- Per-player zone calculation

### Phase 4: Secondary Adjustments (Estimated 1 day)
- Speed modifier per-zone
- Resource spawn bias
- Hitbox generosity (optional, may defer)

### Phase 5: Tuning & Testing (Estimated 2-3 days)
- Playtest with multiple skill levels
- Tune EMA alphas and thresholds
- Verify anti-detection (ask playtesters if they notice)
- Stress test with 4 players and 10K entities

**Total estimated effort: 6-10 working days.**

---

## 10. Summary

The recommended DDA system for GW3D combines the best elements from reference games:

| Feature | Inspiration | Our Implementation |
|---------|------------|--------------------|
| Emotional intensity tracking | Left 4 Dead AI Director | Per-player PerformanceTracker with EMA |
| Invisible difficulty scaling | Resident Evil 4 | Gradual transitions, randomization, anti-detection |
| Resource assist for struggling players | Crash Bandicoot | Geom/buff spawn bias |
| Never punish top performers | Anti-Mario Kart | DDA only helps, never hurts |
| Statistical player comparison | Novel | Percentile ranking within session |
| Zone-based per-player adjustment | Novel for the genre | UV-space Voronoi partitioning |

The system is designed to be:
- **Invisible:** Players should attribute their success to their own improvement.
- **Gradual:** All adjustments ramp over 10-20 seconds.
- **Bounded:** Maximum adjustments are modest (15% speed reduction, 50% mix shift).
- **Reversible:** Adjustments deactivate when the player improves.
- **Opt-out:** Disabled on Nightmare difficulty and when contracts are active.
- **Debuggable:** Full visibility in F3 debug overlay.

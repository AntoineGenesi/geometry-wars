## 2026-02-09 - Exponential Enemy Difficulty Scaling

**Context:** Player reaches 1B+ points with 3000+ combos and massive buff stacks. No real challenge -- enemies die instantly. Need exponential difficulty scaling that keeps pace with player power growth.

**Options Considered:**
1. Scale existing enemy stats linearly with score -- Pros: Simple / Cons: Linear can't keep up with exponential buff stacking; same boring enemies just have more HP
2. Introduce entirely new enemy types per difficulty band -- Pros: Most variety / Cons: Massive art/code effort, 15+ enemy types already exist
3. Tier-based scaling with color variants and splitting -- Pros: Reuses existing geometry with visual distinction, exponential HP scaling, cascading splits create emergent chaos / Cons: More complex system

**Decision:** Option 3 -- Tier-based difficulty scaling system

**Design:**
- 5 difficulty tiers (Normal, Hardened, Veteran, Elite, Nightmare)
- Same enemy geometry, different color tint per tier (orange -> red -> magenta -> white)
- HP scales exponentially: 1x -> 3x -> 8x -> 20x -> 50x
- Speed scales mildly (capped at 1.45x to stay fair)
- Size increases per tier (1.0x -> 1.7x) for visual intimidation
- Tier 2+ enemies split into children of the same type at a lower tier on death
- Difficulty level computed from log10(score), elapsed time, combo, and player level
- Score thresholds: <10K = tier 0 only, 10K-100K = tier 1, 100K-1M = tier 2, 1M-10M = tier 3, 10M+ = tier 4
- Splitting enemies (Titans/Giants) spawn more frequently at higher difficulty
- Wave spawn intervals decrease at higher difficulty
- Scripted early-game waves remain tier 0 (preserves early game feel)

**Key Formula:**
```
difficultyLevel = log10(score/10000) + elapsedTime/600 + comboBonus + levelBonus
maxSpawnTier = floor(difficultyLevel)
```

**Reasoning:** Logarithmic score scaling naturally produces an exponential curve when viewed from the player's perspective (since score itself grows exponentially with multiplier stacking). This means difficulty ramps at the same rate the player powers up. The splitting mechanic creates cascading enemy explosions that fill the screen even when the player is mowing through them quickly.

**Reversibility:** Easy -- remove the `tier` parameter from spawn calls and the system degrades gracefully to the original behavior (all tier 0).

**Files Modified:**
- `src/core/DifficultyScaling.ts` (new) - Core scaling system
- `src/entities/enemies/BaseEnemy.ts` - Added tier support, split-on-death, color tinting
- `src/entities/enemies/EnemySpawner.ts` - Added tier parameter to spawn/spawnWave
- `src/main.ts` - Integrated difficulty into WaveScheduler, added tier split callback

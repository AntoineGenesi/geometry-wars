# Geometry Wars 3: Dimensions - Boss Research

**Date:** 2026-02-08
**Status:** Reference research — game mechanics analysis, no code references.

## Summary

Geometry Wars 3 features **6 main bosses in Adventure Mode**, plus additional bosses in Ultimate and Hardcore modes, for a total of **11 boss encounters**. Each boss is named after a gemstone and features themed colors matching that gem.

## Boss Mechanics (Universal)

### Health System
- Each boss has a **visible health bar** at the top of the screen
- Boss must have its health depleted **approximately 5 times** (5 phases)
- **New health bar** appears for each phase
- **Time is added to the clock** at the beginning of each new phase

### Shield Mechanics
- After health depletion, boss activates an **invulnerable crystal shield**
- Shield lasts several seconds before dropping
- During shield phase, boss spawns waves of standard enemies or mini-bosses
- Player must survive/defeat spawned enemies before shield drops

### Victory Condition
- Deplete boss health in all phases (usually 5) before time expires
- Contact with boss or walls is **lethal**

### General Strategy
- **Prolong early phases** to maximize geom collection and score multiplier
- Weaken boss health carefully to avoid accidental early phase completion
- Save bombs for difficult later phases
- Focus on enemy spawns during shield phases to build multiplier

---

## Adventure Mode Bosses (1-6)

### 1. SAPPHIRE (Level 5)
**Color:** Blue
**Difficulty:** Easy
**Shape:** Large shielded sapphire that spins and chases player

**Phase Breakdown:**
- **Phases 1-4:** Relatively easy, spawns basic enemies (arrows)
- **Phase 5 (Final):** Boss moves very fast and spawns enemies rapidly
  - Recommended: Save bomb for this phase

**Strategy:**
- Prolong phases to maximize geom farming
- Final phase is the only challenge

---

### 2. RUBY (Level 10)
**Color:** Red
**Difficulty:** Moderate

**Phase Breakdown:**
- **Phase 1:** Standard enemy waves
- **Phase 2:**
  - **Tons of diamonds spawn** (grab super state immediately)
  - **Black hole spawns** on opposite end of map (kill before detonation)
- **Phase 3-5:** Boss chases player, spawns arrows
  - Boss **deflects bullets slightly** (unique mechanic)

**Strategy:**
- Prioritize black hole elimination in phase 2
- Acquire super state immediately when diamonds spawn
- Expect bullet deflection during chase phases

---

### 3. EMERALD (Level 20)
**Color:** Green
**Difficulty:** Moderate-Hard

**Phase Breakdown:**
- **Phase 1:** Arrows converge at opposite end of level
  - Kill them all simultaneously
- **Phase 2:** Spawns **1 mini-boss**
  - Kill as fast as possible
- **Phase 3:** Spawns **3 mini-bosses + black hole** (opposite end)
  - Kill black hole first, then mini-bosses
  - Reticule system helps track distant targets
- **Phase 4:** Super state acquisition phase
- **Phase 5 (Final):** Boss chases player, spawns arrows
  - Kill boss quickly (should have 3-star score by now)

**Strategy:**
- Farm phases 1-3 heavily
- Prioritize black hole → mini-bosses in phase 3
- Rush phase 5 if score target met

---

### 4. OPAL (Level 30)
**Color:** White/Iridescent
**Difficulty:** Moderate

**Unique Mechanic:**
- **Red lethal blocks** scattered across arena
- Environmental hazards combined with standard boss mechanics

**Phase Breakdown:**
- Similar to other bosses but with added obstacle navigation

**Strategy:**
- Navigate carefully around red blocks
- Standard boss farming strategy applies

---

### 5. AMETHYST (Level 40)
**Color:** Purple
**Difficulty:** Moderate-Hard

**Phase Breakdown:**
- **Phase 1:** Arrows converge at far end (group kill)
- **Phase 2:** Standard farming phase
- **Phase 3:** Boss spawns **4 turrets** that spawn colored enemies
  - Weaken each turret with ~10 shots during blue enemy phase
  - Destroy turrets before green enemy phase overwhelms you
- **Phases 4-5:** Standard chase/farming

**Strategy:**
- Pre-damage turrets in phase 3 before enemy swarm gets out of control
- Farming is less critical (natural score accumulation is sufficient)

---

### 6. TOPAZ (Level 50 - FINAL BOSS)
**Color:** Yellow/Gold
**Difficulty:** BRUTAL (hardest boss in game)

**Phase Breakdown:**

#### Phase 1 (0:00-0:20)
- Standard enemy farming
- End around 20-second mark

#### Phase 2
- **4 walls spawn around boss**
- Sequence: Arrows → Snake rings → Green square rings

#### Phase 3
- **4 mini-bosses spawn in corners**
- Enemy types change as mini-bosses die:
  - All alive: Diamonds
  - 3 alive: Jacks
  - 2 alive: Green squares
  - 1 alive: Pink boxes

#### Phase 4
- Wall-spawned waves alternate:
  - Arrows + deflectors + diamonds
  - Pink box ring mid-phase

#### Phase 5
- Boss chases with **expanding/contracting walls** (lethal)
- When walls are red: **SURVIVAL MODE** (walls very dangerous)
  - Focus on dodging, don't prioritize boss damage
- Diamonds spawn (eliminate some before focusing boss)

#### Phase 6 (CRITICAL SCORE PHASE)
- **High-value Nufo enemies** spawn rapidly
- Use **homing super state** for survival
- **MUST complete before diamonds spawn** (catastrophic if phase transitions mid-diamond wave)

#### Phase 7
- Boss walls **expand and move**
- Mixed enemy spawning
- **Yellow orbs spawn from walls** (often spawn offscreen and hit instantly)
- Red walls during this phase are extremely punishing

**Critical Mechanics:**
- Walls can turn **red** (more aggressive/lethal)
- Offscreen spawning can cause instant deaths
- Timing phase transitions is crucial to avoid overlap

**Strategy:**
- Phase 1-3: Farm methodically
- Phase 4: Balance farming with survival
- Phase 5: Survival priority when walls are red
- Phase 6: **MAX SCORING** with homing super
- Phase 7: Pure survival, finish quickly

---

## Ultimate Mode Bosses (7-10)

### 7. NEPHRITE (Ultimate Level 10)
No detailed data available.

### 8. AVENTURINE (Ultimate Level 20)
No detailed data available.

### 9. PURPURITE (Ultimate Level 30)
No detailed data available.

### 10. EUDIALYTE (Ultimate Level 40)
No detailed data available.

---

## Hardcore Mode Boss (11)

### 11. TOPAZ (Hardcore Level 20)
Same boss as Adventure Mode Level 50, but under Hardcore constraints.

---

## Common Enemy Spawns Across Bosses

Based on research, bosses commonly spawn:
- **Arrows** (basic enemies)
- **Diamonds** (form geoms/super states)
- **Snakes** (ring formations)
- **Green Squares**
- **Pink Boxes**
- **Deflectors** (bullet reflection)
- **Jacks** (4-pointed enemies)
- **Nufos** (high-value, fast)
- **Black Holes** (must destroy before detonation)
- **Mini-Bosses** (smaller boss variants, 1-4 at a time)

---

## Visual Design Notes

While exact visual descriptions are limited, the research indicates:
- Bosses are **large geometric shapes** (much bigger than normal enemies)
- Colored to match their gemstone name (e.g., Emerald = green, Ruby = red, Sapphire = blue)
- Can activate **crystal shields** (visual indicator of invulnerability)
- Some bosses spawn **4 walls** or **turrets** around them
- Walls can change color (red = lethal/aggressive phase)
- Bosses have unique movement (spinning, chasing, expanding/contracting)

---

## Implementation Notes for Recreation

### Core Boss System Requirements
1. **Health system:** 5 phases with visible health bar
2. **Shield phases:** Crystal shield activation between health depletions
3. **Phase timers:** Add time when entering new phase
4. **Contact damage:** Boss collision = player death
5. **Movement patterns:** Unique per boss (spin, chase, expand/contract)

### Visual Requirements
1. Gemstone-themed colors
2. Large-scale mesh (significantly bigger than enemies)
3. Crystal shield effect (transparency/glow)
4. Wall/turret spawning system
5. Color-changing walls (normal/red states)

### Spawning System Requirements
1. Phase-based enemy waves
2. Mini-boss spawning (1-4 simultaneous)
3. Timed wave sequences
4. Enemy type switching based on phase/conditions
5. Black hole spawning with detonation timer

### Score Strategy Requirements
1. Extended phase mechanics (player can delay phase completion)
2. High multiplier potential from enemy farming
3. Super state drops from diamonds
4. Critical scoring phases (e.g., Topaz phase 6 with Nufos)

---

## Sources

- [Boss - Geometry Wars Wiki](https://geometry-wars.fandom.com/wiki/Boss)
- [3 Star Rating on Every Level Guide - Steam Community](https://steamcommunity.com/sharedfiles/filedetails/?id=404958869)
- [How to be better at Geometry Wars 3: Dimensions - GamesRadar+](https://www.gamesradar.com/how-be-better-geometry-wars-3-dimensions/)
- [Topaz Boss Discussion - Steam Community](https://steamcommunity.com/app/310790/discussions/0/604941528468363028/)
- [Geometry Wars 3 Trophy Guide - PSNProfiles](https://psnprofiles.com/guide/2134-geometry-wars-3-dimensions-trophy-guide)
- [God the final boss sucks - Giant Bomb Forums](https://www.giantbomb.com/forums/geometry-wars-3-dimensions-659732/god-the-final-boss-sucks-1501127/)

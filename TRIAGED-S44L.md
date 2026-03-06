# Session S44l Triage Report

**Date:** 2026-03-07
**Source:** Voice transcript (post-s44k testing feedback)
**Triager:** haiku agent (s44l triager)
**Total Tasks Created:** 21

---

## Summary

User reported issues from playing single-player and multiplayer after s44k merge wave. Three major complaint clusters:

1. **Performance & Rendering** — Upgrade brightness whiteout, companion puff effect lag, CPU metrics needed
2. **Gameplay Balance** — Difficulty scaling broken on small maps (player becomes overpowered), weapon mastery contradictions
3. **Map-Specific Bugs** — Torus, Peanut, Cube Tunnel maps have critical bugs preventing gameplay
4. **Multiplayer Issues** — PvP damage broken, bombs missing, voting screen lacks mode selection
5. **Mobile UX** — Camera zoom wrong, death camera rotates incorrectly
6. **UI/Polish** — QR code positioning, Tesla damage numbers, companion orbit glitch, LAN help modal

---

## Execution Plan

### Wave 1 — CRITICAL GAMEPLAY BLOCKERS (parallel, all must complete)

These 4 tasks block playable gameplay on specific maps:

| Slug | Title | Complexity | Model | Priority |
|------|-------|-----------|-------|----------|
| **s44l-08** | Difficulty Scaling — Player Too Powerful on Small Maps | COMPLEX | sonnet | CRITICAL |
| **s44l-16** | Torus Map Bullet Restriction + Player Position Bug | STANDARD | sonnet | HIGH |
| **s44l-17** | Peanut Map Pole Movement & Bullets Broken | STANDARD | sonnet | HIGH |
| **s44l-20** | Cube Tunnel Shooting & Hit Detection Broken | STANDARD | sonnet | HIGH |

**Note:** s44l-08 is COMPLEX (requires DDA system audit). Start this with sonnet planner or directly with implementer. The other 3 are STANDARD and can be parallel.

**Dependencies:** None — all independent.

### Wave 2 — HIGH PRIORITY RENDERING/MULTIPLAYER BUGS (after Wave 1)

These 3 tasks fix critical bugs in rendering and PvP gameplay:

| Slug | Title | Complexity | Model | Priority |
|------|-------|-----------|-------|----------|
| **s44l-03** | Pickup Brightness Whiteout Bug | STANDARD | sonnet | HIGH |
| **s44l-04** | Companion Puff Effect Performance | STANDARD | sonnet | HIGH |
| **s44l-19** | PvP Bullets Not Killing + Missing Health Bar | STANDARD | sonnet | CRITICAL |

**Note:** s44l-19 blocks PvP mode entirely (no way to damage opponents). Prioritize this.

**Dependencies:** None — all independent.

### Wave 3 — MEDIUM PRIORITY UI/UX FIXES (parallel after Wave 1)

These 9 tasks fix UI, mobile UX, and quick gameplay issues:

| Slug | Title | Complexity | Model | Priority |
|------|-------|-----------|-------|----------|
| **s44l-01** | Remove Performance Profiler Top 10 | QUICK | haiku | MEDIUM |
| **s44l-06** | Companion Orbit Glitch on Cube Face | QUICK | haiku | MEDIUM |
| **s44l-07** | Small Cube Map No Boss Spawns | QUICK | haiku | MEDIUM |
| **s44l-11** | Pause Menu QR Static Position | QUICK | haiku | MEDIUM |
| **s44l-12** | Mobile 2x Zoom at Start | QUICK | haiku | MEDIUM |
| **s44l-15** | Tesla Coil Damage Numbers Visible | QUICK | haiku | MEDIUM |
| **s44l-05** | Weapon Mastery Contradictory Effects | STANDARD | sonnet | MEDIUM |
| **s44l-09** | LAN Troubleshooting Modal | STANDARD | sonnet | MEDIUM |
| **s44l-10** | Entity Culling 90° + Groundwork | STANDARD | sonnet | MEDIUM |
| **s44l-13** | Mobile Death Camera Rotation Bug | STANDARD | sonnet | MEDIUM |
| **s44l-14** | Voting Screen Mode & Size Selection | STANDARD | sonnet | MEDIUM |
| **s44l-18** | Add Bombs to PvP/Multiplayer | QUICK | haiku | MEDIUM |

**Can be parallel** with Wave 2. These are lower priority and mostly independent.

### Wave 4 — ANALYSIS & DEPENDENT FEATURES (after all bugs fixed)

These 2 tasks depend on earlier fixes or are feature-level:

| Slug | Title | Complexity | Model | Priority | Depends |
|------|-------|-----------|-------|----------|---------|
| **s44l-02** | CPU Percentage Breakdown Analysis | STANDARD | sonnet | LOW | none |
| **s44l-21** | PvP Win Conditions Settable | STANDARD | sonnet | LOW | s44l-19 |

**s44l-02** is analysis-only (no code fixes). Run after user asks.

**s44l-21** requires s44l-19 (PvP damage) to be fixed first.

---

## Categorization Summary

### By Category

| Category | Count | Tasks |
|----------|-------|-------|
| **bug** | 10 | s44l-03, s44l-04, s44l-06, s44l-07, s44l-13, s44l-16, s44l-17, s44l-20, s44l-15 |
| **feature/gameplay** | 4 | s44l-05, s44l-14, s44l-18, s44l-21 |
| **feature/ux** | 3 | s44l-09, s44l-11, s44l-12 |
| **feature/performance** | 1 | s44l-10 |
| **game-balance** | 1 | s44l-08 |
| **analysis** | 1 | s44l-02 |
| **ops/refactor** | 1 | s44l-01 |

### By Complexity

| Complexity | Count | Tasks |
|-----------|-------|-------|
| QUICK | 7 | s44l-01, s44l-06, s44l-07, s44l-11, s44l-12, s44l-15, s44l-18 |
| STANDARD | 13 | s44l-02, s44l-03, s44l-04, s44l-05, s44l-09, s44l-10, s44l-13, s44l-14, s44l-16, s44l-17, s44l-19, s44l-20, s44l-21 |
| COMPLEX | 1 | s44l-08 |

### By Model

| Model | Count | Tasks |
|-------|-------|-------|
| **haiku** | 7 | s44l-01, s44l-06, s44l-07, s44l-11, s44l-12, s44l-15, s44l-18 |
| **sonnet** | 13 | s44l-02, s44l-03, s44l-04, s44l-05, s44l-09, s44l-10, s44l-13, s44l-14, s44l-16, s44l-17, s44l-19, s44l-20, s44l-21 |
| **opus** | 1 | (in planner, if s44l-08 needs decomposition) |

---

## Known Issues from DISCOVERIES.md (Relevant to These Tasks)

1. **PeanutSurface.getPoint() missing applyWorldRotation()** — s44j-11 fixed this but 5 other surfaces have the same bug (CapsuleSurface, PillSurface, CubeRingSurface, PipeSurface, SphereWithTunnelSurface). This likely causes s44l-16, s44l-17, s44l-20 bullet/hit detection issues.

2. **s43-11 BULLET_LIFETIME fix not committed** — Marked done but changes are uncommitted. Affects MP parity.

3. **i18n not initialized in MP entry points** — multiplayer-main.ts and network-main.ts don't await initI18n(). Affects UI translations in MP mode.

---

## Deduplication Notes

Original transcript had duplicate complaints about difficulty scaling (mentioned twice, different details). Consolidated into single s44l-08 task.

Voice-to-text errors interpreted:
- "Fins" → companions/drones (SurfaceAgent)
- "rectangle map" → rectangle surface (may be "rect" in code)
- "top 10" → top 10 functions in performance profiler

---

## Risk Assessment

### High-Risk Tasks (may require iteration)

- **s44l-08** (Difficulty Scaling) — Complex system touching DDA, spawn logic, pickup spawning. User has clear expectations but system is intricate.
- **s44l-16, s44l-17, s44l-20** (Map Bugs) — Related to surface coordinate systems. Previous attempts (s44h, s44j) had regressions. Likely all stem from missing applyWorldRotation() per DISCOVERIES.

### Low-Risk Tasks

- s44l-01, s44l-06, s44l-07, s44l-11, s44l-12, s44l-15, s44l-18 (QUICK/straightforward)
- s44l-09, s44l-14 (UI additions, isolated)

### Dependency Risks

- s44l-21 (PvP Win Conditions) **blocks on** s44l-19 (PvP Damage)
- s44l-05 (Weapon Mastery) may require design decision if "combined effect" is undefined

---

## Next Steps

1. **Immediately:** Launch Wave 1 workers (s44l-08, s44l-16, s44l-17, s44l-20 parallel)
2. **After Wave 1:** Launch Wave 2 workers (s44l-03, s44l-04, s44l-19)
3. **Parallel with Wave 2:** Launch Wave 3 QUICK tasks (haiku workers can run many in parallel)
4. **After Wave 2:** Launch remaining Wave 3 STANDARD tasks
5. **After all bugs:** Run Wave 4 (analysis + dependent features)

**Estimated timeline:** 4-6 hours if fixes are straightforward, 8+ hours if regressions appear.

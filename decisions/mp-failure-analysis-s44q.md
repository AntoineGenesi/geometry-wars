# MP Failure Analysis — Git History Deep Dive (s44q-05)

**Date:** 2026-03-08
**Sessions analyzed:** s21 (Feb 17) through s44q (Mar 8)
**Commits analyzed:** 2,213 (full history intact)
**Voice dumps read:** 13 (inbox/2026-03-01 through 2026-03-08)

---

## What Worked (User Said So)

- **Sphere movement** — User praised it Mar 2 04:45: "The map movement is better. I'm happier with it."
- **Hit detection on bullets** — Mar 2: "The hit detection on the bullets on the enemies is a lot better, and the movement speed is better too!"
- **Sphere movement again** — Mar 3 09:00: "The movement is a lot better, it's not as glitchy as before."
- **Mobile movement** — Mar 3 09:00: "The mobile actually feels better; the movement speed feels actually pretty decent."
- **Cube rectangle** — Mar 7 06:15: "Movement on the cube rectangle with a hole in it works, at least for single-player."
- **Peanut killing** — Mar 7 10:00: "Peanut is better, at least it's killing things, and I can move around."

## What Kept Failing

| Bug | First Reported | Last Reported | Fix Count |
|-----|---------------|---------------|-----------|
| Torus bullet from wrong position | Mar 1 | Mar 7 (0900, 1000) | ~7 attempts |
| Peanut pole slowdown | Mar 1 | Mar 7 (0900, 1000) | ~6 attempts |
| Sphere camera/movement | Mar 1 | Mar 7 (0900) | ~4 attempts |
| Pill map broken | Mar 3 (0001) | Mar 7 (0900, 1000) | ~3 attempts |
| Ghost kill hit detection | Mar 1 | Mar 7 (0900) | ~4 attempts |
| MP slower than SP | Mar 2 | Mar 7 | ongoing |
| Spread shot invisible | Mar 2 | Fixed s44k-02 (Mar 6) | 1 fix |

---

## 8 Root Cause Patterns

### Pattern 1: PlaygroundGame.ts Trap (CRITICAL)
Fixes applied to PlaygroundGame.ts (demo harness) are **invisible** in multiplayer. MP goes through `network-main.ts` + `GameRoom.ts`. This burned entire sessions (S19 was 8+ hours of wasted work).

### Pattern 2: Regression by Unrelated Feature Merge (CRITICAL)
s44j (PvP) introduced `s44j-16 client prediction` which broke movement on ALL maps. Root cause found by s44k-01 which reverted just that one commit. Cost: ~1 full session. Lesson: client prediction changes touch all surfaces simultaneously.

### Pattern 3: Level 2 Verification Claimed as "Fixed" (CRITICAL)
Every session: "TypeScript compiles" → "fixed" → user tests → "nothing works." Still happening in s44o where SurfaceVerifier claimed 14 tests pass but sphere camera tilt was immediately caught by user.

### Pattern 4: No Regression Lock After Fix
Torus fixed 7 times. No test locked in each fix, so next coordinate system change could restore the wrong behavior. s44p-04 finally did it correctly: test FAILS before fix, PASSES after fix.

### Pattern 5: SP/MP Code Divergence
MP and SP share no game logic. Every SP fix must be ported to BOTH `network-main.ts` (client) and `GameRoom.ts` (server). Known gaps: MatchUpgradeTracker, mapSizeScaleFactor, pickup dimming.

### Pattern 6: Wrong File Fix
s44p-05 fix applied to `v3_LAN_working/` (backup dir) instead of `src/`. Always verify changed files are in `src/` or `server/`.

### Pattern 7: Verification Framework Tests Wrong Thing
SurfaceVerifier tested isolated math, not the `network-main.ts` code path. MPBugDetector tested server UV math, not client-visible rendering. Effective tests must exercise the actual entry point (`network-main.ts` + `GameRoom.ts`).

### Pattern 8: Layered Fixes Without Integration Check
Each session adds coordinate fixes. s44o fixed torus UV, then s44p found sphere camera broken. Coordinate system, camera frame, and UV recovery are tightly coupled.

---

## The Torus Regression Chain (7 Fixes)

The torus is the canonical example of why fixes don't stick:

1. **s35** — Torus controls inverted → fix right-hand tangent frame → helped
2. **s36** — Re-report: torus inverted bullets → partial fix → still broken at inner surface
3. **s44l-16** — worldToSurface for accurate UV → not sufficient
4. **s44o-04b** — Torus UV parameterization in server → not sufficient
5. **s44p-01** — Wrote MPBugDetector to *prove* the bug existed first (correct approach)
6. **s44p-03** — **Root cause: negate `wy` in atan2** → inner/outer surface confusion resolved
7. **s44p-04** — Negate `wy` in `_worldPosToApproxUV` → ghost kills fixed

The root cause (`wy` sign) was there from the beginning. Six earlier fixes addressed symptoms (tangent frame, UV parameterization) without finding it.

---

## The s44j Regression (Worst Single Event)

**What:** s44j merged PvP features (13+ sub-tasks). One of them (s44j-16) changed client prediction in a way that broke movement on every single map.

**User reaction (Mar 3 13:00):** "What the f___ did you do? You definitely ruined that component. Every map is broken, completely broken."

**Fix:** s44k-01 — `git revert s44j-16` — single commit. Movement restored to all maps.

**Lesson:** Feature merges must include an all-surface movement regression test. Client prediction = cross-surface risk.

---

## Current State (Mar 8, 2026)

| Surface | Status | Notes |
|---------|--------|-------|
| Sphere | ✅ Working | s44p-02 fixed camera tilt |
| Torus | ✅ Working | s44p-03/04 fixed UV + ghost kills |
| Peanut | ⚠️ Partial | Bullet origin OK, poles still sluggish |
| Pill | ⚠️ Partial | Player on surface, hit detection still off |
| Mobius | ✅ Working | s44o-04d fixed seam traversal |
| Cube | ✅ Working | s44l-20 fixed tunnel shooting |

---

## Git History Completeness

- **Earliest commit:** 2026-02-06 (initial project)
- **Total commits:** 2,213 (verified `git log | wc -l`)
- **Remote:** moved from `/mnt/c` to `/home/antoine` — full history preserved
- **Voice dump coverage:** Mar 1 through Mar 8 in `inbox/`
- **No missing history confirmed**

---

## HTML Report

Full visual report at: `reports/mp-failure-analysis.html`

Contains: full session timeline table, voice dump quotes, per-surface fix matrix, pattern cards, test analysis, current status table.

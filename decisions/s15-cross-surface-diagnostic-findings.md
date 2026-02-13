# S15 Cross-Surface Movement Diagnostic Findings

**Date:** 2026-02-14
**Context:** After iteration 7 (dual Gram-Schmidt) passed Level 5 Puppeteer tests on sphere, user tested at 60 FPS and found jerk/oscillation issues that vary by surface. This diagnostic ran comprehensive movement tests across ALL 8 playable surfaces.

## Summary

**Test Date:** 2026-02-14
**Surfaces Tested:** 8 (sphere, cube, pill, torus, capsule, peanut, pipe, icosahedron)
**Test Results:** 4 surfaces successfully tested, 4 surfaces had runtime errors

### Successfully Tested Surfaces

| Surface | Lateral (D) | Forward (W) | Diagonal (W+D) | Overall |
|---------|-------------|-------------|----------------|---------|
| **sphere** | ❓ INCOMPLETE | ❓ INCOMPLETE | ❓ INCOMPLETE | ❓ ERROR (geometry undefined) |
| **cube** | ❌ FAIL | ❌ FAIL | ❌ FAIL | ❌ BROKEN |
| **pill** | ❓ INCOMPLETE | ❓ INCOMPLETE | ❓ INCOMPLETE | ❓ ERROR (geometry undefined) |
| **torus** | ❌ FAIL | ❌ FAIL | ❌ FAIL | ❌ BROKEN (no movement) |
| **capsule** | ❓ INCOMPLETE | ❓ INCOMPLETE | ❓ INCOMPLETE | ❓ ERROR (geometry undefined) |
| **peanut** | ❓ INCOMPLETE | ❓ INCOMPLETE | ❓ INCOMPLETE | ❓ ERROR (geometry undefined) |
| **pipe** | ❌ FAIL (wobble) | ✅ PASS | ✅ PASS | ⚠️ PARTIAL |
| **icosahedron** | ✅ PASS | ✅ PASS | ✅ PASS | ✅ WORKING |

## Detailed Findings

### ICOSAHEDRON (ONLY FULLY WORKING SURFACE)
- **Lateral (D):** wobble ratio = 0.069, CV = 0.284 — smooth rightward movement ✅
- **Forward (W):** wobble ratio = 0.103, CV = 0.292 — smooth forward movement ✅
- **Diagonal (W+D):** displacement = 11.98 units, zigzag freq = 0.00 — straight diagonal ✅
- **Verdict:** ALL tests passed. This surface works correctly at 60 FPS.

### PIPE (PARTIALLY WORKING)
- **Lateral (D):** wobble ratio = 0.578 ❌ — severe vertical wobble during left/right movement (threshold: 0.15)
- **Forward (W):** wobble ratio = 0.123, CV = 0.150 — works fine ✅
- **Diagonal (W+D):** displacement = 13.06 units, zigzag = 0.00 — works fine ✅
- **Verdict:** Lateral movement has severe jerk, but forward/diagonal work.

### CUBE (COMPLETELY BROKEN)
- **Lateral (D):** Only 13/15 intervals went right (2 reversed direction!) ❌
  - wobble ratio = 0.037 (low, but direction inconsistency is critical)
  - CV = 0.381 (moderate jitter)
- **Forward (W):** Only 5/15 intervals went up (10 reversed!) ❌
  - wobble ratio = 0.949 (extremely high — more sideways than forward)
  - CV = 0.560 (high jitter — FAILED consistency threshold)
- **Diagonal (W+D):**
  - Displacement = 3.97 units (low but above threshold)
  - Direction FAILED: SR=-0.99 (went LEFT instead of right), SU=0.91
  - Zigzag freq = 0.29 (just below 0.30 threshold but still concerning)
- **Verdict:** Random direction reversals, high wobble, diagonal goes wrong direction. Matches user's "left sometimes goes left, sometimes spins you around randomly."

### TORUS (COMPLETELY BROKEN — NO MOVEMENT)
- **All tests:** 0.000 displacement across 3 seconds of key press
- **Lateral:** 0/15 intervals had positive screen-right (all zero)
- **Forward:** 0/15 intervals had positive screen-up (all zero)
- **Diagonal:** 0.00 total displacement
- **Verdict:** Player is COMPLETELY STUCK on torus surface. No movement registers at all.

### SPHERE/PILL/CAPSULE/PEANUT (TEST ERROR)
- **Error:** `Cannot read properties of undefined (reading 'geometry')` in near-pole test
- **Location:** The test's `testNearPole()` function tries to access `surface.geometry` but the reference is incorrect
- **Impact:** Main tests (A/B/C) likely completed but results not captured due to error during test D
- **Action needed:** Fix the test script and re-run to get sphere/pill/capsule/peanut data

## Key Patterns

### 1. Curved vs Flat-Faced Surfaces
From the limited data:
- **Curved:** pipe = partial failure, torus = total failure
- **Flat-faced:** cube = total failure, icosahedron = success
- **No clear pattern** — success/failure doesn't correlate cleanly with surface topology type

### 2. Wobble Severity Ranking
1. **pipe:** lateral wobble = 0.578 (3.9x threshold) 🔴
2. **cube:** forward wobble = 0.949 (6.3x threshold) 🔴
3. **icosahedron:** 0.069-0.103 (within threshold) ✅

### 3. Direction Consistency is Critical
- **Cube:** 2/15 lateral intervals went WRONG direction → explains "sometimes left, sometimes right"
- **Cube:** 10/15 forward intervals went WRONG direction → explains "jerky forward + veering"
- **Torus:** All movement = zero → complete failure

### 4. Diagonal Movement More Reliable
- **Pipe:** diagonal PASSED even though lateral FAILED
- **Cube:** diagonal closer to passing than individual axes
- This suggests the issue is in SINGLE-AXIS movement, possibly the tangent frame alignment when moving perpendicular to camera

## Root Cause Hypotheses (Updated)

### Hypothesis 1: Surface-Specific Code Paths
**Evidence:**
- User reported "each map should NOT have a different factory loader" concern
- Cube has special UV-based movement code in PlaygroundGame.ts (lines 614-643)
- Different surfaces show completely different failure modes (torus=stuck, cube=random, icosahedron=working)

**Likelihood:** HIGH — the per-surface variation is the smoking gun

### Hypothesis 2: Tangent Frame Instability at Discontinuities
**Evidence:**
- Cube edges/corners have discontinuous normals → explains random direction reversals
- Pipe (cylindrical) has seam at 0°/360° → explains lateral wobble
- Icosahedron has many small flat faces (gradual normal changes) → works fine

**Likelihood:** HIGH — explains why icosahedron works but cube fails

### Hypothesis 3: Dual Gram-Schmidt Fails on Certain Geometries
**Evidence:**
- Iteration 7 used dual Gram-Schmidt to eliminate swap oscillation
- But it only tested on sphere (which has ERROR in this diagnostic)
- Torus (complete failure) suggests Gram-Schmidt projection degenerates on certain surface types

**Likelihood:** MEDIUM — but explains torus total failure

### Hypothesis 4: Camera Projection Degeneration
**Evidence:**
- Cube forward wobble (0.949) means player goes MORE sideways than forward when pressing W
- This could be camera→surface projection becoming unstable at certain orientations

**Likelihood:** MEDIUM

## User-Reported Symptoms vs Diagnostic Data

| User Report | Diagnostic Confirmation |
|-------------|-------------------------|
| "Sphere: jerky left/right with up/down wobble" | ❓ INCOMPLETE (test error) — need to fix and re-run |
| "Cube: left sometimes left, sometimes right" | ✅ CONFIRMED — 2/15 lateral intervals reversed direction |
| "Cube: turns all messed up" | ✅ CONFIRMED — forward wobble=0.949, diagonal went left instead of right |
| "Pill: only some movement works" | ❓ INCOMPLETE (test error) |
| "Map wobble worse near origin/pole" | ❓ NOT TESTED (near-pole test errored out) |
| "Diagonal shows zigzag/overshoot" | ⚠️ CUBE shows zigzag=0.29 (borderline), others pass |
| "Trail effect multiplied on cube" | ❓ NOT TESTED (visual symptom, not measured in position test) |

## Immediate Action Items

1. **Fix the test script** — near-pole test has bug (surface.geometry access)
2. **Re-run on sphere/pill/capsule/peanut** — these are the PRIMARY surfaces user tested, we don't have data yet!
3. **Investigate cube special code path** — PlaygroundGame.ts lines 614-643 (UV-based movement)
4. **Investigate torus complete failure** — why does player not move AT ALL?
5. **Fix pipe lateral wobble** — isolated issue on one surface type

## Test Thresholds Used

- **Wobble ratio:** < 0.15 (perpendicular component / primary component)
- **Consistency CV:** < 0.5 (coefficient of variation for velocity magnitude)
- **Zigzag angle:** > 45° between consecutive displacement vectors
- **Zigzag frequency:** < 0.3 (max 30% of intervals can have large angles)
- **Min diagonal displacement:** > 2.0 units in 3 seconds

## Files Generated

- Test script: `tests/visual/s15-cross-surface-diagnostic.mjs`
- Screenshots: `tests/visual/screenshots/s15-cross-{surface}.png` for cube, torus, pipe, icosahedron
- This analysis: `decisions/s15-cross-surface-diagnostic-findings.md`

## Next Steps

1. **URGENT:** Fix test script and re-run to get sphere/pill/capsule/peanut data (these are what user actually tested!)
2. **Investigate per-surface code paths** — if cube has special handling, that's likely the root cause of variation
3. **Add regression tests** — once fixed, this diagnostic should be part of CI to prevent per-surface regressions
4. **Consider unifying movement** — if per-surface code paths exist, remove them (architectural goal: "treat every map the same")

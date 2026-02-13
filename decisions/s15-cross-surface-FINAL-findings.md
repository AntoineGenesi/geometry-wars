# S15 Cross-Surface Movement Diagnostic — FINAL FINDINGS

**Date:** 2026-02-14
**Test:** Comprehensive cross-surface movement analysis after iteration 7 (dual Gram-Schmidt)
**User Report:** Iteration 7 passed Puppeteer tests on sphere, but user testing at 60 FPS found surface-specific jerk/oscillation issues

---

## CRITICAL DISCOVERY: THREE SURFACES COMPLETELY BROKEN

**Torus, Capsule, Icosahedron: ZERO MOVEMENT**
- All three surfaces show 0.000 displacement after 3 seconds of key press
- Player is completely stuck — no lateral, no forward, no diagonal movement
- This is a CRITICAL BUG — these surfaces are unplayable

---

## Test Results Summary

| Surface | Lateral | Forward | Diagonal | Overall | Key Issue |
|---------|---------|---------|----------|---------|-----------|
| **sphere** | ✅ PASS | ✅ PASS | ✅ PASS | ✅ **WORKS** | Pole wobble 1.48x (minor) |
| **cube** | ❌ FAIL | ❌ FAIL | ❌ FAIL | ❌ **BROKEN** | Direction reversals, high wobble, zigzag |
| **pill** | ✅ PASS | ✅ PASS | ❌ FAIL | ⚠️ **PARTIAL** | Diagonal zigzag 64% |
| **torus** | ❌ FAIL | ❌ FAIL | ❌ FAIL | 🔴 **STUCK** | Zero movement |
| **capsule** | ❌ FAIL | ❌ FAIL | ❌ FAIL | 🔴 **STUCK** | Zero movement |
| **peanut** | ✅ PASS | ✅ PASS | ✅ PASS | ✅ **WORKS** | Pole wobble 2.02x (minor) |
| **pipe** | ✅ PASS | ✅ PASS | ✅ PASS | ✅ **WORKS** | Wobble at threshold (0.136/0.150) |
| **icosahedron** | ❌ FAIL | ❌ FAIL | ❌ FAIL | 🔴 **STUCK** | Zero movement |

**Success Rate:** 3/8 surfaces fully working (37.5%)
**Critical Failures:** 3/8 surfaces with zero movement (37.5%)

---

## Detailed Findings

### GROUP 1: WORKING SURFACES (3/8)

#### SPHERE ✅
- **Lateral:** wobble=0.047, CV=0.229 — smooth
- **Forward:** wobble=0.107, CV=0.252 — smooth
- **Diagonal:** dist=15.01, zigzag=0.00 — perfect
- **Pole:** wobble increases 1.48x near pole (0.069 vs 0.047 equator) — acceptable
- **Verdict:** WORKS CORRECTLY

#### PEANUT ✅
- **Lateral:** wobble=0.068, CV=0.239 — smooth
- **Forward:** wobble=0.041, CV=0.197 — smooth
- **Diagonal:** dist=10.04, zigzag=0.00 — straight
- **Pole:** wobble increases 2.02x near pole (0.138 vs 0.068 equator) — minor concern
- **Verdict:** WORKS CORRECTLY

#### PIPE ✅
- **Lateral:** wobble=0.136, CV=0.260 — borderline (0.136 vs 0.15 threshold)
- **Forward:** wobble=0.150, CV=0.277 — at threshold exactly (0.150 vs 0.15)
- **Diagonal:** dist=13.85, zigzag=0.00 — straight
- **Verdict:** WORKS but wobble is RIGHT at threshold — could feel jerky to user

---

### GROUP 2: COMPLETELY STUCK (3/8) — CRITICAL BUG

#### TORUS 🔴
- **All movement:** 0.000 displacement
- **15/15 lateral intervals:** zero movement
- **15/15 forward intervals:** zero movement
- **Diagonal:** zero total displacement
- **Verdict:** Player CANNOT MOVE AT ALL

#### CAPSULE 🔴
- **All movement:** 0.000 displacement
- **Verdict:** Player CANNOT MOVE AT ALL

#### ICOSAHEDRON 🔴
- **All movement:** 0.000 displacement
- **Verdict:** Player CANNOT MOVE AT ALL
- **NOTE:** This contradicts the FIRST test run which showed icosahedron working! Indicates a race condition or initialization issue.

---

### GROUP 3: BROKEN MOVEMENT (2/8)

#### CUBE ❌
- **Lateral (D):**
  - Only 12/15 intervals went right — 3 intervals REVERSED direction!
  - wobble=0.039 (low)
  - CV=0.312 (moderate)
- **Forward (W):**
  - Only 5/15 intervals went up — 10 intervals REVERSED direction!
  - wobble=0.996 (6.6x threshold!) — player goes MORE sideways than forward
  - CV=0.561 (high jitter, FAILED threshold)
- **Diagonal (W+D):**
  - dist=2.20 (barely above 2.0 threshold — should be ~10-15)
  - zigzag=0.42 (42% of intervals have >45° angle changes)
  - Direction OK (SR=1.55, SU=0.90) but movement is stuttering
- **Verdict:** SEVERE direction instability, forward movement nearly sideways, diagonal zigzags badly

#### PILL ⚠️
- **Lateral:** wobble=0.032, CV=0.195 — WORKS ✅
- **Forward:** wobble=0.068, CV=0.166 — WORKS ✅
- **Diagonal:**
  - dist=12.64 (good displacement)
  - Direction FAILED: SR=-0.38 (went LEFT instead of right!), SU=10.64
  - zigzag=0.64 (64% of intervals have >45° angle changes — severe overshooting)
- **Verdict:** Single-axis movement works, but diagonal shows severe zigzag/overshoot pattern

---

## Comparison to User Reports

| User Report (60 FPS browser) | Diagnostic Confirmation |
|------------------------------|------------------------|
| "Sphere: jerky left/right with up/down wobble" | ❌ TEST SHOWS SMOOTH — wobble=0.047 (well below threshold) |
| "Cube: left sometimes left, sometimes right" | ✅ CONFIRMED — 3/15 lateral intervals reversed |
| "Cube: turns all messed up" | ✅ CONFIRMED — forward wobble=0.996 (goes sideways), zigzag=0.42 |
| "Pill: only some movement works" | ✅ CONFIRMED — lateral/forward work, diagonal fails with 64% zigzag |
| "Diagonal shows zigzag/overshoot" | ✅ CONFIRMED — pill 64%, cube 42% |
| "Map wobble worse near origin/pole" | ⚠️ PARTIAL — sphere 1.48x, peanut 2.02x, pill 2.56x increase at pole |

**KEY DISCREPANCY:** User reports sphere as jerky, but test shows sphere PASSING all tests. This suggests:
1. 60 FPS visual perception vs 7 FPS Puppeteer sampling rate difference
2. Small wobbles (0.047) may be visible at 60 FPS even if below threshold
3. The pole wobble (1.48x increase) may be more noticeable in continuous play

---

## Root Cause Analysis

### Why Three Surfaces Are Completely Stuck

**Hypothesis 1: Surface initialization failure**
- Torus, capsule, icosahedron may not be initializing the walker correctly
- Check if `MeshWalker.initialize()` fails silently on these geometries
- Look for error logs in console during surface load

**Hypothesis 2: Normal computation failure**
- These three surfaces may have degenerate normals (zero-length or invalid)
- If normal computation returns (0,0,0), the tangent frame can't be constructed
- Check if `surface.getClosestPoint()` works on these geometries

**Hypothesis 3: Surface factory special-casing**
- User mentioned concern: "each map should NOT have a different factory loader"
- These three surfaces may be missing walker initialization code
- Check `PlaygroundGame.ts` for per-surface conditionals

**Likelihood:** HIGH — three completely different surface types (torus=curved, capsule=capped cylinder, icosahedron=polyhedron) all failing the same way suggests a common initialization issue, not geometry-specific bugs.

### Why Cube Has Random Direction Reversals

**Hypothesis:** Tangent frame discontinuity at cube edges
- When player crosses a cube edge, normals change by 90° instantly
- The tangent frame (computed via dual Gram-Schmidt) may flip orientation
- The swap hysteresis added in iteration 6 may not be sufficient for 90° normal changes

**Evidence:**
- 3/15 lateral intervals reversed (20%)
- 10/15 forward intervals reversed (67%!)
- Forward wobble=0.996 means player goes nearly perpendicular to intended direction

### Why Pill Has Diagonal Zigzag

**Hypothesis:** Diagonal input triggers alternating tangent/bitangent projection
- When W+D are both pressed, moveFromInput projects onto both tangent and bitangent
- On pill (capsule shape), the curvature may cause these projections to oscillate in sign
- Results in zigzag pattern: move right-forward, then left-forward, then right-forward...

**Evidence:**
- Single-axis movement (D or W alone) works fine
- Diagonal (W+D together) shows SR=-0.38 (should be +) and zigzag=64%
- User described this as "left→up→RIGHT, then up→back" — exactly a zigzag

---

## Pattern Analysis

### Curved vs Flat-Faced

| Category | Working | Stuck | Broken | Total |
|----------|---------|-------|--------|-------|
| **Curved** (sphere, pill, torus, capsule, peanut, pipe) | 3 | 2 | 1 | 6 |
| **Flat-faced** (cube, icosahedron) | 0 | 1 | 1 | 2 |

**No clear pattern** — both categories have failures. Curved surfaces slightly better (50% working vs 0% for flat-faced).

### Wobble Severity by Surface

Surfaces with movement (excluding stuck surfaces):

| Rank | Surface | Lateral Wobble | Forward Wobble | Status |
|------|---------|----------------|----------------|--------|
| 1. | **pill** | 0.032 | 0.068 | BEST |
| 2. | **sphere** | 0.047 | 0.107 | GOOD |
| 3. | **cube** | 0.039 | **0.996** | BROKEN (forward) |
| 4. | **peanut** | 0.068 | 0.041 | GOOD |
| 5. | **pipe** | 0.136 | 0.150 | BORDERLINE |

**Key finding:** Cube's forward wobble (0.996) is 6.6x the threshold and 9.3x worse than any other surface. This is not a "slight jitter" — the player goes almost perpendicular to the intended direction.

### Pole Sensitivity

Surfaces with pole tests (sphere, pill, peanut):

| Surface | Equator Wobble | Pole Wobble | Ratio | Status |
|---------|----------------|-------------|-------|--------|
| **sphere** | 0.047 | 0.069 | 1.48x | Minor |
| **pill** | 0.032 | 0.081 | 2.56x | Moderate |
| **peanut** | 0.068 | 0.138 | 2.02x | Moderate |

**User was RIGHT:** Movement IS worse near poles, but the magnitude (1.5-2.5x increase) may not be the primary issue. The absolute wobble values are still below threshold even at poles.

---

## Diagnostic vs User Experience Gap

**Why Puppeteer tests show sphere PASSING but user reports sphere as jerky:**

1. **Sampling rate:** Puppeteer samples every 200ms (~5 FPS equivalent). User sees 60 FPS. Small oscillations that average out over 200ms are visible frame-to-frame at 60 FPS.

2. **Visual magnification:** User is watching the screen, where small position wobbles translate to screen pixels. A 0.047 wobble ratio may be 2-3 pixels of unwanted vertical motion during lateral movement, which is visually jarring even if "below threshold" mathematically.

3. **Camera lag:** The camera lerps toward the player position. At 60 FPS, the camera lag combined with player position jitter creates visible "map wobble" that Puppeteer position sampling doesn't capture.

4. **Accumulation:** Small per-frame wobbles accumulate over seconds into visible "chevron spinning" and "map jumping" that Puppeteer's 200ms samples miss.

**Conclusion:** The test thresholds may be too lenient. A wobble ratio of 0.047 may be "passing" mathematically but still visually noticeable at 60 FPS.

---

## Immediate Action Items (Priority Order)

### CRITICAL (Blocks 3 surfaces):
1. **Fix torus/capsule/icosahedron stuck bug** — these surfaces have zero movement
   - Check walker initialization on these geometries
   - Check if normals/closest-point computation fails
   - Add error logging to surface factory

### HIGH (Blocks cube):
2. **Fix cube direction reversals** — 67% of forward intervals go wrong direction
   - Investigate tangent frame behavior at cube edges/corners
   - Add hysteresis or smoothing to prevent 90° flips
   - May need per-surface handling for discontinuous normals (violates "treat all surfaces the same" but may be necessary)

### MEDIUM (Blocks pill diagonal):
3. **Fix pill diagonal zigzag** — 64% of intervals have >45° angle changes
   - Investigate why W+D triggers oscillation but W and D separately work fine
   - Check if dual Gram-Schmidt projection degenerates on certain input combinations

### LOW (Polish):
4. **Reduce pipe wobble** — currently at threshold (0.136/0.150)
5. **Investigate pole sensitivity** — 1.5-2.5x wobble increase near poles
6. **Tighten test thresholds** — current wobble threshold (0.15) may be too lenient for 60 FPS visual perception

---

## Files Generated

- **Test script:** `tests/visual/s15-cross-surface-diagnostic.mjs` (659 lines)
- **Screenshots:** `tests/visual/screenshots/s15-cross-{surface}.png` (8 surfaces)
- **Previous findings:** `decisions/s15-cross-surface-diagnostic-findings.md` (first run with errors)
- **This document:** `decisions/s15-cross-surface-FINAL-findings.md` (complete results)

---

## Next Steps for Iteration 8

1. **READ THIS DOCUMENT FIRST** before attempting any fixes
2. **Focus on torus/capsule/icosahedron** — 3 surfaces completely broken is top priority
3. **Test hypothesis:** Run game with console open, load torus, check for errors
4. **Quick win check:** If torus/capsule/icosahedron issue is a simple initialization bug (missing call, wrong parameter), fix it first to unblock 3 surfaces
5. **Cube requires deeper work** — edge discontinuities may need special handling or a different tangent frame approach
6. **User testing after each fix** — don't fix all 3 groups at once, test incrementally

---

## Test Parameters Used

```javascript
THRESHOLDS = {
  wobble_ratio: 0.15,      // Max perpendicular motion (15% of primary direction)
  consistency_cv: 0.5,     // Max coefficient of variation for velocity
  zigzag_angle: 45,        // Degrees
  zigzag_freq: 0.3,        // Max 30% of intervals with large angle changes
  min_displacement: 2.0,   // Units in 3 seconds
}
```

Sample rate: 200ms (15 samples over 3 seconds per test)
Key press duration: 3 seconds per single-axis test, 3 seconds for diagonal test

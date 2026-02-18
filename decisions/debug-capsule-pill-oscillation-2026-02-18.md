# Capsule/Pill Oscillation Root Cause — 2026-02-18

## Iteration 1 (commit pending) — Entry Nudge Excess Displacement

**What was tried:** Changed `eps` in `FaceWalker._computeEntryBary` from 0.1 to 0.005.

**Root cause:**
The `eps=0.1` entry nudge in `FaceWalker._computeEntryBary` adds a discontinuous world
displacement at every edge crossing. For each edge crossing into a new face, the player is
placed at `eps/(1+eps) ≈ 0.0909 * triangle_height` away from the crossed edge (toward the
opposite vertex). This is NOT accounted for in `distanceTraveled`.

At the cap-cylinder junction on pill/capsule surfaces, this nudge becomes significant because:
1. The cylinder triangles are larger than cap triangles (height ~1 world unit vs tiny near pole)
2. Each cap→cylinder crossing nudges ~0.09 world units in the +y direction
3. Each cylinder→cap crossing nudges ~0.09 world units in the -y direction
4. When the player oscillates near the junction, these alternating nudges cause the
   oscillation metric (consecutive displacement dot products < 0) to exceed the 0.25 threshold

**Evidence:**
- Step-by-step trace with eps=0.1: steps had displacement 0.0918–0.1121 (expected 0.0833)
- Step-by-step trace with eps=0.005: steps had displacement 0.0832–0.0849 ✓
- Puppeteer audit before fix: capsule=0.327 (FAIL), pill=0.500 (FAIL)
- Puppeteer audit after fix: capsule=0.000 (PASS), pill=0.000 (PASS)

**Why the nudge existed:**
To prevent immediate re-crossing of the same edge. After entering face B through edge AB,
if the walker's direction has a component toward AB, `rayExitTriangle` would return t≈0,
causing an infinite crossing loop. The nudge ensures the walker starts "inside" the face.

**Why eps=0.1 was safe before:**
The old vertex detection epsilon was 0.05. The comment said "must be larger than vertex eps".
The vertex detection epsilon was later tightened to 0.001, but the entry nudge was not updated.

**Why eps=0.005 works:**
- 5x the vertex detection epsilon (0.001) → no vertex detection issues
- Extra displacement per crossing ≈ 0.005/1.005 × triangle_height ≈ 0.005 world units
- Over 9 steps/sample with one junction crossing each: ~0.045 extra total (negligible)
- Prevents immediate re-crossing: entry w=0.005 >> 0 threshold

**Surfaces tested:**
All 13/13 surfaces pass with 0.000 oscillation ratio (was 11/13, with capsule=0.327, pill=0.500).

**Dead ends ruled out:**
- Wrong twin edge links: verified 0 bad twin links at cap-cylinder junction
- Boundary edges: confirmed 0 boundary edges at junction
- BVH fallback: verified not triggered (0 bvhFallbacks during anomalous steps)
- WorldDistPerT calculation: proven to always equal |dir| = 1.0 for normalized input
- Vertex detection epsilon: not the issue (vertex detection not firing at junction)
- Seam tolerance wrongly linking far edges: verified midpoint distances are 0.0000

**Files changed:**
- `src/surfaces/geodesic/FaceWalker.ts`: `eps = 0.1` → `eps = 0.005` in `_computeEntryBary`
- `src/test/capsule-pill-regression.test.ts`: new regression test (game-like conditions)

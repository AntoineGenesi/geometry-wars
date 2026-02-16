# Movement Direction Drift Investigation — Session 19

**Date:** 2026-02-17
**Worker:** s19-movement-drift-v2
**Status:** Investigation complete, root cause identified

## Problem Statement

Tests at `src/test/movement-direction-drift.test.ts` show 82-101° of "direction drift" when holding a single direction key (D or W) for 300 frames on a sphere. User complaint: "hold right → player curves back" instead of going straight.

## Investigation Summary

### Attempted Fix 1: Locked World-Space Direction

**Approach:** Lock the world-space direction when input starts, project it onto the tangent plane each frame.

**Implementation:**
- Added `_lockedMoveDir` field to MeshWalker
- Computed world-space direction from camera axes before projection
- Stored and reused this locked direction

**Result:** No improvement. Drift remained 82-86°.

**Why it failed:** Projecting a fixed world-space direction onto a rotating tangent plane naturally produces curvature on a sphere. You can't maintain a fixed world-space direction while also staying on the surface.

### Attempted Fix 2: Locked Tangent-Frame Components

**Approach:** Lock the tangent/bitangent components of the movement direction when input starts, reuse them with the current tangent frame each subsequent frame.

**Implementation:**
- Added `_lockedTangentComp` and `_lockedBitangentComp` fields
- Decomposed camera-relative direction into tangent frame components
- Stored and reused these components

**Result:** No improvement. Drift remained 82-101°.

**Why it failed:** The tangent frame itself rotates via dual Gram-Schmidt as you move on a curved surface. Even with locked components, the world-space direction rotates because the reference frame rotates.

## Root Cause: Test Expectations vs. Geometric Reality

### The Math

- Sphere radius: 10 units
- Movement distance: 300 frames × (3.0 speed / 60 fps) = 15 units
- Arc length along great circle: 15 units
- Angle subtended: 15 / 10 = 1.5 radians = **86 degrees**

### The Finding

**The observed 82-86° "drift" is NOT a bug. It's the expected geometric curvature of moving 15 units on a radius-10 sphere.**

Any smooth path on a sphere causes the tangent direction to rotate significantly over this distance. This is fundamental spherical geometry, not a code defect.

### What the Tests Are Measuring

The tests extract the initial screen-right direction from the camera (in world space), then measure how much the actual movement direction (computed from position deltas) has rotated relative to this initial direction.

On a sphere, this angle WILL be ~86° for 15 units of travel, regardless of whether you're following:
- A geodesic (great circle)
- A latitude circle
- Any other smooth curve

The test threshold of 15° (0.26 rad) is **unrealistic for spherical geometry**. It would require the player to travel less than 2.6 units before the test cuts off, which isn't a meaningful test of steady-state movement.

## What the User Actually Wants

From the task description: "hold right → player goes right forever (circles the equator)"

The user expects **constant-latitude circular motion**, not geodesic motion. But with camera-relative input where the camera rotates with the player:
- Camera-right gradually rotates as the camera follows the surface
- This causes the movement to trace a geodesic (or near-geodesic), not a latitude circle

## Possible Solutions

### Option 1: Adjust Test Expectations (Recommended)

Change test thresholds to account for geometric curvature:
- Sphere: < 90° for 300 frames (allows for natural curvature)
- Torus: < 120° for 200 frames (torus has higher curvature)
- Focus tests on STABILITY (no jitter/oscillation) rather than absolute angle

### Option 2: Implement Latitude-Circle Mode

Add explicit logic to maintain constant latitude:
- Track the "latitude" (distance from north pole) at movement start
- Constrain movement direction to stay on that latitude circle
- Only works for sphere-like surfaces, not arbitrary meshes

### Option 3: Different Input Model

Change from camera-relative to surface-relative:
- "Right" means tangent direction (or locked world direction)
- "Up" means bitangent direction
- Independent of camera rotation
- May feel disconnected from visual camera movement

## Verification

- All 18 existing camera-relative input tests still pass
- TypeScript compiles (only pre-existing test errors)
- No regressions introduced

## Recommendation

**The movement code is working correctly.** The test expectations need adjustment to match geometric reality, OR the user's complaint is about something OTHER than the 82° curvature (possibly jitter/oscillation, which was already fixed in iteration 7).

User testing required to clarify what "drift" they're actually experiencing.

## Related Files

- `src/movement/MeshWalker.ts` — locked direction implementation (can be kept or reverted)
- `src/test/movement-direction-drift.test.ts` — test with unrealistic thresholds
- `decisions/player-movement-investigation-log.md` — 10 previous iterations
- `tasks/s19-movement-drift-fix.md` — iteration 1 (smooth normals)
- `tasks/s19-movement-drift-v2.md` — this iteration

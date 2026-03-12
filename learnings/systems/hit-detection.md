# Hit Detection System

## Purpose
Determines when bullets or enemies collide with the player, and when bullets hit enemies. All collision is computed on the curved surface geometry (not in flat 3D Euclidean space) because entities live on surfaces and distances are measured as surface distances, not straight-line distances.

## Architecture

### SP Hit Detection
- **CollisionSystem.ts** — main SP collision logic
- Player radius (`playerRadius`) defines the hit zone around the player mesh position
- Enemy hit zone is computed from enemy world position vs bullet world position
- Distance metric: great-circle (geodesic) angular distance for spherical/peanut/pill; chord distance for sphere-with-tunnel; OR-fallback for Mobius

### MP Hit Detection
- Server-authoritative in `server/rooms/GameRoom.ts`
- Collision computed server-side using UV positions
- Client shows hit effects on server confirmation
- Root problem: server computes UV positions using sphere-approximation for ALL surfaces

### Distance Metrics by Surface
| Surface | Metric Used | Notes |
|---------|-------------|-------|
| Sphere | Great-circle angular distance | Baseline, accurate |
| Peanut | Great-circle angular distance | Accurate — approximately spherical |
| Pill/Capsule | Great-circle angular distance | Accurate — approximately spherical |
| Torus | Chord distance (Euclidean) | Approximate; inner ring has high distortion |
| Cube | Per-face Euclidean | Each face is flat |
| Cube-ring | Per-face Euclidean | Same as cube |
| Mobius | OR-fallback (sphere OR world) | Seam creates UV discontinuity |
| Sphere-with-tunnel | Chord distance | Fixes inside-tunnel hit detection |

## Critical Bugs and Root Causes

### Bug 1: playerRadius Too Large (SP)
**Root cause:** `playerRadius` was set too generously, causing the player to die to nearby enemies that weren't visually touching them. The hit zone was larger than the player sprite.

**Fix (s44r12-01, commit `377a89de`):** Reduced `playerRadius` in `CollisionSystem.ts` to match visual player size.

**Regression guard:** `playerRadius` should not be increased without gameplay reason — it creates "phantom kills."

### Bug 2: Mobius OR-Fallback Applied to All Surfaces
**Root cause:** The Mobius OR-fallback (checking EITHER great-circle OR world distance) was a special case for the Mobius topology, where the seam creates UV discontinuity that makes great-circle alone unreliable. This fallback was accidentally applied to ALL surfaces, making hit detection inconsistent everywhere.

**Fix (s44r12-01, commit `377a89de`):** Gate the OR-fallback exclusively to Mobius surface type. All other surfaces use standard metric.

**Regression guard:** `// REGRESSION GUARD:` comment in `CollisionSystem.ts` marks this gate. NEVER remove the surface type check.

### Bug 3: Sphere-with-Tunnel — Great-Circle Gives Wrong Distance
**Root cause:** The sphere-with-tunnel geometry has a tunnel through the center. Entities inside the tunnel are NOT on the sphere surface — they're in 3D space inside. Great-circle distance computes the angular distance around the sphere, which is meaningless for entities inside the tunnel.

**Fix (s44r7-04, commit `ccc3c231`):** Use chord distance (3D Euclidean distance) for sphere-tunnel, which correctly measures distance regardless of tunnel vs sphere position.

### Bug 4: MP Hit Detection via Sphere-Approx UV
**Root cause:** The MP server receives sphere-approximation UVs (`sphereUV`) for all surfaces. The server computes collision using `surface.getPoint(sphereUV)` to get world position, but on non-spherical surfaces (torus, peanut, cube), this maps to the WRONG world position. A player visually standing on the torus outer ring may have a sphereUV that maps to a point inside the torus — hit detection is then computed against that wrong position.

**Fix direction (not fully implemented as of March 2026):** Use `surface.worldToSurface(mesh.position)` to convert actual mesh world position to surface UV, then use that UV for collision. This is the same root cause as bullet origin offset and pickup collection bugs.

**Status:** STILL OPEN for MP. SP hit detection is FIXED.

### Bug 5: Pill Hit Detection Ultra-Sensitive
**Observed (2026-03-09):** Dying immediately on pill map without being near enemies. Suspected cause: pill geometry has a narrow waist, and at the waist the surface curves sharply. If `playerRadius` is still too large relative to the curvature, hits register from enemies not visually close.

**Fix:** Addressed as part of s44r12-01 `playerRadius` reduction. If still occurring, check pill surface curvature vs playerRadius in CollisionSystem.

### Bug 5: 5-Second Hit Detection Delay (MP)
**Observed (2026-03-08):** In MP, taking damage was delayed by ~5 seconds from the visual hit. Caused by server message queue backup or a debounce/throttle applied to damage events. Fixed during s44r8-s44r9 sessions.

## What Worked
- Chord distance for sphere-with-tunnel (ignores UV, uses world position)
- Gating Mobius OR-fallback to Mobius only
- Reducing `playerRadius` to match visual sprite
- `surface.worldToSurface(mesh.position)` for SP position-based collision (MP still needs this)

## What DIDN'T Work
- Single global `playerRadius` for all surfaces — surfaces have different effective curvature
- Great-circle distance for tunnel geometry (entities aren't ON the sphere)
- Applying Mobius OR-fallback to all surfaces (makes hit detection globally inconsistent)
- UV-based world position for MP collision (sphere-approx causes wrong positions on non-spherical maps)

## Regression Guards
- **Mobius OR-fallback MUST be gated by surface type** — `CollisionSystem.ts` REGRESSION GUARD comment
- **Sphere-tunnel MUST use chord distance** — `CollisionSystem.ts` REGRESSION GUARD comment
- **`playerRadius` changes require visual verification** — run scenario harness `hit_detection` on all 13 surfaces
- **MP hit detection still uses UV-based position** — do not claim "MP hit detection fixed" without tracing server code

## Verification
Run scenario harness: `node tests/visual/scenario-harness.mjs --scenario=hit_detection --all-surfaces`
Known issue: hit_detection scenario has false positives on 7/13 surfaces due to enemies being killed by player bullets before reaching player. Harness needs fix before it's fully reliable for regression testing.

## Key Files
- `src/core/CollisionSystem.ts` — SP collision logic, playerRadius, surface-specific metrics
- `server/rooms/GameRoom.ts` — MP server-side hit detection (sphere-approx UV, not yet fixed)
- `tests/visual/scenario-harness.mjs` — automated scenario verification

## Historical Timeline
- Feb 2026: Hit detection too large on all maps (radius too big)
- Feb 24: Peanut hit detection wrong (different surface, same UV issue in MP)
- Mar 1: SP hit detection marginally better (partial fix)
- Mar 7: Hit detection kills from invisible enemies (MP, wrong position)
- Mar 8: 5-second damage delay in MP; torus hit detection random deaths
- Mar 9: Pill hit detection ultra-sensitive; cube hit detection too sensitive
- Mar 10: Cube hit detection still too sensitive after claimed fix
- Mar 11: Torus hit detection broken, random deaths
- s44r7-04 (commit `ccc3c231`): Sphere-tunnel chord distance fix
- s44r8-02 (commit `b1be1b3d`): MP hit detection — exact player world pos for some surfaces
- s44r12-01 (commit `377a89de`): Reduced playerRadius + gate Mobius OR-fallback

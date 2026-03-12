# Camera Orientation System

## Purpose
The camera follows the player from above, oriented so that the player's surface normal is "up" for the camera. On curved surfaces this means the camera must continuously re-orient as the player moves around the surface. Incorrect camera orientation manifests as 180° flips, leaning/tilting, inside-surface views, or controls feeling inverted.

## Architecture

### Camera Setup
- Camera is a `THREE.PerspectiveCamera` positioned above the player in world space
- Camera "up" vector is set to player's surface normal
- Camera looks at player position
- Camera uses a lerp (smooth follow) — `camera.position.lerp(target, lerpFactor)` each frame

### Tangent Frame
The player's orientation on the surface is defined by the tangent frame: `{normal, tangent, bitangent}`. This frame defines:
- What "up" means (normal points away from surface)
- What "forward" means (tangent aligns with movement direction)
- The camera derives its orientation from this frame

### Camera Lerp
`lerpFactor` controls how quickly the camera follows the player. Too high = jarring snapping. Too low = camera lags far behind player movement, especially on tight surfaces.

## Critical Bugs and Root Causes

### Bug 1: 180° Camera Flip After Respawn (Mobile-Only Fix Applied Globally)
**Root cause (s44r8, s44r10 area):** A fix for mobile camera orientation (camera was inverted on mobile/iOS) was applied to the shared camera code. On mobile, the normal needed to be negated (`-normal`) to correct orientation. On desktop, the normal should not be negated. When applied globally, desktop cameras flipped 180° on respawn or surface side transitions.

**Fix (commit area s44r8-s44r10):** Gate platform-specific fixes by platform detection (`isMobile()`). The bitangent flip needed for mobile must NOT be applied on desktop.

**Regression guard (failure mode #21):** Platform-specific fixes MUST be gated by platform detection. Never apply unconditionally.

**Subsequent regression (2026-03-08):** The fix was re-broken by another surface commit. User reported: "camera 180° flip after respawn on opposite surface." Root cause was the bitangent fix (meant for mobile) breaking desktop camera. Fixing one surface introduced the flip on another.

### Bug 2: Camera Tilting/Leaning on Sphere
**Observed (2026-03-07):** "Sphere camera leaning/tilting, I felt like I was on an angle." Camera was not perfectly vertical relative to the player's surface. Caused by stale camera "up" vector not being updated correctly after the player moved to a new surface position. The lerp interpolated both position and orientation but the up vector lagged behind, creating a temporary tilt.

**Fix:** Update `camera.up` on every frame before computing camera position, not after.

### Bug 3: Camera Glitch on Mobius Seam
**Root cause:** When crossing the Mobius seam, the player's surface normal flips (the Mobius strip is non-orientable). If the camera's "up" vector is derived from the surface normal, crossing the seam causes a sudden 180° flip in the camera's up direction — the view snaps upside-down then back.

**Fix:** Smooth the normal transition at the seam using a quaternion slerp over multiple frames rather than instantly adopting the new normal. Or: detect seam crossing and apply the half-twist to the camera up vector proactively.

**Status:** Fixed for player movement (s44r12 Mobius seam fix). Camera behavior at seam not separately documented as fixed — may still have residual issues.

### Bug 4: Camera Leaning After Surface Edge Crossing
**Root cause (early sessions):** Player movement on cube faces produced camera oscillation at triangle boundaries. Each triangle had a different normal due to mesh interpolation. As the player crossed triangle boundaries, the camera's up vector jittered between slightly different normals, causing visible tilt flickering.

**Fix:** Player movement switched to mesh walker approach that smooths normal computation across triangle boundaries. Camera up vector derived from mesh walker's smooth normal.

### Bug 5: Camera Inside Surface
**Observed (Feb 2026):** Camera ended up inside the sphere surface after spawn. Caused by camera position lerp starting from origin (0,0,0) and lerping toward the player position — the lerp path passed through the surface geometry.

**Fix:** Initialize camera position to the target position on first frame (skip lerp for the initial frame after spawn or respawn).

### Bug 6: Camera Lerp Too Noticeable in MP
**Observed (2026-03-02):** In MP, camera lerp was visible and distracting — camera lagged noticeably behind player. MP camera lerp factor was different (lower) than SP, or the lerp was being applied on the client even when the server-authoritative player position jumped discretely.

**Fix direction:** Match MP camera lerp factor to SP. Consider disabling lerp for server-position corrections and only lerp for local prediction movement.

## What Worked
- Updating `camera.up` every frame before computing camera target position
- Quaternion slerp for normal transitions at surface seams
- Mesh walker smooth normals for camera up vector (eliminates triangle-boundary jitter)
- Platform-gating mobile-specific normal flip (prevents desktop regression)
- Skip initial lerp on spawn/respawn (prevents camera-inside-surface)

## What DIDN'T Work
- Applying mobile camera fix globally (180° flip on desktop)
- Deriving camera up directly from triangle normal (oscillates at boundaries)
- Lerp starting from camera position origin (passes through geometry)
- Single lerp factor for both SP and MP (MP needs different value or separate handling)

## Regression Guards
- Platform-specific camera fixes MUST be gated by platform detection — see `isMobile()` in camera code
- After ANY surface geometry change, verify camera orientation on: spawn, respawn, teleporter use, surface edge crossing, Mobius seam
- Camera lerp skip must remain on first frame after spawn/respawn — removing it breaks initial view
- Adjacent system audit: camera bugs appear after EVERY surface/collision/normal fix — always check camera as part of verification

## Key Files
- `src/core/GameLoop.ts` — SP camera update loop, camera.up assignment
- `src/network-main.ts` — MP camera update (separate path from SP)
- `src/core/MeshWalker.ts` — mesh walker providing smooth surface normals for camera
- `src/utils/PlatformDetect.ts` (or similar) — `isMobile()` for platform gating

## Historical Timeline
- Feb 16, 2026: Camera lag, camera inverted shooting direction reported
- Feb 19: Mobius camera glitch at seam — camera sends you back
- Feb 21: Camera inside surface issue on spawn
- Mar 1: Player controls inverted when spawning (related to camera tangent frame)
- Mar 7: Sphere camera leaning/tilting; torus player spawning inside torus geometry
- Mar 8: Torus player spawning INSIDE torus; camera 180° flip after respawn (bitangent fix regression)
- Mar 10: MP camera lerp too noticeable
- s44r6–s44r10: Multiple camera fix/regression cycles from surface normal changes

## 2026-02-13 - Camera-Relative Input for Player Movement and Aiming

**Context:** Player movement is broken: WASD directions don't match screen axes when the camera orbits (middle mouse), and even at zero orbit, tangent frame discontinuities cause janky movement on curved surfaces.

**Previous approach (tangent-frame-direct):**
- `moveFromInput()` mapped inputX→tangent, inputY→bitangent
- Only correct when camera.right=tangent, camera.up=bitangent (zero orbit)
- With any orbit, WASD directions diverged from visual screen axes
- Tangent frame discontinuities (on torus edges, etc.) caused sudden input direction changes
- Previous regression guard warned against camera-relative input due to "feedback loop"

**Why the feedback loop concern was wrong:**
The old concern (decisions/playground-spinning-fix.md) was valid for the OLD camera system where camera orientation was derived from movement. With CameraController:
- Camera orbit (yaw/pitch) is user-controlled (middle mouse), NOT coupled to movement
- Camera position follows player (translation only — not rotation feedback)
- Camera.up follows bitangent via lerp (same in both approaches)
- There is NO feedback loop between movement direction and camera orientation

**New approach (camera-relative):**
- `moveFromInput()` extracts camera.right and camera.up from `camera.quaternion`
- Projects both onto surface tangent plane (removes normal component)
- Maps inputX→projected-camera-right, inputY→projected-camera-up
- Falls back to tangent-frame-direct when camera orientation is degenerate (tests with default cameras)
- Same approach for `getAimDirection()`

**Options Considered:**
1. Keep tangent-frame-direct, fix discontinuities separately — Rejected: doesn't solve orbit mismatch
2. Camera-relative with degenerate fallback — Chosen: correct, robust, proven in multiplayer-main.ts
3. Hybrid (tangent-frame for movement, camera for aim) — Rejected: inconsistent UX

**Decision:** Option 2 — camera-relative axes for both movement and aiming

**Evidence:** multiplayer-main.ts already uses camera-relative aiming (lines 917-944) and it works correctly. The approach is proven. Extending it to movement is the logical completion.

**Reversibility:** Easy — revert MeshWalker.ts moveFromInput/getAimDirection to ignore camera parameter.

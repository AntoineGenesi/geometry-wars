# Decision: Replace Tangent Frame Swap Logic with Dual Gram-Schmidt

**Date:** 2026-02-14
**Context:** Player movement iteration 7 — fixing lateral jerk and diagonal freeze
**Task:** tasks/s15-player-movement-epic.md

## Problem

After 6 iterations of fixing player movement, two symptoms remained:
1. **Lateral jerk** — periodic stutter when pressing A/D (~4x/second)
2. **Diagonal freeze** — pressing W+D caused player to vibrate in place with zero net displacement

## Root Cause Analysis

The tangent frame's `_updateTangentFrame()` had swap logic (lines 323-351) that compared `keepScore` vs `swapScore` to decide whether to swap tangent↔bitangent axis assignments. This oscillated at ~45° movement angles:

1. At ~48° movement angle, `swapScore > keepScore + 0.1` → swap triggers
2. After swap, the new axis assignments are ~45° rotated from the transported tangent
3. **Next frame**: `keepScore ≈ 0, swapScore ≈ 2` → immediate swap-back
4. This creates a **bistable oscillation** that toggles every frame

The oscillation propagated through:
- `_bitangent` → `CameraController.targetUp` → `upHint` → `camRight` (in moveFromInput)
- Result: movement direction alternated between +right and -right each frame
- For lateral movement: periodic jerk as angle crosses the threshold
- For diagonal: lateral component oscillation ± right cancels out, netting zero displacement

The hysteresis threshold of 0.1 was insufficient because the post-swap score difference was ~2.0, far exceeding any reasonable hysteresis.

## Options Considered

1. **Increase hysteresis to 0.5+** — Still oscillates after swap (post-swap scores are ~2.0 apart). Would need hysteresis > 1.0, which prevents ALL swaps (effectively option 3).

2. **Add swap cooldown (30 frames)** — Hack. Prevents oscillation but allows a one-time 40° axis jump that creates a visible jerk.

3. **Remove swap entirely, use dual Gram-Schmidt** — Both tangent and bitangent are independently projected onto the new tangent plane. Frame evolves with surface geometry, not movement direction. No swap = no oscillation.

4. **Smooth targetUp with exponential decay** — Absorbs axis jumps but adds lag. Was the approach that failed in iteration 5 (camera.up lerp lag caused different problems).

## Decision: Option 3 — Dual Gram-Schmidt

**Reasoning:**
- **Root cause elimination**, not symptom management. No swap = no oscillation, period.
- **Simpler code** — removed 30 lines of swap logic, replaced with 15 lines of dual Gram-Schmidt.
- **Geometry-driven, not movement-driven** — the tangent frame tracks surface orientation, not player input direction. This means changing movement direction (D→W) doesn't rotate the camera-relative axes.
- **Equivalent to parallel transport** for small steps — Gram-Schmidt projection of old tangent onto new tangent plane is a first-order approximation of parallel transport. The per-frame error is O(displacement × curvature) ≈ 0.01 on typical surfaces.
- **Compatible with all surfaces** — works on smooth (sphere, torus) and sharp (cube edges via BVH fallback path).

**What was removed:**
- Swap logic in `_updateTangentFrame` (geodesic path)
- Orientation slerp (0.35 factor) in GameLoop.ts and PlaygroundGame.ts — was a bandaid for the oscillation. Direct quaternion set is responsive with stable aim direction.

**What was added:**
- Dual Gram-Schmidt: project BOTH old tangent and old bitangent onto new tangent plane
- Re-orthogonalization step after dual projection
- Sign-flip protection on `CameraController.targetUp` (safety net for surface discontinuities)
- 4 regression tests: lateral smoothness, diagonal displacement, direction consistency, torus diagonal

## Reversibility

**Easy.** Revert the `_updateTangentFrame` changes to restore swap logic. The old code is preserved in git history (commit before this one).

## Test Results

- 18/18 camera-relative input tests pass (14 existing + 4 new)
- 27/27 surface trouble zone tests pass
- 17/17 movement integration tests pass
- TypeScript compiles clean (only pre-existing test file errors)
- Verification level: Level 2 (unit tests pass)
- **User testing required for Level 6 confirmation**

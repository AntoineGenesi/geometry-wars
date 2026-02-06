## 2026-02-06 - Torus Camera/Movement Flipping Fix

**Context:** Torus surface was completely unplayable - camera flipped, player could only move in one direction, mirrored images flashing.

**Root Cause:** `MeshSurface.getTangentFrame()` used Gram-Schmidt with a fixed reference vector `(0,1,0)` or `(1,0,0)`, switching when `|normal.y| >= 0.99`. On a torus, the surface normal rotates through ALL orientations as you move around, causing the tangent frame to SNAP at the switchover boundary. This caused:
- Camera up vector to suddenly flip (mirrored images)
- Movement input mapping to invert (one-direction-only)

**Options Considered:**
1. Use quaternion-based interpolation for tangent frame — Pros: mathematically elegant / Cons: complex, overkill
2. Persistent tangent frame in MeshWalker that updates incrementally — Pros: simple, effective / Cons: adds state to walker
3. Higher-order reference vector selection — Pros: no state / Cons: still has singularities, just moved

**Decision:** Option 2 - Persistent tangent frame in MeshWalker

**Changes:**
- `MeshWalker.ts`: Added `_tangent` and `_bitangent` fields initialized from surface on construction
- `MeshWalker.ts`: Added `_updateTangentFrame()` that projects old tangent onto new normal plane (Gram-Schmidt against new normal) with fallback for extreme cases
- `MeshWalker.ts`: `getTangentFrame()` now returns persistent frame instead of recomputing
- `MeshWalker.ts`: `move()` calls `_updateTangentFrame()` before updating normal
- `main.ts` + `multiplayer-main.ts`: Camera position and up vector now use `lerp()` for smooth transitions

**Reasoning:** The persistent tangent frame naturally tracks the surface orientation as the player moves, avoiding any discontinuity. The lerp on camera provides additional smoothing. This is the simplest fix that completely eliminates the problem.

**Reversibility:** Easy - revert to `surface.getTangentFrame(this.normal)` in `getTangentFrame()` and remove the `_tangent`/`_bitangent` fields.

**Note on middle mouse orbit:** The user requested camera orbit with middle mouse. GW3D doesn't have this (camera follows surface normal), so this wasn't implemented. If needed, an orbit offset could be added on top of the surface-following camera.

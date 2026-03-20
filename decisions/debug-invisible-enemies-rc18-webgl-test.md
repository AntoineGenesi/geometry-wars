# RC18 — Critical Next Step: Test WebGL2 Fallback

## Date: 2026-03-21

## The Key Test
The user should try: `http://localhost:3032/?quickStart=true&surface=torus&renderer=webgl`

If enemies are VISIBLE on WebGL2 but INVISIBLE on WebGPU → the bug is in the WebGPU renderer, not in our code. Three.js WebGPURenderer may handle InstancedMesh + DoubleSide + depthTest:false differently.

If enemies are INVISIBLE on BOTH → the bug is in our code and we missed something.

## Why This Matters
- User's friend's laptop + phone can see enemies (same code, different GPU/browser)
- All code changes since v17.0 should make enemies MORE visible (raised MIN_ICB, raised SURFACE_DIM_OPACITY)
- ?noDim=true (forces visibility=1.0) doesn't help
- Phase 1 culling doesn't zero-scale (no RC18 warnings in console)
- Debug Chrome instance can't even finish WebGPU init (90s+ stuck at countdown)

## Already in the game
`?renderer=webgl` is already supported. No code changes needed. Just add it to the URL.

## If WebGL2 works
Then the fix is to either:
1. Fix the WebGPU-specific rendering issue in Three.js WebGPURenderer
2. Default to WebGL2 until the WebGPU InstancedMesh bug is resolved
3. Add a "Switch to WebGL2" button in settings (already exists in SettingsMenu.ts)

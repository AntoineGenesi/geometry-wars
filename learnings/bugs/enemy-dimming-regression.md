# Enemy Dimming Regression (SP + MP)

## Timeline
- **First working:** ~2026-02-19 — dimming was functional in early SP sessions
- **First regression complaint:** 2026-03-11 — "The enemies are showing everywhere even if they're meant to be dimmed. In the single-player on the pill map... the f___ enemies aren't dimmed when they're on the opposite side of the surface." (source: inbox/2026-03-11_0645.md)
- **Continued broken:** 2026-03-12 — "all enemies displaying at full brightness even though they're behind surfaces... on EVERY map" (source: inbox/2026-03-12_0734.md)
- **Fix attempt 1:** commit `86b45c54` — "restore premultiplied alpha in enemy shader (s44r9-01)" — temporary fix but missed root cause
- **Still broken after s44r9:** 2026-03-12 — "it's definitely slow, like the game feels sluggish" AND "enemies aren't dimmed" confirmed again
- **Root cause discovered:** 2026-03-12, autonomous session — "MeshStandardMaterial + instanceColor = invisible dimming" — emissive dominates over diffuse, so instanceColor RGB modulation is invisible at high emissiveIntensity
- **Fix attempt 2:** commit `8e70283a` — "enemy dimming — add RGB-based instanceColor dimming for WebGPU compat (s44r10-01)"
- **Second regression (vis² double-dimming):** commit `53a75b3f` checkpoint — "dimming regression" — shader `onBeforeCompile` was multiplying RGB by instanceOpacity, but `setInstanceVisibility()` already premultiplied; net result: squared dimming, making near-player enemies too dim while far enemies unaffected
- **Fixed:** commit `faf3fbcc` — "fix vis² double-dimming in enemy shader (s44r12-03)"
- **Status (March 2026):** FIXED in SP

## Root Cause
Two distinct causes over the lifetime of this bug:

**Phase 1 (s44r8-s44r9):** MeshStandardMaterial with high `emissiveIntensity` ignores instanceColor because instanceColor only modulates the diffuse channel. With emissive dominating, dimming was invisible. Fix: switch to `MeshBasicMaterial` (unlit), which outputs `material.color × instanceColor` directly.

**Phase 2 (s44r11-s44r12):** The `onBeforeCompile` shader hook multiplied RGB by `instanceOpacity` AGAIN, when `setInstanceVisibility()` was already pre-multiplying. Result: `opacity^2` — near-player entities looked too dim, far entities escaped dimming.

## What Worked
- Switch to `MeshBasicMaterial` for enemies (unlit shader) — s44r10-01
- Remove `vis²` double-dimming in `onBeforeCompile` — s44r12-03
- Per-instance RGB color approach (`instanceColor`) when using correct material

## What DIDN'T Work (dead ends)
- Restoring premultiplied alpha (s44r9-01) — masked symptoms, not root cause
- Adjusting dimming floor values without addressing material type

## Regression Risk
- **CRITICAL:** If material type ever changes back to MeshStandardMaterial, dimming will silently stop working with no visible error
- If `onBeforeCompile` shader hook is modified, check for double-application of opacity
- See MEMORY.md: "MeshStandardMaterial + instanceColor = invisible dimming" — this is failure mode #27 in `.claude/rules/failure-modes-quick-ref.md`

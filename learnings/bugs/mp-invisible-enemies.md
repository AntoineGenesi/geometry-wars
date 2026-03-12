# MP Invisible Enemies

## Timeline
- **First reported:** 2026-02-21 — "enemies appear out of nowhere now. This is crazy, there's no spawning warning" (source: archive/inbox/2026-02-21_0100.md)
- **Still reported:** 2026-02-23 — "the entities and enemies, they're dimmed. Like, when I was on, like, the sphere surface... every entity was technically dimmed. None of them were undimmed, even if they got next to me." (source: archive/inbox/2026-02-23_0100.md)
- **Fix attempt 1:** 2026-03-11 — commit `223425c3` — "MP invisible enemies — shader opacity^2 bug + raise dimming floor (s44r8-04)" — PARTIAL
- **Still broken:** 2026-03-11 — "The enemies appear invisible on the pill map, and so they're probably invisible on the other maps as well" (source: inbox/2026-03-11_0908.md)
- **Root cause found:** 2026-03-12 — "sphere-approximation UVs for ALL surfaces → shader opacity^2 → dimming floor too low" (s44r12-08 investigation)
- **Fix attempt 2:** 2026-03-12 — commit `80e5d744` — "MP cube-tunnel invisible enemies + voting screen missing maps (s44r12-08)" — `tunnelDepth` calculation was wrong, causing all enemies to have near-zero opacity
- **Last mentioned:** 2026-03-12 — still present on cube-ring/cube-tunnel in s44r12 memory; cube-tunnel FIXED by s44r12-08

## Root Cause
Two layered causes:
1. **Shader opacity^2 bug (s44r8):** Enemy shader was squaring the opacity value in `onBeforeCompile`, producing near-zero visibility for all enemies at any meaningful dimming depth. Fix: remove the double-squaring.
2. **MP cube-tunnel depth calculation (s44r12):** `tunnelDepth` field was undefined/wrong for cube-tunnel surface, causing enemies to always register as "behind the surface" and receive maximum dimming.

The dimming system itself works (surface-normal dot product), but the depth value fed into it was corrupted.

## What Worked
- s44r8-04: Fixing the opacity^2 bug restored visibility on sphere/basic maps
- s44r12-08: Fixing tunnelDepth calculation restored visibility on cube-tunnel

## What DIDN'T Work (dead ends)
- Raising the dimming floor alone (s44r8-04 partial fix) — didn't address root cause
- General opacity adjustments without identifying the ^2 squaring error

## Regression Risk
- If `onBeforeCompile` shader is modified, the opacity chain may be re-squared
- If new surfaces are added, they need proper `tunnelDepth` / surface depth values
- Key fix: `fix: MP invisible enemies — shader opacity^2 bug + raise dimming floor (s44r8-04)` and `fix: MP cube-tunnel invisible enemies + voting screen missing maps (s44r12-08)`
- See also: `MEMORY.md` — "MeshStandardMaterial + instanceColor = invisible dimming" for the related SP dimming root cause

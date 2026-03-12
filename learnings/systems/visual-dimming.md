# Visual Dimming System

## Purpose
Enemies dim as they take damage and when they are on the opposite side of the surface from the player (depth-dimming). Both mechanisms use instanceColor on instanced mesh renderers to modulate each entity's visual brightness independently without draw call overhead.

## Architecture

### SP Dimming Pipeline
1. `EnemyRenderer.ts` — creates `THREE.InstancedMesh` with `instanceColor` attribute
2. Per enemy, each frame: compute `opacity` from health ratio + depth factor
3. Call `setInstanceVisibility(index, opacity)` which sets `instanceColor` RGB to `(opacity, opacity, opacity)`
4. Shader picks up `instanceColor` and modulates fragment color

### Depth Dimming
Enemies on the back of the surface (far from player) are dimmed based on angular distance from player. The player-enemy angle is used to produce a `depthFactor` in [0, 1] that gets multiplied into the instance opacity.

### MP Dimming Pipeline
MP uses `network-main.ts` inline rendering — no `EnemyRenderer.ts`. Each MP entity has its own mesh. Opacity is set via direct material color manipulation, mirroring the SP `instanceColor` approach.

## Critical Bugs and Root Causes

### Bug 1: MeshStandardMaterial + instanceColor = Invisible Dimming
**Root cause:** `THREE.InstancedMesh.instanceColor` only modulates the DIFFUSE channel, NOT the emissive channel. When `emissiveIntensity` is high (2.0+), the emissive term dominates the final fragment color. Setting `instanceColor = (0.1, 0.1, 0.1)` dims diffuse to 10% but emissive remains at 200%, so the enemy still looks bright.

**Fix (s44r11-01, commit `317dc49a`):** Switch enemy materials from `MeshStandardMaterial` to `MeshBasicMaterial` (unlit). With `MeshBasicMaterial`, the output formula is `material.color × instanceColor` — there is no emissive channel, so dimming is always visible.

**Rule:** Any new enemy renderer MUST use `MeshBasicMaterial` if it relies on `instanceColor` for visual effects. `MeshStandardMaterial` will silently break dimming whenever emissive is non-zero.

### Bug 2: vis² Double-Dimming (Opacity²)
**Root cause:** Two layers of dimming were applied multiplicatively:
1. `setInstanceVisibility(index, opacity)` premultiplied the `instanceColor` RGB by `opacity`
2. An `onBeforeCompile` shader hook in `EnemyRenderer.ts` ALSO multiplied the fragment RGB by `instanceOpacity`

Result: effective opacity = `opacity × opacity = opacity²`. At 50% health, opacity was `0.25` instead of `0.5` — enemies appeared nearly invisible at partial health.

**Fix (s44r12-03, commit `faf3fbcc`):** The `onBeforeCompile` shader hook was changed to only modify the alpha channel (transparency), NOT the RGB channels. RGB dimming is handled entirely by `instanceColor` via `setInstanceVisibility`.

**Detection:** If enemies appear too dark at partial health, or near-dead enemies are completely invisible, check for double application of dimming. Verify `onBeforeCompile` does NOT multiply RGB by any opacity variable.

### Bug 3: MP Invisible Enemies (Shader Opacity^2)
**Root cause:** The same opacity² bug manifested differently in MP. The MP rendering path in `network-main.ts` applied `instanceOpacity` both in the material's vertex shader (via `onBeforeCompile`) AND when setting `instanceColor`. Enemies at 100% health appeared dim; enemies at low health appeared invisible.

**Fix (s44r8-04, commit `e6c2c947`):** Raised the dimming floor and removed the double application in the MP shader path. Fixed per commit `e6c2c947`.

### Bug 4: Bullet Over-Dimming
**Root cause:** Bullet depth-dimming was applied with the wrong reference normal. `normalize(bulletPosition)` was used instead of `playerNormal` — this computed bullet depth relative to world center, not relative to the player on the surface. Bullets on the player's side of the surface were incorrectly dimmed.

**Fix (s44r8-01, commit `13d6c018`):** Use `player.normal` (the player's surface normal) instead of `normalize(bulletPosition)` to compute depth.

### Bug 5: Torus Entity Dimming Flickering (Small Torus)
**Observed (2026-03-08):** On small torus maps, entities flickered bright/dim rapidly. Not yet traced to root cause in detail. Suspected cause: torus curvature causes the depth angle computation to oscillate near the threshold when player is near the torus hole (inner ring). Entities transition rapidly between "front side" and "back side" as torus curvature changes the angular separation.

**Status:** STILL OPEN as of March 2026.

## What Worked
- `MeshBasicMaterial` (unlit) — `instanceColor` modulates 100% of output
- Single-pass dimming: only `setInstanceVisibility()` sets RGB, shader only sets alpha
- Floor clamping for dimming: `max(dimFactor, 0.1)` prevents complete invisibility (enemies always slightly visible from behind)

## What DIDN'T Work
- `MeshStandardMaterial` with `instanceColor` — emissive dominates when `emissiveIntensity > 0`
- Double-pass dimming (instanceColor + onBeforeCompile RGB multiply) — produces `opacity²` effect
- Using `normalize(position)` for depth instead of player normal

## Regression Guards
- Enemy materials MUST be `MeshBasicMaterial`; changing to `MeshStandardMaterial` silently breaks dimming
- `onBeforeCompile` hook in EnemyRenderer MUST NOT multiply RGB by any opacity factor
- SP and MP paths both need the same dimming approach — MP path is in `network-main.ts` inline, NOT in `EnemyRenderer.ts`
- Test surfaces: torus (inner ring flickering), cube-ring (was also broken), peanut (variable curvature)

## Key Files
- `src/rendering/EnemyRenderer.ts` — SP instanced rendering + `setInstanceVisibility`
- `src/network-main.ts` — MP inline enemy rendering + MP dimming path
- `src/core/GameLoop.ts` — SP depth-dimming update per frame (calls EnemyRenderer)

## Historical Timeline
- Feb 2026: First reports of wrong dimming on MP torus
- Feb 23–24, 2026: Consistent reports of entities not dimming in MP
- Mar 8, 2026: Torus dimming flickering on small maps (SP)
- Mar 11, 2026: Enemy dimming COMPLETELY BROKEN on SP + MP — bullets dimming instead
- Mar 12, 2026: All enemies lit/bright (dimming not working anywhere)
- s44r8-04 (commit `e6c2c947`): MP shader opacity² fix
- s44r10-01 (commit `8e70283a`): Enemy RGB instanceColor dimming for WebGPU compat
- s44r11-01 (commit `317dc49a`): Root cause found — MeshStandardMaterial emissive + vis² bug
- s44r12-03 (commit `faf3fbcc`): vis² double-dimming removed — shader only does alpha

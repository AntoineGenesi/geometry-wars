# Learnings Index

Curated knowledge from completed tasks. Workers should check this before starting investigation.

## How to Use
- Search: `grep -rl '<keyword>' learnings/`
- Browse: read this index for topic summaries
- Updated by: Learnings Curator (post-merge, COMPLEX+ tasks)

## Bugs

| Topic | File | Status | Summary |
|-------|------|--------|---------|
| MP Invisible Enemies | [bugs/mp-invisible-enemies.md](bugs/mp-invisible-enemies.md) | FIXED | Shader opacity² bug in MP rendering + cube-tunnel depth calc. Root cause: `onBeforeCompile` multiplied opacity twice, and enemies had full opacity at max depth. Fixed s44r8-04 + s44r12-08. |
| Enemy Dimming Regression | [bugs/enemy-dimming-regression.md](bugs/enemy-dimming-regression.md) | FIXED | SP+MP enemy dimming broken by MeshStandardMaterial emissive dominating instanceColor. vis² double-dimming made it opacity². Fixed s44r10-01 + s44r11-01 + s44r12-03. |
| MP Bullet Direction | [bugs/mp-bullet-direction.md](bugs/mp-bullet-direction.md) | FIXED | MP bullets following UV lines instead of geodesics. Root cause: UV-based tangent vectors in server bullet direction. Fixed via atan2 fix in s44r7-04. |
| SP Hit Detection | [bugs/sp-hit-detection.md](bugs/sp-hit-detection.md) | FIXED | Player dying too early in SP. playerRadius too large + Mobius OR-fallback applied globally. Fixed s44r12-01. |
| MP Hit Detection | [bugs/mp-hit-detection.md](bugs/mp-hit-detection.md) | STILL OPEN | MP hit detection wrong on all maps. Sphere-approx UV used for collision — wrong world position on non-spherical surfaces. Partial fix in s44r8-02. |
| Teleportation Jumps | [bugs/teleportation-jumps.md](bugs/teleportation-jumps.md) | STILL OPEN | Random teleportation at UV poles + visual jumps on teleport. UV singularity at poles + camera lerp through geometry. Stress test finding. |
| MP Pickup Collection | [bugs/mp-pickup-collection.md](bugs/mp-pickup-collection.md) | PARTIALLY FIXED | MP pickups can't be collected. UV-based proximity check uses wrong world position. Partial fix via worldToSurface in s44r9-04. |
| Cube Map Movement | [bugs/cube-map-movement.md](bugs/cube-map-movement.md) | FIXED (SP) | Cube aiming locked left/right, camera 180° flip. UV tangent frame + computeVertexNormals() rotation bug. Fixed s44r6 + s44r10-03. |
| MP Bullet Color Mismatch | [bugs/mp-bullet-color-mismatch.md](bugs/mp-bullet-color-mismatch.md) | FIXED | MP bullets wrong color. Missing weapon color lookup in MP path. Fixed s44r12-07. |
| Tesla Coil One-Damage | [bugs/tesla-coil-one-damage.md](bugs/tesla-coil-one-damage.md) | FIXED | Tesla coil only damages once instead of continuous ticks. Collision event vs tick-based logic. Fixed s44r12-07. |
| MP Upgrades Green Squares | [bugs/mp-upgrades-green-squares.md](bugs/mp-upgrades-green-squares.md) | STILL OPEN | Upgrade icons show as green squares in MP. Icon textures not loaded in MP rendering path. Known open issue. |
| Bullet Origin Near Poles | [bugs/bullet-origin-near-poles.md](bugs/bullet-origin-near-poles.md) | STILL OPEN | Bullets don't originate from player near sphere poles / on torus inner ring / peanut waist. Sphere-approx UV spawn position. Fix: use mesh.position. |
| MP Shared Lives | [bugs/mp-shared-lives.md](bugs/mp-shared-lives.md) | FIXED | Lives shared between all players (should be per-player). Server tracked single counter not per-player. Fixed (multiple regressions). |
| Pixelation Regression | [bugs/pixelation-regression.md](bugs/pixelation-regression.md) | FIXED | Pixelation toggle too strong/too weak. Device pixel ratio 0.375 is user-confirmed midpoint. Fixed s44r12-04. |
| Mobius Seam Wall | [bugs/mobius-seam-wall.md](bugs/mobius-seam-wall.md) | FIXED (SP) | Player blocked at Mobius UV seam. UV discontinuity at half-twist caused impassable wall. Fixed for SP movement; hit detection OR-fallback gated to Mobius in s44r12-01. |
| Enemy Spawning Inside Surface | [bugs/enemy-spawning-inside-surface.md](bugs/enemy-spawning-inside-surface.md) | PARTIALLY FIXED | Enemies spawn inside surfaces. Server-client geometry mismatch (mapSizeScaleFactor missing on server). Cube-ring + Mobius enemies still frozen (OPEN). |

## Systems

| Topic | File | Summary |
|-------|------|---------|
| Visual Dimming | [systems/visual-dimming.md](systems/visual-dimming.md) | How enemy dimming works (depth + health). Critical: must use MeshBasicMaterial, not MeshStandardMaterial. vis² double-dimming pattern to avoid. SP uses EnemyRenderer instanceColor; MP inline in network-main.ts. |
| Hit Detection | [systems/hit-detection.md](systems/hit-detection.md) | Surface-aware collision system. Per-surface distance metrics (great-circle, chord, OR-fallback). Mobius OR-fallback MUST be gated by surface type. MP still uses sphere-approx UV (open). |
| Camera Orientation | [systems/camera-orientation.md](systems/camera-orientation.md) | Camera follows player above surface, up = player surface normal. Platform-specific fixes MUST be gated (mobile vs desktop). Adjacent system: camera breaks after EVERY surface/normal change — always verify. |
| Teleportation | [systems/teleportation.md](systems/teleportation.md) | Portal system for surface teleportation. UV poles cause singularity. Camera must reset (not lerp) on teleport. Invincibility timer needed after arrival. Trigger detection must use world position. |
| Enemy Spawning | [systems/enemy-spawning.md](systems/enemy-spawning.md) | Enemy placement on surface. Server-client geometry MUST be identical (mapSizeScaleFactor). Fallback spawn at UV=(0.5,0.5) not (0,0). Cube-ring + Mobius enemies frozen at topology discontinuity (open). |
| MP Bullet Direction | [systems/mp-bullet-direction.md](systems/mp-bullet-direction.md) | How bullets get their direction in MP. Server uses sphere-approx UV tangent vectors — wrong on non-spherical surfaces. Fix: world-space aim direction. Bullet origin MUST use mesh.position not surface.getPoint(sphereUV). |

## Cross-Reference: Root Causes

### Sphere-Approximation UV (affects MP only)
The MP server sends sphere-approximation UVs for ALL surfaces. Any system that uses `surface.getPoint(sphereUV)` or `surface.getTangent(sphereUV)` will compute wrong world positions on non-spherical maps. Affects:
- MP hit detection → `bugs/mp-hit-detection.md`
- MP bullet origin → `bugs/bullet-origin-near-poles.md`
- MP pickup collection → `bugs/mp-pickup-collection.md`
- MP bullet direction → `bugs/mp-bullet-direction.md`

**Fix pattern:** Use `surface.worldToSurface(mesh.position)` to get surface UV from actual position, then use actual mesh position for world-space operations. See 4 locations in `network-main.ts`.

### MeshStandardMaterial + instanceColor
Using `MeshStandardMaterial` with `instanceColor` for dimming is silently broken when `emissiveIntensity > 0`. Affects:
- Enemy dimming → `bugs/enemy-dimming-regression.md`
- MP invisible enemies (related) → `bugs/mp-invisible-enemies.md`

**Fix pattern:** Always use `MeshBasicMaterial` for instanced meshes that rely on `instanceColor` dimming.

### UV Poles / Singularities
Sphere UV has singularities at v=0 and v=1 (poles). Systems that use UV for world position or distance will produce unpredictable results near poles. Affects:
- Teleportation → `bugs/teleportation-jumps.md`
- Bullet origin → `bugs/bullet-origin-near-poles.md`
- Player movement oscillation (historical, fixed)

**Fix pattern:** Use world-position (mesh.position) not UV for proximity/distance checks. Avoid placing spawnable objects near UV poles.

### Platform-Specific Code Applied Globally
Fixes intended for mobile (e.g., normal negation, bitangent flip) break desktop when applied unconditionally. Affects:
- Camera 180° flip → `systems/camera-orientation.md`

**Fix pattern:** Gate platform-specific code with `isMobile()`. See failure mode #21 in `.claude/rules/failure-modes-quick-ref.md`.

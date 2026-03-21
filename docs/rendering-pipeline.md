# Rendering Pipeline — Visibility, Dimming, Bloom, Transparency

**Purpose:** Reference document for any worker touching rendering, visibility, or post-processing code.
**Last updated:** s44r33-09 (2026-03-22)
**Rule:** Read this before touching any file in `src/rendering/`, `src/core/RenderLoop.ts`, or `src/core/Game.ts` bloom setup.

---

## Full Pipeline Flowchart

```
FIXED UPDATE (GameLoop.ts — physics tick, ~60Hz)
│
├─ GameLoop.fixedUpdate(dt)
│   └─ enemyInstanceManager.updateInstancesWithLOD()    ← PHASE 1
│       ├─ For each enemy: getEntityVisibilityState()
│       │   └─ dot(playerNormal, enemyPos − playerPos) < 0 → HIDDEN
│       │       ├─ hide90DegreeEntities=true  → zero-scale matrix (INVISIBLE)
│       │       └─ hide90DegreeEntities=false → instanceColor × 0.3 (very dim)
│       ├─ LOD assignment (HIGH / MEDIUM / LOW geometry)
│       ├─ Set instanceMatrix (transform) per slot
│       └─ instanceMatrix.needsUpdate = true

RENDER FRAME (main.ts game.onRender — every frame)
│
├─ RenderLoop.render(ctx, alpha)
│   │
│   ├─ surface_projection   (bullets surface-projected)
│   │
│   ├─ transparency_and_occlusion                        ← PHASE 2 setup
│   │   ├─ Tunnel raycast: camera→player, count hits → isCurrentlyBlocked
│   │   ├─ OcclusionSurfaceMaterial: setOcclusionParams (surface fade)
│   │   └─ depthOcclusion.update() — batch 100 raycasts/frame (BVH)
│   │       └─ per enemy: camera→enemy ray, count surface intersections → targetOpacity
│   │
│   ├─ enemy_visibility                                  ← PHASE 2 apply
│   │   For each alive enemy:
│   │   ├─ depthOpacity = depthOcclusion.getOpacity(enemy)  (0–1, EMA-smoothed)
│   │   ├─ UV distance dimming (surface UV coords, hysteresis ENTER=0.17/EXIT=0.13)
│   │   │   └─ visibility = min(depthOpacity, surfaceVis)
│   │   ├─ Proximity override: worldDist < 2.0 → visibility = max(vis, 1.0)
│   │   ├─ Tunnel fade: enemy between camera and blocked player → dim
│   │   ├─ Visibility floor: max(visibility, SURFACE_DIM_OPACITY=0.40)
│   │   ├─ Far-side culling (150+ enemies): camera-dot test → visibility=0 for far enemies
│   │   ├─ ?noDim=true → visibility = 1.0  (PHASE 2 ONLY — does NOT affect Phase 1)
│   │   ├─ setInstanceVisibility(enemy, visibility)
│   │   │   └─ instanceColor = perInstanceColors × visibility
│   │   │   └─ MIN_ICB = 0.35: if avg(r,g,b) < 0.35, scale up (preserves hue)
│   │   ├─ ensureMinimumVisibility() — safety net for all slots
│   │   └─ flushColors() — mark instanceColor.needsUpdate = true
│   │
│   ├─ pickup_dimming   (UV-distance dimming for pickups, min 0.35)
│   └─ camera_and_ui   (screen shake, HUD throttled to ~10fps)
│
└─ game.render()                                         ← GPU SUBMIT
    ├─ updateCamera(alpha)
    └─ WebGL2:  composer.render()
    │   ├─ RenderPass (scene → render target)
    │   ├─ UnrealBloomPass (threshold=0.3, strength=1.0, radius=0.5, half-res)
    │   ├─ vignette ShaderPass
    │   └─ OutputPass (tone mapping → screen)
    └─ WebGPU:  webgpuPostProcessing.render()
        ├─ scenePass (scene render)
        ├─ extract bright pixels above threshold
        ├─ .blur() mip-based approximation
        └─ composite + vignette → screen
```

---

## Phase 1: Hemisphere Culling

**File:** `src/rendering/EnemyInstanceManager.ts` lines 460–489
**Called from:** `src/core/GameLoop.ts:439` — runs in the **fixed-update tick**, not per-render-frame
**Helper:** `src/rendering/EntityCulling.ts` → `getEntityVisibilityState()`

### How it works

```
dot( playerNormal, normalize(enemyPos - playerPos) ) < 0  →  HIDDEN
```

The player's outward surface normal defines a hemisphere. Any enemy in the "back" hemisphere (dot < 0) is HIDDEN.

### Two modes (controlled by `hide90DegreeEntities` setting)

| `hide90DegreeEntities` | Effect on HIDDEN enemy |
|---|---|
| `true` (opt-in setting) | Zero-scale matrix: `scale=(0,0,0)` — enemy is **completely invisible**, bypasses ALL rendering including Phase 2 and bloom. |
| `false` (default) | `instanceColor = perInstanceColors × 0.3` — enemy is dimmed to 30% of base color, still visible |

The setting is re-read every 60 frames from `loadGraphicsSettings()` (line 434–438 in GameLoop.ts).

### Phase 1 and `?noDim=true`

**`?noDim=true` does NOT affect Phase 1.** Phase 1 sets colors directly in `updateInstancesWithLOD`. The `__NO_DIM` global is only checked in RenderLoop at line 373. This is the reason RC18 was baffling — even with `noDim=true`, Phase 1 was still applying 0.3× color.

### Phase 1 sets color BEFORE Phase 2 reads it

Flow for a HIDDEN enemy with `hide90DegreeEntities=false`:
1. Phase 1: `instanceColor = baseColor × 0.3`
2. Phase 2: `setInstanceVisibility(enemy, visibility)` → `instanceColor = perInstanceColors × visibility`

**Wait** — Phase 2 reads `perInstanceColors`, NOT the current `instanceColor`. So Phase 1's 0.3× color is overwritten by Phase 2. BUT: if `hide90DegreeEntities=true`, Phase 1 writes a zero-scale matrix and `continue`s, skipping Phase 2 entirely.

---

## Phase 2: UV Dimming + Depth Occlusion

**File:** `src/core/RenderLoop.ts` lines 102–415
**Called from:** `src/main.ts:2147` via `game.onRender`

### Step A: Depth Occlusion (raycast-based)

**File:** `src/rendering/DepthOpacity.ts` → `DepthOcclusionSystem`

Raycasts from camera to each enemy and counts surface intersections:

| Intersections | Target opacity |
|---|---|
| 0 (clear line of sight) | 1.0 |
| 1–2 (behind one surface) | 0.5 |
| 3+ (behind multiple surfaces) | 0.15 |

**Performance:** batched at 100 raycasts/frame, BVH-accelerated (`three-mesh-bvh`). At 200 enemies, all enemies are re-checked every 2 frames (~33ms).

**EMA smoothing** (α=0.7) prevents single-frame raycast noise (e.g., grazing cube edges) from flipping opacity. Threshold raised to 0.75 (from 0.5) to handle alternating 0/1 noise pattern.

**Surface bypass — cube-tunnel:** Camera is outside the tunnel → raycasts always hit 2 walls → would force opacity=0.15 for all enemies. Bypassed: `depthOpacity = 1.0` for cube-tunnel. See `RenderLoop.ts:143-146, 208`.

### Step B: UV-Distance Dimming

Computed every frame (not batched), using surface UV coordinates:

```
uvDist = sqrt( min(|eu|, 1-|eu|)² + min(|ev|, 1-|ev|)² )
```

Both U and V treated as wrapping (correct for torus, harmless for others).

| uvDist | visibility |
|---|---|
| < 0.13 (EXIT threshold) | 1.0 (fully bright) |
| 0.13–0.17 | hysteresis zone (depends on last frame state) |
| > 0.17 (ENTER threshold) | dimming starts |
| > 0.45 (FAR_UV) | SURFACE_DIM_OPACITY = 0.40 |
| in-between | smooth hermite interpolation |

**Hysteresis** (anti-flicker): two thresholds prevent oscillation when uvDist hovers near 0.15. Tracked per-entity in `_entityDimmedState` (WeakMap, auto-GC'd).

Combined: `visibility = min(depthOpacity, surfaceVis)`

### Step C: World-Space Proximity Override

Overrides dimming for enemies physically close to the player (prevents unfair deaths from dim enemies):

```
worldDist < 2.0  →  visibility = max(visibility, 1.0)   (fully bright)
worldDist 2.0–5.0 → linear fade back to surfaceVis
```

**Why world-space, not UV**: Near poles (sphere, peanut, capsule), enemies at the same latitude but different longitude have large UV distance but ~zero world distance. They should be visible, not dimmed.

**Exception:** `areOnOppositeWallSides()` — if player and enemy are on opposite walls of a tunnel, no proximity override (they're physically separated).

### Step D: Tunnel Camera-Blocking Fade

When the surface is between camera and player (`isCurrentlyBlocked`), dim enemies in that line of sight:

```
alignment > 0.7 (within ~45°) AND enemy closer than player → fade
```

This prevents enemies from appearing to float in front of the surface when the camera is clipping through it.

### Step E: Visibility Floor

```
visibility = max(visibility, SURFACE_DIM_OPACITY)   // = 0.40
```

Prevents compound dimming: depthOpacity=0.40 × surfaceVis=0.40 = 0.16 without the floor.

**History:** The floor has been tuned many times:
- 0.08 → too dark, enemies invisible on dark background
- 0.15 → still invisible with DoubleSide+depthTest:false
- 0.25 → invisible after RC17
- **0.40** → current (s44r33 + RC17 DoubleSide)

### Step F: Far-Side Culling (150+ entities)

At high entity counts (performance and visual clutter):

- **Activates** at ≥150 entities
- **Deactivates** at <120 entities (hysteresis)
- Bosses exempt (always visible as threat cue)
- Uses camera-from-center dot product against enemy-from-center direction
- Smooth fade zone: `dot ∈ [-0.10, +0.15]`

### Step G: setInstanceVisibility → MIN_ICB

`EnemyInstanceManager.setInstanceVisibility(enemy, visibility)` (line 670):

```
instanceColor.rgb = perInstanceColors × visibility
if avg(r,g,b) < MIN_ICB (0.35) AND visibility > 0:
    scale all channels by MIN_ICB/avg   (preserves hue)
```

`perInstanceColors` stores the **undimmed** base color per instance, separate from `instanceColor`. This allows correct dimming even when rainbow mode or hit-flash has changed `instanceColor`.

**MIN_ICB = 0.35** (current). Gotcha: needs to be reverted toward 0.15 once RC18 is fully diagnosed. At 0.35, even heavily-dimmed enemies render as visibly bright (RGB 89). See the debug notes in MEMORY.md.

### Step H: ensureMinimumVisibility + flushColors

```typescript
ctx.enemyInstanceManager.ensureMinimumVisibility();  // safety net: MIN_ICB for all slots
ctx.enemyInstanceManager.flushColors();               // instanceColor.needsUpdate = true
```

`ensureMinimumVisibility()` catches enemies that bypassed the per-enemy loop (LOD transitions, race conditions, materializing enemies, etc.).

---

## Material Flags (RC15–RC17)

| Flag | Value | Set where | Why / RC |
|---|---|---|---|
| `depthTest` | `false` | All InstancedMesh materials in `EnemyInstanceManager` | RC15: GPU depth test culled far-side enemies (behind the surface mesh, depth value > surface mesh). |
| `side` | `THREE.DoubleSide` | All InstancedMesh materials | RC17: Back-face culling removed far-side enemies even after depthTest:false. With DoubleSide, both front and back faces render. |
| `frustumCulled` | `false` | InstancedMesh + KotH zone meshes | Prevents Three.js frustum culling from hiding instances based on bounding box when camera is above the surface. |
| `transparent` | `true` | All enemy materials | Required for the `opacity` attribute / `instanceColor` alpha path to work. |
| Material type | `MeshBasicMaterial` | All instanced enemies | RC11 (s44r11-01): `MeshStandardMaterial` + `instanceColor` dims diffuse only, not emissive. With high `emissiveIntensity` and no lights, `instanceColor` changes were invisible. Fix: use `MeshBasicMaterial` (unlit, color-driven). |

### Per-instance opacity attribute

Each `InstancedMesh` has a custom `instanceOpacity` attribute (1 float per instance) injected via `onBeforeCompile`. The shader multiplies fragment alpha by this value.

**WebGL-only gotcha:** `onBeforeCompile` is WebGL-only. The WebGPU renderer ignores it. This is why Phase 2 dimming uses **RGB scaling** (`perInstanceColors × visibility`) rather than the opacity attribute. Both are set, but only RGB works on WebGPU.

To avoid "visibility²" darkening (s44r18-20), the opacity attribute is always kept at 1.0 for dimmed enemies — dimming is done via RGB only.

---

## Bloom Pipeline

### WebGL2 Path (EffectComposer)

**File:** `src/core/Game.ts` lines 298–361

```
EffectComposer (50% resolution by default)
  ├─ RenderPass          — renders full scene to render target
  ├─ UnrealBloomPass     — threshold=0.3, strength=1.0, radius=0.5
  │   └─ 5+ blur passes on bright pixels only
  ├─ vignette ShaderPass — subtle screen-edge darkening
  └─ OutputPass          — tone mapping → screen
```

**Resolution scaling:**
- Modern / CRT modes: 50% (half W × half H) — 4× cheaper than full-res
- Pixelated mode: 40% — chunky pixel look via NearestFilter upscale

**Selective bloom (threshold=0.3):** Works because:
- Arena surface: `MeshBasicMaterial` color `0x141440` → luminance ≈ **0.091** (below threshold)
- Grid: `LineBasicMaterial` color `0x2a2aaa` → luminance ≈ **0.201** (below threshold)
- Enemy materials: emissiveIntensity 1.2–3.0 → **well above 0.3**
- Player: emissiveIntensity ~0.4 → **above 0.3**

Result: only game entities produce bloom glow, not the arena background.

### WebGPU Path (TSL PostProcessing)

**File:** `src/core/Game.ts` lines 394–451

```
PostProcessing (three/webgpu TSL node graph)
  ├─ pass(scene, camera) — renders scene to texture
  ├─ extract: max(r,g,b) > threshold → brightColor
  ├─ .blur(0.3) — mip-based blur approximation (NOT UnrealBloomPass)
  ├─ composite: original + blurred × strength
  └─ vignette: multiply by (1 - dot(uv-0.5, uv-0.5) × 0.8)
```

**This is NOT UnrealBloomPass.** It's a simpler mip-blur approximation. Visual result is similar but not identical (less sharp bloom rings, different falloff). If WebGPU PostProcessing fails to init (dynamic import error), falls back to direct `renderer.render()` with no post-processing.

### Dynamic bloom control

Both paths support runtime tuning via `game.setBloomSettings(strength, threshold)`:
- WebGL2: updates `bloomPass.strength / .threshold` directly
- WebGPU: updates TSL uniform nodes `webgpuBloomStrengthUniform / webgpuBloomThresholdUniform`

---

## WebGPU vs WebGL2

**File:** `src/rendering/RendererFactory.ts`

| Topic | WebGPU | WebGL2 |
|---|---|---|
| Selection | Auto when Chrome 113+ | Fallback, or `?renderer=webgl` |
| Force | `?renderer=webgpu` | `?renderer=webgl` |
| Post-processing | TSL PostProcessing (three/webgpu) | EffectComposer + UnrealBloomPass |
| onBeforeCompile | **Not supported** | Supported |
| instanceColor opacity attribute | **Ignored** — RGB dimming only | Works (shader patch via onBeforeCompile) |
| Silent fallback | WebGPURenderer may silently fall to WebGL2 — detected via `backend.constructor.name !== 'WebGPUBackend'` | N/A |
| Headless testing | SwiftShader (software WebGL2) — NOT the same as GPU WebGPU | SwiftShader |

### Silent WebGPU fallback (critical gotcha)

Three.js `WebGPURenderer.init()` can silently fall back to a `WebGLBackend` internally without throwing. The game detects this by checking `(renderer as any).backend.constructor.name`. If it's not `'WebGPUBackend'`, the renderer is discarded and WebGL2 is created fresh (line 191–214 in RendererFactory.ts).

**Diagnose WebGPU issues:**
- Run `__webgpuDiagnostic()` in browser console (installed by `installWebGPUDiagnostic()`)
- Check `chrome://gpu` → "WebGPU" line
- Check console for `[RendererFactory]` messages at startup

### Headless testing vs real GPU (failure mode #31)

Puppeteer headless uses SwiftShader (software WebGL2). WebGPU bugs on real hardware **will not appear** in headless tests. Use the Windows Chrome debug port (see MEMORY.md) for real GPU verification.

---

## Key Constants (current values as of s44r33)

| Constant | Value | File | Notes |
|---|---|---|---|
| `SURFACE_DIM_OPACITY` | 0.40 | `RenderLoop.ts:52` | Minimum opacity for far-away / behind-surface enemies. Raised through many sessions (see comment history). |
| `SURFACE_NEAR_UV_ENTER` | 0.17 | `RenderLoop.ts:50` | Start dimming when UV distance crosses this (from undimmed) |
| `SURFACE_NEAR_UV_EXIT` | 0.13 | `RenderLoop.ts:51` | Stop dimming when UV distance drops below this (from dimmed) |
| `SURFACE_FAR_UV` | 0.45 | `RenderLoop.ts:52` | Fully dimmed beyond 45% UV distance |
| `MIN_ICB` | 0.35 | `EnemyInstanceManager.ts:711,743` | Minimum instanceColor brightness. Needs reverting to ~0.15 once RC18 resolved. |
| `PROXIMITY_NEAR_WORLD` | 2.0 | `RenderLoop.ts:23` | Enemies within 2 world units: forced full visibility |
| `PROXIMITY_FADE_WORLD` | 5.0 | `RenderLoop.ts:25` | Fade back to surface dimming by 5 world units |
| `FAR_SIDE_THRESHOLD_ON` | 150 | `RenderLoop.ts:169` | Activate far-side culling at this many entities |
| `FAR_SIDE_THRESHOLD_OFF` | 120 | `RenderLoop.ts:170` | Deactivate below this count |
| `DEFAULT_BLOOM.threshold` | 0.3 | `Game.ts:65` | Only pixels brighter than this bloom |
| `DEFAULT_BLOOM.strength` | 1.0 | `Game.ts:63` | Bloom intensity |
| `bloomResolutionScale` | 0.5 | `Game.ts:195` | Bloom rendered at 50% resolution |
| Occlusion `opacity0` | 1.0 | `DepthOpacity.ts:202` | 0 surface layers |
| Occlusion `opacity1` | 0.5 | `DepthOpacity.ts:203` | 1 surface layer |
| Occlusion `opacity2Plus` | 0.15 | `DepthOpacity.ts:204` | 2+ surface layers |
| Occlusion `batchSize` | 100 | `DepthOpacity.ts:201` | Raycasts per frame |

---

## Debug Flags

| Flag | Effect |
|---|---|
| `?noDim=true` | Sets `visibility=1.0` in Phase 2 (RenderLoop). **Does NOT affect Phase 1** hemisphere culling. |
| `?debugVisibility=true` | Enables visibility overlay (throttled 500ms update) |
| `?renderer=webgl` | Forces WebGL2, skips WebGPU |
| `?renderer=webgpu` | Forces WebGPU (only if capable) |
| `?testMode=true` | Enables `preserveDrawingBuffer` for Puppeteer pixel reads |
| `?godMode=true` | Player immortality (separate from rendering) |

Browser console functions:
- `__webgpuDiagnostic()` — step-by-step WebGPU adapter/device check
- `window.__TEST_API` — programmatic game control (when `?testMode=true`)

---

## Known Gotchas

### 1. `?noDim=true` doesn't fix all invisible enemies

`?noDim=true` only bypasses Phase 2. Phase 1 hemisphere culling in `updateInstancesWithLOD` runs in the fixed update tick and is unaffected. If enemies are invisible with `noDim=true`, the cause is upstream of Phase 2: `isMaterializing`, zero-scale matrix from Phase 1, slot allocation failure, or `hide90DegreeEntities=true`.

### 2. Phase 1 color vs Phase 2 color

Phase 1 sets `instanceColor` directly. Phase 2 reads `perInstanceColors` (the undimmed base color) and writes `instanceColor`. So Phase 1's 0.3× dimming is only visible if Phase 2 is skipped (e.g., enemy not in `allEnemies`, `enemy.alive=false`). In normal gameplay, Phase 2 overwrites Phase 1's color every frame.

### 3. MIN_ICB currently too high (0.35)

MIN_ICB=0.35 was raised to fix RC18 (invisible enemies). It means heavily-dimmed far-side enemies appear at 35% brightness (clearly visible). Once RC18 is diagnosed, this should revert to ~0.15. Track in MEMORY.md.

### 4. depthTest:false + DoubleSide = enemies render through surfaces

RC15 and RC17 fixed invisibility by disabling depth test and enabling double-sided rendering. The side effect: enemies on the far side now render through the surface visually. The dimming system (Phase 2) compensates by making them dark enough to seem "behind" the surface. If dimming is too low, this looks wrong.

### 5. Depth occlusion is batched — stale values

`depthOcclusion.getOpacity()` returns a smoothed value that may be 0–50 frames old. EMA smoothing (lerpSpeed=8.0) helps, but enemies can briefly appear at wrong opacity after camera moves or teleports. This is intentional for performance.

### 6. WebGL onBeforeCompile opacity attribute doesn't work on WebGPU

All opacity-attribute changes (`opacityAttribute.setX()`) are silently ignored on WebGPU. The WebGPU dimming path is **RGB-only** via `instanceColor`. Always test dimming on both backends.

### 7. LOD batches have separate visibility paths

Enemies in MEDIUM/LOW LOD batches use `setLODInstanceVisibility()` (not `setInstanceVisibility()`). Both share MIN_ICB=0.35 logic, but LOD batches use the enemy type's base color (not per-instance `perInstanceColors`). If an enemy color changes (hit flash, rainbow mode) while in LOD, the LOD batch shows the stale base color.

### 8. Bloom doesn't apply to InstancedMesh alpha-dimmed enemies

Dimming via `instanceColor` lowers the pixel brightness below threshold (0.3). Heavily dimmed enemies won't bloom. This is correct behavior (dim = far/hidden), but it means switching from `MeshStandardMaterial` (which has emissive) to `MeshBasicMaterial` (which doesn't) was necessary to avoid the opposite problem: high emissive overriding dim RGB.

### 9. EffectComposer NearestFilter for pixelated mode

In pixelated mode, the EffectComposer render buffers use `NearestFilter` (sharp pixel edges when upscaling). Switching modes at runtime requires updating both `readBuffer` and `writeBuffer` textures (EffectComposer swaps them between passes). Missing the writeBuffer update causes one-frame blur artifacts on mode switch.

### 10. WebGPURenderer silent fallback

Three.js WebGPURenderer can silently swap to WebGL2 backend internally. The game detects this (RendererFactory.ts:187–214) and discards the silently-degraded renderer, creating a fresh WebGL2 renderer instead. The discarded renderer has no EffectComposer, so using it would produce no bloom.

---

## Performance Profile

Profiler labels (from `src/core/PerformanceProfiler.ts`):

| Label | Phase | Cost at 200 enemies |
|---|---|---|
| `surface_projection` | Bullet surface projection | Low — O(bullets) |
| `transparency_and_occlusion` | Depth occlusion raycasts + surface opacity | Medium — 100 BVH raycasts/frame |
| `enemy_visibility` | Phase 2 UV dimming + setInstanceVisibility | Medium — O(enemies), all per-frame |
| `pickup_dimming` | Pickup UV dimming | Low — O(pickups) |
| `camera_and_ui` | Screen shake + HUD | Low — throttled 10fps |

**Where spikes come from:**

- `transparency_and_occlusion`: BVH raycasts. At 200 enemies, 100 raycasts/frame is negligible (~0.2ms). Spikes occur when surface mesh is large (EPIC maps with 2× scale) because the BVH has more triangles.
- `enemy_visibility`: Scales linearly with enemy count. At 400 enemies (400 enemyToIndex + 400 visibility calculations), this is ~0.5ms. The bottleneck is `instanceColor.needsUpdate = true` triggering GPU buffer uploads.

**Batching:** All enemies of the same type share one `InstancedMesh`. ~15 draw calls total for all 200 enemies (was 2000+ with individual meshes). LOD batches reduce high-poly count at distance.

---

## Execution Order Summary

```
TICK (onFixedUpdate, ~60Hz):
  1. GameLoop.fixedUpdate → enemySpawner.update → enemies move
  2. EnemyInstanceManager.updateInstancesWithLOD → Phase 1 cull + LOD assign
  3. instanceMatrix.needsUpdate = true

FRAME (onRender, every RAF):
  4. RenderLoop.render:
     a. Surface projection (bullets)
     b. depthOcclusion.update (100 raycasts) → getOpacity cache updated
     c. Per-enemy: UV dimming + depth → visibility float
     d. setInstanceVisibility → instanceColor = perInstanceColors × visibility × MIN_ICB floor
     e. ensureMinimumVisibility (safety net)
     f. flushColors → instanceColor.needsUpdate = true
  5. game.render():
     a. updateCamera
     b. composer.render() or webgpuPostProcessing.render() → bloom + vignette → screen
```

Phase 1 runs at fixed-update rate (decoupled from render FPS). Phase 2 runs every render frame. On very high refresh rates (240Hz), Phase 2 runs 4× per physics tick — the visibility values may be slightly stale from Phase 1 for one tick.

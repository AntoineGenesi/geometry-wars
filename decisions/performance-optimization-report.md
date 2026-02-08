# Performance Optimization Report

## Executive Summary

The game's primary bottleneck is **GPU draw calls**, not CPU computation. Each enemy is built from 12-30+ individual `THREE.Mesh` objects (tube segments + joint spheres via `GeometryBuilder.ts`), meaning 100 enemies can generate **1500-3000+ draw calls** -- far beyond the ~200-500 draw call budget for smooth 60fps. The secondary bottleneck is **per-frame object allocation** (new `Vector3`, `Matrix4`, `Quaternion`, `Color` on every frame in hot paths), creating GC pressure that causes periodic frame drops. Fixing these two issues via `InstancedMesh` for enemies and eliminating per-frame allocations would likely push capacity from ~100 entities to ~1000+ entities at 60fps.

---

## Current Architecture Analysis

### Rendering Pipeline (Game.ts)

**Cost: HIGH (GPU-bound)**

- **Renderer**: `WebGLRenderer` with `antialias: true`, pixel ratio capped at 2.0 (good).
- **Post-processing**: `EffectComposer` with 4 passes:
  1. `RenderPass` -- full scene render
  2. `UnrealBloomPass` -- fullscreen gaussian blur (3 internal passes: bright extraction, H-blur, V-blur). At `strength=0.7, radius=0.5, threshold=0.6`.
  3. Vignette `ShaderPass` -- lightweight fullscreen shader
  4. `OutputPass` -- color space conversion
- **Effective cost**: The bloom pass alone costs 3 additional fullscreen shader passes. At 1080p, that is ~6 million fragment shader invocations *per bloom pass*. At 4K with pixelRatio=2, it quadruples.

### Enemy System (EnemySpawner.ts, BaseEnemy.ts, GeometryBuilder.ts)

**Cost: VERY HIGH (draw calls)**

Each enemy mesh is created by `buildPrismFrame()` in `GeometryBuilder.ts`, which creates:
- **1 `CylinderGeometry` mesh per edge** (with 5 radial segments, 1 height segment each)
- **1 `SphereGeometry` mesh per unique vertex** (6x6 segments)
- Each mesh has its own `MeshStandardMaterial` (expensive: PBR lighting computation)

For a simple Grunt (diamond 3D shape, line 133-163 of `GeometryBuilder.ts`):
- 12 edges = **12 cylinder meshes**
- 8 vertices = **8 sphere meshes**
- Total: **20 draw calls per Grunt**

For an Octahedron enemy:
- 12 edges + 6 vertices = **18 draw calls**

For a Polygon3D with 8 sides:
- ~24 edges + ~16 vertices = **~40 draw calls**

**With 100 enemies on screen**: 100 * 20 = **~2000 draw calls just for enemies**

Additionally, every frame in `BaseEnemy.applySurfaceTransform()` (line 61-91):
- Creates `new THREE.Matrix4()`, `new THREE.Euler()` -- 2 object allocations per enemy per frame
- Also clones `transform.position` via `offsetPosition.clone()` + `addScaledVector()`

### Enemy Separation (EnemySpawner.ts:428-463)

**Cost: MEDIUM (O(n^2) CPU)**

`applySeparation()` is a nested loop comparing every active enemy pair:
- At 100 enemies: 4,950 distance calculations per frame
- At 200 enemies: 19,900 per frame
- At 500 enemies: 124,750 per frame (will cause frame drops)

### Bullet Pool (Bullet.ts)

**Cost: MODERATE (well-pooled, but allocations in update)**

- Pool of 200 `THREE.Line` objects -- **200 draw calls max**
- Each line has its own cloned geometry (line 88: `geometry.clone()`) -- 200 geometries in VRAM
- **Per-frame allocation in update()** (line 233-234): `new THREE.Vector3(b.dirX, b.dirY, b.dirZ)` for EVERY active bullet EVERY frame
- **Per-frame allocation in orientLine()** (line 362-363): `line.position.clone().add(dir)` -- 1 clone per active bullet per frame
- `closestPointOnSurface()` BVH query per bullet per frame (line 212) -- this is O(log n) but has allocation overhead

### Geom Pool (Geom.ts)

**Cost: MODERATE (draw calls + allocations)**

- Pool of 300, each geom is a `THREE.Group` containing 2 `THREE.Line` objects = **600 draw calls max**
- `applySurfaceProjection()` (line 164-196) per active geom per frame creates:
  - `new THREE.Matrix4()` (line 188)
  - `new THREE.Quaternion()` twice (lines 189-190)
  - Each geom's `getTransform()` call creates new Vector3 objects internally

### Particle System (ParticleSystem.ts)

**Cost: LOW-MODERATE (well-optimized GPU particles + fragment pool)**

- GPU point particles: single `THREE.Points` draw call with 5000 particles. **1 draw call total**. This is excellent.
- Shatter fragments: pool of 400 `THREE.Mesh` objects with `MeshBasicMaterial`. **Up to 400 draw calls** when all active.
- Fragment update (line 563): `fragment.velocity.clone().multiplyScalar(dt)` -- **1 allocation per active fragment per frame**
- `enemyDeath()` spawns 40-60 fragments + 48 point particles. Multiple deaths in a frame can spike fragment count.

### Score Popups (ScorePopup.ts)

**Cost: MODERATE (texture creation + draw calls)**

- Each popup creates a `THREE.Sprite` with a `SpriteMaterial` + `CanvasTexture` -- **1 draw call per active popup**
- Texture cache limited to 50 entries (line 182), but damage numbers are unique strings (e.g., "-1", "-2.5") that may not cache well
- Canvas drawing per unique text: `document.createElement('canvas')`, `getContext('2d')`, font rendering -- expensive on first occurrence
- At high scores with rapid kills: 20+ active popups = 20 draw calls + 20 sprites in scene graph

### Glow Trails (GlowTrail.ts)

**Cost: MODERATE (per-trail overhead * trail count)**

- Each trail = 1 core `THREE.Line` + 3 glow layers = **4 draw calls per trail**
- Player trail: always active = 4 draw calls
- Fast enemy trails (Mayfly, Rocket, Duck): 4 draw calls each
- 20 fast enemies = **80 draw calls** just for trails
- `updateColors()` creates `new Float32Array(this.coreColors.length)` per glow layer per update (line 271) -- **3 typed array allocations per trail per frame** when colors update

### Entity Glow (EntityGlow.ts)

**Cost: LOW**

- Sprite-based, shared texture (good). 1 draw call per glow.
- Only player glow is active in single-player. Negligible impact.

### Surface Grid Deformation (Surface.ts:226-265)

**Cost: MODERATE (spring simulation)**

- `applyForce()` (line 226): iterates ALL grid vertex springs per force application. Grid is 24x18 = 432 vertices. Each bullet hit, enemy death, and bomb calls this.
- `updateGrid()` (line 239): Sub-stepped spring simulation. Each step iterates all 432 springs. With 4 sub-steps: 1728 spring updates per frame.
- **Per-frame allocation**: `spring.offset.clone().multiplyScalar()` (line 249), `springForce.multiplyScalar()` (line 252), `spring.velocity.clone().multiplyScalar()` (line 254) -- **3 Vector3 clones per spring per sub-step** = 5184 allocations per frame.

### Depth-Based Enemy Opacity (main.ts:1609-1645)

**Cost: MODERATE (per-enemy per-frame)**

- For every alive enemy, every frame:
  - `enemy.position.clone().sub(meshCenter).normalize()` -- 1 clone (line 1612)
  - `meshSurface.getVisibility()` -- BVH query
  - When blocked: additional `enemy.position.clone().sub(camPos)` (line 1618), `.clone()` (line 1619), `toEnemy.normalize()` (line 1623)
  - `enemy.mesh.traverse()` to set opacity on all child meshes (line 1636-1644) -- this traverses 20+ children per enemy per frame

### Collision Detection (main.ts)

**Cost: MODERATE-HIGH (brute force O(n*m))**

Three collision checks per frame, all brute-force:

1. **Bullet-enemy** (line 317-398): `bulletPool.forEachActive()` x `enemies[]` = O(bullets * enemies).
   - 100 active bullets * 100 enemies = 10,000 `distanceTo()` calls per frame
   - Each `distanceTo()` is a sqrt (can use squared distance instead)

2. **Player-enemy** (line 428-460): O(enemies) -- negligible.

3. **Player-geom** (line 405-422): `geomPool.forEachActive()` -- O(active_geoms), ~100-200 distance checks.

### Tunnel Transparency Raycaster (main.ts:1572-1605)

**Cost: LOW-MODERATE**

- Single raycaster per frame, `intersectObject()` against surface mesh. O(surface triangles) but uses Three.js internal BVH when available.
- Creates `toPlayer.clone()`, `toPlayerDir.clone()` per frame -- minor.

### Multiplayer Split-Screen (SplitScreenRenderer.ts, multiplayer-main.ts)

**Cost: VERY HIGH**

- Renders the **full scene N times** (2-4 viewports), each with `renderer.render(scene, camera)`.
- Bloom is disabled in split-screen (uses direct rendering), which helps significantly.
- But the pre-render callback (line 1005-1021) iterates ALL enemies for depth-opacity -- **once per viewport per frame**.
- With 4 players and 100 enemies: the depth opacity loop runs 400 times per frame, each with mesh traversal.

---

## Bottleneck Analysis

### Visual (GPU) Bottlenecks

| Bottleneck | Severity | Estimated Draw Calls | Fix Difficulty |
|---|---|---|---|
| Enemy meshes (tube segments) | **CRITICAL** | ~2000 at 100 enemies | Medium (InstancedMesh) |
| Bullet lines | Moderate | ~200 max | Medium (InstancedBufferGeometry) |
| Geom diamonds | Moderate | ~600 max (300 * 2 lines) | Medium (InstancedMesh) |
| Shatter fragments | Moderate | ~200 avg, ~400 peak | Low (already pooled) |
| Score popups (sprites) | Low | ~20 avg | Low (cap count) |
| Glow trails | Moderate | ~80 (20 fast enemies * 4) | Medium (reduce layers) |
| Bloom post-process | Moderate | N/A (fullscreen passes) | Easy (dynamic quality) |
| Split-screen (N renders) | High | N * everything | Medium (LOD per viewport) |

**Total estimated draw calls at 100 enemies**: ~3000-4000 draw calls
**GPU target for 60fps**: ~500-1000 draw calls

### Computation (CPU) Bottlenecks

| Bottleneck | Severity | Operations/Frame | Fix Difficulty |
|---|---|---|---|
| Enemy separation O(n^2) | **HIGH** at scale | n*(n-1)/2 | Medium (spatial hash) |
| Bullet-enemy collision O(n*m) | **HIGH** at scale | bullets * enemies | Medium (spatial hash) |
| Depth opacity traversal | Moderate | enemies * ~20 children | Easy (cache material refs) |
| Grid spring simulation | Moderate | 432 * sub_steps | Low (reduce sub-steps) |
| `applySurfaceTransform` per enemy | Moderate | enemies * allocations | Easy (pre-allocate) |
| `getTransform()` (surface.getPoint) | Moderate | trig calls per entity | Medium (cache/LUT) |

### Memory / GC Pressure

| Source | Allocations/Frame | Fix |
|---|---|---|
| `BaseEnemy.applySurfaceTransform()` | 2 objects * enemies | Pre-allocate, mutate in place |
| `Bullet.update()` | ~3 Vector3 per bullet | Use temp vectors |
| `Geom.applySurfaceProjection()` | ~3 objects per geom | Pre-allocate |
| `Surface.updateGrid()` | ~3 clones * 432 springs * sub_steps | Mutate in place |
| `GlowTrail.updateColors()` | 3 Float32Array per trail | Reuse buffers |
| `ParticleSystem.updateFragments()` | 1 clone per fragment | Use temp vector |
| depth-opacity loop | ~5 clones per enemy | Pre-allocate |
| `checkBulletEnemyCollisions()` hit flash | setTimeout per hit | Use timer pattern |

**Estimated per-frame allocations at 100 enemies, 100 bullets, 100 geoms**:
- Enemies: ~200 objects (Matrix4, Euler) + ~500 (depth opacity)
- Bullets: ~300 Vector3s
- Geoms: ~300 objects
- Grid: ~5000 Vector3 clones (spring simulation)
- **Total: ~6000+ short-lived objects per frame** -- significant GC pressure

---

## Optimization Recommendations

### Tier 1: High Impact, Low Effort (DO FIRST)

**1. Eliminate Per-Frame Allocations (Impact: HIGH, Effort: LOW)**
- **File**: `src/entities/enemies/BaseEnemy.ts:61-91`
  - Pre-allocate a `_tempMatrix4`, `_tempEuler`, `_tempVec3` on the class.
  - Replace `new THREE.Matrix4()`, `new THREE.Euler()`, `clone()` with mutations on the temp objects.
- **File**: `src/entities/Bullet.ts:233-234, 258, 271`
  - Module-level `const _tempDir = new THREE.Vector3()` and `const _tempTarget = new THREE.Vector3()`.
  - Replace `new THREE.Vector3(b.dirX, b.dirY, b.dirZ)` with `_tempDir.set(b.dirX, b.dirY, b.dirZ)`.
  - Replace `orientLine()` clone with mutation.
- **File**: `src/surfaces/Surface.ts:226-265` (spring simulation)
  - Replace `spring.offset.clone().multiplyScalar()` with in-place math.
  - Replace `spring.velocity.clone().multiplyScalar(subDt)` with in-place `addScaledVector`.
- **File**: `src/effects/GlowTrail.ts:271`
  - Pre-allocate the `dimmedColors` Float32Array once, reuse each frame.
- **File**: `src/main.ts:1609-1645` (depth opacity)
  - Pre-allocate temp vectors for the loop. Cache `meshCenter` per frame (it doesn't change).
  - Cache material references per enemy instead of calling `mesh.traverse()` every frame.
- **Estimated impact**: Eliminates ~6000 per-frame allocations. Reduces GC pauses from ~5-15ms spikes to near zero. Most noticeable as elimination of periodic micro-stutters.

**2. Use Squared Distance for Collision (Impact: MEDIUM, Effort: VERY LOW)**
- **File**: `src/main.ts:337` -- `bulletPos.distanceTo(enemy.position)` uses `Math.sqrt`.
  - Replace with `distanceToSquared()` and compare against `(enemy.radius + 0.15) ** 2`.
  - Same for player-enemy (line 443) and geom pickup (line 414).
- **Estimated impact**: ~10-20% faster collision checks. `sqrt` is the most expensive part of distance.

**3. Reduce Glow Trail Layers (Impact: MEDIUM, Effort: VERY LOW)**
- **File**: `src/effects/GlowTrail.ts:42` -- `GLOW_LAYERS = 3`
  - Reduce to 1 glow layer (from 3). Each trail goes from 4 draw calls to 2.
  - Visual difference is minimal because WebGL `lineWidth` > 1 is not supported on most hardware anyway.
  - With 20 fast enemies: saves ~40 draw calls and ~40 buffer updates per frame.

**4. Cap Active Score Popups (Impact: LOW-MEDIUM, Effort: VERY LOW)**
- **File**: `src/effects/ScorePopup.ts`
  - Add a max popup limit (e.g., 15). When at capacity, recycle the oldest popup instead of creating new ones.
  - Skip damage number popups entirely when there are already 10+ popups active.
- **Estimated impact**: Prevents popup explosion during chain kills. Reduces sprite count during intense moments.

### Tier 2: High Impact, Medium Effort

**5. InstancedMesh for Enemies (Impact: VERY HIGH, Effort: MEDIUM-HIGH)**

This is the single biggest optimization available.

Currently each Grunt is 20 draw calls. With `THREE.InstancedMesh`:
- Create ONE `InstancedMesh` per visual archetype (diamond, square, triangle, octahedron, etc.).
- Each enemy type shares the same merged geometry + single material.
- Update per-instance transform matrix each frame via `instanceMatrix`.
- Use per-instance color via `instanceColor` for hit flash effects.

**Example**: All Grunts share one InstancedMesh with diamond geometry. 50 Grunts = **1 draw call** instead of 1000.

With ~6 unique enemy shapes, 200 enemies = **~6-10 draw calls** instead of ~4000.

**Challenge**: The tube-based geometry builder creates separate meshes per edge. These would need to be merged into a single BufferGeometry per enemy type using `THREE.BufferGeometryUtils.mergeGeometries()`.

**Estimated impact**: Reduces enemy draw calls by **99%** (from ~2000 to ~10).

**6. InstancedMesh for Geoms (Impact: HIGH, Effort: MEDIUM)**
- All geoms are identical diamond shapes. Perfect for instancing.
- 300 geoms = **1-2 draw calls** instead of 600.
- Update instance matrices each frame for position + spin.

**7. Spatial Hash Grid for Collisions (Impact: HIGH at scale, Effort: MEDIUM)**
- Create a uniform spatial hash grid (cell size = max entity radius * 2).
- Insert all enemies into the grid each frame.
- Bullet-enemy collision only checks enemies in the same and adjacent cells.
- **At 200 enemies + 100 bullets**: reduces from 20,000 checks to ~500-1000.
- **At 500 enemies**: reduces from 50,000 to ~2000-3000.
- Same grid can be used for enemy separation (replaces O(n^2) with O(n * k) where k is avg neighbors).

**Note on surface coordinates**: The game operates in UV space for enemies and world space for bullets. The spatial grid should operate in world space since collision checks use `distanceTo()` on world positions.

**8. Cache Enemy Material References (Impact: MEDIUM, Effort: LOW-MEDIUM)**
- **File**: `src/main.ts:1636-1644` and `src/main.ts:356-369`
- Each enemy should cache an array of its `THREE.MeshStandardMaterial` references at creation time.
- Replace per-frame `mesh.traverse()` (which walks 20+ nodes) with direct material array iteration.
- For hit flash (line 356-369): use the cached materials array instead of traversing.
- **Estimated impact**: Eliminates ~2000 tree traversals per frame at 100 enemies.

### Tier 3: Medium Impact, High Effort (CONSIDER LATER)

**9. WebWorker for Physics/Collision (Impact: HIGH, Effort: HIGH)**
- Move collision detection and enemy AI updates to a Web Worker.
- Use `SharedArrayBuffer` for position data (requires COOP/COEP headers).
- Main thread only handles rendering + input.
- **Benefit**: Collision at 500+ enemies won't block rendering.
- **Risk**: Adds complexity, requires careful synchronization, COOP/COEP headers needed for `SharedArrayBuffer`.

**10. LOD System for Enemies (Impact: MEDIUM, Effort: MEDIUM)**
- Enemies far from camera or on the far side of the surface use simplified meshes (fewer tubes, no joints).
- Combined with depth-based opacity: enemies at opacity < 0.3 could use a single colored quad instead of full 3D prism.
- **Estimated impact**: Reduces draw calls by 30-50% for far-side enemies.

**11. Instanced Bullets (Impact: MEDIUM, Effort: MEDIUM)**
- Replace 200 individual `THREE.Line` objects with a single `THREE.InstancedBufferGeometry`.
- Each bullet is an instance with position + direction as instance attributes.
- **200 bullets = 1 draw call** instead of 200.

**12. Dynamic Bloom Quality (Impact: MEDIUM, Effort: LOW)**
- When frame rate drops below 55fps, reduce bloom pass resolution (0.5x instead of 1x).
- Below 45fps, disable bloom entirely.
- `bloomPass.resolution.set(width * scale, height * scale)` is the API.
- **Estimated impact**: 30-40% GPU time savings when bloom is at half-res.

**13. InstancedMesh for Shatter Fragments (Impact: LOW-MEDIUM, Effort: MEDIUM)**
- Replace 400 individual `THREE.Mesh` fragments with 3 `InstancedMesh` (one per shape type).
- Would reduce peak fragment draw calls from 400 to 3.

---

## Intelligent Visual Degradation Strategy

When entity count exceeds thresholds, degrade visuals in this order (least noticeable first):

| Threshold | Action | Visual Impact |
|---|---|---|
| 80 enemies | Disable enemy glow trails | Negligible -- trails are subtle |
| 120 enemies | Reduce bloom to half resolution | Barely noticeable |
| 150 enemies | Disable score popup damage numbers (keep score popups) | Minor |
| 200 enemies | Reduce particle counts by 50% (enemyDeath: 20 fragments instead of 40) | Moderate |
| 250 enemies | Disable grid deformation (skip `surface.applyForce()` calls) | Moderate |
| 300 enemies | Disable bloom entirely | Noticeable but gameplay unaffected |
| 400 enemies | Cap bullet pool at 100 (from 200) | Changes gameplay feel |

Implementation: Add a `QualityManager` that monitors `renderer.info.render.calls` and adjusts these settings dynamically.

---

## Multiplayer-Specific Optimizations

### Split-Screen Rendering (2-4x cost)

**Current cost**: Each viewport calls `renderer.render(scene, camera)` which re-processes the entire scene graph.

**Optimizations**:
1. **Frustum culling per viewport**: Three.js does this automatically, but the scene graph traversal itself is costly. Pre-cull entities that are behind the surface relative to ALL viewports.
2. **Share depth-opacity computation**: Currently the pre-render callback (multiplayer-main.ts:1005-1021) recomputes depth visibility per viewport. Since all viewports see the same enemies, compute visibility once for the "average" camera position, not per-viewport.
3. **Reduce particle count in multiplayer**: Use `ParticleSystem(2500)` instead of 5000.
4. **Disable bloom entirely in 4-player** (already done by using `SplitScreenRenderer` which skips composer).

### Network Multiplayer

- **Entity interpolation buffer**: 3 frames of buffered positions, interpolate between them. Avoids jitter.
- **Server-side enemy AI**: Only sync enemy positions, not full AI state. Reduces bandwidth.
- **Delta compression**: Only send position deltas for entities that moved (most enemies move every frame, but geoms are often stationary).
- **LOD by relevance**: Only sync detailed state for enemies near any player. Far enemies get reduced update rate (10Hz instead of 60Hz).

---

## Estimated Capacity

| Configuration | Current Estimate | After Tier 1 | After Tier 1+2 | After All |
|---|---|---|---|---|
| **Max enemies at 60fps** | ~80-120 | ~120-150 | ~500-800 | ~1500+ |
| **Max bullets at 60fps** | 200 (pool limit) | 200 | 200 | 500+ |
| **Max geoms at 60fps** | 300 (pool limit) | 300 | 500+ | 1000+ |
| **Max particles** | 5000 (good) | 5000 | 5000 | 5000 |
| **Draw calls** | ~3000-4000 | ~2800 | ~200-400 | ~50-100 |
| **Split-screen 4P enemies** | ~40-60 | ~60-80 | ~200-400 | ~500+ |

### Key Assumptions
- 1080p resolution, mid-range GPU (GTX 1060 / RX 580 class)
- 60fps target (16.6ms frame budget)
- Draw call overhead ~0.01-0.05ms per call on modern drivers
- At 3000 draw calls: ~30-150ms just in driver overhead (well above budget)

---

## Conclusion

**The bottleneck is overwhelmingly GPU draw calls**, not CPU computation. The tube-based enemy geometry system (`GeometryBuilder.ts`) creates 20+ individual meshes per enemy, causing draw call counts to explode with enemy count. This is the architectural root cause.

### Recommended Implementation Order:

1. **Eliminate per-frame allocations** (2-4 hours) -- immediate GC stutter fix
2. **Squared distance for collisions** (30 minutes) -- free performance
3. **Cache enemy material references** (1-2 hours) -- removes traverse overhead
4. **Reduce glow trail layers** (15 minutes) -- easy draw call savings
5. **InstancedMesh for enemies** (8-16 hours) -- the transformative change, 99% draw call reduction for enemies
6. **InstancedMesh for geoms** (4-6 hours) -- 99% draw call reduction for geoms
7. **Spatial hash for collisions** (4-8 hours) -- enables 500+ enemy counts
8. **Dynamic bloom quality** (1-2 hours) -- adaptive GPU load management
9. **Visual degradation system** (2-4 hours) -- graceful performance at extreme counts

After steps 1-6, the game should handle 500+ enemies at 60fps in single-player and 200+ enemies per viewport in 4-player split-screen. The total draw call count would drop from ~3000-4000 to approximately 200-300 (surface mesh, instanced enemies, instanced geoms, instanced bullets, particles, UI).

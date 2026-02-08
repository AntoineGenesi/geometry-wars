# 10K Entity Roadmap

## Current State

### Measured Performance (2026-02-09)

| Metric | Value | Source |
|--------|-------|--------|
| **Max enemies at 60fps** | ~100-120 | GPU-bound: draw calls |
| **Draw calls per enemy** | ~20 (12 cylinders + 8 spheres via GeometryBuilder.ts) | performance-optimization-report.md |
| **Total draw calls at 100 enemies** | ~3,000-4,000 | Enemies + bullets + geoms + effects + surface |
| **Per-frame CPU allocations** | **0** (eliminated from 7,444) | Tier 1 complete |
| **Collision detection** | O(n * k) via SpatialHash | SpatialHash.ts implemented |
| **Bullet pool size** | 200 (individual THREE.Line objects) | Bullet.ts |
| **Geom pool size** | 300 (each = THREE.Group with 2 Lines) | Geom.ts |
| **Particle system** | 5,000 GPU points + 400 fragment meshes | ParticleSystem.ts |
| **Post-processing** | 4 passes (render + bloom + vignette + output) | Game.ts |
| **Split-screen** | 2-4 viewports, N full scene renders, no bloom | SplitScreenRenderer.ts |
| **Network server tick** | 60 Hz, MAX_ENEMIES = 50 | server/rooms/GameRoom.ts |

### Already Completed

1. **Per-frame allocation elimination**: 7,444 -> 0 objects/frame (BaseEnemy, Bullet, Geom, Surface, GlowTrail, ParticleSystem, depth-opacity loop)
2. **Squared distance for collisions**: Eliminated sqrt from all distance checks
3. **Cached enemy material references**: No more per-frame mesh.traverse()
4. **SpatialHash for collisions**: O(n*k) broad-phase, cell size 2.5 units

### In Progress / Planned (GitHub Issues)

- **#66**: InstancedMesh for enemies
- **#67**: LOD system
- **#69**: Instanced bullets

### Primary Bottleneck

**GPU draw calls**. Each enemy built by `GeometryBuilder.ts` creates 12-30+ separate `THREE.Mesh` objects (tube segments + joint spheres), each with its own `MeshStandardMaterial`. At 100 enemies, the GPU processes ~2,000 enemy draw calls alone. The GPU target for 60fps is 500-1,000 draw calls total.

---

## Target State

| Metric | Target |
|--------|--------|
| **Active entities** | 10,000+ (enemies + bullets + geoms + particles) |
| **Frame rate** | Stable 60fps on mid-range GPU (GTX 1060 class) |
| **Draw calls** | < 100 total |
| **CPU frame budget** | < 8ms (leaves 8.6ms for GPU at 60fps) |
| **GC pauses** | Zero (already achieved) |
| **Network bandwidth** | < 50 KB/s per player at 10K entities |
| **Split-screen 4P** | 2,500+ entities at 60fps |
| **Visual quality** | Neon glow preserved, smooth animations, no pop-in |

---

## Phase 1: GPU Rendering Revolution (100 -> 1,000 entities)

**Goal**: Reduce draw calls by 95%. This is the single most impactful change.

**Estimated duration**: 2-3 weeks

### 1.1 InstancedMesh for Enemies (Issue #66)

**Current**: Each Grunt = 20 draw calls (12 `CylinderGeometry` tubes + 8 `SphereGeometry` joints). 100 Grunts = 2,000 draw calls.

**Target**: All enemies of the same visual archetype share ONE `InstancedMesh`. 100 Grunts = 1 draw call.

**Implementation steps**:

1. **Merge enemy geometry per archetype**. In `GeometryBuilder.ts`, after `buildPrismFrame()` creates the individual tube/joint meshes, use `BufferGeometryUtils.mergeGeometries()` to collapse them into a single `BufferGeometry`. Store the merged result per enemy type (diamond, octahedron, cube, pentagon, etc.). There are approximately 6-8 unique visual archetypes across the 15 enemy types.

2. **Create an EnemyInstanceManager** class (new file: `src/rendering/EnemyInstanceManager.ts`):
   - Holds one `THREE.InstancedMesh` per archetype, with a shared `MeshStandardMaterial`
   - Pre-allocates instance count to a generous maximum (e.g., 2,000 per archetype)
   - Provides `addEnemy(type, transform) -> instanceId` and `removeEnemy(instanceId)`
   - Updates `instanceMatrix` and `instanceColor` each frame from enemy position data
   - Sets `instanceMatrix.needsUpdate = true` and `instanceColor.needsUpdate = true` each frame

3. **Decouple enemy logic from enemy mesh**. Currently `BaseEnemy` owns a `this.mesh` (THREE.Group). After instancing, enemies become pure data objects (position, health, type, etc.). The `EnemyInstanceManager` handles all rendering. `BaseEnemy.applySurfaceTransform()` writes to a matrix in the instance buffer, not to a scene graph node.

4. **Per-instance color for effects**. Hit flash: set `instanceColor` to white for 80ms, then restore. Death: set instance count to hide the slot. This replaces the current `mesh.traverse()` approach.

**Draw call impact**:

| Enemy Count | Before | After | Reduction |
|-------------|--------|-------|-----------|
| 100 | 2,000 | ~8 | **99.6%** |
| 500 | 10,000 | ~8 | **99.9%** |
| 1,000 | 20,000 | ~8 | **99.96%** |

**Key files to modify**: `src/entities/enemies/BaseEnemy.ts`, `src/utils/GeometryBuilder.ts`, `src/entities/enemies/EnemySpawner.ts`, `src/main.ts`, `src/multiplayer-main.ts`

**Risk**: Enemy-specific animations (Spinner rotation, Snake segment movement, Boss pulsing) need per-instance transform updates. Some enemies may need custom vertex shaders for animated deformations that cannot be expressed as a single matrix transform.

**Mitigation**: Start with static-geometry enemies (Grunt, Wanderer, Weaver, Neutron). Animated enemies (Spinner, Snake, Boss) keep individual meshes until Phase 2 LOD can handle them as simplified impostors at distance.

### 1.2 Instanced Bullets (Issue #69)

**Current**: 200 individual `THREE.Line` objects, each with cloned geometry. 200 draw calls max.

**Target**: 1 draw call for all bullets using `THREE.InstancedBufferGeometry` or `THREE.InstancedMesh`.

**Implementation steps**:

1. Create a single `BufferGeometry` for the bullet line segment (already exists as `createBulletGeometry()` in `Bullet.ts`)
2. Create `THREE.InstancedMesh` with that geometry + `LineBasicMaterial`, instance count = pool size (increase to 500-1000)
3. Each frame, update instance matrices from the `BulletData[]` array (position + orientation)
4. Use `instanceMatrix.needsUpdate = true`
5. Set `count` to the number of active bullets (pack active bullets to front of instance array)

**Draw call impact**: 200 -> 1. Enables pool expansion to 1,000+ bullets without GPU cost.

**Key files to modify**: `src/entities/Bullet.ts`

### 1.3 Instanced Geoms

**Current**: 300 geoms, each = `THREE.Group` with 2 `THREE.Line` children. 600 draw calls max.

**Target**: 1 draw call for all geoms.

**Implementation steps**:

1. All geoms share the identical diamond shape. Perfect instancing candidate.
2. Merge the 2 lines into a single `BufferGeometry` (or use a small diamond mesh)
3. Single `InstancedMesh` with 300-1,000 capacity
4. Per-instance color for the sparkle/pulse effect via `instanceColor`
5. Spin animation: update `instanceMatrix` per frame with rotation

**Draw call impact**: 600 -> 1. Enables pool expansion to 2,000+ geoms.

**Key files to modify**: `src/entities/Geom.ts`

### 1.4 Instanced Shatter Fragments

**Current**: 400 individual fragment meshes (Triangle, Square, Diamond shapes). Up to 400 draw calls during intense combat.

**Target**: 3 draw calls (one per fragment shape).

**Implementation steps**:

1. Three `InstancedMesh` objects (one per `FragmentShape`)
2. Update instance matrices from fragment velocity/position data each frame
3. Use alpha in `instanceColor` for fade-out

**Draw call impact**: 400 -> 3

**Key files to modify**: `src/effects/ParticleSystem.ts`

### 1.5 Material Consolidation

**Current**: Each enemy mesh has its own `MeshStandardMaterial` instance. Different enemy types have different colors.

**Target**: Share materials where possible, use per-instance color for differentiation.

**Implementation steps**:

1. Create one `MeshStandardMaterial` per archetype (or even one for all enemies, using `instanceColor`)
2. Set `material.emissive` once; per-instance color handles the type-specific hue
3. Disable `material.metalness` and `material.roughness` variations (they are all 0.3/0.4 anyway)
4. Consider switching to `MeshBasicMaterial` for enemies (no PBR lighting computation, cheaper fragment shader). The bloom pass already provides the glow.

**GPU impact**: Reduces shader state changes between draw calls. When combined with instancing, the GPU processes a single shader program for all enemies.

### Phase 1 Summary

| Entity Type | Before (draw calls) | After (draw calls) |
|-------------|---------------------|---------------------|
| 500 enemies | 10,000 | ~8 |
| 500 bullets | 500 | 1 |
| 1,000 geoms | 2,000 | 1 |
| 400 fragments | 400 | 3 |
| Glow trails (20) | 80 | 20 (reduce to 1 layer) |
| Surface + grid | ~10 | ~10 |
| Particles (GPU points) | 1 | 1 |
| Post-processing | 4 | 4 |
| Score popups | ~15 | ~15 |
| **Total** | **~13,010** | **~63** |

**Estimated capacity after Phase 1**: ~1,000 enemies at 60fps in single-player.

---

## Phase 2: Distance Optimization (1K -> 5K entities)

**Goal**: Reduce per-entity GPU cost for distant/occluded entities.

**Estimated duration**: 2-3 weeks

### 2.1 LOD System (Issue #67)

Three detail levels for enemies based on distance from camera:

| LOD Level | Distance | Detail | Draw Cost |
|-----------|----------|--------|-----------|
| **LOD 0** (Full) | < 10 units | Full merged geometry, all tubes + joints | 1 instance draw |
| **LOD 1** (Reduced) | 10-25 units | Simplified geometry (half the tube segments, no joints) | 1 instance draw |
| **LOD 2** (Minimal) | > 25 units | Single colored quad/billboard | 1 instance draw |

**Implementation**:

1. Pre-generate 3 merged geometries per enemy archetype at game start
2. Maintain 3 `InstancedMesh` per archetype (one per LOD level)
3. Each frame, bucket enemies into LOD levels based on camera distance
4. Pack instance matrices for each LOD level and set `.count`
5. LOD 2 uses a single `PlaneGeometry` billboard that always faces the camera (rotate instance matrix to face camera)

**Key insight for curved surfaces**: On a sphere or torus, "distance" means geodesic distance or, more practically, the angle between the entity's surface normal and the camera direction. Entities on the far side of the surface (normal facing away from camera) are already faded by the depth-opacity system. These should use LOD 2 or be skipped entirely.

**Split-screen consideration**: Each viewport has a different camera. LOD assignment must be computed per-viewport. However, since instance buffers are shared, use the MINIMUM LOD level across all viewports (i.e., if any viewport sees an enemy up close, use LOD 0).

### 2.2 Billboard Impostors for Far Entities

For enemies on the far side of the surface (opacity < 0.3):

1. Replace 3D geometry with a single screen-facing quad
2. The quad displays a pre-rendered sprite of the enemy type (baked at startup into a texture atlas)
3. Use octahedral impostors for view-dependent appearance if needed (8x8 view angle grid)
4. Single `InstancedMesh` for all impostor quads across all types (use texture atlas UV offsets as instance attributes)

**Draw call impact**: All far-side enemies -> 1 draw call regardless of count.

**Visual impact**: Minimal. Far-side enemies are already at 10-30% opacity. A colored quad is barely distinguishable from a full mesh at that opacity.

### 2.3 Frustum Culling per Viewport

Three.js performs automatic frustum culling per mesh, but with instancing, individual instances are NOT frustum-culled automatically. Manual culling is needed:

1. Before updating instance buffers each frame, test each entity against the camera frustum
2. Only pack visible entities into the instance buffer
3. For split-screen: compute the union frustum of all viewports (or cull per-viewport if using separate instance buffers)

**Implementation**: Use `THREE.Frustum` with `camera.projectionMatrix * camera.matrixWorldInverse`. Test each entity's bounding sphere against the frustum. This is O(n) per frame, which is fast.

### 2.4 Surface-Aware Occlusion Culling

Unique to this game: entities on the far side of a 3D surface are occluded.

1. Use the dot product between entity surface normal and camera direction as a cheap occlusion test
2. If `dot(entityNormal, cameraToEntity) > 0.7`, the entity is on the back face -- skip rendering entirely (don't even add to instance buffer)
3. This culls ~40-60% of entities on a sphere, more on a torus

**Combined with LOD**: Entities with `dot > 0.3` use LOD 2 (billboard). Entities with `dot > 0.7` are culled entirely.

### Phase 2 Summary

| Scenario | Phase 1 Capacity | Phase 2 Capacity |
|----------|-------------------|-------------------|
| Sphere surface | 1,000 | 4,000+ (60% culled on back face) |
| Cube surface | 1,000 | 3,000+ (5 faces hidden) |
| Torus surface | 1,000 | 5,000+ (large hidden interior) |

**Estimated capacity after Phase 2**: ~3,000-5,000 enemies at 60fps in single-player.

---

## Phase 3: Compute Optimization (5K -> 10K entities)

**Goal**: Ensure CPU can update 10K entities within 8ms budget.

**Estimated duration**: 3-4 weeks

### 3.1 Structure of Arrays (SoA) Entity Storage

**Current** (Array of Structures):
```
enemies[i] = { position: Vector3, health: number, speed: number, type: string, ... }
```
Each enemy is a class instance with properties scattered across heap memory. Cache-unfriendly for bulk iteration.

**Target** (Structure of Arrays):
```
enemyPositionsX = Float32Array(10000)
enemyPositionsY = Float32Array(10000)
enemyPositionsZ = Float32Array(10000)
enemyHealth     = Float32Array(10000)
enemySpeed      = Float32Array(10000)
enemyType       = Uint8Array(10000)
enemyFlags      = Uint8Array(10000)  // alive, active, etc. as bitflags
```

**Benefits**:
- **Cache-friendly**: Iterating positions touches contiguous memory. At 10K enemies, position data = 120 KB (fits in L2 cache)
- **SIMD-friendly**: Future WebAssembly SIMD can process 4 floats at once
- **SharedArrayBuffer-ready**: Typed arrays can be backed by SharedArrayBuffer for worker thread access
- **Zero GC**: No object creation/destruction, just index management

**Migration path**: Create an `EntityStore` class that wraps the typed arrays. `BaseEnemy` becomes a lightweight facade that reads/writes from the store by index. Enemy behavior logic operates on indices rather than objects.

### 3.2 Update Frequency Tiers

Not all entities need 60Hz updates:

| Tier | Update Rate | Criteria | Entities |
|------|-------------|----------|----------|
| **Tier 0** (Critical) | 60 Hz | Within 5 units of any player | Enemies near player, bullets, active geoms |
| **Tier 1** (Active) | 30 Hz | Within 15 units, visible | Mid-range enemies |
| **Tier 2** (Background) | 10 Hz | > 15 units or on far side | Far enemies, distant geoms |
| **Tier 3** (Dormant) | 2 Hz | Fully occluded | Enemies completely behind the surface |

**Implementation**:
1. Each frame, assign entities to tiers based on distance to nearest player
2. Tier N entities update every `60/rate` frames, using a round-robin offset to spread the load
3. Between updates, interpolate position linearly from last two known positions

**CPU impact at 10K enemies**:
- Without tiers: 10,000 updates/frame
- With tiers (typical distribution 10%/30%/40%/20%): 1,000 + 1,500 + 667 + 67 = ~3,234 updates/frame (67% reduction)

### 3.3 WebWorker Physics/Collision Offloading

Move the expensive per-frame computations off the main thread:

**Worker thread responsibilities**:
- Spatial hash construction and queries
- Bullet-enemy collision detection
- Enemy-enemy separation
- Enemy AI steering (nearest player, flocking)
- Update frequency tier assignment

**Main thread responsibilities**:
- Rendering (instance buffer updates)
- Input processing
- Audio
- Game state management

**Communication pattern using SharedArrayBuffer**:

```
Main Thread                    Worker Thread
-----------                    -------------
Write input to SAB ----------> Read input from SAB
                               Process physics
                               Write results to SAB
Read results from SAB <------- Signal via Atomics.notify()
Update instance buffers
Render
```

**SharedArrayBuffer layout** (for 10K enemies + 1K bullets):

| Array | Type | Size | Description |
|-------|------|------|-------------|
| `enemyPosX` | Float32Array(10000) | 40 KB | X positions |
| `enemyPosY` | Float32Array(10000) | 40 KB | Y positions |
| `enemyPosZ` | Float32Array(10000) | 40 KB | Z positions |
| `enemyFlags` | Uint8Array(10000) | 10 KB | alive/active/tier |
| `enemyHealth` | Float32Array(10000) | 40 KB | Health |
| `bulletPosX` | Float32Array(1000) | 4 KB | Bullet X |
| `bulletPosY` | Float32Array(1000) | 4 KB | Bullet Y |
| `bulletPosZ` | Float32Array(1000) | 4 KB | Bullet Z |
| `collisionResults` | Int32Array(2000) | 8 KB | Hit pairs |
| `controlFlags` | Int32Array(16) | 64 B | Sync/frame counters |
| **Total** | | **~230 KB** | Fits easily in memory |

**Security headers required** (vite.config.ts):
```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

**Risk**: SharedArrayBuffer requires COOP/COEP headers. This may break loading external resources (fonts, CDN scripts) unless they set `Cross-Origin-Resource-Policy: cross-origin`.

**Mitigation**: Use a fallback mode without SharedArrayBuffer (postMessage with transferable ArrayBuffers) for environments that don't support the headers. Performance is worse (~5x slower transfer) but still viable up to ~5K entities.

### 3.4 Persistent Spatial Hash

**Current**: `SpatialHash.clear()` is called every frame, then all entities re-inserted.

**Optimization**: Track entity movement and only re-insert entities that changed cells:

1. Store each entity's current cell hash
2. On position update, compute new cell hash
3. Only remove/insert if cell changed (most enemies move slowly, staying in the same cell for multiple frames)

**Impact at 10K entities**: Reduces spatial hash operations from 10K inserts/frame to ~500-2,000 re-inserts/frame (80-95% reduction depending on movement speeds).

### Phase 3 Summary

| Optimization | CPU Time Saved | Entities Enabled |
|--------------|----------------|------------------|
| SoA storage | ~30% faster iteration | N/A (infrastructure) |
| Update tiers | ~67% fewer updates | +3,000 |
| WebWorker offload | Frees entire main thread budget | +5,000 |
| Persistent spatial hash | ~80% fewer hash ops | +2,000 |

**Estimated capacity after Phase 3**: ~10,000 enemies at 60fps in single-player.

---

## Phase 4: Multiplayer Scale

**Goal**: Support 10K entities across 4 networked players with acceptable latency and bandwidth.

**Estimated duration**: 3-4 weeks

### 4.1 Interest Management (Area of Interest)

**Current**: `GameRoom.ts` syncs ALL entities to ALL clients. At 10K entities, this is ~400 KB/tick at 60 Hz = **24 MB/s per client**. Completely unacceptable.

**Target**: Each client receives only entities relevant to their viewport.

**Implementation**:

1. **Server-side AOI grid**: Divide the surface UV space into a grid (e.g., 10x10). Each player has an "interest zone" covering their visible area (~3x3 cells around their position).

2. **Entity relevance scoring**:
   ```
   relevance = 1.0 / (1.0 + distance_to_nearest_player)
   if (entity_is_enemy && distance < attack_range): relevance = 1.0
   if (entity_is_geom && distance > magnet_range): relevance *= 0.3
   if (entity_is_bullet && not_owned_by_client): relevance *= 0.5
   ```

3. **Colyseus @filter() integration**: Apply filters on the state schema arrays to send only relevant entities per client. The existing `@filter()` decorator in Colyseus supports this, though performance at 10K entities requires the AOI grid (not per-entity distance checks).

4. **Budget-based filtering**: Each client has a bandwidth budget (e.g., 50 KB/s). Fill the budget with entities sorted by relevance score. Excess entities are not sent.

**Bandwidth reduction**:

| Entity Count | Without AOI | With AOI (3x3 cells) | Reduction |
|--------------|-------------|----------------------|-----------|
| 1,000 | 2.4 MB/s | ~600 KB/s | 75% |
| 5,000 | 12 MB/s | ~800 KB/s | 93% |
| 10,000 | 24 MB/s | ~1 MB/s | 96% |

### 4.2 Delta Compression

**Current**: Colyseus schema syncs full state changes.

**Optimization**:

1. **Position quantization**: Encode UV coordinates as `uint16` (0-65535 maps to 0.0-1.0). Reduces position data from 8 bytes (2 floats) to 4 bytes (2 uint16). Precision: 1/65535 = 0.0015% of surface.

2. **Delta encoding**: Only send position changes. Most enemies move slowly, so deltas fit in `int8` (-128 to 127) most frames. 2 bytes per entity per tick instead of 4.

3. **Dead reckoning**: For bullets (constant velocity), send only spawn events (origin + direction + speed). Clients simulate bullet flight locally. No per-frame bullet position sync needed.

4. **Enemy AI determinism**: If enemy AI is deterministic (same inputs produce same outputs), sync only the random seed + player positions. Clients run AI locally. Server validates.

**Bandwidth with delta compression + dead reckoning**:

| Component | Per-tick bytes | At 60 Hz |
|-----------|---------------|----------|
| Player positions (4 players) | 32 | 1.9 KB/s |
| Enemy position deltas (100 visible) | 200 | 12 KB/s |
| Bullet spawn events (~10/sec) | 200 | 0.2 KB/s |
| Enemy spawn/death events | ~50 | 3 KB/s |
| Score/multiplier updates | ~20 | 1.2 KB/s |
| **Total per client** | | **~18 KB/s** |

### 4.3 Server-Side LOD

Not all entities need full server-side simulation:

| Tier | Server Logic | Sync Rate |
|------|-------------|-----------|
| Near any player (< 0.1 UV) | Full AI + collision | 60 Hz |
| Mid-range (0.1 - 0.3 UV) | Simplified AI (move toward player only) | 20 Hz |
| Far (> 0.3 UV) | Dormant (no AI, just position stored) | 5 Hz |

**Server CPU impact**: At 10K enemies, only ~1,000-2,000 run full AI per tick. Server CPU budget drops from 10K to ~2K enemy updates per tick.

**Key file to modify**: `server/rooms/GameRoom.ts` -- the current `updateEnemies()` iterates all enemies every tick with `this.state.enemies.forEach()`. Add tier-based update gating.

### 4.4 Bullet Prediction (Spawn Events, Not Positions)

**Current**: Server creates `BulletState` objects in `this.state.bullets` array and syncs positions every tick.

**Target**: Server broadcasts bullet spawn events (origin, direction, speed, owner). Clients simulate bullet flight locally. Server performs authoritative collision detection and broadcasts hit/kill events.

**Protocol**:
```
Server -> Client: { type: 'bullet_spawn', id, origin, dir, speed, owner }
Server -> Client: { type: 'bullet_hit', bulletId, enemyId, damage }
Server -> Client: { type: 'bullet_despawn', bulletId }
```

**Benefits**:
- Eliminates per-bullet per-tick sync (major bandwidth savings)
- Client sees bullet instantly (no network latency on own bullets)
- Server remains authoritative on collision outcomes

### 4.5 Server Tick Rate Optimization

**Current**: `GameRoom` runs at 60 Hz (`setInterval(() => this.tick(), 1000 / TICK_RATE)`).

**Optimization**: Reduce server tick rate to 20 Hz for state sync, keep 60 Hz for collision detection only:

1. Collision detection runs at 60 Hz (accuracy matters)
2. State serialization + network send runs at 20 Hz (reduces bandwidth 3x)
3. Clients interpolate between state snapshots at 60 Hz using client-side prediction

### Phase 4 Summary

| Optimization | Bandwidth Saved | Server CPU Saved |
|--------------|-----------------|------------------|
| AOI filtering | 75-96% | N/A |
| Delta compression | 60% | N/A |
| Bullet prediction | 90% of bullet traffic | N/A |
| Server-side LOD | N/A | 70-80% |
| Reduced sync rate | 67% | 67% serialize cost |

**Estimated network capacity**: 10K entities with 4 players at < 50 KB/s per client.

---

## Phase 5: Adaptive Quality System

**Goal**: Automatically maintain 60fps by degrading visual quality gracefully.

**Estimated duration**: 1-2 weeks

### 5.1 FPS Monitor

```typescript
class QualityManager {
  private fpsHistory: number[] = []; // last 60 frames
  private qualityLevel: number = 0;  // 0 = max quality, higher = more degraded

  update(dt: number): void {
    const fps = 1 / dt;
    this.fpsHistory.push(fps);
    if (this.fpsHistory.length > 60) this.fpsHistory.shift();

    const avgFps = this.fpsHistory.reduce((a, b) => a + b) / this.fpsHistory.length;

    if (avgFps < 50 && this.qualityLevel < MAX_LEVEL) {
      this.qualityLevel++;
      this.applyLevel(this.qualityLevel);
    } else if (avgFps > 58 && this.qualityLevel > 0) {
      this.qualityLevel--;
      this.applyLevel(this.qualityLevel);
    }
  }
}
```

### 5.2 Graceful Degradation Order

Ordered from least noticeable to most noticeable:

| Level | Trigger | Action | Visual Impact |
|-------|---------|--------|---------------|
| 0 | Default | Full quality | None |
| 1 | < 55 fps | Disable enemy glow trails | Negligible |
| 2 | < 50 fps | Bloom at half resolution (`bloomPass.resolution.set(w/2, h/2)`) | Barely visible |
| 3 | < 45 fps | Reduce particle count by 50% (20 fragments on death instead of 40) | Minor |
| 4 | < 40 fps | Disable grid deformation (skip `surface.applyForce()`) | Moderate |
| 5 | < 35 fps | Disable bloom entirely | Noticeable (neon glow gone) |
| 6 | < 30 fps | Disable score popups, reduce geom pool to 200 | Moderate |
| 7 | < 25 fps | Cap bullet pool at 100, reduce enemy LOD distances | Gameplay feel changes |
| 8 | < 20 fps | Disable all effects, billboard all enemies | Significant visual change |

### 5.3 Recovery with Hysteresis

- Degrade at threshold - 5 fps (aggressive response)
- Recover at threshold + 3 fps (conservative recovery)
- Wait 2 seconds between quality changes (avoid thrashing)
- Never recover more than 1 level at a time

### 5.4 Split-Screen Quality Scaling

Split-screen has inherently higher GPU cost (N renders per frame). Apply automatic quality offsets:

| Player Count | Quality Offset | Effect |
|--------------|---------------|--------|
| 1 (single) | 0 | Full quality |
| 2 (split) | +1 | Trails disabled by default |
| 3 (split) | +2 | Trails + bloom half-res |
| 4 (split) | +3 | Trails + bloom half-res + fewer particles |

---

## Phase 6: Advanced Techniques (10K -> 50K if needed)

**Goal**: Push beyond 10K using GPU compute and streaming.

**Estimated duration**: 4-6 weeks (only if needed)

### 6.1 GPU Compute via Transform Feedback (WebGL2)

Move enemy position updates to the GPU using WebGL2 transform feedback:

1. Store enemy positions + velocities in a `Float32Array` texture (RGBA32F, 100x100 = 10K enemies)
2. Vertex shader reads current position + velocity, computes new position
3. Transform feedback writes the result to a second buffer (ping-pong)
4. InstancedMesh reads position data directly from the GPU buffer (no CPU readback)

**Benefits**: Enemy position update becomes purely GPU-side. CPU only needs to update high-level steering targets (player positions, spawn/despawn events).

**Limitation**: WebGL2 transform feedback does not support random writes (needed for spatial hash). Collision detection must remain on CPU or use WebGPU compute.

### 6.2 WebGPU Compute Shaders (Future)

As of late 2025, WebGPU is supported in Chrome, Firefox, Safari, and Edge. WebGPU compute shaders enable:

- 1,000,000+ particle simulations at 60fps
- GPU-side spatial hashing (compute shader writes to hash table texture)
- GPU-side collision detection (parallel broad-phase + narrow-phase)
- GPU-side AI steering (boids, flocking, pathfinding on surfaces)

**Implementation path**: Three.js r170+ has experimental WebGPU support via `THREE.WebGPURenderer`. This is a longer-term migration but would unlock 50K-100K entities.

**Risk**: WebGPU API is still evolving. Three.js WebGPU renderer has feature gaps. Safari support may be incomplete.

### 6.3 Entity Streaming

For truly massive entity counts (50K+), only entities within a certain range of any player are fully instantiated:

1. **Streaming radius**: Entities within 30 units of a player are "live" (full simulation + rendering)
2. **Proxy radius**: Entities 30-60 units away are "proxy" (simplified simulation, billboard rendering)
3. **Virtual entities**: Beyond 60 units, entities exist only as data (no GPU resources). They are instantiated when a player approaches.

**Surface-specific**: On a sphere of radius 8, the geodesic distance from one pole to the other is ~25 units. This means the entire surface fits within the streaming radius. Streaming is more relevant for:
- Large custom meshes (imported OBJ/GLB)
- Multiple surfaces (future multi-arena feature)
- Torus/peanut surfaces where the far side is geodesically distant

### 6.4 Proxy Entity Groups

When 50+ enemies cluster together at a distance:

1. Replace the cluster with a single "swarm proxy" -- a larger billboard showing the approximate group
2. The proxy pulsates based on the number of entities it represents
3. When a player approaches, the proxy dissolves into individual enemies
4. Reduces both draw calls and CPU updates for distant groups

---

## Implementation Order (Priority-Ordered Gantt)

```
Week 1-2:   [==== Phase 1.1: InstancedMesh Enemies ====]
Week 2:         [== Phase 1.2: Instanced Bullets ==]
Week 2-3:       [== Phase 1.3: Instanced Geoms ==]
Week 3:             [= Phase 1.4: Instanced Fragments =]
Week 3:             [= Phase 1.5: Material Consolidation =]
                    === MILESTONE: 1,000 entities at 60fps ===
Week 4:         [=== Phase 2.1: LOD System ===]
Week 4-5:       [=== Phase 2.2: Billboard Impostors ===]
Week 5:             [== Phase 2.3: Frustum Culling ==]
Week 5:             [== Phase 2.4: Surface Occlusion ==]
                    === MILESTONE: 5,000 entities at 60fps ===
Week 6:         [=== Phase 3.1: SoA Entity Storage ===]
Week 6-7:       [=== Phase 3.2: Update Frequency Tiers ===]
Week 7-9:       [====== Phase 3.3: WebWorker Offload ======]
Week 9:             [= Phase 3.4: Persistent Spatial Hash =]
                    === MILESTONE: 10,000 entities at 60fps ===
Week 10-11:     [==== Phase 4.1: Interest Management ====]
Week 11-12:     [=== Phase 4.2: Delta Compression ===]
Week 12:            [== Phase 4.3: Server-Side LOD ==]
Week 12-13:     [=== Phase 4.4: Bullet Prediction ===]
                    === MILESTONE: 10K entities, 4-player network ===
Week 13-14:     [=== Phase 5: Adaptive Quality ===]
                    === MILESTONE: Stable across hardware tiers ===
Week 15+:       [Phase 6 -- only if 10K is not enough]
```

**Critical path**: Phase 1 (instancing) is the gating factor. Everything else builds on top of it.

**Dependencies**:
- Phase 2 (LOD) depends on Phase 1 (instancing) -- LOD swaps between instance pools
- Phase 3 (SoA) depends on Phase 1 -- SoA arrays feed instance buffers
- Phase 3.3 (WebWorker) depends on Phase 3.1 (SoA) -- SharedArrayBuffer needs typed arrays
- Phase 4 depends on Phases 1-3 working -- server optimizations assume client can render locally
- Phase 5 depends on Phase 1 -- quality levels toggle instancing features

---

## Risk Assessment

### Phase 1 Risks

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| Animated enemies (Spinner, Snake, Boss) break with instancing | HIGH | HIGH | Keep animated enemies as individual meshes initially. Only 3-4 types need animation. At < 50 animated enemies, the draw call cost is tolerable. |
| Hit flash effect looks different with instanceColor | MEDIUM | MEDIUM | Test early. If instanceColor is too uniform, use a custom shader with per-instance emissive intensity. |
| Merged geometry looks different from tube segments | LOW | LOW | Visual difference is minimal. Tubes + joints merge into a single mesh that looks identical when rendered. |
| InstancedMesh raycasting breaks | LOW | HIGH | Raycasting is not used for enemies (collision uses spatial hash). If needed later, use `InstancedMesh.computeBoundingBox()` per instance. |

### Phase 2 Risks

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| LOD pop-in visible on curved surfaces | MEDIUM | MEDIUM | Use smooth alpha blending between LOD levels (cross-fade over 0.3 seconds). |
| Billboard impostors break depth-based opacity | MEDIUM | LOW | Billboards already face the camera. Apply the same opacity calculation. |
| Per-viewport LOD is too expensive in 4P split | HIGH | MEDIUM | Use a single LOD assignment (maximum quality across viewports) and accept that some viewports show higher-than-needed detail. |

### Phase 3 Risks

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| SharedArrayBuffer COOP/COEP breaks resource loading | HIGH | HIGH | Test immediately. Add `crossorigin` attributes to all external resource loads. Fall back to postMessage + transferable if headers cause issues. |
| SoA migration breaks all enemy subclass behavior | HIGH | MEDIUM | Migrate incrementally. Keep BaseEnemy class as a facade. Run both systems in parallel during transition with diff-checking. |
| Worker thread sync latency causes visible desync | MEDIUM | MEDIUM | Double-buffer: worker writes to buffer B while main thread reads buffer A. Swap each frame. Adds 1 frame of latency, which is unnoticeable at 60fps. |
| Update tiers cause visible "low-framerate" enemies | MEDIUM | HIGH | Interpolate between tick positions. At 10Hz (Tier 2), interpolation across 6 frames is smooth enough if velocity is available. |

### Phase 4 Risks

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| Colyseus @filter() performance at 10K entities | HIGH | HIGH | Implement AOI grid server-side, not per-entity filters. Pre-compute relevance sets each tick and use ArraySchema slicing. |
| Client-side bullet prediction desyncs from server | MEDIUM | MEDIUM | Server sends correction events. Client reconciles within 2 frames. Visual desync is < 1 bullet-length. |
| Deterministic AI fails across different JS engines | HIGH | MEDIUM | Use fixed-point math for AI steering. Avoid floating-point operations that differ between V8 (client) and Node (server). |

---

## Estimated Capacity at Each Phase

| Phase | Single Player | 2P Split | 4P Split | Network 4P |
|-------|--------------|----------|----------|------------|
| **Current** | 100-120 | 50-70 | 30-50 | 50 (server MAX) |
| **Phase 1** (Instancing) | 1,000 | 600 | 350 | 50 (server unchanged) |
| **Phase 2** (LOD + Culling) | 3,000-5,000 | 2,000-3,000 | 1,000-1,500 | 50 (server unchanged) |
| **Phase 3** (Compute) | 8,000-10,000 | 5,000-7,000 | 3,000-4,000 | 50 (server unchanged) |
| **Phase 4** (Network) | 10,000+ | 7,000+ | 4,000+ | 5,000-10,000 |
| **Phase 5** (Adaptive) | 10,000+ stable | 7,000+ stable | 5,000+ stable | 10,000+ stable |
| **Phase 6** (GPU Compute) | 50,000+ | 30,000+ | 15,000+ | 10,000+ |

**Notes on split-screen scaling**:
- 2P split = ~60% of single-player capacity (2 renders, but bloom is disabled)
- 4P split = ~35% of single-player capacity (4 renders, smaller viewport = fewer pixels)
- Network 4P = similar to single-player per client (each client renders their own viewport)

---

## Benchmark Validation Plan

At each phase completion, run the following benchmarks:

1. **Entity count sweep**: Spawn 100, 500, 1K, 2K, 5K, 10K enemies. Measure average FPS over 10 seconds.
2. **Draw call count**: Log `renderer.info.render.calls` at each entity count.
3. **CPU frame time**: Measure `performance.now()` delta between `requestAnimationFrame` callbacks.
4. **GC pressure**: Use Chrome DevTools Memory timeline. Verify no sawtooth pattern.
5. **Network bandwidth**: Use Colyseus `room.state.$changes` monitoring + Chrome Network tab.
6. **Visual quality**: Screenshot at each LOD transition distance. Compare against full-quality reference.

**Automated benchmark script**: Create `src/test/performance-benchmark.ts` that runs the entity count sweep headlessly (Puppeteer + SwiftShader) and outputs a CSV of fps vs. entity count.

---

## Key Files Reference

| File | Role in Optimization |
|------|---------------------|
| `src/utils/GeometryBuilder.ts` | Merge geometries per archetype (Phase 1.1) |
| `src/entities/enemies/BaseEnemy.ts` | Decouple from mesh, add SoA storage (Phases 1.1, 3.1) |
| `src/entities/enemies/EnemySpawner.ts` | Manage instance pools, LOD assignment (Phases 1.1, 2.1) |
| `src/entities/Bullet.ts` | Convert to InstancedMesh (Phase 1.2) |
| `src/entities/Geom.ts` | Convert to InstancedMesh (Phase 1.3) |
| `src/effects/ParticleSystem.ts` | Instance fragments (Phase 1.4) |
| `src/core/Game.ts` | Bloom quality control, renderer info logging (Phase 5) |
| `src/core/SpatialHash.ts` | Add persistence optimization (Phase 3.4) |
| `src/rendering/SplitScreenRenderer.ts` | Per-viewport culling (Phase 2.3) |
| `src/main.ts` | Integrate QualityManager, LOD updates (Phases 2, 5) |
| `src/multiplayer-main.ts` | Split-screen quality offsets (Phase 5.4) |
| `server/rooms/GameRoom.ts` | AOI, delta compression, tick rate (Phase 4) |
| `server/schema/GameState.ts` | Quantized state, filtered arrays (Phase 4) |

---

## Research Sources

- [Three.js InstancedMesh documentation](https://threejs.org/docs/pages/InstancedMesh.html)
- [Three.js InstancedMesh performance optimizations](https://vrmeup.com/devlog/devlog_10_threejs_instancedmesh_performance_optimizations.html)
- [100 Three.js Best Practices (2026)](https://www.utsubo.com/blog/threejs-best-practices-100-tips)
- [Three.js Instances rendering guide (Codrops)](https://tympanus.net/codrops/2025/07/10/three-js-instances-rendering-multiple-objects-simultaneously/)
- [Web Workers + SharedArrayBuffer for parallel computing](https://medium.com/@maximdevtool/web-workers-sharedarraybuffer-parallel-computing-for-heavy-algorithms-in-frontend-662391ae0558)
- [Running JS physics in a WebWorker](https://dev.to/jerzakm/running-js-physics-in-a-webworker-part-1-proof-of-concept-ibj)
- [GPU-Accelerated Particles with WebGL 2](https://gpfault.net/posts/webgl2-particles.txt.html)
- [WebGL 2 Compute via Transform Feedback](https://gist.github.com/CodyJasonBennett/34c36b91719171c45ec50e850dc38a34)
- [WebGPU Particle Life simulation](https://lisyarus.github.io/blog/posts/particle-life-simulation-in-browser-using-webgpu.html)
- [WebGPU: Simulating 1M particles in the browser](https://markaicode.com/webgpu-physics-simulation-1m-particles/)
- [Overwatch Gameplay Architecture and Netcode (GDC)](https://www.gdcvault.com/play/1024001/-Overwatch-Gameplay-Architecture-and)
- [Game Networking Resources](https://github.com/miwarnec/Game-Networking-Resources)
- [Colyseus Area of Interest discussion](https://discuss.colyseus.io/topic/45/is-there-any-way-to-implement-area-of-interest)
- [Colyseus Schema 3.0 roadmap (filtering/LOD)](https://github.com/colyseus/colyseus/issues/709)
- [Billboard impostor techniques](https://80.lv/articles/inside-game-development-using-impostors)
- [Octahedral impostors (GPU Gems)](https://developer.nvidia.com/gpugems/gpugems3/part-iv-image-effects/chapter-21-true-impostors)
- [Agar.io architecture](https://github.com/huytd/agar.io-clone/wiki/Game-Architecture)
- [BatchedMesh proposal (Three.js)](https://github.com/mrdoob/three.js/issues/22376)
- [Scaling performance (React Three Fiber)](https://r3f.docs.pmnd.rs/advanced/scaling-performance)
- [Game Optimization Complete Performance Guide 2025](https://generalistprogrammer.com/tutorials/game-optimization-complete-performance-guide-2025)

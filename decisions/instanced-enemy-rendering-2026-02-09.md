## 2026-02-09 - GPU Instanced Rendering for Enemies

**Context:** At 100 enemies on screen, each enemy's ~20 child meshes (tubes + joints from GeometryBuilder) produced ~2000 GPU draw calls, causing frame drops on mid-range GPUs.

**Options Considered:**
1. **InstancedMesh per enemy type** - Merge child geometries, one draw call per type. Pros: massive draw call reduction (~2000 -> ~15), standard Three.js approach. Cons: per-instance visual effects need workaround (opacity, hit flash).
2. **BatchedMesh (Three.js r159+)** - More flexible dynamic batching. Pros: supports per-instance materials. Cons: newer API, less battle-tested, more complex.
3. **Geometry merge into single mesh** - One giant merged mesh for all enemies. Pros: 1 draw call. Cons: can't easily remove/add instances, all enemies share one material.

**Decision:** Option 1 - InstancedMesh per enemy type.

**Reasoning:**
- InstancedMesh is the standard, well-tested Three.js approach
- 10 instanceable enemy types = 10 batches = 10 draw calls (vs ~2000)
- Complex enemies (Snake, Boss, Repulsor, Gate, Spawner, Painter, GravityWell, Titans, Giants) excluded - they have multi-part meshes with independent sub-animations that can't be merged. These are rare enough (usually <10 on screen) that individual rendering is fine.
- Per-instance color handles hit flash and depth-opacity fading
- Individual mesh kept (hidden) for collision bounds and behavior updates

**Instanceable types (10):** Grunt, Duck, Mayfly, Rocket, Neutron, Weaver, Wanderer, SpinnerSpawn, Spinner, Virus

**Non-instanceable types (remaining):** Snake, Repulsor, GravityWell, Gate, Spawner, Painter, Boss (all variants), TitanGrunt, TitanSpinner, TitanWeaver, GiantWanderer, GiantRocket, GiantSnake, GiantNeutron

**Key technical details:**
- `mergeGeometries()` from Three.js utils to merge all child tube+joint meshes
- `InstancedMesh.setMatrixAt()` per frame from enemy mesh worldMatrix
- `instanceColor` for hit flash (white tint) and depth-opacity (brightness modulation)
- `isMaterializing` flag replaces `mesh.visible` check for spawn-warning state detection
- Instance slots recycled on enemy death

**Reversibility:** Easy - set `enemySpawner.setInstanceManager(null)` or remove the call. Individual mesh rendering is the fallback.

**Draw call estimate:**
- Before: ~20 draw calls per enemy x 100 enemies = ~2000 draw calls
- After: 10 batches (instanceable types) + ~20 individual (complex types at ~5 on screen) = ~30 draw calls
- Net reduction: ~98.5%

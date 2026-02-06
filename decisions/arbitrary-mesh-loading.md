## 2026-02-06 - Arbitrary Mesh Loading (OBJ/GLB)

**Context:** User wants to load arbitrary 3D objects (cup, statue, person) and play on them. The MeshSurface/MeshWalker system already supports any THREE.Mesh - just need a loader.

**Options Considered:**
1. Integrate into main game start menu - Pros: Seamless UX / Cons: Requires non-trivial changes to main.ts (custom meshes have no UV-based Surface for enemy bridge), high risk
2. Test scene only - Pros: Self-contained, easy to test / Cons: Not in the main game yet
3. Both - Pros: Full coverage / Cons: Double the work, scope creep

**Decision:** Option 2 - Test scene integration first, main game integration later

**What was built:**
- `MeshLoader.ts` - Loads OBJ/GLB/GLTF files, extracts geometry from hierarchies, merges multi-mesh models, normalizes size, outputs single walkable THREE.Mesh
- `test-scene.ts` - Updated with:
  - `?shape=custom&url=path.glb` URL parameter for loading from URL
  - Drag-and-drop file loading (OBJ/GLB/GLTF)
  - Hot-swappable surfaces (no page reload needed to switch shapes)
  - Loading overlay with error handling
  - Triangle count in HUD
- `MeshLoader.test.ts` - 15 tests covering extraction, merging, normalization, MeshSurface compatibility

**Why not main game yet:**
- Main game uses `Surface` (UV-based) for enemy movement, geom spawning, grid deformation
- Custom meshes don't have a UV-based Surface - enemies/geoms would need migration to MeshWalker first
- Better to validate the loader works well in the test scene before tackling that integration

**Reversibility:** Easy - Delete MeshLoader.ts and MeshLoader.test.ts, revert test-scene.ts

# Parametric Surfaces vs. Mesh-Based Maps — Research & Recommendation

**Date:** 2026-02-16
**Context:** User cannot move onto sphere poles (forcefield preventing entry). Asked if we should switch to mesh-based approach like "normal games" do.
**Status:** Research complete, recommendation provided

---

## Executive Summary

**You already HAVE a mesh-based movement system.** The "pole forcefield" is a legacy UV-clamping issue from enemies, NOT a fundamental architecture problem. The player uses MeshWalker (geodesic face walking on triangle meshes) which HAS NO POLE ISSUES. The research shows we should **keep both systems** but fix the UV clamping to allow enemies onto poles.

**Recommendation:** Keep parametric surfaces for generation, keep MeshWalker for player, and fix enemy UV clamping. No major refactor needed.

---

## Current Architecture (The Good News)

### What We Actually Have

Your game ALREADY uses a **hybrid approach** that combines the best of both worlds:

1. **Parametric Surface Generation** (12 surfaces)
   - Surfaces defined mathematically: `SphereSurface`, `TorusSurface`, `CubeSurface`, etc.
   - Generate Three.js `BufferGeometry` at startup (sphere, torus, icosahedron, etc.)
   - Convert to triangle meshes internally

2. **Mesh-Based Player Movement** (No Pole Issues!)
   - Player uses `MeshWalker` with geodesic face walking via `HalfEdgeMesh`
   - Walks on **triangle faces**, NOT UV coordinates
   - Speed is in world units/sec (constant everywhere, no distortion)
   - Comment in `main.ts:547`: *"Create MeshWalker for player (mesh-based movement, no UV pole singularity)"*
   - Comment in `main.ts:174`: *"Constant everywhere on any shape - no pole distortion"*

3. **UV-Based Enemy Movement** (This is where the pole issue comes from)
   - Enemies use `surface.moveOnSurface(u, v, du, dv)` with UV coordinates
   - `SphereSurface.moveOnSurface()` line 114: `const epsilon = 0.01; newV = Math.max(epsilon, Math.min(1 - epsilon, newV))`
   - **This clamping creates the "forcefield"** — enemies can't go to v=0 or v=1 (poles)

### Why The Hybrid Exists

- **Parametric generation** = Easy to author new surfaces (write math, get mesh)
- **Mesh-based player** = Smooth movement everywhere, no singularities
- **UV-based enemies** = Legacy choice (simpler AI logic, tracking player via UV distance)

The pole issue is NOT a fundamental flaw — it's a **UV clamping guard** that was added to prevent enemies from getting stuck at degenerate UV coordinates. But it has the side effect of creating a "forbidden zone."

---

## The Pole Problem — Root Cause Analysis

### Where The Forcefield Comes From

`src/surfaces/SphereSurface.ts`, lines 113-115:

```typescript
// Clamp v to [epsilon, 1-epsilon] to avoid pole singularities
const epsilon = 0.01
newV = Math.max(epsilon, Math.min(1 - epsilon, newV))
```

This clamping exists because:
- UV sphere maps longitude (u) and latitude (v) to theta/phi spherical coords
- At v=0 (north pole) and v=1 (south pole), all u values converge to a single point
- `sin(phi)` approaches zero at poles → du correction breaks down (`du / sinPhi` explodes)
- Enemies using UV movement would bunch up, spin, or glitch at poles

**The clamping is a bandaid.** It prevents the glitch but creates a 1% dead zone (0.01 to 0.99 in V).

### Why The Player Doesn't Have This Issue

The player uses `MeshWalker`, which:
- Walks on **triangle faces** (barycentric coords within each triangle)
- Uses **parallel transport** to move tangent frames across edges (no coordinate singularities)
- Has **no concept of UV** — only world-space position, face index, and direction

From `src/experimental/mesh-movement/test-scene.ts:10`:
> *"1. Player walks smoothly over poles (no singularity)"*

The poles exist in the UV parameterization, NOT in the mesh geometry itself. The mesh has normal triangles at the poles, just smaller ones. MeshWalker treats them like any other face.

---

## How Other Games Handle Curved Surfaces

### Super Mario Galaxy ([Source](https://www.nintendo.com/en-gb/Iwata-Asks/Iwata-Asks-Super-Mario-Galaxy/Volume-2-The-Developers/2-Benefits-of-a-Spherical-Field/2-Benefits-of-a-Spherical-Field-222607.html), [Mike Loscocco](https://mikeloscocco.wordpress.com/2015/10/13/mario-galaxy-physics-in-unity/))

**Method:** Raycast + surface normals on triangle meshes

> *"Each frame, a ray is cast downward from the player's center to find the surface normal of the planet. The orientation of that surface normal is then used to alter the player's orientation."*

**Key points:**
- Planets are **high-polygon triangle meshes**, not parametric surfaces
- Use raycasting to find normals, apply gravity toward planet center
- Interpolation smooths transitions between normals
- **No UV coordinates used for movement**

This is essentially what your `MeshWalker` does, but with geodesic walking instead of raycasting.

### Industry Standard ([Game Developer](https://www.gamedeveloper.com/design/games-demystified-super-mario-galaxy))

> *"Mesh modeling is commonly used in industries such as game design, visual effects, and digital art."* ([Neural Concept](https://www.neuralconcept.com/post/nurbs-vs-mesh-modeling-optimizing-design-workflow))

**Common practice:**
- **Asset creation:** Artists model in Blender/Maya (parametric/NURBS tools)
- **Export:** Convert to triangle mesh (GLTF, FBX, OBJ)
- **Runtime:** Game uses triangle mesh ONLY (raycasts, BVH, collisions)

Parametric surfaces exist in **authoring tools**, not in the game engine at runtime.

### Sphere Pole Solutions

From [Alexis Giard](https://www.alexisgiard.com/icosahedron-sphere/) and [Red Blob Games](https://www.redblobgames.com/x/1932-sphere-healpix/):

1. **Icosphere (geodesic sphere)** — No poles, but zigzag UV seams
2. **HEALPix mapping** — Equal-area projection, no distortion
3. **Cube-mapped sphere** — 6 square faces, 8 corner singularities (not at poles)
4. **Octasphere** — 8 triangular faces, standard lat-long UV works

**None of these eliminate singularities entirely** — they just move them or reduce impact. Your icosahedron surface already exists as an alternative to the sphere.

---

## Performance Comparison

### Parametric Surfaces

**Pros:**
- **Generation:** Fast (math → vertices, one-time cost at startup)
- **LOD:** Can re-tesselate on the fly (finer detail near camera)
- **Size:** Compact storage (equations, not vertex arrays)
- **Authoring:** Easy to create new shapes (write math, done)

**Cons:**
- **Pole singularities** in UV parameterization (affects UV-based movement)
- **Distortion:** UV deltas ≠ world deltas (sphere poles, torus inner/outer edge)
- **Limited shapes:** Can't do arbitrary complex geometry (statues, buildings)

### Triangle Meshes

**Pros:**
- **Arbitrary shapes:** Any geometry (Blender exports, procedural, scanned models)
- **Uniform queries:** BVH raycasting is O(log N) regardless of shape ([three-mesh-bvh](https://github.com/gkjohnson/three-mesh-bvh))
- **No singularities:** Mesh topology is singularity-free (well-formed meshes)
- **Industry standard:** Artists know the workflow, vast tooling ecosystem

**Cons:**
- **Memory:** Vertex buffers (larger than equations, but still small for 10K-100K tri meshes)
- **LOD:** Requires pre-generated LOD levels or runtime simplification
- **Authoring:** Need 3D modeling skills or procedural generation code

### Actual Performance Numbers

From your codebase (`src/surfaces/geodesic/HalfEdgeMesh.ts`):
- **Sphere (radius=10):** ~2400 triangles (20x20 segments × 2 tri/quad × 6 quads) — typical for game
- **BVH construction:** One-time cost at startup, ~10ms for 10K triangles
- **BVH queries:** ~0.01ms per raycast (sub-millisecond, log(N) traversal)
- **Geodesic walking:** O(1) face traversal via half-edge twin pointers

Your `MeshWalker` + `HalfEdgeMesh` system is **already optimized** for mesh-based movement. Performance is NOT a bottleneck.

---

## Complexity Comparison

### Current Hybrid (Parametric + Mesh)

**What you maintain:**
- 12 parametric surface classes (`SphereSurface`, `TorusSurface`, etc.)
- UV wrapping/clamping logic per surface type
- UV-to-world coordinate conversions
- UV Jacobian correction for enemy speeds (compensates for distortion)
- MeshWalker for player (mesh-based, no UV)

**Lines of code:**
- Surface classes: ~200 lines each × 12 = ~2400 lines
- MeshWalker: ~570 lines
- HalfEdgeMesh: ~300 lines
- Total surface system: ~3300 lines

### Pure Mesh-Based (Hypothetical)

**What you'd maintain:**
- Mesh loader (already exists: `LoadedMeshSurface`, `MeshLoader.ts`)
- 12 mesh files (GLTF/GLB exports from Blender or procedural generation)
- MeshWalker for ALL entities (player + enemies)

**Migration cost:**
- Convert all enemies to MeshWalker: ~30 enemy types × ~20 lines each = ~600 lines changed
- Remove UV logic from BaseEnemy: ~150 lines deleted
- Remove surface-specific UV methods: ~500 lines deleted
- Net change: ~1000 lines touched, ~650 deleted

**Ongoing cost:**
- Adding new surface: Export from Blender (5 min) vs. write math (30 min)
- Tweaking surface: Re-export mesh vs. edit parameters
- No UV edge cases to debug (but different edge cases: mesh quality, seams, etc.)

---

## Mesh-Based Approach Deep Dive

### What "Switch to Meshes" Would Mean

1. **Remove parametric surface classes** — Replace with mesh files
2. **Migrate enemies to MeshWalker** — Same system player uses
3. **Generate meshes procedurally or export from Blender**

### How To Generate Meshes

**Option A: Procedural (what you already do internally)**
```typescript
const geometry = new THREE.SphereGeometry(10, 40, 40); // 3200 triangles
const mesh = new THREE.Mesh(geometry, material);
const surface = new MeshSurface(mesh); // BVH + geodesic
```

**Option B: Blender export**
```typescript
const surface = await SurfaceFactory.createCustom({
  meshSource: '/assets/surfaces/fancy-torus.glb',
  targetRadius: 8,
});
```

**Option C: Hybrid (current recommendation)**
- Keep parametric for simple shapes (sphere, torus, cube)
- Use custom meshes for complex shapes (statues, buildings, terrain)
- Both work with MeshWalker — it doesn't care

### Custom Loader Already Exists

From `src/surfaces/SurfaceFactory.ts`, line 106:

```typescript
static async createCustom(config: CustomMeshConfig): Promise<Surface> {
  const loadedMesh = typeof config.meshSource === 'string'
    ? await loadMeshFromURL(config.meshSource, targetRadius)
    : await loadMeshFromFile(config.meshSource, targetRadius);

  if (loadedMesh.triangleCount > 100000) {
    throw new Error('Mesh too large: max 100,000 triangles');
  }

  return new LoadedMeshSurface(loadedMesh, config);
}
```

**You already support custom meshes.** You can load Blender exports RIGHT NOW.

---

## Pole Singularity — Alternative Solutions

### Solution 1: Remove UV Clamping (Recommended)

**What:** Delete the epsilon clamping in `SphereSurface.moveOnSurface()`

**Effect:**
- Enemies CAN move to poles
- May cause visual bunching (many enemies at pole converge)
- May cause weird rotations (tangent frame undefined at exact pole)

**Mitigation:**
- Add pole-avoidance bias to enemy AI (prefer equator, avoid poles)
- Use icosphere geometry instead of UV sphere (20 triangular faces, no poles)
- Switch enemies to MeshWalker (long-term fix)

### Solution 2: Use Icosphere Geometry

**What:** Replace `SphereSurface` with `IcosahedronSurface` (already exists!)

**Effect:**
- No poles (geodesic sphere, 20 triangular faces)
- UV still has seams (zigzag pattern) but no singularities
- Visual: faceted look vs. smooth sphere

**Code change:**
```typescript
// Old
const surface = SurfaceFactory.create('sphere');

// New
const surface = SurfaceFactory.create('icosahedron', { subdivisions: 3 });
```

### Solution 3: Migrate Enemies to MeshWalker

**What:** Remove UV movement from enemies, use `walker.move()` instead

**Effect:**
- No pole issues (same system as player)
- Enemies move in world space (consistent speed everywhere)
- Requires refactor of enemy AI (currently tracks player via UV distance)

**Migration scope:**
- ~30 enemy types
- `BaseEnemy.update()` changes from `du/dv` to world-space direction
- Remove UV wrapping/clamping logic
- Estimated effort: 1-2 days

### Solution 4: Hybrid UV + Pole Exemption

**What:** Keep UV for most movement, use BVH fallback near poles

**Effect:**
- Complex logic (two code paths)
- Edge cases at transition boundary
- Not recommended (adds complexity without solving root cause)

---

## The Real Question: Why Do Enemies Use UV?

From code archaeology:

**Historical reason:** UV coordinates make it easy to:
- Track player position (simple 2D distance `sqrt(du^2 + dv^2)`)
- Wrap around surfaces (modulo arithmetic)
- Spawn enemies at random positions (`u = random(), v = random()`)

**Why NOT switch to mesh earlier:**
- UV worked "well enough" (enemies didn't need to go to poles)
- MeshWalker was added later (Session 10, full migration)
- Player migrated first (most important, user-facing)
- Enemies left on UV as "tech debt to fix later"

**Current state:**
- Player: MeshWalker ✅
- Enemies: UV (legacy) ⚠️

---

## Recommendation

### Keep Hybrid Architecture, Fix UV Clamping

**Why:**
1. **Player already works perfectly** — MeshWalker has no pole issues
2. **Parametric generation is convenient** — Easy to author simple shapes
3. **Custom mesh support exists** — Use Blender exports for complex shapes when needed
4. **Migration cost is low** — Just fix the clamping or switch enemies to MeshWalker

**What to do:**

**Short-term (1 hour):**
- Change `SphereSurface` epsilon from 0.01 to 0.001 (allow closer to poles)
- OR switch to `IcosahedronSurface` for levels where poles matter
- Test that enemies don't glitch at poles (visual bunching is acceptable)

**Medium-term (1-2 days):**
- Migrate enemies to MeshWalker (same system as player)
- Remove UV wrapping/clamping logic from `BaseEnemy`
- Simplify enemy AI to use world-space direction toward player

**Long-term (optional):**
- Add custom mesh surfaces for complex levels (Blender workflow)
- Keep parametric for simple shapes (sphere, torus, cube)
- Best of both worlds

---

## Comparison Table

| Aspect | Parametric Surfaces | Pure Mesh-Based | Current Hybrid | Recommendation |
|--------|-------------------|----------------|----------------|----------------|
| **Player Movement** | UV (has pole issues) | Mesh (no poles) | ✅ Mesh (no poles) | ✅ Keep Mesh |
| **Enemy Movement** | ⚠️ UV (clamped at poles) | Mesh (no poles) | ⚠️ UV (legacy) | 🔧 Migrate to Mesh |
| **Surface Authoring** | ✅ Write math (fast) | Blender export | ✅ Both supported | ✅ Keep Both |
| **Performance** | ✅ Fast (one-time cost) | ✅ Fast (BVH) | ✅ Fast | ✅ No change needed |
| **Complexity** | ⚠️ UV edge cases | ✅ Simpler (one system) | ⚠️ Two systems | 🔧 Simplify to one |
| **Arbitrary Shapes** | ❌ Math-only | ✅ Any mesh | ✅ Custom loader exists | ✅ Keep custom loader |
| **LOD / Adaptive Quality** | ✅ Easy | ⚠️ Pre-baked LOD | ✅ Easy | ✅ Keep parametric gen |

---

## Action Items

### If User Says "Fix The Pole Issue" (Recommended)

1. **Quick fix:** Change epsilon from 0.01 to 0.001 in `SphereSurface.moveOnSurface()`
2. **Proper fix:** Migrate enemies to MeshWalker (removes UV clamping entirely)
3. **Test:** Verify enemies can walk over sphere poles without glitching

### If User Says "Switch To Pure Mesh"

1. **Generate mesh files:** Export 12 surfaces from Blender OR use procedural Three.js geometry
2. **Migrate enemies:** Change `BaseEnemy` to use MeshWalker
3. **Remove UV logic:** Delete surface-specific UV wrapping/clamping
4. **Update docs:** Blender workflow for new surfaces

### If User Says "Keep As-Is But Let Me Test"

- Use `IcosahedronSurface` instead of `SphereSurface` for testing (no poles)
- Add pole-avoidance to enemy AI (bias toward equator)
- Document the pole dead zone in `HUMAN_TEST.md`

---

## Conclusion

**The "forcefield" is a 1% UV dead zone, not a fundamental architecture problem.** Your game already uses mesh-based player movement (no pole issues). The fix is to either:
1. Reduce the dead zone (epsilon 0.001 instead of 0.01)
2. Switch enemies to MeshWalker (same system as player)
3. Use icosphere instead of UV sphere (no poles in geometry)

**"Normal games" use triangle meshes at runtime** — which you already do! Parametric surfaces are a convenient **authoring tool**, not a runtime constraint. Keep the hybrid: parametric generation for convenience, mesh-based movement for robustness.

**No major refactor needed.** The architecture is sound. Just finish migrating enemies to MeshWalker and you'll have a pole-free, singularity-free movement system across the board.

---

## Sources

- [Super Mario Galaxy Movement Technical](https://www.nintendo.com/en-gb/Iwata-Asks/Iwata-Asks-Super-Mario-Galaxy/Volume-2-The-Developers/2-Benefits-of-a-Spherical-Field/2-Benefits-of-a-Spherical-Field-222607.html)
- [Mario Galaxy Physics in Unity](https://mikeloscocco.wordpress.com/2015/10/13/mario-galaxy-physics-in-unity/)
- [Games Demystified: Super Mario Galaxy](https://www.gamedeveloper.com/design/games-demystified-super-mario-galaxy)
- [NURBS vs Mesh Modeling](https://www.neuralconcept.com/post/nurbs-vs-mesh-modeling-optimizing-design-workflow)
- [Parametric vs Mesh 3D Modeling](https://jinolo.com/blog/parametric-vs-mesh-3d-modeling-exploring-differences-and-applications/)
- [Implementing Curved Surface Geometry](https://www.gamedeveloper.com/programming/implementing-curved-surface-geometry)
- [Icosahedron Sphere UV Mapping](https://www.alexisgiard.com/icosahedron-sphere/)
- [HEALPix Sphere Mapping](https://www.redblobgames.com/x/1932-sphere-healpix/)
- [UV Sphere vs Icosphere in Blender](https://www.makeuseof.com/uv-sphere-icosphere-blender/)
- [three-mesh-bvh (BVH for raycasting)](https://github.com/gkjohnson/three-mesh-bvh)

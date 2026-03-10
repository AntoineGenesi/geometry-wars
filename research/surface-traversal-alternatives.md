# Surface Traversal Alternatives: Comprehensive Research Wiki

> **Last updated:** 2026-02-07
> **Project context:** Geometry Wars 3D Dimensions browser clone (Three.js + TypeScript + Vite)
> **Approach at time of writing (2026-02-07):** UV-based parametric surfaces + three-mesh-bvh for BVH queries
> **Current approach (as of 2026-03-10):** MeshWalker (BVH mesh-walking) for player/bullets; UV parameterization still used for enemies/geoms.
> **Known pain points:** Camera-relative input mapping, surface normal computation, direction consistency across different surface topologies

---

## Table of Contents

1. [Problem Statement](#problem-statement)
2. [Game Engines with Web Export](#1-game-engines-with-web-export)
3. [Surface Walking Libraries & Approaches](#2-surface-walking-libraries--approaches)
4. [Physics Engines with Surface Constraints](#3-physics-engines-with-surface-constraints)
5. [Existing Games & Demos That Solve This](#4-existing-games--demos-that-solve-this)
6. [Academic & Research Approaches](#5-academic--research-approaches)
7. [Hybrid Approaches](#6-hybrid-approaches)
8. [Comparison Table](#comparison-table)
9. [Recommendations](#recommendations)
10. [Appendix: Key Code Snippets](#appendix-key-code-snippets)

---

## Problem Statement

We need a system that lets entities (player, enemies, projectiles) move on the surface of arbitrary 3D shapes in a browser at 60fps. The core technical challenges are:

1. **Surface-constrained movement** -- Given a position on a mesh and a direction, compute the new position after moving some distance along the surface.
2. **Direction consistency** -- When moving from one triangle to the next, the "forward" direction must be preserved via parallel transport, not naively projected.
3. **Camera-relative input** -- Player pushes joystick "right" in screen space; this must map to a consistent tangent direction on the surface regardless of curvature.
4. **Geodesic projectiles** -- Bullets should follow shortest-path (geodesic) trajectories along the surface.
5. **Arbitrary mesh support** -- Not just parametric shapes (sphere, torus), but imported OBJ/GLB meshes.
6. **Performance** -- All of the above at 60fps with dozens of active entities.

---

## 1. Game Engines with Web Export

### 1.1 Godot 4 (Web Export)

**Overview:** Godot 4.x exports to WebAssembly + WebGL 2.0 using the "Compatibility" rendering backend. Godot 4.3 fixed the biggest single-threaded export issues, and 4.4 (2025) added further optimizations.

**Surface Walking Capability:** Godot has no built-in surface-walking system. You would implement it using GDScript/C# with raycasting (similar to Super Mario Galaxy's approach) or write a custom GDExtension in C++ using geometry-central compiled to WASM. Godot's `NavigationServer3D` supports NavMesh but only for floor-based navigation, not curved 3D surfaces.

**Limitations:**
- GLES3 renderer performance is subpar on WebGL 2.0 (targets high-end native devices)
- Safari/iOS issues with WebGL 2.0 and SharedArrayBuffer (single-threaded export fixes this but at a performance cost)
- Bundle size: ~15-30MB minimum for a 3D Godot 4 web export (compressed)
- No WebGPU support yet in web exports
- 100% CPU usage bug reported in some configurations (issue #85431)
- Apple device compatibility requires single-threaded mode

**Assessment:**

| Criterion | Rating |
|-----------|--------|
| Browser feasibility | 3/5 -- Works, but large bundles, Safari issues |
| Surface walking quality | 2/5 -- Must build from scratch |
| Geodesic projectiles | No -- Not built-in |
| Custom mesh support | 4/5 -- Good OBJ/GLB import |
| Development effort | High -- Porting entire game to new engine |
| Performance | 3/5 -- WebGL 2 overhead, no SIMD in web builds |
| Visual quality | 4/5 -- Decent post-processing pipeline |
| Community/docs | 4/5 -- Large community, good docs |

**Links:**
- [Godot Web Export Docs](https://docs.godotengine.org/en/stable/tutorials/export/exporting_for_web.html)
- [Godot 4.3 Web Export Progress](https://godotengine.org/article/progress-report-web-export-in-4-3/)

---

### 1.2 Babylon.js

**Overview:** Babylon.js is a full-featured, web-native 3D engine backed by Microsoft. It was one of the first engines to ship a working WebGPU backend and has a mature ecosystem including physics (Havok), NavMesh (Recast), GUI, XR, and advanced post-processing.

**Surface Walking Capability:** Babylon.js has no built-in surface-walking system, but it has stronger building blocks than most alternatives:
- Built-in Recast NavMesh integration (`@babylonjs/navigation`) -- but designed for floor-based navigation
- Forum discussions show people solving "move along mesh surface" using raycasts + closest point queries
- Rich math library (Vector3, Quaternion, Matrix) for implementing parallel transport
- Mesh picking and intersection are first-class features

**Key Advantage:** WebGPU support is production-ready. If you need compute shaders for geodesic distance fields or GPU-based surface queries, Babylon.js is ahead of Three.js here.

**Assessment:**

| Criterion | Rating |
|-----------|--------|
| Browser feasibility | 5/5 -- Web-native, WebGPU ready |
| Surface walking quality | 2/5 -- Must build from scratch |
| Geodesic projectiles | No -- Not built-in |
| Custom mesh support | 5/5 -- Excellent GLB/OBJ/FBX support |
| Development effort | High -- Full engine migration from Three.js |
| Performance | 5/5 -- WebGPU backend, excellent optimization |
| Visual quality | 5/5 -- PBR, bloom, advanced post-processing |
| Community/docs | 5/5 -- Excellent docs, active forums, Microsoft backing |

**Links:**
- [Babylon.js Official](https://www.babylonjs.com/)
- [Babylon.js Navigation Mesh](https://doc.babylonjs.com/features/featuresDeepDive/crowdNavigation/createNavMesh/)
- [Babylon.js vs Three.js Comparison (2025)](https://dev.to/devin-rosario/babylonjs-vs-threejs-the-360deg-technical-comparison-for-production-workloads-2fn6)

---

### 1.3 PlayCanvas

**Overview:** PlayCanvas is a web-first game engine with a cloud-based editor, built on WebGL 1/2 with WebGPU in development. It has integrated Ammo.js physics and Recast NavMesh pathfinding (via the Orestis extension).

**Surface Walking Capability:** Like Babylon.js, no built-in surface walking. The Orestis 3D Pathfinding extension uses Recast for NavMesh generation, but it is floor-based. Surface-constrained movement would need custom implementation.

**Assessment:**

| Criterion | Rating |
|-----------|--------|
| Browser feasibility | 5/5 -- Web-native |
| Surface walking quality | 1/5 -- No tools for this |
| Geodesic projectiles | No |
| Custom mesh support | 4/5 -- Good GLB support |
| Development effort | High -- Engine migration + custom surface system |
| Performance | 4/5 -- Lightweight, well-optimized |
| Visual quality | 4/5 -- Good but fewer post-processing options than Babylon |
| Community/docs | 3/5 -- Smaller community than Three.js/Babylon |

**Links:**
- [PlayCanvas Engine](https://playcanvas.com/)
- [Orestis 3D Pathfinding](https://pic.pirron-rodon.one/docs/extensions/orestis.html)

---

### 1.4 Unity WebGL

**Overview:** Unity can export to WebGL, producing a WASM build that runs in browsers. Unity 6 (2025) improved WebGL output, but fundamental issues remain.

**Surface Walking Capability:** Unity has a mature NavMesh system (NavMeshAgent, NavMeshSurface) but it is designed for floor-based AI navigation. For true surface walking, you would use custom C# code with raycasting or integrate a geodesic library. Unity's scripting environment makes this easier than raw JS.

**Critical Issues:**
- Bundle size: 20-50MB+ compressed, even for simple 3D games. Loading times are significant.
- Memory: The Unity heap in WASM is limited and hard to control. Memory leaks are common.
- Performance: Significant overhead vs. native. JS interop is slow.
- Build size increased ~20% from Unity 2021 to Unity 6.
- No WebGPU support in web builds yet.
- Licensing: Unity runtime fee concerns (though relaxed in 2024).

**Assessment:**

| Criterion | Rating |
|-----------|--------|
| Browser feasibility | 2/5 -- Large bundles, poor load times |
| Surface walking quality | 3/5 -- Good NavMesh, but still floor-based |
| Geodesic projectiles | Partial -- Could implement with Asset Store packages |
| Custom mesh support | 5/5 -- Excellent import pipeline |
| Development effort | High -- Full engine migration |
| Performance | 2/5 -- Heavy WASM overhead, no WebGPU |
| Visual quality | 4/5 -- Good URP pipeline in WebGL |
| Community/docs | 5/5 -- Massive ecosystem |

**Links:**
- [Unity Web Performance Considerations](https://docs.unity3d.com/6000.3/Documentation/Manual/webgl-performance.html)
- [Unity WebGL Build Size Discussion](https://discussions.unity.com/t/reduce-size-of-webgl-build-how/621422)

---

### 1.5 Unreal Engine (Pixel Streaming)

**Overview:** Unreal Engine does not compile to WASM/WebGL. Instead, it offers Pixel Streaming: the game runs on a remote GPU server and streams video to the browser via WebRTC. The browser sends inputs back.

**Viability for This Project:** Not viable. Pixel Streaming adds 50-150ms input latency minimum (even on local network), requires a dedicated GPU server per session, and costs $0.50-2.00/hour per concurrent user on cloud infrastructure. For a twitch-action game like Geometry Wars that needs <16ms input response, this is a non-starter.

**Assessment:**

| Criterion | Rating |
|-----------|--------|
| Browser feasibility | 1/5 -- Requires server infrastructure |
| Surface walking quality | N/A -- Engine is capable, but delivery method kills it |
| Geodesic projectiles | N/A |
| Custom mesh support | 5/5 -- Best-in-class |
| Development effort | Very High -- Server infrastructure + new engine |
| Performance | 1/5 -- Latency makes action games unplayable |
| Visual quality | 5/5 -- Best-in-class (if latency didn't matter) |
| Community/docs | 4/5 -- Large community |

---

## 2. Surface Walking Libraries & Approaches

### 2.1 three-mesh-bvh (Current Approach)

**Repo:** [github.com/gkjohnson/three-mesh-bvh](https://github.com/gkjohnson/three-mesh-bvh)

**How It Works:** Builds a Bounding Volume Hierarchy over mesh geometry for fast spatial queries. For surface walking, the typical pattern is:
1. Move entity in world space (e.g., along tangent plane)
2. Use `closestPointToPoint()` to snap back to the mesh surface
3. Use the returned face normal for orientation

**Strengths:**
- Pure JavaScript, no WASM dependency
- Very fast spatial queries (raycasting, closest point, containment)
- Well-maintained, good Three.js integration
- Works with any mesh geometry

**Weaknesses (why we're looking for alternatives):**
- **Not a surface walking system.** It is a spatial query accelerator. There is no concept of "move along surface in direction X for distance D."
- **Snap-to-surface approach loses direction.** Moving in world space then snapping to the nearest point does not follow geodesics. On high-curvature surfaces (like a small sphere), this causes entities to "skip" across the surface.
- **No parallel transport.** When you snap to a new point, you lose track of the entity's tangent-space orientation. This causes the camera-relative input mapping to fail across different surface regions.
- **No edge crossing logic.** Unlike true mesh walking (which traverses face-to-face via shared edges), snap-to-surface can jump to completely different mesh regions.

**Assessment:**

| Criterion | Rating |
|-----------|--------|
| Browser feasibility | 5/5 |
| Surface walking quality | 2/5 -- Snap-to-surface only, not true walking |
| Geodesic projectiles | No |
| Custom mesh support | 5/5 |
| Development effort | Low (already integrated) |
| Performance | 5/5 |
| Visual quality | N/A (rendering is separate) |
| Community/docs | 4/5 |

---

### 2.2 Geodesic Tracing via geometry-central (WASM)

**Repo:** [github.com/nmwsharp/geometry-central](https://github.com/nmwsharp/geometry-central)
**Key paper:** Sharp & Crane, "You Can Find Geodesic Paths in Triangle Meshes by Just Flipping Edges" (SIGGRAPH Asia 2020)

**How It Works:** geometry-central is a C++ library for computational geometry on surfaces. Its key function for us:

```cpp
TraceGeodesicResult traceGeodesic(
    IntrinsicGeometryInterface& geom,
    SurfacePoint startP,       // Starting position (face + barycentric coords)
    Vector2 traceVec,          // Direction + distance in tangent space
    const TraceOptions& opts   // Options (include path, barriers, etc.)
);
```

This computes the **exponential map**: given a starting point on a mesh, a tangent-space direction, and a distance, it returns the endpoint you would reach by walking in a straight line (geodesic) along the surface. The algorithm:
1. Starts at the given face
2. Projects the direction vector onto the face plane
3. Walks in a straight line until hitting an edge
4. Crosses the edge to the adjacent face (unfolding the faces into a common plane)
5. Continues walking in the now-unfolded straight line
6. Repeats until the desired distance is covered

The returned `TraceGeodesicResult` contains:
- `endPoint` -- Final position as a SurfacePoint
- `endingDir` -- The direction vector parallel-transported to the endpoint's tangent space
- `pathPoints` -- Full path (optional, for rendering geodesic trails)
- `hitBoundary` -- Whether the path hit a mesh boundary

**This is exactly what we need.** The `endingDir` field gives us free parallel transport -- direction consistency is maintained across the entire path.

**Browser Deployment:** Casey Primozic demonstrated that geometry-central compiles to WASM via Emscripten and runs in the browser. Performance: ~3.2 seconds for millions of traces was optimized to ~842ms (3.8x speedup) by replacing Eigen's `colPivHouseholderQr()` with direct barycentric coordinate math. For our use case (dozens of entities, one trace per entity per frame = ~100 traces/frame at 60fps = 6000 traces/second), this should be very fast.

**Challenges:**
- Requires Emscripten toolchain to build WASM module
- Need to manage memory between JS and WASM (mesh data transfer)
- Eigen library must be patched for WASM compilation (known compiler issue)
- API is C++ -- need to write a thin WebIDL or Embind wrapper for JS

**Assessment:**

| Criterion | Rating |
|-----------|--------|
| Browser feasibility | 4/5 -- Proven WASM compilation, some build complexity |
| Surface walking quality | 5/5 -- True geodesic walking with parallel transport |
| Geodesic projectiles | Yes -- Same traceGeodesic function |
| Custom mesh support | 5/5 -- Any triangle mesh |
| Development effort | Medium -- WASM build, JS wrapper, entity system rewrite |
| Performance | 4/5 -- Fast enough for game use, WASM overhead |
| Visual quality | N/A (rendering separate) |
| Community/docs | 4/5 -- Good docs, active research group |

**Links:**
- [geometry-central Geodesic Paths](https://geometry-central.net/surface/algorithms/geodesic_paths/)
- [Wrapping Meshes With Geodesic Walks](https://cprimozic.net/blog/wrapping-meshes-with-geodesic-walks/)
- [Speeding Up Geodesic Tracing](https://cprimozic.net/notes/posts/speeding-up-geodesic-tracing-in-geometry-central/)
- [Flip Geodesics Demo](https://github.com/nmwsharp/flip-geodesics-demo)

---

### 2.3 geometry-processing-js

**Repo:** [github.com/GeometryCollective/geometry-processing-js](https://github.com/GeometryCollective/geometry-processing-js)

**Overview:** A pure JavaScript framework for geometry processing from the Geometry Collective at CMU (Keenan Crane's group). Built on a halfedge mesh data structure with Eigen compiled to asm.js.

**Key Features:**
- Halfedge mesh data structure in JS
- Geodesic distance computation (Heat Method)
- Sparse linear algebra via Eigen/asm.js
- Runs entirely in the browser, no server needed

**Limitations:**
- Last updated 2020 -- appears semi-abandoned
- No `traceGeodesic` equivalent (only computes distance fields, not paths)
- Heat Method gives distance but not direction -- you cannot use it for frame-by-frame movement
- Performance of asm.js is inferior to WASM
- API is research-oriented, not game-oriented

**Assessment:**

| Criterion | Rating |
|-----------|--------|
| Browser feasibility | 5/5 -- Pure JS, runs anywhere |
| Surface walking quality | 2/5 -- Distance fields only, no path tracing |
| Geodesic projectiles | Partial -- Can compute distance, not direction |
| Custom mesh support | 4/5 -- OBJ import |
| Development effort | High -- Would need to add path tracing on top |
| Performance | 3/5 -- asm.js, not WASM |
| Visual quality | N/A |
| Community/docs | 2/5 -- Appears unmaintained |

**Links:**
- [geometry-processing-js Docs](https://geometrycollective.github.io/geometry-processing-js/)
- [Geodesic Distance Demo](https://geometrycollective.github.io/geometry-processing-js/projects/geodesic-distance/index.html)

---

### 2.4 The Heat Method for Geodesic Distance

**Paper:** Crane, Weischedel, Wardetzky -- "Geodesics in Heat" (2013, ACM TOG 2017)
**Web:** [cs.cmu.edu/~kmcrane/Projects/HeatMethod](https://www.cs.cmu.edu/~kmcrane/Projects/HeatMethod/)

**How It Works:**
1. Solve a heat equation from the source point (short time diffusion)
2. Normalize the gradient of the heat to get unit direction field
3. Solve a Poisson equation to recover the distance function

This gives geodesic distances from a source point to all other points on the mesh. It is fast (two sparse linear solves with pre-factored matrices) and robust.

**Relevance to Our Problem:** The Heat Method is excellent for precomputing distance fields (e.g., "how far is every point from the player?") but does NOT directly give you movement paths. You would need to:
1. Compute distance field from player position each frame
2. Move enemies by following the negative gradient (steepest descent toward the player)

This is useful for enemy AI (pathfinding toward player on the surface) but not for player movement or bullet trajectories.

**Implementations:**
- geometry-central (C++, WASM-compatible)
- CGAL (C++, heavy dependency)
- geometry-processing-js (JavaScript, but slow)
- libigl (C++, WASM-compatible via emscripten)

**Assessment:**

| Criterion | Rating |
|-----------|--------|
| Browser feasibility | 4/5 -- Via WASM |
| Surface walking quality | 3/5 -- Distance only, gradient-based movement |
| Geodesic projectiles | No -- Gives distance, not paths |
| Custom mesh support | 5/5 |
| Development effort | Medium |
| Performance | 4/5 -- Pre-factored linear systems are fast |
| Visual quality | N/A |
| Community/docs | 4/5 |

---

### 2.5 NavMesh on 3D Surfaces

**Libraries:**
- [recast-navigation-js](https://github.com/isaac-mason/recast-navigation-js) -- WASM port of Recast/Detour
- [three-pathfinding](https://github.com/donmccurdy/three-pathfinding) -- NavMesh utilities for Three.js
- [@recast-navigation/three](https://www.npmjs.com/package/@recast-navigation/three) -- Three.js helpers

**How Recast Works:** Recast voxelizes the input mesh, identifies walkable areas, generates a polygon mesh (NavMesh) of navigable regions, and provides pathfinding (A* with string pulling) on this mesh.

**Critical Limitation:** Recast is designed for floor-based navigation. It assumes a gravity direction (usually -Y) and filters walkable surfaces by slope angle. This fundamentally does not work for our use case where "up" changes depending on where you are on the surface. You would walk on the outside of a sphere, but Recast would only consider the top hemisphere "walkable."

**Could It Be Adapted?** In theory, you could:
1. Generate the NavMesh with a very steep walkable slope angle (nearly 90 degrees)
2. Disable gravity-based filtering
3. Use the resulting polygon mesh as a coarse navigation graph

But the pathfinding would still be graph-based (A* through polygon portals), not geodesic. Paths would be approximately shortest but not true geodesics. And direction consistency (parallel transport) would still need custom implementation.

**Assessment:**

| Criterion | Rating |
|-----------|--------|
| Browser feasibility | 5/5 -- Mature WASM port |
| Surface walking quality | 1/5 -- Designed for floors, not curved surfaces |
| Geodesic projectiles | No |
| Custom mesh support | 4/5 -- Works with any mesh |
| Development effort | High -- Fighting against the tool's design |
| Performance | 5/5 -- Very fast pathfinding |
| Visual quality | N/A |
| Community/docs | 4/5 |

---

### 2.6 Parallel Transport on Triangle Meshes

**Concept:** Parallel transport is the mathematical operation of moving a tangent vector from one point on a surface to another while keeping it "as parallel as possible." On a triangle mesh, this has a clean discrete formulation.

**How It Works on a Triangle Mesh:**
1. Two adjacent triangles share an edge. They can be "unfolded" (flattened) into a common plane by rotating around the shared edge.
2. A tangent vector on one triangle is transported to the neighbor by applying this unfolding rotation.
3. The result is a vector in the neighbor's tangent plane that preserves the angle relative to the shared edge.

**Why This Matters:** Parallel transport is the missing ingredient in our current system. When an entity crosses from one face to another, its "forward" direction must be parallel-transported to maintain consistency. Without it:
- Camera-relative input breaks (pushing "right" doesn't consistently mean the same thing)
- Entity orientations drift randomly
- Bullets curve unpredictably

**Implementation:** On a triangle mesh, parallel transport across an edge is just a 2D rotation:

```
angle = signed_angle(edge_in_face_A, edge_in_face_B)
transported_vector = rotate(vector, angle)
```

This is simple enough to implement in pure TypeScript. The challenge is tracking which face an entity is on and correctly handling edge crossings.

**Assessment:**

| Criterion | Rating |
|-----------|--------|
| Browser feasibility | 5/5 -- Pure math, no dependencies |
| Surface walking quality | 4/5 -- Excellent direction consistency |
| Geodesic projectiles | Partial -- Gives correct direction, but need face traversal too |
| Custom mesh support | 5/5 |
| Development effort | Medium -- Requires face-tracking entity system |
| Performance | 5/5 -- Just rotation math |
| Visual quality | N/A |
| Community/docs | 2/5 -- Academic papers, few game-oriented tutorials |

**Links:**
- [Connections and Parallel Transport (DDG Course)](http://wordpress.discretization.de/geometryprocessingandapplicationsws19/connections-and-parallel-transport/)
- [Vector Field Processing on Triangle Meshes (SIGGRAPH 2016 Course)](https://geometry.caltech.edu/pubs/dGDT16.pdf)

---

### 2.7 Exponential Map / Log Map

**Concept:** The exponential map and logarithmic map are the fundamental operations for movement on surfaces:

- **Exp map** (= `traceGeodesic`): Given a point P and a tangent vector V, walk along the surface in direction V for distance |V|. Returns the endpoint Q.
- **Log map**: Given two points P and Q on the surface, compute the tangent vector V at P that points toward Q with magnitude equal to the geodesic distance. This is the inverse of the exp map.

**The Vector Heat Method** (Sharp, Soliman, Crane 2019) provides a fast way to compute the log map for all points on a mesh simultaneously:
1. Solve three sparse linear systems (pre-factorable)
2. Result: for every vertex, the 2D polar coordinates (distance, angle) relative to a source point

This is incredibly useful for:
- Enemy AI: compute log map from player position; every enemy instantly knows the geodesic direction and distance to the player
- Projectile targeting: log map gives the launch direction for a geodesic bullet

**API (via geometry-central):**
```cpp
VectorHeatSolver solver(*geometry, tCoef);
VertexData<Vector2> logMap = solver.computeLogMap(sourceVertex);
// logMap[v].x = geodesic distance from source to v
// logMap[v].y = angle at source pointing toward v
```

**Three strategies:**
- `VectorHeat` -- Fast, some distortion far from source
- `AffineLocal` -- Fast, accurate near source (best for nearby enemies)
- `AffineAdaptive` -- Highest quality, slowest (factors new matrix per solve)

**Assessment:**

| Criterion | Rating |
|-----------|--------|
| Browser feasibility | 4/5 -- Via WASM (geometry-central) |
| Surface walking quality | 5/5 -- Mathematically correct |
| Geodesic projectiles | Yes -- Log map gives launch directions |
| Custom mesh support | 5/5 |
| Development effort | Medium-High -- WASM integration + solver setup |
| Performance | 4/5 -- Pre-factored solves are fast, but per-frame log map is expensive for moving sources |
| Visual quality | N/A |
| Community/docs | 4/5 |

**Links:**
- [Vector Heat Method (geometry-central)](https://geometry-central.net/surface/algorithms/vector_heat_method/)
- [The Vector Heat Method (Paper)](https://www.cs.cmu.edu/~kmcrane/Projects/VectorHeatMethod/index.html)

---

## 3. Physics Engines with Surface Constraints

### 3.1 Rapier (Rust/WASM)

**Repo:** [github.com/dimforge/rapier](https://github.com/dimforge/rapier)
**NPM:** `@dimforge/rapier3d` (WASM), `@dimforge/rapier3d-simd` (SIMD-accelerated)

**Overview:** Rapier is a modern physics engine written in Rust with first-class WASM support. As of 2025, the SIMD-accelerated WASM package is 2-5x faster than the 2024 version.

**Surface Constraint Approach:** Rapier does not have a "surface constraint" primitive. But you could:
1. Create a kinematic rigid body for each entity
2. Each frame, compute the entity's desired position using geodesic tracing
3. Set the rigid body's position to the surface point
4. Use Rapier for collision detection only (entity-entity, entity-projectile)

This hybrid approach uses Rapier for what it is good at (fast collision detection via WASM SIMD) and a separate system for surface walking.

**Assessment:**

| Criterion | Rating |
|-----------|--------|
| Browser feasibility | 5/5 -- Excellent WASM support |
| Surface walking quality | 1/5 -- Not designed for this |
| Geodesic projectiles | No |
| Custom mesh support | 4/5 -- Trimesh colliders |
| Development effort | Medium -- For collision only |
| Performance | 5/5 -- SIMD WASM, very fast |
| Visual quality | N/A |
| Community/docs | 4/5 |

**Links:**
- [Rapier JavaScript Getting Started](https://rapier.rs/docs/user_guides/javascript/getting_started_js/)
- [Rapier 2025 Review](https://dimforge.com/blog/2026/01/09/the-year-2025-in-dimforge/)

---

### 3.2 Cannon-es

**Repo:** [github.com/pmndrs/cannon-es](https://github.com/pmndrs/cannon-es)

**Overview:** Lightweight JavaScript physics engine, fork of cannon.js. Implements rigid body dynamics, discrete collision detection, and constraint solving.

**Surface Constraint Viability:** Cannon-es has no surface constraint. The closest you could get is a custom constraint that projects bodies onto a surface each frame, but this fights the physics solver and causes instability. Not recommended for surface walking.

**Assessment:**

| Criterion | Rating |
|-----------|--------|
| Browser feasibility | 5/5 -- Pure JS |
| Surface walking quality | 1/5 |
| Geodesic projectiles | No |
| Custom mesh support | 3/5 -- Trimesh support is basic |
| Development effort | Low -- Easy to add, but limited value |
| Performance | 3/5 -- JS, no SIMD |
| Visual quality | N/A |
| Community/docs | 3/5 |

---

### 3.3 Ammo.js / Bullet Physics

**Repo:** [github.com/kripken/ammo.js](https://github.com/kripken/ammo.js)

**Overview:** Emscripten port of the Bullet Physics Engine. Full-featured rigid body and soft body dynamics. Large WASM module (~1-2MB).

**Surface Constraint Viability:** Bullet has a `btKinematicCharacterController` that could be adapted to walk on surfaces using custom gravity directions (like Super Mario Galaxy). The approach:
1. For each entity, set gravity to point toward the surface center (or along the surface normal)
2. Use the character controller for stepping and collision
3. The controller handles slope walking and step detection

This is closer to the Super Mario Galaxy approach than a geodesic approach. It works well for sphere-like surfaces but struggles with concave or topologically complex surfaces (torus interior, peanut pinch points).

**Assessment:**

| Criterion | Rating |
|-----------|--------|
| Browser feasibility | 4/5 -- Mature WASM, but large module |
| Surface walking quality | 3/5 -- Gravity-based, not geodesic |
| Geodesic projectiles | No |
| Custom mesh support | 4/5 -- Good trimesh support |
| Development effort | Medium-High |
| Performance | 4/5 -- WASM, well-optimized |
| Visual quality | N/A |
| Community/docs | 3/5 -- Ammo.js docs are sparse |

---

### 3.4 PhysX (WASM)

**Repo:** [github.com/fabmax/physx-js-webidl](https://github.com/fabmax/physx-js-webidl)
**NPM:** `physx-js-webidl` (v2.6.2, PhysX 5.6.1)

**Overview:** NVIDIA PhysX compiled to WASM via Emscripten with WebIDL bindings. PhysX 5.x is the most feature-rich physics engine available in the browser.

**Surface Constraint Viability:** PhysX has `PxController` (character controller) similar to Bullet, plus more advanced constraint types. The same gravity-direction approach applies. PhysX's solver is more stable than Bullet's for unusual constraint configurations.

**Caveat:** The WASM module is large (~3-5MB), and the API surface is enormous. Using it just for surface walking is overkill. Better suited if you also need full physics simulation.

**Assessment:**

| Criterion | Rating |
|-----------|--------|
| Browser feasibility | 3/5 -- Works, but large module |
| Surface walking quality | 3/5 -- Character controller with custom gravity |
| Geodesic projectiles | No |
| Custom mesh support | 5/5 |
| Development effort | High -- Complex API |
| Performance | 5/5 -- Industry-leading solver |
| Visual quality | N/A |
| Community/docs | 3/5 -- PhysX docs are for C++; JS wrapper docs are minimal |

---

## 4. Existing Games & Demos That Solve This

### 4.1 Geometry Wars 3: Dimensions (Lucid Games, 2014)

**Platform:** Native (PS4, Xbox One, PC, iOS, Android)
**Engine:** Custom (likely based on Bizarre Creations' legacy engine)

**What We Know:**
- No public technical documentation exists from Lucid Games about their implementation
- The game uses pre-defined geometric shapes (sphere, cube, peanut, etc.), not arbitrary meshes
- Movement appears smooth with no visible direction artifacts
- Projectiles follow geodesic-like paths on the surface
- Camera follows the player along the surface normal

**Likely Implementation:** Given the constraints (2014 hardware, mobile support), the most probable approach is:
1. Parametric surface equations for each shape type (same as our current UV approach)
2. Movement in parameter space with Jacobian-based direction correction
3. Bullet trajectories computed by iterative stepping in parameter space
4. Pre-computed UV atlases for rendering

This is essentially what we already have. Their advantage was likely a more polished Jacobian-based direction mapping and more careful handling of pole singularities.

---

### 4.2 Super Mario Galaxy (Nintendo, 2007)

**Platform:** Wii (PowerPC, ~729 MHz, 88MB RAM)
**Engine:** Custom Nintendo engine

**Technical Approach:**
1. Each planetoid has a gravity field (usually a sphere or point attractor)
2. A raycast from Mario downward (relative to current gravity) finds the surface polygon
3. The surface normal of that polygon becomes the new "up" direction for Mario
4. Mario's orientation is smoothly interpolated (SLERP) between old and new up vectors
5. Movement is in the plane perpendicular to the current gravity direction
6. Landing on a new planetoid switches the gravity source

**Key Insight:** This is NOT surface walking -- it is gravity-based snapping. Mario does not track which triangle he is standing on or cross edges explicitly. He simply raycasts downward each frame. This works because:
- Planetoids are high-poly (smooth normals)
- Movement speed is moderate (no teleporting across large mesh regions)
- The gravity field provides a global "down" direction at every point

**Applicability:** This approach works for convex shapes (sphere, cube) but fails for:
- Concave regions (torus interior) -- gravity direction is ambiguous
- Very high-speed entities (bullets that cross many faces per frame)
- True geodesic paths (gravity-snap paths are not geodesics)

**Links:**
- [Games Demystified: Super Mario Galaxy](https://www.gamedeveloper.com/design/games-demystified-super-mario-galaxy)
- [Mario Galaxy Physics in Godot](https://game-blog.sethcorker.com/2020-08-05-godot-experiments/)
- [Mario Galaxy Physics in Unity](https://mikeloscocco.wordpress.com/2015/10/13/mario-galaxy-physics-in-unity/)

---

### 4.3 Casey Primozic's Geodesic Walker (Web Demo)

**URL:** [cprimozic.net/blog/wrapping-meshes-with-geodesic-walks/](https://cprimozic.net/blog/wrapping-meshes-with-geodesic-walks/)

**Technical Approach:**
- geometry-central compiled to WASM via Emscripten
- Three.js for rendering
- Rust WASM module for mesh generation
- TypeScript glue code to pass buffer data between WASM modules and the renderer

**Performance:** Millions of geodesic traces in ~842ms (after optimization). For a game with 100 traces/frame at 60fps, this is ~0.01ms per trace -- well within budget.

**This is the closest existing demo to what we need.** It proves the geometry-central WASM approach is viable for browser-based geodesic tracing with Three.js rendering.

---

## 5. Academic & Research Approaches

### 5.1 Vector Field Design on Surfaces

**Paper:** Zhang et al., "Vector Field Design on Surfaces" (ACM TOG, 2006)

**Relevance:** Defines smooth vector fields on triangle meshes with controlled singularities. Could be used to precompute "movement direction fields" on each surface -- e.g., a vector field that spirals inward toward the player, or flows along the surface in a given direction.

**Game Application:** Pre-compute a vector field on the surface; entities follow the field instead of computing geodesics per frame. The field can be updated periodically (e.g., every 10 frames) rather than every frame.

**Limitation:** Singularities are unavoidable on most surfaces (by the Poincare-Hopf theorem). On a sphere, any continuous vector field must have at least two singularities (poles). Entities near singularities would have undefined movement direction.

**Links:**
- [Vector Field Design on Surfaces (Paper)](https://dl.acm.org/doi/10.1145/1183287.1183290)
- [Vector Field Processing on Triangle Meshes (SIGGRAPH 2016 Course)](https://graphics.pixar.com/library/VectorFieldCourse/paper.pdf)

---

### 5.2 Discrete Connections and Covariant Derivatives

**Paper:** Liu, Jacobson, Crane -- "Discrete Connection and Covariant Derivative for Vector Field Analysis and Design" (ACM TOG, 2016)

**Relevance:** Defines a discrete connection on a triangle mesh -- a rotation angle on each dual edge that describes how to transport a vector from one face to its neighbor. This is the mathematical foundation for parallel transport on meshes.

**Game Application:** Pre-compute the discrete connection for each surface mesh. When an entity crosses an edge, look up the connection angle and rotate the entity's direction by that angle. This gives mathematically correct parallel transport with just one lookup and one 2D rotation per edge crossing.

**Implementation Cost:** The connection is computed once per mesh (offline). At runtime, edge crossings require:
1. Identify which edge was crossed (from face traversal)
2. Look up the connection angle for that edge
3. Rotate the entity's direction vector by that angle

This is O(1) per edge crossing -- extremely fast.

**Links:**
- [Discrete Connection and Covariant Derivative (Paper)](https://dl.acm.org/doi/10.1145/2870629)

---

### 5.3 Geodesic Shooting / Edge-Flipping Geodesics

**Paper:** Sharp & Crane, "You Can Find Geodesic Paths in Triangle Meshes by Just Flipping Edges" (SIGGRAPH Asia 2020)

**How It Works:** Given a path along mesh edges, the FlipOut algorithm shortens it to a geodesic by flipping edges in an intrinsic triangulation. This runs in milliseconds, even on million-triangle meshes.

**Game Application:** For computing geodesic paths between two known points (e.g., bullet trajectory from player to target):
1. Find an initial edge path between source and target (Dijkstra on dual graph)
2. Run FlipOut to straighten it to a geodesic
3. Animate the bullet along the resulting path

**Advantage over traceGeodesic:** FlipOut gives the globally shortest path between two points, while traceGeodesic gives a locally straight path from a starting direction (which may not reach the intended target).

**Implementation:** Available in geometry-central (C++/WASM).

**Links:**
- [Flip Geodesics Research Page](https://nmwsharp.com/research/flip-geodesics/)
- [Flip Geodesics in geometry-central](https://geometry-central.net/surface/algorithms/flip_geodesics/)

---

### 5.4 Geodesic Algorithms Survey

**Paper:** Mitchell, Mount, Papadimitriou -- "The Discrete Geodesic Problem" (1987)
**Survey:** Crane et al., "A Survey of Algorithms for Geodesic Paths and Distances" (2020)

**Key Algorithms:**
| Algorithm | Complexity | Type | Accuracy |
|-----------|-----------|------|----------|
| MMP (Mitchell-Mount-Papadimitriou) | O(n^2 log n) | Exact paths | Exact |
| Chen-Han | O(n^2) | Exact paths | Exact |
| Heat Method | O(n) amortized | Distance only | Approximate |
| Fast Marching | O(n log n) | Distance only | Approximate |
| FlipOut (Sharp-Crane) | O(n) practical | Paths | Exact (locally shortest) |
| Geodesic tracing (exp map) | O(k) per trace | Paths | Exact (locally straight) |

For our game, **geodesic tracing (exp map)** is the best fit: it is O(k) per trace where k is the number of face crossings, gives exact locally-straight paths, and naturally provides parallel transport.

**Links:**
- [A Survey of Algorithms for Geodesic Paths and Distances (PDF)](https://www.cs.cmu.edu/~kmcrane/Projects/GeodesicSurvey/GeodesicSurvey.pdf)

---

## 6. Hybrid Approaches

### 6.1 geometry-central WASM + Three.js Rendering (Recommended)

**Architecture:**
```
[Three.js Renderer]  <-->  [TypeScript Game Logic]  <-->  [geometry-central WASM Module]
                                    |
                                    v
                           [Rapier WASM] (optional, for collision)
```

**How It Works:**
1. **Initialization:** Load mesh into both Three.js (for rendering) and geometry-central WASM (for surface queries).
2. **Per-frame movement:** For each entity, call `traceGeodesic(currentFace, currentBarycentric, directionVec)` via WASM. Get back new position + parallel-transported direction.
3. **Position update:** Convert face+barycentric position to world-space 3D coordinates. Set the Three.js mesh position.
4. **Camera:** Use the surface normal at the player's position for camera orientation (same as current system).
5. **Collision:** Either use three-mesh-bvh for spatial queries or Rapier WASM for physics-based collision.

**Data Flow (per frame):**
```
Input (joystick) --> map to tangent vector at player's face
                --> traceGeodesic(face, bary, tangentVec)     [WASM call]
                --> new face, new bary, new direction
                --> getWorldPosition(face, bary)
                --> update Three.js mesh.position
                --> update camera from surface normal
```

**Estimated Development Effort:**
- Build geometry-central WASM module with Embind wrapper: 2-3 days
- Write TypeScript wrapper class (`SurfaceWalker`): 1-2 days
- Rewrite entity position system (face+bary instead of UV): 2-3 days
- Rewrite camera system: 1 day
- Rewrite bullet system (geodesic traces): 1-2 days
- Testing and debugging: 3-5 days
- **Total: 10-16 days**

---

### 6.2 Custom TypeScript Mesh Walker (No WASM)

**Architecture:** Implement a minimal triangle-mesh walking system in pure TypeScript, without any external geometry library.

**Core Algorithm (pseudocode):**
```typescript
function walkOnSurface(
    mesh: HalfEdgeMesh,
    startFace: number,
    startBary: Vector3,    // barycentric coordinates
    direction: Vector2,    // tangent-space direction
    distance: number
): WalkResult {
    let face = startFace;
    let bary = startBary;
    let dir = direction;
    let remaining = distance;

    while (remaining > 0) {
        // 1. Compute where the ray exits the current face
        const exit = rayExitFace(face, bary, dir);

        if (exit.distance >= remaining) {
            // We stop inside this face
            bary = advanceBary(bary, dir, remaining);
            remaining = 0;
        } else {
            // We cross an edge to the next face
            remaining -= exit.distance;
            const nextFace = mesh.adjacentFace(face, exit.edge);

            // 2. Parallel transport direction across the edge
            dir = parallelTransport(dir, face, nextFace, exit.edge);

            // 3. Convert barycentric coords to the new face
            bary = convertBaryAcrossEdge(exit.bary, exit.edge, face, nextFace);
            face = nextFace;
        }
    }

    return { face, bary, direction: dir };
}
```

**Advantages:**
- No WASM build complexity
- No binary dependency management
- Full control over the algorithm
- Can be optimized specifically for our use case
- Easier to debug (all TypeScript)

**Disadvantages:**
- Must implement halfedge mesh data structure
- Must implement parallel transport correctly
- Must handle degenerate cases (zero-area triangles, T-junctions, mesh boundaries)
- Must handle bullet mesh boundaries (wrapping vs. stopping)
- ~1000-2000 lines of non-trivial geometry code
- Risk of subtle bugs in edge cases

**Estimated Development Effort:**
- Halfedge mesh data structure: 2-3 days
- Face walking + edge crossing: 3-4 days
- Parallel transport: 1-2 days
- Barycentric coordinate utilities: 1 day
- Integration with entity system: 2-3 days
- Edge case handling and debugging: 3-5 days
- **Total: 12-18 days**

---

### 6.3 Pre-computed Geodesic Distance Fields + GPU

**Architecture:** Pre-compute geodesic distance and direction from every vertex to every other vertex (or a sparse set of landmark vertices). Store as textures. Use GPU (WebGPU compute shaders) for real-time queries.

**How It Works:**
1. **Offline:** For each surface mesh, pre-compute geodesic distances between all pairs of landmark vertices using the Heat Method or MMP.
2. **Store:** Encode distances and directions as textures (one per landmark vertex).
3. **Runtime:** To move an entity, look up the pre-computed direction in the texture and interpolate.

**Performance:** O(1) per query at runtime (texture lookup). Pre-computation cost is O(n * k) where n is mesh vertices and k is number of landmarks.

**Limitation:** This only works for movement toward/away from fixed landmarks, not arbitrary geodesic tracing. It is best suited for enemy AI pathfinding (enemies always move toward the player), not for player-controlled movement.

**Links:**
- [Constant-time All-pairs Geodesic Distance Query (ACM 2012)](https://dl.acm.org/doi/10.1145/2159616.2159622)
- [Compressing Geodesic Information (2022)](https://www.inf.usi.ch/hormann/papers/Gotsman.2022.CGI.pdf)

---

### 6.4 Gravity-Based Snapping (Super Mario Galaxy Style)

**Architecture:** Use per-surface gravity fields with raycast-based surface snapping. No explicit face tracking.

**How It Works:**
1. Define a gravity field for each surface (e.g., toward center for sphere, toward axis for cylinder)
2. Each frame, move entity in the plane perpendicular to gravity
3. Raycast "downward" (along gravity) to find the nearest surface point
4. Snap entity to that point
5. SLERP entity orientation toward the surface normal

**Advantages:**
- Simple to implement (~200-300 lines)
- No halfedge data structure needed
- Works with three-mesh-bvh for fast raycasting (already have this)
- No WASM dependency

**Disadvantages:**
- Not geodesic -- paths are not shortest paths on the surface
- Fails on concave surfaces (torus interior, peanut pinch)
- Direction consistency depends on smooth gravity field interpolation
- Bullets follow parabolic arcs, not geodesics
- High-speed entities can "tunnel" through thin surface features

**Best For:** If you only need convex shapes and don't care about exact geodesics, this is the simplest approach. It is what most Mario Galaxy clones use.

**Estimated Development Effort:**
- Gravity field per surface type: 1 day
- Snap system: 1 day
- Orientation interpolation: 0.5 days
- Integration: 1 day
- **Total: 3-4 days**

---

## Comparison Table

| Approach | Browser | Surface Walking | Geodesic Bullets | Custom Meshes | Effort | Performance | Direction Consistency |
|----------|---------|----------------|------------------|---------------|--------|-------------|----------------------|
| **UV Parametric (current)** | 5 | 3 (parametric only) | No | 1 (must parameterize each) | Done | 5 | 3 (Jacobian issues) |
| **three-mesh-bvh snap** | 5 | 2 (snap, not walk) | No | 5 | Low | 5 | 1 (no parallel transport) |
| **geometry-central WASM** | 4 | 5 (true geodesic) | Yes | 5 | Medium | 4 | 5 (parallel transport built-in) |
| **Custom TS Mesh Walker** | 5 | 4 (correct if implemented well) | Partial | 5 | Medium-High | 4 | 4 (manual parallel transport) |
| **Gravity Snap (Galaxy)** | 5 | 3 (convex only) | No | 4 | Low | 5 | 3 (depends on gravity field) |
| **Babylon.js (engine switch)** | 5 | 2 (must build) | No | 5 | Very High | 5 | N/A |
| **Heat Method Distance** | 4 | 3 (gradient only) | No | 5 | Medium | 4 | 2 (no direction transport) |
| **Vector Heat Log Map** | 4 | 5 (distance + direction) | Yes (launch dir) | 5 | Medium-High | 3 (per-frame recompute) | 5 |
| **Godot 4 Web** | 3 | 2 (must build) | No | 4 | Very High | 3 | N/A |
| **Unity WebGL** | 2 | 3 | Partial | 5 | Very High | 2 | N/A |
| **Rapier (collision only)** | 5 | 1 | No | 4 | Low | 5 | N/A |
| **NavMesh (Recast)** | 5 | 1 (floor-based) | No | 4 | High | 5 | 1 |
| **Pre-computed Distance GPU** | 4 | 3 (landmarks only) | No | 5 | High | 5 | 2 |

---

## Recommendations

### Rank 1: geometry-central WASM + Three.js (Best Overall)

**Why:** This is the only approach that gives true geodesic walking with built-in parallel transport, geodesic projectiles, and arbitrary mesh support. The WASM compilation has been proven viable by Casey Primozic's work. Performance is sufficient for our use case (dozens of entities at 60fps).

**Trade-offs:**
- WASM build complexity (Emscripten toolchain, Eigen patches)
- Binary dependency (~1-2MB WASM module)
- Need to maintain JS-WASM bridge code

**Action Plan:**
1. Fork geometry-central, build WASM module with Emscripten
2. Expose `traceGeodesic`, `computeLogMap`, and mesh loading via Embind
3. Write TypeScript `SurfaceWalker` class wrapping WASM calls
4. Rewrite entity system to store `{faceIndex, barycentricCoords, tangentDirection}`
5. Integrate with existing Three.js rendering (position entities from face+bary)
6. Use `computeLogMap` from player position for enemy AI pathfinding

**Estimated Effort:** 10-16 days
**Risk Level:** Medium (WASM build issues, memory management)

---

### Rank 2: Custom TypeScript Mesh Walker (Best No-WASM Option)

**Why:** If the WASM approach proves too complex to maintain, a pure TypeScript implementation of face-based walking with manual parallel transport gives most of the benefits without the build toolchain overhead. It is the "boring, obvious solution" that a senior engineer would choose if WASM is off the table.

**Trade-offs:**
- Must implement non-trivial geometry code correctly
- No geodesic projectiles (would need additional work for true geodesics)
- Must handle all edge cases manually
- More code to maintain long-term

**Action Plan:**
1. Implement halfedge mesh data structure in TypeScript
2. Implement face walking (ray-exit-face + edge-crossing)
3. Implement parallel transport (edge rotation angles)
4. Rewrite entity system to use face+bary positions
5. Integrate with rendering

**Estimated Effort:** 12-18 days
**Risk Level:** Medium (geometry bugs, edge cases)

---

### Rank 3: Gravity Snap + UV Parametric Hybrid (Lowest Effort)

**Why:** If development time is critically limited, improving the existing UV system with gravity-based snapping for non-parametric surfaces gives the fastest path to a working game. It won't have geodesic projectiles or perfect direction consistency, but it will "feel" correct for most players.

**Trade-offs:**
- Not geodesic -- bullets curve wrongly on some surfaces
- Direction consistency issues remain (but can be mitigated with careful Jacobian correction)
- Cannot support truly arbitrary meshes (each surface type needs a gravity field definition)
- Technical debt -- will need replacement for custom map support

**Action Plan:**
1. Fix existing UV system's Jacobian-based direction mapping for parametric surfaces
2. Add gravity-based snapping for any new mesh types using three-mesh-bvh raycasting
3. Improve camera SLERP for smoother orientation transitions
4. Accept bullets-are-not-geodesic as a known limitation

**Estimated Effort:** 3-5 days
**Risk Level:** Low (incremental improvement on existing code)

---

## Appendix: Key Code Snippets

### A1. Parallel Transport Across a Triangle Edge (TypeScript)

```typescript
/**
 * Parallel-transports a 2D tangent vector across a shared edge between two
 * adjacent faces on a triangle mesh.
 *
 * @param vec - The 2D tangent-space vector in faceA's local frame
 * @param faceA - Source face (3 vertex positions)
 * @param faceB - Target face (3 vertex positions)
 * @param sharedEdge - The two vertex indices forming the shared edge
 * @returns The vector in faceB's local frame
 */
function parallelTransportAcrossEdge(
    vec: { x: number; y: number },
    faceA: [Vector3, Vector3, Vector3],
    faceB: [Vector3, Vector3, Vector3],
    sharedEdge: [number, number]
): { x: number; y: number } {
    // Compute normals
    const normalA = computeFaceNormal(faceA);
    const normalB = computeFaceNormal(faceB);

    // Edge direction (shared by both faces)
    const edgeDir = faceA[sharedEdge[1]].clone().sub(faceA[sharedEdge[0]]).normalize();

    // Compute the rotation angle between the two faces around the shared edge
    // This is the dihedral angle
    const crossA = new Vector3().crossVectors(edgeDir, normalA).normalize();
    const crossB = new Vector3().crossVectors(edgeDir, normalB).normalize();

    // Signed angle between crossA and crossB around edgeDir
    const cosAngle = crossA.dot(crossB);
    const sinAngle = new Vector3().crossVectors(crossA, crossB).dot(edgeDir);
    const angle = Math.atan2(sinAngle, cosAngle);

    // Rotate the 2D tangent vector by this angle
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    return {
        x: vec.x * cos - vec.y * sin,
        y: vec.x * sin + vec.y * cos
    };
}
```

### A2. Face Walking Ray-Exit (TypeScript Pseudocode)

```typescript
interface WalkResult {
    faceIndex: number;
    barycentric: Vector3;
    direction: Vector2;     // parallel-transported
    remainingDistance: number;
}

/**
 * Walk along a triangle mesh surface from a starting point in a given
 * tangent-space direction for a given distance.
 */
function walkOnMesh(
    mesh: HalfEdgeMesh,
    startFace: number,
    startBary: Vector3,
    direction: Vector2,
    distance: number,
    maxSteps: number = 1000
): WalkResult {
    let face = startFace;
    let bary = startBary.clone();
    let dir = { x: direction.x, y: direction.y };
    let remaining = distance;

    for (let step = 0; step < maxSteps && remaining > 0; step++) {
        // Convert tangent-space direction to barycentric velocity
        const baryVel = tangentToBarycentricVelocity(face, dir, mesh);

        // Find where the ray exits the triangle (first barycentric coord hitting 0)
        const { t, exitEdge, exitBary } = findRayExit(bary, baryVel);

        const stepDist = t * tangentSpeedScale(face, mesh);

        if (stepDist >= remaining) {
            // Stop inside this face
            const fraction = remaining / stepDist;
            bary.addScaledVector(baryVel, fraction * t);
            remaining = 0;
        } else {
            // Cross the edge
            remaining -= stepDist;
            const nextFace = mesh.adjacentFace(face, exitEdge);

            if (nextFace === -1) {
                // Hit mesh boundary -- stop or wrap
                remaining = 0;
                bary = exitBary;
            } else {
                // Parallel transport direction
                dir = parallelTransportAcrossEdge(dir, face, nextFace, exitEdge);
                // Mirror barycentric coords to neighbor face
                bary = mirrorBarycentricAcrossEdge(exitBary, exitEdge, face, nextFace, mesh);
                face = nextFace;
            }
        }
    }

    return { faceIndex: face, barycentric: bary, direction: dir, remainingDistance: remaining };
}
```

### A3. geometry-central WASM Wrapper (Embind Sketch)

```cpp
// geodesic_wasm.cpp -- Embind wrapper for geometry-central
#include <emscripten/bind.h>
#include "geometrycentral/surface/meshio.h"
#include "geometrycentral/surface/surface_point.h"
#include "geometrycentral/surface/trace_geodesic.h"
#include "geometrycentral/surface/vertex_position_geometry.h"

using namespace geometrycentral;
using namespace geometrycentral::surface;
using namespace emscripten;

struct MeshHandle {
    std::unique_ptr<ManifoldSurfaceMesh> mesh;
    std::unique_ptr<VertexPositionGeometry> geometry;
};

struct TraceResult {
    int endFace;
    float endBary0, endBary1, endBary2;
    float endDirX, endDirY;
    bool hitBoundary;
};

MeshHandle* loadMesh(uintptr_t verticesPtr, int nVertices,
                      uintptr_t indicesPtr, int nTriangles) {
    // Convert raw buffers to geometry-central mesh
    float* verts = reinterpret_cast<float*>(verticesPtr);
    int* indices = reinterpret_cast<int*>(indicesPtr);

    // ... build ManifoldSurfaceMesh from data ...

    auto handle = new MeshHandle();
    // handle->mesh = ...
    // handle->geometry = ...
    return handle;
}

TraceResult traceOnSurface(MeshHandle* handle,
                            int faceIndex, float b0, float b1, float b2,
                            float dirX, float dirY) {
    Face f = handle->mesh->face(faceIndex);
    SurfacePoint startP(f, Vector3{b0, b1, b2});
    Vector2 traceVec{dirX, dirY};

    TraceGeodesicResult result = traceGeodesic(
        *handle->geometry, startP, traceVec);

    TraceResult out;
    // ... extract endPoint face index, barycentric, direction ...
    out.hitBoundary = result.hitBoundary;
    return out;
}

EMSCRIPTEN_BINDINGS(geodesic_module) {
    class_<MeshHandle>("MeshHandle");

    value_object<TraceResult>("TraceResult")
        .field("endFace", &TraceResult::endFace)
        .field("endBary0", &TraceResult::endBary0)
        .field("endBary1", &TraceResult::endBary1)
        .field("endBary2", &TraceResult::endBary2)
        .field("endDirX", &TraceResult::endDirX)
        .field("endDirY", &TraceResult::endDirY)
        .field("hitBoundary", &TraceResult::hitBoundary);

    function("loadMesh", &loadMesh, allow_raw_pointers());
    function("traceOnSurface", &traceOnSurface, allow_raw_pointers());
}
```

### A4. TypeScript SurfaceWalker Class (Using WASM)

```typescript
// SurfaceWalker.ts -- TypeScript wrapper around geometry-central WASM
import type { GeodesicModule, MeshHandle, TraceResult } from './geodesic-wasm-types';

export interface SurfacePosition {
    faceIndex: number;
    bary: [number, number, number];
    tangentDir: [number, number];  // direction in tangent space
}

export class SurfaceWalker {
    private module: GeodesicModule;
    private meshHandle: MeshHandle;

    constructor(module: GeodesicModule, meshHandle: MeshHandle) {
        this.module = module;
        this.meshHandle = meshHandle;
    }

    static async create(
        wasmModule: GeodesicModule,
        vertices: Float32Array,
        indices: Uint32Array
    ): Promise<SurfaceWalker> {
        const vertPtr = wasmModule._malloc(vertices.byteLength);
        const idxPtr = wasmModule._malloc(indices.byteLength);
        wasmModule.HEAPF32.set(vertices, vertPtr / 4);
        wasmModule.HEAPU32.set(indices, idxPtr / 4);

        const handle = wasmModule.loadMesh(
            vertPtr, vertices.length / 3,
            idxPtr, indices.length / 3
        );

        wasmModule._free(vertPtr);
        wasmModule._free(idxPtr);

        return new SurfaceWalker(wasmModule, handle);
    }

    walk(pos: SurfacePosition, distance: number): SurfacePosition {
        const result: TraceResult = this.module.traceOnSurface(
            this.meshHandle,
            pos.faceIndex,
            pos.bary[0], pos.bary[1], pos.bary[2],
            pos.tangentDir[0] * distance,
            pos.tangentDir[1] * distance
        );

        return {
            faceIndex: result.endFace,
            bary: [result.endBary0, result.endBary1, result.endBary2],
            tangentDir: [result.endDirX, result.endDirY]
        };
    }

    getWorldPosition(pos: SurfacePosition): { position: Vector3; normal: Vector3 } {
        // Interpolate vertex positions using barycentric coords
        // ... (can be done in JS from the mesh data)
    }
}
```

---

## Appendix: Additional References

### Repos
- [geometry-central](https://github.com/nmwsharp/geometry-central) -- C++ surface mesh algorithms (geodesic tracing, heat method, vector heat, flip geodesics)
- [geometry-processing-js](https://github.com/GeometryCollective/geometry-processing-js) -- JS geometry processing (halfedge, heat method)
- [three-mesh-bvh](https://github.com/gkjohnson/three-mesh-bvh) -- BVH for Three.js spatial queries
- [recast-navigation-js](https://github.com/isaac-mason/recast-navigation-js) -- WASM NavMesh for Three.js
- [Rapier.js](https://github.com/dimforge/rapier.js) -- Rust/WASM physics engine
- [physx-js-webidl](https://github.com/fabmax/physx-js-webidl) -- PhysX 5.6 WASM bindings
- [libigl-wasm](https://github.com/ryanaltair/libigl-wasm) -- libigl compiled to WASM
- [flip-geodesics-demo](https://github.com/nmwsharp/flip-geodesics-demo) -- Edge-flipping geodesic construction demo
- [mojocorp/geodesic](https://github.com/mojocorp/geodesic) -- MMP exact geodesic algorithm (C++)

### Papers
- Crane, Weischedel, Wardetzky. "Geodesics in Heat." ACM TOG 2017. [Link](https://www.cs.cmu.edu/~kmcrane/Projects/HeatMethod/)
- Sharp, Soliman, Crane. "The Vector Heat Method." ACM TOG 2019. [Link](https://www.cs.cmu.edu/~kmcrane/Projects/VectorHeatMethod/)
- Sharp, Crane. "You Can Find Geodesic Paths in Triangle Meshes by Just Flipping Edges." SIGGRAPH Asia 2020. [Link](https://nmwsharp.com/research/flip-geodesics/)
- Mitchell, Mount, Papadimitriou. "The Discrete Geodesic Problem." SIAM J. Computing, 1987. [Link](https://www.cs.jhu.edu/~misha/ReadingSeminar/Papers/Mitchell87.pdf)
- Surazhsky et al. "Fast Exact and Approximate Geodesics on Meshes." ACM TOG 2005. [Link](https://hhoppe.com/geodesics.pdf)
- Zhang et al. "Vector Field Design on Surfaces." ACM TOG 2006. [Link](https://dl.acm.org/doi/10.1145/1183287.1183290)
- Liu, Jacobson, Crane. "Discrete Connection and Covariant Derivative." ACM TOG 2016. [Link](https://dl.acm.org/doi/10.1145/2870629)
- Crane et al. "A Survey of Algorithms for Geodesic Paths and Distances." 2020. [PDF](https://www.cs.cmu.edu/~kmcrane/Projects/GeodesicSurvey/GeodesicSurvey.pdf)

### Blog Posts & Tutorials
- [Wrapping Meshes With Geodesic Walks](https://cprimozic.net/blog/wrapping-meshes-with-geodesic-walks/) -- Proven browser WASM integration
- [Speeding Up Geodesic Tracing in geometry-central](https://cprimozic.net/notes/posts/speeding-up-geodesic-tracing-in-geometry-central/) -- Performance optimization
- [Games Demystified: Super Mario Galaxy](https://www.gamedeveloper.com/design/games-demystified-super-mario-galaxy) -- Gravity-based approach analysis
- [Vector Field Processing on Triangle Meshes (SIGGRAPH 2016 Course Notes)](https://graphics.pixar.com/library/VectorFieldCourse/paper.pdf) -- Comprehensive DDG tutorial
- [Connections and Parallel Transport (DDG Course)](http://wordpress.discretization.de/geometryprocessingandapplicationsws19/connections-and-parallel-transport/) -- Mathematical foundations

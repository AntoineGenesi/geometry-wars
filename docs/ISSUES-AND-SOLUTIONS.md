# Issues and Solutions Log

## Current Architecture

Player and bullets use **MeshWalker** (BVH-based surface walking via `three-mesh-bvh`). This system works on any mesh geometry with constant world-space speed and no singularities. Enemies and geoms still use UV-parameterized surfaces, bridged to world space via `surface.worldToSurface()`.

Key files:
- `src/experimental/mesh-movement/MeshSurface.ts` - BVH wrapper (closestPointOnSurface, moveOnSurface, raycast)
- `src/experimental/mesh-movement/MeshWalker.ts` - Persistent tangent frame movement
- `src/entities/Bullet.ts` - Modified to use MeshSurface when available
- `src/main.ts` - Integration: player uses MeshWalker, bullets use MeshSurface

24 automated tests verify pole traversal, speed constancy, and multi-shape support. Visual verification done on sphere, torus, cube, knot, and pill via Puppeteer screenshots.

---

## Solved Issues

### 2026-02 - UV Pole Singularity (RESOLVED)

**Problem**: UV-based movement on sphere had singularities at poles (V=0 and V=1). All U values mapped to a single point, causing infinite angular velocity near poles and non-uniform speed across the surface. Each shape required custom `moveOnSurface()` with its own quirks.

**Resolution**: Replaced UV movement for player and bullets with MeshWalker, which moves in world-space tangent directions and projects back onto the mesh via BVH. Speed is constant everywhere. No shape-specific code needed.

### 2026-02 - Bullets Hardcoded to Spherical Great Circles (RESOLVED)

**Problem**: Bullets traveled along spherical great circles regardless of actual surface shape. On torus, cube, and other non-spherical surfaces, bullets would fly off-surface or path incorrectly.

**Resolution**: Bullets now use `MeshSurface.moveOnSurface()` to follow any mesh surface. Each frame, the bullet moves in its tangent direction and snaps back to the closest surface point via BVH.

### 2026-02 - Torus Camera Flipping (RESOLVED)

**Problem**: Camera `up` vector was recomputed from scratch each frame using cross products, causing discontinuities and sudden flips on torus inner surface.

**Resolution**: MeshWalker uses a persistent tangent frame that smoothly rotates with the surface normal. Camera uses this frame's tangent as its `up` vector, eliminating flips. See `decisions/torus-tangent-frame-fix.md`.

---

## Evolution of Approach

### Phase 1: UV Parameterization

Initial system stored positions as (u, v) coordinates on parameterized surfaces. Worked well for simple shapes but had fundamental limitations: pole singularities, non-uniform speed, shape-dependent code, and no support for arbitrary meshes.

### Phase 2: Hamster Ball Rotation (Explored, Not Used)

Concept: keep player fixed at center, rotate the surface under them. Rejected because it breaks for non-convex shapes and creates confusion in multiplayer.

### Phase 3: Mesh-Based BVH Walking (Current)

Uses `three-mesh-bvh` for fast `closestPointToPoint()` on any mesh. Player moves in world space along the surface tangent plane, then snaps back to the mesh. Works identically on sphere, torus, cube, imported OBJ/GLB, or any other geometry.

---

## Known Limitations

- **Enemies still use UV system**: 30 enemy types move via `surface.moveOnSurface(u, v, du, dv)`. Migration to MeshWalker is planned but not yet started. See `decisions/enemy-meshwalker-migration.md`.
- **UV bridge approximation**: `surface.worldToSurface()` converts world positions to UV for enemy/geom interaction. This works but adds a layer of coordinate conversion that would be unnecessary if enemies also used MeshWalker.
- **Far-side entity visibility**: No depth-based opacity yet. Enemies behind the surface look the same as nearby ones.
- **Bloom tuning**: Bloom is enabled (threshold=0.85, strength=1.0) but additive-blended particles can cause white-out. All particle/trail materials use NormalBlending to mitigate.

---

## Testing Requirements

### Movement Tests (Automated - 24 passing)
1. Walk over sphere poles - constant speed, no singularity
2. Walk in circle at any position - uniform speed
3. Load arbitrary OBJ mesh - movement works identically

### Bullet Tests (Automated)
1. Shoot on sphere - bullet follows surface curve
2. Shoot on torus - bullet follows torus surface (not spherical)
3. Shoot on cube - bullet follows cube faces and edges

### Visual Tests (Manual)
- Player always centered regardless of surface position
- Camera up vector stable on torus inner surface

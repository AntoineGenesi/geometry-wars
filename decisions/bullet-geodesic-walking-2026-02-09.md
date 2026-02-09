## 2026-02-09 - Bullet Movement: Geodesic Face Walking Instead of BVH Projection

**Context:** Bullets on the cube surface curved toward vertex convergence points (corners where 3+ faces meet) instead of traveling in straight geodesic paths. This was most visible when shooting toward the top/bottom of the cube.

**Options Considered:**
1. Fix the CubeSurface UV parameterization at corners - Pros: No change to bullet system / Cons: Doesn't fix the actual problem (bullets use BVH, not UV); would need fixes for every surface type
2. Switch bullets from BVH closest-point projection to geodesic face walking - Pros: True geodesic paths on all surfaces; same algorithm player already uses; fixes all vertex convergence issues / Cons: Slightly more complex update loop; per-bullet geodesic state
3. Add vertex-avoidance heuristics to BVH projection - Pros: Minimal code change / Cons: Heuristic, fragile, doesn't solve the fundamental problem

**Decision:** Option 2 - Switch bullets to geodesic face walking with BVH fallback.

**Reasoning:** The root cause was that `closestPointOnSurface()` (BVH) projects to the geometrically nearest point on the mesh. Near cube corner vertices that protrude outward, the nearest-point query pulls bullets toward the vertex. This is a fundamental limitation of BVH projection for movement. The geodesic face walker (already used by MeshWalker for the player) walks along triangle faces and parallel-transports the direction across edges, giving true locally-straight paths. This is the correct algorithm for the problem and is already proven to work for the player.

**Reversibility:** Easy - Revert the changes to `src/entities/Bullet.ts`. The BVH-only path is preserved as a fallback when geodesic state is null.

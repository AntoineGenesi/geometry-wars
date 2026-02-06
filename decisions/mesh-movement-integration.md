## 2026-02-06 - Mesh-Based Movement Integration

**Context:** UV-based movement system had pole singularities (player stuck at top of sphere, infinite speed near poles), couldn't support arbitrary meshes.

**Options Considered:**
1. Fix UV math per-shape - Pros: No refactor / Cons: Fundamental math problem, can't support arbitrary meshes
2. Full rewrite (MeshWalker everywhere) - Pros: Clean / Cons: Touches ~30 enemy files, high risk
3. Bridge approach (MeshWalker for player/bullets, UV bridge for enemies) - Pros: Minimal disruption, incremental / Cons: Two systems co-existing

**Decision:** Option 3 - Bridge approach

**What changed:**
- Player movement: MeshWalker (world-space, BVH-based, no UV)
- Bullet projection: MeshSurface.closestPointOnSurface() (any shape, not just sphere)
- Camera: Follows MeshWalker position + surface normal
- Depth-based opacity: MeshSurface.getVisibility() applied to enemies in render loop
- UV bridge: `surface.worldToSurface(playerWalker.position)` converts to UV for enemies/geoms/drones

**What didn't change:**
- Enemy movement (still UV-based, works for predefined shapes)
- Geom spawning and magnetic pull (still UV-based)
- Drone positioning (still UV-based)
- Grid deformation (still world-position-based, works fine)
- Start menu, multiplayer, network code (untouched)

**Reasoning:**
- Minimum viable change that fixes the user's core complaints (pole singularity, sphere-only bullets)
- Enemies using UV still works acceptably for the 10 predefined shapes
- Bridge allows incremental migration: enemies can be converted to MeshWalker one-by-one later
- 24 automated tests verify the core system before integration

**Reversibility:** Easy - Revert main.ts changes and remove MeshSurface import from Bullet.ts. The experimental/ folder is self-contained.

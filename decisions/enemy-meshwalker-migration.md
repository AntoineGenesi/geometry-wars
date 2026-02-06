## 2026-02-06 - Enemy MeshWalker Migration Decision

**Context:** Enemies move in UV space (surfacePosition.u/v), player uses MeshWalker (world-space BVH). Should enemies migrate to MeshWalker too?

**Analysis:**
- 13 enemy types, each with unique movement logic in UV space
- All enemies already positioned in world-space via `surface.getPoint(u,v)` + `applySurfaceTransform()`
- Collisions already use world-space distance (`distanceTo()`)
- Depth-based opacity already applied in all three game modes
- UV bridge (`surface.worldToSurface()`) works correctly for enemy targeting

**What works well with UV enemies:**
- All 10 built-in surfaces have valid UV parametrization
- Enemy behavior logic (chase, bounce, orbit, sine-wave) maps naturally to UV deltas
- Spawning, separation, and boundary handling work in UV space

**What UV enemies can't handle:**
- Arbitrary loaded meshes (no UV parametrization) - enemies can't move on custom meshes
- Pole singularity on spheres (v=0 and v=1) - enemies near poles move erratically

**Decision:** Defer full MeshWalker migration. Current UV system works well for built-in surfaces.

**When to migrate:**
- When arbitrary mesh gameplay (from MeshLoader) is integrated into main game
- When pole singularity becomes a visible gameplay issue

**What was done instead:**
- Verified depth-based opacity applied in all modes (already done)
- Verified collisions use world-space distance (already done)
- Documented the migration path for future reference

**Migration path (when needed):**
1. Add `MeshWalker` to BaseEnemy (optional, mesh mode only)
2. Enemy `updateBehavior` outputs desired UV delta (unchanged)
3. New method converts UV delta → world-space tangent direction using cached transform
4. MeshWalker.move() handles surface projection
5. World position → UV via `worldToSurface()` for backward compat

**Reversibility:** Easy - this is a defer decision, no code changes to reverse

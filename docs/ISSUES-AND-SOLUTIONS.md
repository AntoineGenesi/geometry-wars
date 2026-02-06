# Issues and Solutions Log

## CRITICAL: UV Parameterization Pole Singularity

### Problem
The current UV-based movement system has fundamental mathematical flaws:

1. **Pole Singularity on Sphere**: At V=0 (north pole) or V=1 (south pole), all U values map to a single point. Moving "forward" is impossible, and moving sideways causes infinite angular velocity because circumference → 0.

2. **Non-uniform Speed**: Movement in UV space translates to varying world-space speeds:
   - Equator: Normal speed
   - Near poles: Lateral movement becomes infinitely fast
   - This is why player "spins ultra quick" at the top

3. **Shape Dependency**: Each shape requires custom `moveOnSurface()` implementation with its own quirks and singularities (torus has different issues, cube has edge discontinuities).

4. **Cannot Support Arbitrary Meshes**: A cup, statue, or person mesh has no natural UV parameterization.

### Root Cause
```javascript
// FLAWED: UV-based movement
const newUV = surface.moveOnSurface(u, v, du, dv);  // Shape-dependent!
player.surfaceU = newUV.u;
player.surfaceV = newUV.v;
```

The `moveOnSurface()` function tries to handle wrapping/clamping but cannot fix the fundamental singularity problem.

### Solution: Mesh-Based Surface Walking
Replace UV system with world-space raycasting:

```javascript
// CORRECT: Mesh-based movement
// 1. Calculate desired movement in world space (tangent to surface)
const moveDir = tangent.multiplyScalar(inputX).add(bitangent.multiplyScalar(inputY));
const newWorldPos = currentPos.add(moveDir.multiplyScalar(speed * dt));

// 2. Project back onto mesh surface via raycast
const rayOrigin = newWorldPos.add(normal.multiplyScalar(10)); // Above surface
const rayDir = normal.clone().negate(); // Pointing at surface
const hit = raycaster.intersectObject(mesh);
if (hit.length > 0) {
  player.position.copy(hit[0].point);
  player.normal = hit[0].face.normal;
}
```

Benefits:
- Works for ANY mesh (cup, statue, arbitrary shape)
- Uniform speed everywhere (no singularities)
- No shape-specific code needed

---

## ISSUE: Bullets Use Spherical Great-Circle Paths

### Problem
Bullets are hardcoded to travel in spherical great circles, even on torus/cube:

```javascript
// From Bullet.ts - WRONG for non-spheres
const targetRadius = b.sphereRadius > 0 ? b.sphereRadius : this.sphereRadius;
line.position.multiplyScalar(targetRadius / currentDist);  // Projects onto SPHERE
```

### Solution
Bullets should use the same mesh-based movement as player:
1. Move in world-space direction
2. Raycast back onto surface each frame
3. Update direction to stay tangent to surface

---

## ISSUE: No Visual Distinction for Far-Side Entities

### Problem
Enemies on the back of a shape (through the surface) look identical to nearby enemies.

### Solution
Depth-based opacity:
```javascript
// Compare entity position to camera position relative to surface center
const toCam = camera.position.clone().sub(surfaceCenter);
const toEntity = entity.position.clone().sub(surfaceCenter);
const dot = toCam.dot(toEntity);
const opacity = dot > 0 ? 1.0 : 0.3; // Back side = faint
entity.material.opacity = opacity;
```

---

## FAILED APPROACHES LOG

### Approach 1: UV Parameterization (FAILED)
- **What**: Store positions as (u, v) coordinates, use `moveOnSurface()`
- **Why Failed**: Pole singularities, shape-dependent, varying speeds
- **Lesson**: Cannot fix mathematically - need different approach entirely

### Approach 2: Hamster Ball Rotation (FAILED)
- **What**: Player fixed at center, surface rotates under them
- **Why Failed**: Doesn't work for non-convex shapes, confusing for multiplayer
- **Lesson**: Player must actually move on surface

---

## WORKING APPROACHES

### Mesh-Based Movement with three-mesh-bvh (IMPLEMENTED)
- **Source**: https://github.com/gkjohnson/three-mesh-bvh
- **How**: BVH acceleration for fast `closestPointToPoint()` on any mesh
- **Key files**:
  - `src/experimental/mesh-movement/MeshSurface.ts` - BVH wrapper
  - `src/experimental/mesh-movement/MeshWalker.ts` - Entity movement
  - `src/experimental/mesh-movement/MeshBullet.ts` - Surface-following bullets (standalone)
  - `src/entities/Bullet.ts` - Modified to use `MeshSurface` when available
  - `src/main.ts` - Integrated: player uses MeshWalker, bullets use MeshSurface
- **Status**: INTEGRATED into main game. Player movement + bullets use BVH.
  - Enemies/geoms still use UV (bridged via `surface.worldToSurface()`)
  - 24 automated tests passing (pole traversal, speed constancy, multi-shape)
- **Test results**: Verified on sphere, torus, cube, knot, cylinder via Puppeteer screenshots

---

## Testing Requirements

### Movement Tests
1. Walk to "top" of sphere - should be able to continue over and down other side
2. Walk in circle at any position - should maintain constant speed
3. Load arbitrary OBJ mesh - movement should work identically

### Bullet Tests
1. Shoot on sphere - bullet follows surface curve
2. Shoot on torus - bullet follows torus surface (NOT spherical)
3. Shoot on cube - bullet follows cube faces and edges

### Visual Tests
- Enemies behind surface should be visibly fainter
- Player always centered regardless of surface position

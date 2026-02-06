# 3D Surface Movement Research

## Overview

This document summarizes research on approaches for moving entities along 3D surfaces in games like Geometry Wars 3: Dimensions.

## Approaches Evaluated

### 1. UV-Based Surface Parameterization (CURRENT)

**How it works:**
- Surface is parameterized with U,V coordinates (0-1 range)
- Entities store their position as (u, v) coordinates
- `moveOnSurface(u, v, du, dv)` handles movement with proper wrapping/clamping
- `getPoint(u, v)` returns world position, normal, and tangents
- Camera follows player along surface normal

**Pros:**
- Simple to implement for parametric surfaces (sphere, torus, cylinder)
- Clean separation between surface and entity logic
- Works well for smooth, regular shapes

**Cons:**
- Requires explicit parameterization for each surface type
- Pole singularities on spheres (need special handling)
- Doesn't work well for irregular/arbitrary meshes without UV unwrapping

**Best for:** Geometry Wars-style game with pre-defined geometric shapes

### 2. Mesh Walking / Triangle Traversal

**How it works:**
- Entity position stored as (triangleIndex, barycentricCoords)
- Movement crosses triangle edges, transitioning to adjacent triangles
- Uses half-edge data structure for efficient neighbor lookup

**Libraries:**
- [three-mesh-bvh](https://github.com/gkjohnson/three-mesh-bvh) - Fast raycasting and spatial queries
- Half-edge data structures for mesh traversal

**Pros:**
- Works for ANY mesh geometry
- No UV unwrapping needed
- Physically accurate surface following

**Cons:**
- Complex to implement correctly
- Edge cases at mesh boundaries
- Performance overhead for large meshes

**Best for:** Arbitrary/irregular mesh surfaces

### 3. Geodesic Paths (Heat Method)

**How it works:**
- Compute geodesic distances using heat diffusion
- Solve sparse linear system for distance field
- Move along gradient of distance field

**Libraries:**
- [ddg-exercises-js](https://github.com/cmu-geometry/ddg-exercises-js) - Heat method implementation
- [geodesic-computation](https://github.com/sywe1/geodesic-computation) - Fast Marching and Heat methods

**Pros:**
- True shortest paths on surfaces
- Smooth movement along geodesics
- Mathematically elegant

**Cons:**
- Computationally expensive for real-time updates
- Requires mesh preprocessing
- Overkill for simple game movement

**Best for:** Pathfinding, AI navigation, smooth camera paths

### 4. Gravity-Based (Mario Galaxy Style)

**How it works:**
- Define gravity direction per surface point (toward surface center)
- Raycast downward to find surface
- Align entity to surface normal

**Libraries:**
- [recast-navigation-js](https://github.com/isaac-mason/recast-navigation-js) - Navigation mesh generation
- [three-pathfinding](https://github.com/donmccurdy/three-pathfinding) - Nav mesh utilities

**Pros:**
- Intuitive "gravity" metaphor
- Works with physics engines
- Handles complex terrain

**Cons:**
- Need to handle multi-surface scenarios
- Raycast performance overhead
- Can have jitter/instability

**Best for:** Open-world 3D platformers with gravity mechanics

### 5. World Rotation (Hamster Ball)

**How it works:**
- Player stays at fixed world position
- Surface rotates based on input
- All entities rotate with surface

**Pros:**
- Player always visible at screen center
- Simple camera setup

**Cons:**
- Doesn't work for non-convex shapes
- Unintuitive for irregular meshes
- Hard to coordinate multiplayer

**Status:** REJECTED - User explicitly said this doesn't work well

## Recommendation for Geometry Wars Clone

**Primary:** UV-Based Parameterization (current implementation)
- Works for all predefined shapes (sphere, torus, cube, cylinder, peanut, capsule)
- Simple and performant
- Clean code architecture

**Enhancement for Irregular Meshes:** Add Mesh Walking support
- Use three-mesh-bvh for efficient collision detection
- Implement triangle traversal for cup/irregular shapes
- Keep UV system for regular shapes, fall back to mesh walking for others

## Key Implementation Details

### Camera Following (Critical)
```javascript
// Camera follows player along surface normal
const cameraDistance = 15;
game.camera.position.copy(surfacePoint.position)
  .add(playerNormal.clone().multiplyScalar(cameraDistance));
game.camera.lookAt(surfacePoint.position);
game.camera.up.copy(tangentV);  // Prevents camera flipping
```

### Screen-Space Aiming
```javascript
// Project mouse aim onto surface tangent plane
const camRight = new THREE.Vector3();
const camUp = new THREE.Vector3();
camera.matrixWorld.extractBasis(camRight, camUp, new THREE.Vector3());

const screenAim = camRight.multiplyScalar(aimX)
  .add(camUp.multiplyScalar(-aimY));
const dot = screenAim.dot(playerNormal);
aimDirection = screenAim.sub(playerNormal.multiplyScalar(dot)).normalize();
```

### Bullet Surface Following
- Bullets spawn at player world position
- Travel along great circles on sphere surfaces
- Project back onto surface each frame

## GitHub Repos for Reference

- [Geometry-Wars-WebGL](https://github.com/davertron/Geometry-Wars-WebGL) - Three.js clone (2D planes)
- [gwbase](https://github.com/russellklenk/gwbase) - C++ Geometry Wars clone
- [three-mesh-bvh](https://github.com/gkjohnson/three-mesh-bvh) - BVH for fast raycasting
- [recast-navigation-js](https://github.com/isaac-mason/recast-navigation-js) - Nav mesh generation

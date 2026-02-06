# three-mesh-bvh API Reference

> Library: [three-mesh-bvh](https://github.com/gkjohnson/three-mesh-bvh)
> Purpose: BVH acceleration for raycasting and spatial queries on Three.js meshes
> Researched: 2026-02-06

---

## Installation

```bash
npm install three-mesh-bvh
```

## Imports

```typescript
import {
  MeshBVH,
  MeshBVHHelper,
  StaticGeometryGenerator,
  ExtendedTriangle,
  OrientedBox,
  computeBoundsTree,
  disposeBoundsTree,
  acceleratedRaycast,
  CENTER, AVERAGE, SAH,
  NOT_INTERSECTED, INTERSECTED, CONTAINED,
} from 'three-mesh-bvh';
```

---

## Core Interfaces (TypeScript)

```typescript
interface HitPointInfo {
  point: Vector3;      // Closest point on mesh surface
  distance: number;    // Distance from query point
  faceIndex: number;   // Index of the triangle hit
}

interface BVHOptions {
  strategy?: number;              // CENTER | AVERAGE | SAH (default: CENTER)
  maxDepth?: number;              // Max tree depth (default: 40)
  maxLeafTris?: number;           // Alias for maxLeafSize
  maxLeafSize?: number;           // Target tris per leaf (default: 10)
  setBoundingBox?: boolean;       // Auto-compute bounds (default: true)
  useSharedArrayBuffer?: boolean; // Use SharedArrayBuffer (default: false)
  indirect?: boolean;             // Preserve index layout (default: false)
  verbose?: boolean;              // Log warnings (default: true)
  onProgress?: (progress: number) => void;
  range?: { start: number; count: number };
}

interface ShapecastCallbacks {
  boundsTraverseOrder?: (box: Box3) => number;
  intersectsBounds: (
    box: Box3,
    isLeaf: boolean,
    score: number | undefined,
    depth: number,
    nodeIndex: number
  ) => number | boolean;  // NOT_INTERSECTED | INTERSECTED | CONTAINED or boolean
  intersectsRange?: (
    offset: number,
    count: number,
    contained: boolean,
    depth: number,
    nodeIndex: number,
    box: Box3
  ) => boolean;
  intersectsTriangle?: (
    triangle: ExtendedTriangle,
    triangleIndex: number,
    contained: boolean,
    depth: number
  ) => boolean | void;
}
```

### Constants

```typescript
// Split strategies (for BVHOptions.strategy)
CENTER   // Fast; splits along axis midpoint
AVERAGE  // Balanced; splits at centroid mean
SAH      // Optimal; tests 32 splits per axis (slower construction)

// Shapecast return values (from intersectsBounds)
NOT_INTERSECTED  // No intersection, skip subtree
INTERSECTED      // Partial overlap, continue traversal into children
CONTAINED        // Shape fully encloses bounds, optimize traversal
```

---

## MeshBVH Class

### Constructor

```typescript
constructor(geometry: BufferGeometry, options?: BVHOptions): MeshBVH
```

Creates a BVH from a triangle mesh geometry. **The geometry's index buffer is reorganized** unless `indirect: true` is set.

```typescript
const bvh = new MeshBVH(geometry, {
  strategy: SAH,
  maxLeafSize: 10,
});
geometry.boundsTree = bvh;
```

---

### raycast()

```typescript
raycast(
  ray: Ray,
  materialOrSide?: Side | Material | Material[],
  near?: number,
  far?: number
): Intersection[]
```

Returns **all** intersection hits (unsorted). Results are in BVH local coordinates.

**Returns:** Array of Three.js `Intersection` objects:
```typescript
{
  point: Vector3,
  distance: number,
  faceIndex: number,
  face: { a: number, b: number, c: number, normal: Vector3, materialIndex: number },
  object: Object3D,
  uv?: Vector2
}
```

**Example:**
```typescript
const ray = new THREE.Ray(origin, direction);
const hits = bvh.raycast(ray, THREE.DoubleSide);
hits.sort((a, b) => a.distance - b.distance); // Sort by distance if needed
```

---

### raycastFirst()

```typescript
raycastFirst(
  ray: Ray,
  materialOrSide?: Side | Material | Material[],
  near?: number,
  far?: number
): Intersection | null
```

Returns only the **closest** intersection. Typically **several times faster** than `raycast()`.

**Returns:** Single `Intersection` object or `null`.

**Example:**
```typescript
const hit = bvh.raycastFirst(ray, THREE.DoubleSide);
if (hit) {
  console.log(`Hit at distance ${hit.distance}, face ${hit.faceIndex}`);
  console.log(`Point: ${hit.point.x}, ${hit.point.y}, ${hit.point.z}`);
}
```

---

### closestPointToPoint()

```typescript
closestPointToPoint(
  point: Vector3,
  target?: HitPointInfo,
  minThreshold?: number,
  maxThreshold?: number
): HitPointInfo | null
```

Finds the nearest point on the mesh surface to a given point.

**Parameters:**
- `point` - Query point in BVH local space
- `target` - Optional reusable result object
- `minThreshold` - Early exit if distance is less than this (optimization)
- `maxThreshold` - Ignore points farther than this (optimization)

**Returns:**
```typescript
{
  point: Vector3,     // Closest point on mesh surface
  distance: number,   // Distance from query point to closest point
  faceIndex: number   // Triangle index containing the closest point
}
```

**Example:**
```typescript
const target: HitPointInfo = {
  point: new THREE.Vector3(),
  distance: Infinity,
  faceIndex: -1,
};

const result = bvh.closestPointToPoint(
  new THREE.Vector3(5, 0, 0),
  target,
  0,    // minThreshold
  10    // maxThreshold - ignore anything farther than 10 units
);

if (result) {
  console.log(`Closest surface point: ${result.point.toArray()}`);
  console.log(`Distance: ${result.distance}`);
  console.log(`On triangle: ${result.faceIndex}`);
}
```

**Key for Geometry Wars:** This is the primary method for snapping entities to surface. Given any world position, find the closest point on the surface mesh.

---

### closestPointToGeometry()

```typescript
closestPointToGeometry(
  geometry: BufferGeometry,
  geometryToBvh: Matrix4,
  target1?: HitPointInfo,
  target2?: HitPointInfo,
  minThreshold?: number,
  maxThreshold?: number
): HitPointInfo | null
```

Finds closest points between two geometries. Performance improves significantly if the other geometry also has a `boundsTree`.

**Parameters:**
- `geometry` - The other geometry to test against
- `geometryToBvh` - Matrix transforming the other geometry into this BVH's local space
- `target1` - Result: closest point on THIS mesh (BVH frame)
- `target2` - Result: closest point on OTHER geometry (geometry frame)
- `minThreshold` - Early exit optimization
- `maxThreshold` - Distance cutoff optimization

**Returns:** `target1` (the HitPointInfo for this BVH's mesh), or `null`.

**Example:**
```typescript
const target1: HitPointInfo = { point: new THREE.Vector3(), distance: Infinity, faceIndex: -1 };
const target2: HitPointInfo = { point: new THREE.Vector3(), distance: Infinity, faceIndex: -1 };

// Transform from enemy's local space to surface BVH's local space
const enemyToSurface = new THREE.Matrix4()
  .copy(surfaceMesh.matrixWorld).invert()
  .multiply(enemyMesh.matrixWorld);

const result = surfaceBvh.closestPointToGeometry(
  enemyMesh.geometry,
  enemyToSurface,
  target1,  // Closest point on surface
  target2,  // Closest point on enemy
  0,
  5.0       // Only care about distances < 5
);

if (result) {
  console.log(`Surface point: ${target1.point.toArray()}`);
  console.log(`Enemy point: ${target2.point.toArray()}`);
  console.log(`Gap: ${target1.distance}`);
}
```

---

### shapecast()

```typescript
shapecast(callbacks: ShapecastCallbacks): boolean
```

**The most powerful and flexible method.** Generalized BVH traversal with custom shape intersection logic. Returns `true` when first triangle callback returns `true`.

**Callback flow:**
1. `boundsTraverseOrder(box)` - Return score to order child node traversal (e.g., distance for nearest-first)
2. `intersectsBounds(box, isLeaf, score, depth, nodeIndex)` - Broad phase: does your shape overlap this AABB?
   - Return `NOT_INTERSECTED` to skip subtree
   - Return `INTERSECTED` to continue into children
   - Return `CONTAINED` to optimize (mark all children as contained)
3. `intersectsRange(offset, count, contained, depth, nodeIndex, box)` - Batch-test triangle ranges
4. `intersectsTriangle(triangle, triangleIndex, contained, depth)` - Narrow phase: test individual triangles
   - Return `true` to stop traversal immediately
   - Return `false` or `void` to continue

**Example - Sphere intersection query:**
```typescript
const sphere = new THREE.Sphere(center, radius);
const hitTriangles: number[] = [];

bvh.shapecast({
  intersectsBounds: (box) => {
    return box.intersectsSphere(sphere) ? INTERSECTED : NOT_INTERSECTED;
  },
  intersectsTriangle: (tri, triIndex) => {
    if (tri.intersectsSphere(sphere)) {
      hitTriangles.push(triIndex);
    }
    return false; // Continue searching (don't stop at first hit)
  }
});
```

**Example - Capsule collision (from character movement demo):**
```typescript
const capsuleInfo = {
  radius: 0.5,
  segment: new THREE.Line3(
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(0, -1.0, 0)
  )
};

const tempBox = new THREE.Box3();
const tempVector = new THREE.Vector3();
const tempVector2 = new THREE.Vector3();
const tempSegment = new THREE.Line3();

// Transform capsule segment to collider local space
tempSegment.copy(capsuleInfo.segment);
tempSegment.start.applyMatrix4(player.matrixWorld).applyMatrix4(colliderInverse);
tempSegment.end.applyMatrix4(player.matrixWorld).applyMatrix4(colliderInverse);

// Build bounding box around capsule
tempBox.makeEmpty();
tempBox.expandByPoint(tempSegment.start);
tempBox.expandByPoint(tempSegment.end);
tempBox.min.addScalar(-capsuleInfo.radius);
tempBox.max.addScalar(capsuleInfo.radius);

// Shapecast for collision
colliderBvh.shapecast({
  intersectsBounds: (box) => box.intersectsBox(tempBox),
  intersectsTriangle: (tri) => {
    const triPoint = tempVector;
    const capsulePoint = tempVector2;
    const distance = tri.closestPointToSegment(tempSegment, triPoint, capsulePoint);

    if (distance < capsuleInfo.radius) {
      const depth = capsuleInfo.radius - distance;
      const direction = capsulePoint.sub(triPoint).normalize();
      // Push capsule out of collision
      tempSegment.start.addScaledVector(direction, depth);
      tempSegment.end.addScaledVector(direction, depth);
    }
    return false; // Check all triangles
  }
});
```

---

### intersectsSphere()

```typescript
intersectsSphere(sphere: Sphere): boolean
```

Fast boolean test: does any triangle in the mesh intersect the sphere?

```typescript
const sphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), 2.0);
if (bvh.intersectsSphere(sphere)) {
  console.log('Collision detected!');
}
```

---

### intersectsBox()

```typescript
intersectsBox(box: Box3, boxToMesh: Matrix4): boolean
```

Boolean test for box-mesh intersection. `boxToMesh` transforms the box into mesh local space.

---

### intersectsGeometry()

```typescript
intersectsGeometry(geometry: BufferGeometry, geometryToBvh: Matrix4): boolean
```

Boolean geometry-to-geometry intersection test. Both geometries having a `boundsTree` improves performance.

---

### refit()

```typescript
refit(nodeIndices?: number[] | Set<number>): void
```

Updates bounding boxes after vertex positions change. Faster than rebuilding the entire BVH. Pass specific node indices to refit only affected branches.

---

### getBoundingBox()

```typescript
getBoundingBox(target: Box3): Box3
```

Returns mesh bounding box from BVH root (faster than `geometry.computeBoundingBox()`).

---

## Serialization

```typescript
// Serialize for WebWorker transfer or caching
const serialized = MeshBVH.serialize(bvh, { cloneBuffers: true });

// Deserialize
const restored = MeshBVH.deserialize(serialized, geometry, { setIndex: true });
geometry.boundsTree = restored;
```

---

## BufferGeometry Extensions

Register once at app startup:

```typescript
import { computeBoundsTree, disposeBoundsTree, acceleratedRaycast } from 'three-mesh-bvh';

THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;
THREE.Mesh.prototype.raycast = acceleratedRaycast;
```

Then use on any geometry:

```typescript
geometry.computeBoundsTree({ strategy: SAH });
// ...later...
geometry.disposeBoundsTree();
```

For raycasting, set `raycaster.firstHitOnly = true` to use the optimized `raycastFirst()` path:

```typescript
const raycaster = new THREE.Raycaster();
raycaster.firstHitOnly = true;
const hits = raycaster.intersectObject(mesh);
```

---

## ExtendedTriangle Class

Extended `THREE.Triangle` with cached intersection data. Used in `shapecast` callbacks.

```typescript
class ExtendedTriangle extends Triangle {
  needsUpdate: boolean;  // Set true after modifying a, b, c

  intersectsTriangle(other: Triangle, target?: Line3): boolean;
  intersectsSphere(sphere: Sphere): boolean;
  closestPointToSegment(
    segment: Line3,
    target1?: Vector3,  // Closest point on triangle
    target2?: Vector3   // Closest point on segment
  ): number;            // Returns distance
  distanceToPoint(point: Vector3): number;
  distanceToTriangle(tri: Triangle): number;
}
```

**Key method for character collision:**
`closestPointToSegment()` is used in capsule collision to find the closest point between a triangle and the capsule's line segment. Returns the distance; if distance < capsule radius, there's a collision.

---

## OrientedBox Class

```typescript
class OrientedBox {
  min: Vector3;
  max: Vector3;
  matrix: Matrix4;
  needsUpdate: boolean;

  set(min: Vector3, max: Vector3, matrix: Matrix4): OrientedBox;
  intersectsBox(box: Box3): boolean;
  intersectsTriangle(tri: Triangle): boolean;
  closestPointToPoint(point: Vector3, target?: Vector3): number;
  distanceToPoint(point: Vector3): number;
  distanceToBox(box: Box3, threshold?: number, target1?: Vector3, target2?: Vector3): number;
}
```

---

## StaticGeometryGenerator

Merges multiple meshes into a single geometry for efficient BVH construction:

```typescript
class StaticGeometryGenerator {
  useGroups: boolean;
  attributes: string[];          // Which attributes to include
  applyWorldTransforms: boolean;

  constructor(objects: Object3D[] | Object3D);
  getMaterials(): Material[];
  generate(target?: BufferGeometry): BufferGeometry;
}
```

**Example:**
```typescript
const generator = new StaticGeometryGenerator(levelGroup);
generator.attributes = ['position']; // Only need position for collision
const mergedGeometry = generator.generate();
mergedGeometry.boundsTree = new MeshBVH(mergedGeometry);
```

---

## MeshBVHHelper

Visualizes the BVH tree structure for debugging:

```typescript
const helper = new MeshBVHHelper(mesh, /* depth */ 10);
helper.color.set(0x00ff88);
helper.opacity = 0.3;
helper.displayEdges = true;
helper.displayParents = false;
scene.add(helper);

// Call after BVH changes
helper.update();

// Cleanup
helper.dispose();
```

---

## Complete Character Movement Example

From the official three-mesh-bvh character movement demo:

```typescript
import * as THREE from 'three';
import { MeshBVH, StaticGeometryGenerator } from 'three-mesh-bvh';

// --- Setup ---
const playerVelocity = new THREE.Vector3();
let playerIsOnGround = false;
const gravity = -30;

const capsuleInfo = {
  radius: 0.5,
  segment: new THREE.Line3(
    new THREE.Vector3(),
    new THREE.Vector3(0, -1.0, 0.0)
  ),
};

// Build collider from level geometry
const generator = new StaticGeometryGenerator(levelGroup);
generator.attributes = ['position'];
const colliderGeometry = generator.generate();
colliderGeometry.boundsTree = new MeshBVH(colliderGeometry, { maxLeafSize: 10 });
const collider = new THREE.Mesh(colliderGeometry);

// Temp variables (reused each frame to avoid GC)
const tempMat = new THREE.Matrix4();
const tempSegment = new THREE.Line3();
const tempBox = new THREE.Box3();
const tempVector = new THREE.Vector3();
const tempVector2 = new THREE.Vector3();

// --- Per-Frame Update ---
function updatePlayer(delta: number) {
  // 1. Apply gravity
  if (playerIsOnGround) {
    playerVelocity.y = delta * gravity;
  } else {
    playerVelocity.y += delta * gravity;
  }

  // 2. Apply movement input (WASD relative to camera)
  // ... (apply input forces to playerVelocity.x/z) ...

  // 3. Move player by velocity
  player.position.addScaledVector(playerVelocity, delta);

  // 4. Resolve collisions with BVH
  // Transform capsule into collider local space
  tempMat.copy(collider.matrixWorld).invert();
  tempSegment.copy(capsuleInfo.segment);
  tempSegment.start.applyMatrix4(player.matrixWorld).applyMatrix4(tempMat);
  tempSegment.end.applyMatrix4(player.matrixWorld).applyMatrix4(tempMat);

  // Expand bounding box around capsule
  tempBox.makeEmpty();
  tempBox.expandByPoint(tempSegment.start);
  tempBox.expandByPoint(tempSegment.end);
  tempBox.min.addScalar(-capsuleInfo.radius);
  tempBox.max.addScalar(capsuleInfo.radius);

  // 5. Shapecast: push capsule out of all intersecting triangles
  collider.geometry.boundsTree.shapecast({
    intersectsBounds: (box) => box.intersectsBox(tempBox),
    intersectsTriangle: (tri) => {
      const triPoint = tempVector;
      const capsulePoint = tempVector2;
      const distance = tri.closestPointToSegment(
        tempSegment, triPoint, capsulePoint
      );

      if (distance < capsuleInfo.radius) {
        const depth = capsuleInfo.radius - distance;
        const direction = capsulePoint.sub(triPoint).normalize();
        tempSegment.start.addScaledVector(direction, depth);
        tempSegment.end.addScaledVector(direction, depth);
      }
      return false; // Continue checking all triangles
    }
  });

  // 6. Apply collision correction back to world space
  const newPosition = tempVector;
  newPosition
    .copy(tempSegment.start)
    .applyMatrix4(collider.matrixWorld);

  const deltaVector = tempVector2;
  deltaVector.subVectors(newPosition, player.position);

  // 7. Ground detection: if pushed upward, we're on the ground
  playerIsOnGround = deltaVector.y > Math.abs(delta * playerVelocity.y * 0.25);

  // 8. Apply position correction with small offset to prevent tunneling
  const offset = Math.max(0.0, deltaVector.length() - 1e-5);
  deltaVector.normalize().multiplyScalar(offset);
  player.position.add(deltaVector);

  // 9. Adjust velocity based on collision
  if (!playerIsOnGround) {
    // Remove velocity component going into the collision surface
    deltaVector.normalize();
    playerVelocity.addScaledVector(deltaVector, -deltaVector.dot(playerVelocity));
  } else {
    playerVelocity.set(0, 0, 0);
  }
}
```

---

## Geometry Wars Application Notes

### Surface Snapping (Player/Enemy/Bullet)

For entities that must stay on a surface, use `closestPointToPoint()`:

```typescript
// Build BVH for the game surface once
const surfaceBvh = new MeshBVH(surfaceMesh.geometry, { strategy: SAH });
surfaceMesh.geometry.boundsTree = surfaceBvh;

// Each frame: snap entity to surface
const hitInfo = { point: new THREE.Vector3(), distance: 0, faceIndex: 0 };
const result = surfaceBvh.closestPointToPoint(entity.position, hitInfo);
if (result) {
  entity.position.copy(result.point);
  // Get surface normal from the triangle for orientation
  const tri = new THREE.Triangle();
  const posAttr = surfaceMesh.geometry.getAttribute('position');
  const idx = surfaceMesh.geometry.getIndex();
  const i0 = idx.getX(result.faceIndex * 3);
  const i1 = idx.getX(result.faceIndex * 3 + 1);
  const i2 = idx.getX(result.faceIndex * 3 + 2);
  tri.a.fromBufferAttribute(posAttr, i0);
  tri.b.fromBufferAttribute(posAttr, i1);
  tri.c.fromBufferAttribute(posAttr, i2);
  const normal = new THREE.Vector3();
  tri.getNormal(normal);
  // Use normal for camera/entity orientation
}
```

### Entity-Entity Collision via BVH

For bullet-enemy or player-enemy collision on curved surfaces:

```typescript
// Option 1: closestPointToPoint for point entities
const result = enemyBvh.closestPointToPoint(bulletPosition);
if (result && result.distance < collisionRadius) {
  // Hit!
}

// Option 2: intersectsSphere for radius-based entities
const sphere = new THREE.Sphere(entityPosition, entityRadius);
if (surfaceBvh.intersectsSphere(sphere)) {
  // Touching surface
}
```

### Raycasting for Shooting

```typescript
const ray = new THREE.Ray(playerPosition, aimDirection);
const hit = surfaceBvh.raycastFirst(ray, THREE.DoubleSide);
if (hit) {
  // Bullet endpoint on surface
  spawnImpactEffect(hit.point, hit.face.normal);
}
```

---

## Performance Tips

1. Use `SAH` strategy for static geometry (better queries, slower build)
2. Use `CENTER` for geometry that gets rebuilt frequently
3. `maxLeafSize: 10` is a good default
4. Reuse `HitPointInfo` target objects to avoid GC pressure
5. Use `maxThreshold` on `closestPointToPoint` to limit search radius
6. `raycastFirst()` is several times faster than `raycast()` for single-hit queries
7. Merge static geometry with `StaticGeometryGenerator` for single BVH
8. Use `indirect: true` if you need to preserve the original index buffer

# Developer Guide: Custom Mesh System Architecture

> This guide explains how the custom mesh system works, how to extend it, and how to debug issues. Audience: developers extending the codebase.

## Architecture Overview

The custom mesh system is built on four core components:

```
File Loading (MeshLoader)
    ↓
Geometry Merging & Normalization
    ↓
Surface Abstraction (LoadedMeshSurface)
    ↓
BVH-Accelerated Queries (MeshSurface)
    ↓
Enemy Movement & Rendering
```

### 1. MeshLoader — File I/O & Geometry Processing

**File:** `src/loaders/MeshLoader.ts`

**Responsibility:** Load 3D models from URLs or File objects, extract geometry, merge multi-mesh models, and normalize size.

**Key Functions:**

```typescript
// Load from URL
export async function loadMeshFromURL(url: string, targetRadius: number = 8): Promise<LoadedMesh>

// Load from File object (drag-and-drop, file input)
export async function loadMeshFromFile(file: File, targetRadius: number = 8): Promise<LoadedMesh>

// Return type
interface LoadedMesh {
  mesh: THREE.Mesh;              // The final, walkable mesh
  originalSize: THREE.Vector3;   // Original bounding box dimensions
  scaleFactor: number;           // Scale factor applied for normalization
  triangleCount: number;         // Triangle count in merged geometry
}
```

**Algorithm:**

1. **Detect file type** from filename (`.obj`, `.glb`, `.gltf`)
2. **Parse file** using OBJLoader or GLTFLoader
3. **Extract geometries** from the loaded object hierarchy (handles multi-mesh models)
4. **Apply world transforms** to each geometry (ensures merged result is in unified space)
5. **Merge geometries** using `mergeGeometries()` (strips to position-only to avoid attribute mismatches)
6. **Normalize size** to fit target radius (default: 16 units)
7. **Compute normals** for rendering and queries

**Error Handling:**

Throws with user-friendly messages:
- `Unsupported file type: ${url}. Use .obj, .glb, or .gltf`
- `Failed to load mesh — ${reason}`
- `No mesh geometry found in loaded model`
- `Failed to merge geometries`

### 2. LoadedMeshSurface — Surface Abstraction Layer

**File:** `src/surfaces/LoadedMeshSurface.ts`

**Responsibility:** Implement the Surface interface for arbitrary loaded meshes, enabling UV-based enemy movement via spherical projection + BVH snapping.

**Key Methods:**

```typescript
class LoadedMeshSurface extends Surface {
  // Get a point on the surface at UV coordinates (u, v) ∈ [0,1]×[0,1]
  getPoint(u: number, v: number): SurfacePoint

  // Move on the surface from (u, v) by (du, dv) in UV space
  moveOnSurface(u: number, v: number, du: number, dv: number): { u: number; v: number }

  // Convert world position back to UV coordinates
  worldToSurface(worldPos: THREE.Vector3): { u: number; v: number }

  // UV wrapping behavior
  wrapUV(u: number, v: number): { u: number; v: number }
  get wrapsU(): boolean  // true (longitude wraps)
  get wrapsV(): boolean  // false (has poles)
}
```

**UV Mapping Strategy:**

Since arbitrary meshes don't have pre-baked UV coordinates, the system uses **spherical projection**:

1. **Spherical coordinate conversion:**
   - `u ∈ [0, 1]` maps to θ ∈ [0, 2π] (longitude, wraps)
   - `v ∈ [0, 1]` maps to φ ∈ [0, π] (latitude, clamps)

2. **Ray-casting to surface:**
   - Compute direction vector from sphere center using (θ, φ)
   - Ray-cast from outside the bounding sphere toward center
   - If ray hits mesh → use hit point
   - If ray misses → fall back to closest-point-on-surface

3. **Movement in UV space:**
   - Get current point at (u, v)
   - Compute world displacement using tangent frame and bounding sphere circumference
   - Move in world space using MeshSurface.moveOnSurface()
   - Convert new position back to UV coordinates

**Why This Works:**

- Every (u, v) ∈ [0,1]² maps to a valid point on the mesh surface
- Wrapping is automatic (longitude wraps, latitude has poles)
- Works for **any** mesh topology (sphere, torus, bunny, your own creations)
- BVH snapping ensures movement is on the actual geometry, not in space

**UV Grid Visualization:**

The system can render longitude/latitude grid lines:
```typescript
// Visible grid overlay (useful for debugging)
createGrid(): THREE.LineSegments
```

### 3. MeshSurface — BVH-Accelerated Queries

**File:** `src/surfaces/MeshSurface.ts`

**Responsibility:** Perform efficient geometric queries on arbitrary meshes using BVH acceleration. Used by LoadedMeshSurface for ray-casting and surface movement.

**Key Methods:**

```typescript
class MeshSurface {
  // Ray-cast onto the mesh surface
  raycastOntoSurface(rayOrigin: Vector3, rayDirection: Vector3): { point: Vector3; normal: Vector3; distance: number }

  // Find closest point on mesh surface to a given world position
  closestPointOnSurface(position: Vector3): { point: Vector3; normal: Vector3; distance: number }

  // Move on surface from `fromPoint` with `direction` for `distance`
  moveOnSurface(fromPoint: Vector3, fromNormal: Vector3, direction: Vector3, distance: number): { point: Vector3; normal: Vector3 }

  // Get tangent frame (tangent, bitangent) at a given normal
  getTangentFrame(normal: Vector3): { tangent: Vector3; bitangent: Vector3 }
}
```

**BVH Build Time:**

- ~2ms per 10k triangles
- ~5ms per 50k triangles
- Built once on load

**BVH Rebuild (Animated Meshes):**

For animated meshes (geometry changes each frame):
- BVH is invalidated when the mesh updates
- Rebuild cost: ~5ms per 50k triangles per frame
- **Recommendation:** Keep animated maps **< 30k triangles** for 60 FPS

### 4. CustomMeshRegistry — Multi-Mesh Management

**File:** `src/loaders/CustomMeshRegistry.ts`

**Responsibility:** Load and cache multiple meshes, manage memory with LRU eviction.

**Key Methods:**

```typescript
class CustomMeshRegistry {
  // Load or retrieve a mesh from cache
  async getMesh(id: string, url: string): Promise<LoadedMesh>

  // Switch to a different mesh (e.g., M key to cycle)
  switchMesh(newId: string): LoadedMeshSurface

  // Clear cache
  clear(): void

  // Get cache statistics
  getStats(): { total: number; cached: number; memoryUsage: number }
}
```

**LRU Eviction:**

- Default cache size: 100 MB
- When cache exceeds limit: least-recently-used mesh is evicted
- Useful for games with 5+ custom maps loaded

## How to Extend the System

### Adding Support for a New File Format

Example: adding FBX support

1. **Import the loader:**
   ```typescript
   import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
   ```

2. **Update detectFileType():**
   ```typescript
   function detectFileType(filename: string): MeshFileType | null {
     const lower = filename.toLowerCase();
     if (lower.endsWith('.obj')) return 'obj';
     if (lower.endsWith('.glb')) return 'glb';
     if (lower.endsWith('.gltf')) return 'gltf';
     if (lower.endsWith('.fbx')) return 'fbx';  // NEW
     return null;
   }
   ```

3. **Add FBX parsing to loadMeshFromURL():**
   ```typescript
   } else if (fileType === 'fbx') {
     const loader = new FBXLoader();
     root = await loader.loadAsync(url);
   }
   ```

4. **Test with sample FBX model**

### Custom UV Mapping Strategy

If you want non-spherical projection (e.g., cylindrical for pipes, polar for concentric rings):

1. **Subclass LoadedMeshSurface:**
   ```typescript
   class CylindricalMeshSurface extends LoadedMeshSurface {
     getPoint(u: number, v: number): SurfacePoint {
       // Custom cylindrical mapping instead of spherical
       const theta = u * Math.PI * 2;
       const height = v * someHeight;
       // ... custom ray-cast and snap logic ...
     }
   }
   ```

2. **Override in LoadedMeshSurface factory:**
   ```typescript
   export function createSurfaceForMesh(loadedMesh: LoadedMesh, projectionType: 'spherical' | 'cylindrical' = 'spherical') {
     if (projectionType === 'cylindrical') {
       return new CylindricalMeshSurface(loadedMesh);
     }
     return new LoadedMeshSurface(loadedMesh);
   }
   ```

### LOD Generation

If you want automatic level-of-detail:

1. **In MeshLoader.normalizeSize(), after merge:**
   ```typescript
   // Generate LOD versions
   const lod0 = mergedGeo; // Full resolution
   const lod1 = decimateGeometry(mergedGeo, 0.5); // 50% poly count
   const lod2 = decimateGeometry(mergedGeo, 0.25); // 25% poly count
   ```

2. **Store in LoadedMesh:**
   ```typescript
   interface LoadedMesh {
     mesh: THREE.Mesh;
     lodMeshes?: THREE.Mesh[]; // LOD versions
     ...
   }
   ```

3. **Use in game based on distance or FPS:**
   ```typescript
   if (fps < 50 && camera.distance > 20) {
     // Switch to LOD mesh to maintain 60 FPS
   }
   ```

## Integration Points

### Game.ts Setup

When loading a custom mesh:

```typescript
import { loadMeshFromURL } from './loaders/MeshLoader';
import { LoadedMeshSurface } from './surfaces/LoadedMeshSurface';

const loadedMesh = await loadMeshFromURL(url);
const surface = new LoadedMeshSurface(loadedMesh);
```

### Enemy Movement

Enemies use UV-based movement, which automatically works on any Surface (including LoadedMeshSurface):

```typescript
class Enemy extends Entity {
  private u = 0.5, v = 0.5; // UV coordinates

  updatePosition(deltaTime: number) {
    // Compute movement direction
    const [du, dv] = this.computeMovement();

    // Move on surface (works on sphere, cube, torus, custom mesh)
    const newUV = this.surface.moveOnSurface(this.u, this.v, du * deltaTime, dv * deltaTime);
    this.u = newUV.u;
    this.v = newUV.v;

    // Get world position for rendering
    const point = this.surface.getPoint(this.u, this.v);
    this.mesh.position.copy(point.position);
    this.mesh.quaternion.setFromUnitVectors(THREE.Vector3(0, 1, 0), point.normal);
  }
}
```

### StartMenu Integration

The file picker is in `src/ui/StartMenu.ts`:

```typescript
private async onLoadCustomMap(file: File) {
  try {
    const loadedMesh = await loadMeshFromFile(file);
    this.selectedSurface = 'custom';
    this.customMesh = loadedMesh;
    this.startGame();
  } catch (error) {
    this.showError(`Failed to load custom map: ${error.message}`);
  }
}
```

## Performance Considerations

### BVH Build Cost

| Triangles | Build Time | Recommendation |
|-----------|-----------|-----------------|
| 10k | ~2ms | Instant, excellent |
| 50k | ~5ms | Noticeable on first load, acceptable |
| 100k | ~10ms | Significant spike, warning recommended |
| > 100k | > 15ms | Rejected (game enforces limit) |

### Memory Usage

| Triangles | Typical Memory |
|-----------|---|
| 10k | ~2 MB |
| 50k | ~10 MB |
| 100k | ~20 MB |

Cache 5 maps simultaneously: ~50 MB + BVH structures (~50 MB) = ~100 MB total.

### Query Performance

Once BVH is built:
- Ray-cast: ~0.05ms per query
- Closest-point: ~0.05ms per query
- Move-on-surface: ~0.1ms per query

Per-frame cost (100 enemies): ~10ms for all movement queries (acceptable, ~16% of 60 FPS budget).

## Testing

### Unit Tests

```bash
npm test -- MeshLoader.test.ts
npm test -- MeshSurface.test.ts
```

**What's covered:**
- File type detection
- Geometry merging
- Normalization (scaling, centering)
- UV mapping (getPoint, moveOnSurface, worldToSurface)
- Edge cases (empty file, corrupted geometry, non-manifold mesh)

### Integration Tests

```bash
npm test -- CustomMeshIntegration.test.ts
```

**What's covered:**
- Load mesh → create surface → spawn enemies
- Enemy movement on loaded mesh
- BVH rebuild (animated meshes)
- Memory (load multiple meshes, verify LRU eviction)

### Visual Tests

```bash
npm run test:visual -- custom-mesh
```

**What's verified:**
- Mesh renders correctly
- Player can move on mesh
- Enemies spawn and move
- Game doesn't crash on edge cases (huge mesh, empty file, invalid format)

## Troubleshooting for Developers

### BVH says "undefined"

```typescript
if (!this.meshSurface.boundsTree) {
  throw new Error('Failed to build collision structure for custom mesh. The mesh may be corrupted or too complex (try reducing triangle count).');
}
```

**Solution:** Check if mesh geometry is valid. Try re-exporting from Blender.

### Enemies teleporting

**Cause:** UV coordinates wrap incorrectly or moveOnSurface fails

**Debug:**
```typescript
console.log(`Enemy at UV: (${u}, ${v}), world: ${worldPoint.position}`);
// Check if UV is in [0, 1] after wrapping
// Check if world position is on the mesh surface
```

### Player stuck inside mesh

**Cause:** Player spawned at wrong position or mesh is non-watertight

**Solution:**
```typescript
// Verify player spawn position is on surface
const playerPoint = surface.getPoint(0.5, 0.5);
console.log(`Player spawn position: ${playerPoint.position}`);
// Should be on the visual mesh, not inside or far away
```

### Animated mesh jittery

**Cause:** BVH rebuilding every frame is slow or out-of-sync with animation

**Solution:**
- Reduce poly count (< 30k for 60 FPS)
- Consider using static mesh for the playable area and animating a separate visual mesh
- Or add LOD switching to reduce poly count during animation

### Memory leak on mesh switching

**Cause:** Old mesh not garbage collected after disposal

**Solution:** Always call `dispose()`:
```typescript
if (this.oldSurface) {
  this.oldSurface.dispose(); // Releases BVH, geometries, materials
}
```

## API Reference

### MeshLoader.ts

```typescript
export async function loadMeshFromURL(
  url: string,
  targetRadius: number = 8
): Promise<LoadedMesh>
```

Loads a mesh from a URL string.

- **url:** Full URL to .obj, .glb, or .gltf file
- **targetRadius:** Mesh is normalized to fit within this radius
- **Returns:** LoadedMesh object with mesh, originalSize, scaleFactor, triangleCount
- **Throws:** Error with user-friendly message

---

```typescript
export async function loadMeshFromFile(
  file: File,
  targetRadius: number = 8
): Promise<LoadedMesh>
```

Loads a mesh from a File object (e.g., from file input or drag-and-drop).

- **file:** File object with .obj, .glb, or .gltf content
- **targetRadius:** Mesh is normalized to fit within this radius
- **Returns:** LoadedMesh object
- **Throws:** Error with user-friendly message

### LoadedMeshSurface.ts

```typescript
constructor(loadedMesh: LoadedMesh, config?: LoadedMeshConfig)
```

Creates a new surface from a loaded mesh.

- **loadedMesh:** LoadedMesh object from MeshLoader
- **config:** Optional configuration (radius, gridSegmentsU, gridSegmentsV)

---

```typescript
getPoint(u: number, v: number): SurfacePoint
```

Get a point on the surface at UV coordinates.

- **u, v:** Coordinates in [0, 1]² (wrapping handled by wrapUV)
- **Returns:** SurfacePoint with position, normal, tangentU, tangentV

---

```typescript
moveOnSurface(u: number, v: number, du: number, dv: number): { u: number; v: number }
```

Move on the surface from (u, v) by (du, dv) in UV space.

- **u, v:** Current UV coordinates
- **du, dv:** Movement in UV space
- **Returns:** New UV coordinates after movement

---

```typescript
worldToSurface(worldPos: THREE.Vector3): { u: number; v: number }
```

Convert world position to UV coordinates.

- **worldPos:** World-space position (can be on or off surface)
- **Returns:** UV coordinates of closest point on surface

## See Also

- [User Guide](CUSTOM_MAPS.md) — How to load custom maps
- [ARCHITECTURE.md](ARCHITECTURE.md) — Overall system architecture
- Source code: `src/loaders/MeshLoader.ts`, `src/surfaces/LoadedMeshSurface.ts`, `src/surfaces/MeshSurface.ts`

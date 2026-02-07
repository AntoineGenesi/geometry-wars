## 2026-02-07 - Comprehensive Surface Movement Fixes

**Context:** Movement was broken on multiple surfaces: torus had inverted forward/backward, peanut had invisible walls, cube/cylinder had stuck spots, and several surfaces had inward-pointing normals.

**Root Causes Found:**

1. **Torus inversion**: `moveFromInput()` used camera.up (Y axis) for forward/backward. On surfaces where camera.up doesn't align with visual "forward" (like torus), this inverts controls. Fix: use camera's negative Z axis (visual forward) instead.

2. **Peanut/Cube/DentedSphere zero movement**: Triangle winding order in `createMesh()` was `(a,c,b)/(b,c,d)` which produces INWARD-facing normals when `computeVertexNormals()` runs. Inward normals cause the tangent plane projection to fail. Fix: reversed to `(a,b,c)/(b,d,c)`.

3. **Peanut vertex normals**: Used simplified spherical approximation `(sinPhi*cosTheta, cosPhi, sinPhi*sinTheta)` instead of actual surface normals. Fix: let THREE.js compute normals from geometry via `computeVertexNormals()`.

4. **Cylinder edge stuck**: Open-ended cylinder had no geometry past the edges. BVH snapped walker back to edge forever. Fix: changed to closed cylinder (caps enabled).

5. **General stuck recovery**: Added stuck detection in MeshWalker.move() - when walker moves < 5% of requested distance, tries alternate directions (decompose into tangent/bitangent frame, then fallback to pure tangent/bitangent).

**Changes:**
- `MeshWalker.ts`: Rewrote moveFromInput() to use camera -Z for forward; added stuck recovery in move()
- `PeanutSurface.ts`: Fixed winding order, use computeVertexNormals()
- `CubeSurface.ts`: Fixed winding order
- `DentedSphereSurface.ts`: Fixed winding order
- `CylinderSurface.ts`: Changed to closed cylinder (caps)
- `SphereWithTunnelSurface.ts`: Pole clamping (MIN_SIN_PHI=0.05)

**Verification:** 176 automated tests across all 10 surfaces. Tests cover:
- Direction consistency (no inversions)
- Full traversal (no invisible walls)
- Speed constancy
- Surface adherence
- Tangent frame stability (no camera flips)
- Pole/extreme traversal

**Reversibility:** Medium - each fix is independent and can be reverted per-surface.

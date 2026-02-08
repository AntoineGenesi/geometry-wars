## 2026-02-07 - Sphere Tunnel: Smooth Bevel at Junction

### Context
Sharp angle where tunnel meets sphere causing visual crease, lighting discontinuity, and bullet traversal issues.

### Root Cause
The `profileAt()` function had a hard switch between sphere segment (normal ≈ (0.25, 0.97)) and tunnel segment (normal = (-1, 0)) with no smooth transition.

### Fix Applied
Added circular arc bevel transitions at both sphere-tunnel junctions, modeled after CubeRingSurface's corner bevels.

**Profile is now 4 segments (was 2):**
1. Outer sphere arc (shortened by bevel)
2. Top bevel arc (sphere → tunnel, circular arc)
3. Inner tunnel (shortened by bevel)
4. Bottom bevel arc (tunnel → sphere, circular arc)

**Config:** `bevelRadius` parameter (default 0.8 world units)

**Math:** For bevel radius `bR`, the bevel circle center is at `(tr + bR, cos(phiEnd) * (R - bR))` where `phiEnd = asin((tr + bR) / (R - bR))`. Each bevel sweeps angle `π/2 + phiEnd` with C1-continuous normals at all junction points.

**Implementation detail:** Added `computeBevelGeometry()` as a static method so it works both during `super()` construction (when instance properties are undefined) and during normal operation.

### Results
- All 268 tests pass
- Profile is C1-continuous at all junctions (verified by matching position and normal at each boundary)
- Refactored createMesh() and createGrid() to use profileAt() instead of inlined profile logic

### Reversibility
Set `bevelRadius: 0` to disable bevel, or revert SphereWithTunnelSurface.ts

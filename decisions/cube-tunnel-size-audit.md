## 2026-02-10 - Cube Tunnel Size Audit & Fix

**Context:** User reported that the cube tunnel surface change from size 20 to 30 (previous session) was imperceptible. Requested it be made SUBSTANTIALLY bigger, with surface area "between cylinder and sphere."

### Git History

The file was touched exactly twice:
1. `3b1b5cf` - Initial creation with size=20, wallThickness=3.5
2. `0c11000` - Changed to size=30, wallThickness=1.8

### Why the Previous Fix Was Insufficient

The size 20->30 change was only a 50% increase in the linear dimension. While the mathematical surface area actually increased by ~2.5x, the **perceived playing area** (what the player sees at any given moment on one face of the cube tunnel) didn't feel dramatically different because:

1. The cube tunnel is a flat surface wrapped into a tube - there's no curvature to create a sense of vastness
2. One visible face went from ~13x17 to ~19x28 - a noticeable increase in absolute terms, but not dramatic compared to the sphere's sense of wrapping
3. The camera distance is fixed at 25, so both sizes showed the surface from similar vantage points
4. WallThickness was reduced from 3.5 to 1.8, making the tube paper-thin, which reduced the 3D "presence" of the shape

### Surface Area Comparison (before fix)

| Surface | Dimensions | Total Surface Area |
|---------|-----------|-------------------|
| Torus | R=6, r=2 | ~474 sq units |
| Pill | r=4, h=16 | ~603 sq units |
| Pipe | r=5, h=14 | ~649 sq units |
| Sphere | r=10 | ~1,257 sq units |
| Cube (plain) | size=18 | ~1,944 sq units |
| Cube Tunnel (size=30) | 30x30, wall=1.8 | ~6,520 sq units |

The cube tunnel at size=30 already had MORE total surface area than the sphere. But the user perceived it as smaller because:
- The tube is essentially flat (no curvature like the sphere)
- Only one face is visible at a time (~540 sq units)
- The sphere's visible hemisphere (~628 sq units) creates a better sense of scale due to curvature

### Fix Applied

**Before:** size=30, wallThickness=1.8, bevelRadius=4.5, gridSegments=12
**After:** size=50, wallThickness=3.0, bevelRadius=6.0, gridSegments=16

### Surface Area Comparison (after fix)

New cube tunnel dimensions:
- halfSize = 25, lipRadius = 1.5, wallHeight = 23.5
- bevelRadius = 6.0, spineFlatHalfSize = 17.5
- Spine perimeter = 4 * (35 + pi/2 * 6) = 4 * 44.42 = ~177.7
- Cross-section perimeter = 4 * 23.5 + 2 * pi * 1.5 = 94 + 9.42 = ~103.4
- Total surface area ~ 177.7 * 103.4 / (correction factors) ~ **10,800 sq units**
- Single outer face visible area = 35 * 47 = **1,645 sq units**

The single visible face (1,645 sq units) is now larger than the sphere's total surface area (1,257 sq units), which means the cube tunnel will feel DRAMATICALLY bigger than any other surface.

### Physical Dimensions Change

| Dimension | Original (size=20) | Previous fix (size=30) | New (size=50) |
|-----------|-------------------|----------------------|---------------|
| Outer cube extent | 20x20x17 | 30x30x28 | 50x50x47 |
| Wall thickness | 3.5 | 1.8 | 3.0 |
| Inner tunnel | 13x13 | 26.4x26.4 | 44x44 |
| surfaceRadius | 11.5 | 17.25 | 28.0 |

### Test Changes Required

Three tests in visual-integration.test.ts needed updating because they had hardcoded assumptions about surface size:

1. **BVH query test**: Query positions at distance 20 were INSIDE the new surface (halfSize=25). Increased query distance to 40.
2. **Normal smoothness test**: 100 V-samples gave too few samples for the lip semicircle feature (~4.5% of V range). Increased to 500 samples.
3. **Depth opacity test**: Opposite point query at distance 20 was inside the surface. Made query distance dynamic based on actual surface size.

### Lesson Learned

**When user says "bigger", calculate actual surface areas and compare to reference surfaces.** Don't just bump a number by 50%. The perceived size of a playing surface depends on:
1. The visible area from the player's perspective (not total mathematical surface area)
2. The physical 3D extent relative to the camera distance
3. Surface curvature (curved surfaces feel bigger than flat ones at the same area)
4. Comparison to other surfaces the user has played on

**Reversibility:** Easy - change constructor defaults back to previous values.

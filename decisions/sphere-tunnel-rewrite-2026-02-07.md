## 2026-02-07 - SphereWithTunnelSurface Complete Rewrite

**Context:** The original SphereWithTunnelSurface had a fundamental geometry bug. The hemisphere's createMesh used phi from 0 to PI/2-holeAngle, placing the hemisphere edge at (y=2, r=7.746) for default values. The tunnel entrance was at (y=7.746, r=2). The "transition ring" stitched these wildly mismatched positions together, creating stretched garbage geometry.

**Root cause:** The angle math was wrong. For a sphere of radius R=8 with tunnel radius r=2:
- holeAngle = asin(r/R) = asin(0.25) = 14.5 degrees
- The hemisphere traversed from pole (phi=0) to phi=PI/2-holeAngle = 75.5 degrees
- But the correct range for reaching the hole is only phi=0 to phi=holeAngle = 14.5 degrees
- The hemisphere covered 75.5 degrees instead of 14.5, ending near the equator instead of near the pole

**Options Considered:**
1. Fix the angle range in the existing code (hemisphere phi: 0 to holeAngle)
   - Pros: Minimal change
   - Cons: Each hemisphere would cover only 14.5 degrees (tiny cap), leaving equatorial belt uncovered
2. Rewrite as torus topology (profileAt + revolution, like CubeRingSurface)
   - Pros: Correct geometry, proven pattern, works with geodesic walker, smooth everywhere
   - Cons: Complete rewrite, breaks tunnelAxis parameter

**Decision:** Option 2 - Complete rewrite as torus topology

**Key changes:**
- Removed tunnelAxis parameter (always Y axis, tunnelAxis kept in config for backward compat)
- Removed separate hemisphere/tunnel/transition mesh sections
- New profileAt(t) defines cross-section: outer sphere arc + inner tunnel straight line
- createMesh uses CubeRingSurface's proven vertex layout (duplicate verts at seams, computeVertexNormals)
- UV parameterization: u = azimuthal, v = cross-section position (both periodic)
- Both u and v wrap (torus topology, no pole singularity)
- Player spawns on equator (outer sphere, widest point)

**Results:**
- SphereTunnel speed test: FIXED (was failing, now passes)
- Total test failures: 5 → 4 (only pre-existing Cube invert + Mobius x3 remain)
- TypeScript compiles clean
- 216 tests pass

**Reversibility:** Medium - the old file is in git history. Revert with `git checkout HEAD~1 -- src/surfaces/SphereWithTunnelSurface.ts`

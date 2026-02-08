## 2026-02-07 - Peanut Surface: Closed Poles with Apex Cap

### Context
Player couldn't traverse to the tips/ends of the peanut surface. Geodesic face walker bounced off boundary edges at the poles.

### Root Cause
`PeanutSurface.createMesh()` clamped `sinPhi` to `MIN_SIN_PHI = 0.05` at poles (j=0 and j=rings), creating small rings instead of apex points. These rings had boundary edges (twin=-1 in HalfEdgeMesh). FaceWalker reflects at boundary edges instead of crossing them.

### Fix Applied
Hybrid approach - keep pole rings + add apex cap:

1. **Reduced** MIN_SIN_PHI from 0.05 to 0.01 (smaller pole rings)
2. **Added** single apex vertex at each true pole position (0, ±rTop, 0)
3. **Added** fan triangles connecting each apex to its pole ring
4. **Kept** all standard quad strips between rings unchanged

This closes the mesh at both poles - no more boundary edges. The walker can now cross through the pole area freely.

### Approaches Tried
1. **Single apex + fan (no pole rings)**: Failed. Fan triangles from apex to first interior ring were too thin/flat (same height as apex), causing walker numerical issues. 4 test failures.
2. **Hybrid apex + small pole rings + fan**: Works. The tiny pole ring provides geometric spacing between the apex and the main mesh. Fan triangles are small but well-shaped.

### Results
- All 268 tests pass (135 movement validation including peanut pole traversal)
- TypeScript compiles clean

### Reversibility
Easy - revert PeanutSurface.ts createMesh() method

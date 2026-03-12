# Cube Map Movement / Aiming Bug

## Timeline
- **First reported:** 2026-02-12 — "cube map: bullets getting caught in vertices on the edges" (source: archive/inbox/2026-02-18_0900.md)
- **Rotation/direction:** 2026-02-13 — "Cube: Random spinning, inconsistent left/right mapping. Movements don't always map to the same direction." (source: archive/inbox/2026-02-13_2030.md)
- **MP camera inversion:** 2026-02-26 — "one of the cube maps on multiplayer, when I did cube on multiplayer, it literally, when my guy would go onto one of the weird surfaces, the game perspective would shift, so it would like, the game would completely do a 180" (source: archive/inbox/2026-02-26_2200.md)
- **Fix attempt 1:** commit `0345e24b` — "fix: cube MP — shooting locked left/right + camera inside cube (s44r8-03)" — PARTIAL
- **Still broken shooting:** 2026-03-09 — "Cube map aiming is still only shooting directly left or directly right. If my mouse is on the right side of my character then he's shooting directly to his right." (source: inbox/2026-03-09_0530.md)
- **Geometry issue:** 2026-02-26 — "Player gets stuck in weird triangular funneling shape. Can't move properly regardless of direction pressed." — REGRESSION from attempted fix
- **Cube-ring broken:** 2026-03-11 — "cube ring map, I can't move forwards or to the right; I can only go to the left and down. Going to the left actually makes me go down and going down makes me go to the right" (source: inbox/2026-03-11_1030.md)
- **Fix for cube-ring:** commit `2426005c` — "fix: cube-ring movement 90° rotation — use analytical normals in mesh (s44r10-03)"
- **Cube aiming confirmed fixed (s44r10):** commit `9fe1ca14` — "Merge s44r10-02: SP hit detection — EnemySpawner UV wrapping fix + regression test"
- **Status (March 2026):** Cube aim FIXED in SP (s44r6 series). Cube-ring movement FIXED (s44r10-03). MP cube camera/respawn partially fixed (s44r8-03).

## Root Cause
Multiple layered issues:
1. **Aiming direction:** Cube face tangent frames were computed incorrectly, causing bullet direction to snap to nearest cardinal axis (left/right/up/down) rather than following mouse angle. Fixed by computing tangent frame consistently from face normal rather than UV gradient.
2. **Camera inside cube:** On respawn, camera position was placed inside the cube geometry due to incorrect surface normal orientation. Fixed in s44r8-03 using `worldToSurface` for respawn position.
3. **Cube-ring 90° rotation:** `computeVertexNormals()` produced incorrect normals for cube-ring topology, causing 90° movement rotation. Fixed by using analytical normals (s44r10-03).
4. **MP perspective flip:** Crossing between cube faces with different UV orientations caused camera to invert. Related to tangent frame discontinuity at cube edges.

## What Worked
- Analytical normals instead of `computeVertexNormals()` for cube-ring
- Consistent face-normal-based tangent frame for cube aiming
- `worldToSurface` for respawn position

## What DIDN'T Work (dead ends)
- UV-gradient tangent frame for cube faces (fails at corners and edges)
- Clamping angles to nearest face direction (snapped to wrong direction)

## Regression Risk
- Cube-ring: do NOT use `computeVertexNormals()` — must use analytical normals
- Cube aiming: tangent frame computation must be face-normal-based, not UV-based
- Both SP and MP code paths must be updated when fixing cube geometry (MP uses a different code path)

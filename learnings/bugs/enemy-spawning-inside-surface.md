# Enemies Spawning Inside Surfaces / Wrong Geometry

## Timeline
- **First reported:** 2026-02-20 — "the entities in the LAN aren't moving in the way that, like, they are, like, for different players, they're in different positions... the enemies aren't on the surface with you. They're still spawning inside, and they're, like, rendering inside on the original smaller surface, not on the larger or shrink-shrunk one." (source: archive/inbox/2026-02-20_1300.md)
- **Map size mismatch:** 2026-02-20 — "a bunch of entities going around a ghost of where the planet used to be inside the sphere, and I'm on the outside trying to shoot into them" — enemies spawning at default size, player on larger/smaller map size (source: archive/inbox/2026-02-20_1300.md)
- **SP pill bug:** 2026-03-09 — "launched the pill map on PvE and a bunch of the big enemies, like the snakes with the fins that spawn, have their body parts... spawned inside the pill, almost like on a surface that's like half as big as the pill" (source: inbox/2026-03-09_0900.md)
- **Server-client parity root cause identified:** 2026-03-12 — "Server `SurfaceGeometryBuilder` must use same dimensions as client `createStandardSurfaceConfig()` (including map size scaling)." — MEMORY.md failure mode #20
- **Fix for server-client parity:** tests in `SurfaceGeometryBuilder.server-client-parity.test.ts`
- **Still frozen on cube-ring+mobius:** MEMORY.md March 2026 — "STRESS: cube-ring + mobius — ALL enemies frozen"
- **Status (March 2026):** Server-client geometry mismatch is known and partially addressed. Cube-ring + mobius enemy freezing STILL OPEN.

## Root Cause
**Primary (server-client geometry mismatch):** The server (`SurfaceGeometryBuilder`) uses different dimensions from the client (`createStandardSurfaceConfig()`). When map size scaling is applied on the client but not the server, enemies are spawned at server-calculated UV positions that correspond to the unscaled geometry — appearing "inside" the larger client-rendered surface.

**Secondary (cube-ring + mobius frozen):** Enemy update logic for cube-ring and Mobius geometries has a bug where the MeshWalker/movement system freezes when the enemy tries to navigate across the topology discontinuity (cube ring edges, Mobius twist). The enemy position is locked at the discontinuity.

## What Worked
- Server-client parity test (`SurfaceGeometryBuilder.server-client-parity.test.ts`) detects the dimension mismatch
- Using `mapSizeScaleFactor` consistently in both server and client geometry builders

## What DIDN'T Work
- Fixing only the client geometry — server still spawns enemies at wrong scale
- Per-map special case scaling (missed surfaces)

## Regression Risk
- **CRITICAL: Server-client geometry mismatch is failure mode #20** — whenever any surface geometry is changed, BOTH server and client must be updated
- Parity test: `SurfaceGeometryBuilder.server-client-parity.test.ts` must pass before merge
- Cube-ring + mobius frozen: this is a stress test finding, not yet fixed

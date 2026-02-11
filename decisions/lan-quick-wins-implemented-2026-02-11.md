# LAN Quick Wins Implemented — 2026-02-11

## Context
Deep audit (decisions/lan-deep-audit-2026-02-11.md) found 12 issues explaining why LAN feels "laggy and weird" despite 13/13 automated tests passing. Implemented the 5 highest-impact fixes.

## Changes Made (2 commits)

### Commit 1: 9da6c5a — Performance Quick Wins
1. **Server patch rate 30Hz→60Hz** (GameRoom.ts setPatchRate 33→16)
   - On LAN, bandwidth is negligible. Matching simulation rate = minimum latency.
2. **Disabled depth-based opacity** (network-main.ts removed 23 lines)
   - Was computing getVisibility() + setting material.opacity on EVERY enemy EVERY frame
   - 250+ material property changes per frame for 50 enemies = massive GPU state churn
   - Co-op doesn't use this and feels smooth
3. **Added bullet + geom interpolation** (network-main.ts +bulletTargetUV +geomTargetUV)
   - Same lerp pattern as enemy/player interpolation in onRender
   - Bullets: BULLET_LERP=0.3 (fast convergence for fast-moving objects)
   - Geoms: GEOM_LERP=0.2 (slower convergence, geoms don't move much)
4. **Gated diagnostic API behind ?debug** (network-main.ts)
   - 200ms setInterval polling no longer runs in production play
   - Console debug commands only available with ?debug in URL

### Commit 2: b1043d9 — Client Prediction Fix
5. **Aim orientation prediction always runs** (network-main.ts)
   - Previously: prediction only applied when moveX/moveY ≠ 0
   - Now: visual position + aim orientation updates EVERY frame for local player
   - Movement delta only applied when WASD held (same as before)
   - Eliminates 16-33ms perceived input lag for aiming/turning while stationary

## Remaining Audit Issues (Not Implemented)

| # | Issue | Status | Why Not Now |
|---|-------|--------|-------------|
| 2 | Surface type race condition | Deferred | Client already rebuilds on confirmed type mismatch. Would need server-side `waitFor()` for full fix. |
| 5 | Spawn ring cleanup | Low risk | `skipSpawnWarning=true` already prevents rings. Spawner state divergence is minor. |
| 8 | Three separate implementations | Architectural | GameContext from refactor COULD be shared, but network-main.ts has different lifecycle. Needs careful design. |
| 9 | No bandwidth/latency metrics | Nice-to-have | Would help future debugging. Not user-facing. |
| 10 | UV collision on curves | Deferred | Server uses Euclidean UV distance. Breaks on sphere but works on torus/cube. Needs geodesic distance formula per surface. |
| 11 | Dead interest management code | Cleanup | 200 lines of dead code in GameRoom.ts. Safe to delete but not urgent. |
| 12 | Inconsistent V-clamp | Cleanup | Magic numbers (0.003, 0.05) should be exported from Surface classes. |

## Expected Impact
- **Depth opacity removal**: ~5-10ms/frame saved (250 material updates eliminated)
- **60Hz patches**: Halved perceived entity update latency
- **Bullet interpolation**: Smooth bullet movement (was snapping at patch rate)
- **Aim prediction**: Instant aim response (was waiting 16-33ms for server)

## Verification
- Level 2: TypeScript compiles, 1903/1908 tests pass (5 pre-existing failures)
- User testing required for Level 4

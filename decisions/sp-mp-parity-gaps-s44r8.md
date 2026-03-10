# SP vs MP Parity Gaps — s44r8 Audit (2026-03-11)

## Summary

Systematic audit of single-player vs multiplayer gameplay parity gaps. Built on previous analysis from s44r6-13 (architecture report) and s44r6-16 (code-sharing deep analysis). This audit focuses on what FIXED vs what still needs the EPIC refactor (s44r6b-11).

---

## Gaps Fixed in This Session (s44r8-06)

### Fix 1: Pickup radius not in sync across SP pickup classes
**Severity:** HIGH — affects gameplay feel, inconsistent collection UX

**Root cause:** s44r6c-02 updated `WeaponPickup.ts` and `BuffPickup.ts` to 0.35 but missed:
- `SuperStatePickup.ts` — was 0.3 (not updated)
- `BuffPickupNew.ts` — was 0.25 (not updated)

**Fix:** Added `WEAPON_PICKUP_WORLD_RADIUS = 0.35` to `src/shared/GameBalanceConstants.ts`. All 4 SP pickup files now import from shared. This is a **regression guard** — if the value needs to change, it changes in one place.

**MP server:** Already correct at 0.35 (`PICKUP_WORLD = 0.35 * scaleFactor` in GameRoom.ts).

### Fix 2: Bullet lifetime not scaled by mapSizeScaleFactor in MP server
**Severity:** HIGH — bullets are too short-lived on large/epic maps in MP

**Root cause:** SP scales bullet lifetime by map size:
```javascript
// src/main.ts
bulletPool.lifetimeMultiplier = mapSizeScaleFactor;
// Result: MEDIUM=6s, LARGE=9s, EPIC=12s, SMALL=4.5s
```
MP server used raw `BULLET_LIFETIME = 6.0` regardless of map size.

**Fix:** `server/rooms/GameRoom.ts` `updateBullets()` now uses:
```javascript
const bulletLifetime = BULLET_LIFETIME * getMapScaleFactor(this.state.mapSize || 'medium');
```

**Impact:** On EPIC maps (2x scale), bullets now live 12s instead of 6s. On LARGE (1.5x), 9s instead of 6s. Bullets can now traverse the same fraction of the map as in SP.

---

## Gaps Previously Fixed (context)

From s44r6b-11 (shared constants), s44r8-02/03 (hit detection):
- Weapon configs (damage, fireRate, ammo) — unified in `GameBalanceConstants.ts`
- Level system (thresholds, multipliers) — unified
- Pickup radius (WeaponPickup, BuffPickup) — s44r6c-02
- Pickup radius (server GameRoom.ts) — s44r6c-02
- MP hit detection — exact player world positions for all maps (s44r8-02)
- Cube face UV snap + bullet spawn (s44r8-03)

---

## MEDIUM Priority Gaps — Needs Design Decision

### Gap 3: Enemy world speed not normalized by mapSizeScaleFactor in MP
**Severity:** MEDIUM — enemies are faster on large maps in MP

**SP behavior:** `enemySpawner.setSurfaceSpeedScale(surface.speedScale / mapSizeScaleFactor)` — normalizes so enemies traverse same fraction of map per second regardless of size.

**MP server:** Enemies use raw UV speed from `ENEMY_SPEEDS` table. On LARGE maps (1.5x), the same UV distance = 1.5x more world distance → enemies are 1.5x faster in world space.

**Mitigating factor:** Player UV speed (`PLAYER_SPEED_UV`) is also unscaled, so the player-to-enemy speed RATIO is preserved. The relative difficulty feels the same, but everything moves faster in world space on large maps.

**Recommendation:** Could fix by dividing ENEMY_SPEEDS by `getMapScaleFactor(mapSize)` in `getEnemySpeed()`. Low risk. Deferred — needs user testing to confirm it's actually jarring.

### Gap 4: getMapScaleFactor() duplicated in server
**Severity:** LOW — code duplication, risk of future drift

**SP:** `src/core/MapSize.ts` — `getMapSizeScaleFactor(MapSize): number`
**Server:** Local function in `GameRoom.ts` — `getMapScaleFactor(mapSize: string): number`

Server has additional values (tiny=0.5, huge=2.0) that SP's MapSize enum doesn't support. Server's function is a superset.

`MapSize.ts` has `import type { SurfaceType }` — a type-only import that compiles away. In theory the server could import it, but it would require changing the server tsconfig and is lower priority than gameplay fixes.

**Recommendation:** If SP ever adds 'tiny' or 'huge' map sizes, manually update server's function. Add comment cross-reference.

---

## EPIC Gaps — Requires s44r6b-11 Full Refactor

These are architectural differences that cannot be fixed with targeted edits. They require the EPIC s44r6b-11 (SP/MP code sharing implementation).

### Gap 5: Missing enemy types in MP (18 of ~30 SP types absent)
**Severity:** HIGH — gameplay is fundamentally different

**SP enemy types:** All 30+ types in `src/entities/enemies/` (GiantWanderer, FractalSnake, Splitter, Phaser, Boss, etc.)
**MP server:** ~12 types (grunt, arrow, wanderer, duck, weaver, spinner, rocket, neutron, snake, gate, blackhole, repulsor, mayfly, proton, ufo, mines, mutator, bubbles, spawnlet, virus, spawner, painter, titans)

Missing bosses, fractal types, giant types, phaser types. These can't be ported without server-side geometry/physics that currently runs on client.

**Path forward:** Port enemy behavior logic (not rendering) to server. Each enemy type needs a server-side AI behavior class analogous to `BaseEnemy`. High effort.

### Gap 6: Weapon mastery not tracked on server
**Severity:** HIGH — no progression system in MP

**SP:** `MatchUpgradeTracker` tracks kills per weapon type, unlocks tiers, shows mastery UI.
**MP server:** Kill counts tracked, but no weapon mastery unlock system. Players stay at base weapon stats throughout a match.

**Path forward:** Add `weaponKills` map to `PlayerState`. Server applies weapon tier thresholds from `GameBalanceConstants.ts`. Client reads tier and adjusts visual feedback.

### Gap 7: Client prediction uses UV approximation (not MeshWalker)
**Severity:** MEDIUM — causes rubber-banding and position errors

**SP:** Player and enemy positions computed via `MeshWalker.ts` (geodesic movement on actual surface mesh, BVH-based).
**MP server:** Uses UV interpolation for player prediction on client. Server uses `ServerMeshWalker` (wraps `MeshWalker`) for authoritative position, but client prediction is UV-only → visible correction jumps.

**Path forward:** Use `MeshWalker` on client for prediction too. Requires giving client access to the surface BVH without full server-side computation. Medium effort.

### Gap 8: Surface-specific enemy movement (MeshWalker vs UV)
**Severity:** MEDIUM — enemies feel different on curved surfaces

**SP:** Enemies use `BaseEnemy.moveOnSurface()` which calls `surface.moveOnSurface()` — geodesic movement that respects surface curvature (peanut waist, torus hole, etc.)
**MP server:** Enemies use UV interpolation with metric corrections for sphere/peanut/torus. The metric corrections are approximations — enemies "slip" near high-curvature regions.

**Path forward:** Part of s44r6b-11. Would require porting surface geometry to server or making enemies server-authoritative with mesh-based movement.

---

## Reference: SP vs MP Architecture Summary

| System | SP | MP | Status |
|--------|----|----|--------|
| Weapon configs | Shared via GameBalanceConstants.ts | Shared | ✓ Fixed (s44r6b-11) |
| Level system | Shared | Shared | ✓ Fixed (s44r6b-11) |
| Pickup radius (weapon) | 0.35 | 0.35 | ✓ Fixed (s44r6c-02) |
| Pickup radius (buff, super-state) | 0.35 | 0.35 | ✓ Fixed (s44r8-06) |
| Bullet lifetime | 6s * mapScale | 6s * mapScale | ✓ Fixed (s44r8-06) |
| Bullet speed | 4.0 world/s | 0.13 UV/s | ✓ Consistent (different units) |
| Hit detection | World positions | World positions | ✓ Fixed (s44r8-02) |
| Player movement | MeshWalker | MeshWalker (server-auth) | ✓ Shared via ServerMeshWalker |
| Enemy movement | MeshWalker | UV + metric approx | ✗ EPIC gap |
| Enemy types | ~30 types | ~12 types | ✗ EPIC gap |
| Weapon mastery | Full system | Not implemented | ✗ EPIC gap |
| Enemy speed scale | Normalized by mapScale | NOT normalized | ⚠ Medium |
| Map size function | getMapSizeScaleFactor | Local copy | ⚠ Low |

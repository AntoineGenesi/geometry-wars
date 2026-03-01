# Multiplayer

## Local Splitscreen

URL: `http://localhost:3000?mode=multiplayer`

Two players share one screen on the same surface.

### Controls

| Action | Player 1 | Player 2 |
|--------|----------|----------|
| Move | WASD | IJKL |
| Aim | Mouse | Auto-aim (shoots in movement direction) |
| Shoot | Left click | O |
| Bomb | Space | P |

Camera follows the midpoint of both players. Scoring is combined.

Source: `src/multiplayer-main.ts`, `src/input/MultiplayerInput.ts`

## Network Multiplayer (LAN)

URL: `http://localhost:3000?mode=network`

Up to 4 players on the same surface with server-authoritative state synchronization.

### Setup

```bash
npm run server                  # Start Colyseus server on port 2567
```

Then open the client:
- Local: `http://localhost:3000?mode=network`
- Remote: `http://localhost:3000?mode=network&server=ws://hostname:2567`

Source: `src/network-main.ts`, `src/network/NetworkClient.ts`, `server/`

## LAN Hosting

Play with friends on the same WiFi network. No separate server required in dev mode.

### Host a Game

1. Run `npm run dev`
2. Click **LAN** in the start menu
3. Click **HOST GAME** - the embedded server starts automatically
4. Share the displayed URL with LAN players (e.g. `http://192.168.1.15:3000?mode=network&server=ws://192.168.1.15:2567`)
5. Click **ENTER GAME** to join your own server

### Join a Game

1. Run `npm run dev`
2. Click **LAN** in the start menu
3. Either:
   - Click **SCAN LAN** to auto-discover games on the local network
   - Enter the host's IP address and click **CONNECT**

### How It Works

A Vite plugin (`vite-plugin-lan.ts`) manages the embedded Colyseus server:
- `POST /__lan/start` spawns the server as a child process
- `POST /__lan/stop` kills it
- `GET /__lan/status` returns hosting state + LAN IP addresses
- `GET /__lan/scan` scans the local /24 subnet for game servers (via `/api/info` endpoint)

The LAN feature only works in dev mode (requires the Vite dev server). For production deployments, use the Network Multiplayer setup with `npm run server`.

Source: `vite-plugin-lan.ts`, `src/network/LANClient.ts`, `src/ui/StartMenu.ts`

## Kill Attribution

Bullets carry an `ownerId` field identifying the player who fired them. When an enemy dies, the system determines kill credit and assists.

- **Kill credit**: Goes to the player whose bullet dealt the killing blow.
- **Damage tracking**: Each enemy maintains a `damageBy` map recording total damage dealt by each player.
- **Assist threshold**: A player qualifies for an assist if they dealt at least 20% of the enemy's max HP.
- **Assist reward**: 40% of the enemy's base score value.

Both kills and assists increment a player's `totalKillAssists` counter, which drives the aura tier system.

Source: `src/multiplayer/KillTracker.ts`

## Aura System

Players build an aura based on their combined kill + assist count. The aura buffs nearby allies.

### Tier Progression

| Tier | Threshold | Outer Ring | Inner Ring |
|------|-----------|------------|------------|
| 0 | 0 | None | None |
| 1 | 10 kills+assists | 3.0 radius, +15% damage, 0.5 HP/s heal | None |
| 2 | 25 | 4.0 radius, +25% damage, 1.0 HP/s | None |
| 3 | 50 | 5.0 radius, +20% damage, 1.0 HP/s | 2.5 radius, +40% damage, 2.0 HP/s |
| 4 | 80 | 6.0 radius, +25% damage, 1.5 HP/s | 3.0 radius, +50% damage, 3.0 HP/s |
| 5 | 120 | 7.0 radius, +30% damage, 2.0 HP/s | 4.0 radius, +60% damage, 4.0 HP/s |

### Ring Visuals

- **Outer ring** (cyan): Appears at tier 1. Pulses gently. Brighter when actively buffing an ally.
- **Inner ring** (magenta): Appears at tier 3. Stronger buffs for allies inside the inner radius.

### Healing

Heal rate from ally auras accumulates HP over time. When accumulated healing reaches 30 HP, the player gains +1 life (capped at 9 lives max).

### How Buffs Apply

Buffs are directional: player A's aura affects player B (and vice versa), but a player does not buff themselves. When multiple allies overlap, the strongest buff from any source applies (max, not additive).

Source: `src/multiplayer/AuraSystem.ts`

---

## Networking Architecture

> For the full deep-dive see `docs/MP-ARCHITECTURE.md` and `docs/mp-architecture-audit.md`.

The LAN mode uses a **server-authoritative** model:

- **Server**: Colyseus 0.15 running on Node.js 20 (`server/rooms/GameRoom.ts`)
- **Simulation**: 60 Hz tick on server; state patches broadcast at ~30 Hz
- **Sync**: Colyseus Schema v2 binary delta encoding over WebSocket
- **Client prediction**: Local player movement predicted client-side; overridden by server each tick
- **State schema**: `players` (MapSchema), `bullets`, `enemies`, `geoms`, `weaponPickups` (ArraySchemas)

### Critical Implementation Detail: `declare` Keyword

Colyseus Schema installs getter/setter descriptors in its constructor to track changes. TypeScript compiled to **ES2022** uses `Object.defineProperty` for class field initializers, which overwrites those setters. The result is silent empty-state encoding.

**All schema classes must use `declare` + constructor assignment:**

```typescript
// CORRECT — in server/schema/GameState.ts
class PlayerState extends Schema {
  declare surfaceU: number;
  constructor() { super(); this.surfaceU = 0.5; }
}

// WRONG — silently breaks state encoding
class PlayerState extends Schema {
  surfaceU: number = 0.5; // ES2022 Object.defineProperty overwrites setter!
}
```

**Never use `!:` (definite assignment assertion) either** — esbuild still emits `Object.defineProperty` for it under ES2022.

---

## Bug Fixes Log

This section documents every MP bug fixed, what went wrong, and what the fix was. Future developers: read this before touching MP code.

---

### S27f — Bullets Rendered as Polygons + Movement Too Fast

**Symptom:** In LAN MP, bullets looked like spinning polygons/geomes and didn't follow geodesic paths or hit enemies. Players moved ~2× faster than in single player.

**Root cause (bullets):** `BulletInstanceManager.ts` used `lookAt()` to orient capsule meshes, which aligns the capsule's `-Z` axis with the travel direction. `CapsuleGeometry`'s long axis is `+Y`. This made capsules appear as discs perpendicular to travel. Also `scaleY/scaleZ` were swapped so the length ran across the travel direction.

**Root cause (speed):** `GameRoom.ts` had `PLAYER_SPEED = 0.19` UV/s. A comment said "radius=5" but `DEFAULT_SURFACE_SCALE=10`, so effective speeds were 2× single player. All enemy speeds had the same error.

**Fix:**
- `BulletInstanceManager.ts`: Changed to `setFromUnitVectors(_Y_AXIS, _tmpDir)` (aligns `+Y` capsule axis with direction). Swapped scaleY/scaleZ. Increased radial segments 6→8.
- `GameRoom.ts`: `PLAYER_SPEED` 0.19→0.095, `BULLET_SPEED` 0.26→0.13. All enemy speeds halved proportionally.
- `network-main.ts`: `predSpeed` 0.19→0.095 to match server.

**Files:** `src/rendering/BulletInstanceManager.ts`, `server/rooms/GameRoom.ts`, `src/network-main.ts`
**Verification:** Level 2 (unit tests). Human LAN test required for Level 6.

---

### S27g — Spawn Indicators (Red Dots) Without Enemies

**Symptom:** During a wave spawn, red warning dots appeared but fewer than 50% resulted in actual enemies. In a wave of 51 enemies with cap=30, players would see 51 red dots but only ~25 enemies.

**Root cause:** `GameRoom.spawnSingleEnemy()` sent a `pre_spawn` warning to clients, then deferred the actual entity creation via `setTimeout(1500ms)`. The cap check in `spawnWave()` read `this.state.enemies.length` synchronously, which doesn't include pending (not-yet-materialized) enemies. So all 51 warnings were sent before any enemy materialized, then the setTimeout callbacks silently dropped excess spawns once the cap was hit.

**Fix:** Added `pendingEnemyCount` tracking:
1. `pendingEnemyCount` increments immediately when a warning is sent; decrements in the setTimeout (with generation guard for safe restarts).
2. Cap check: `enemies.length + pendingEnemyCount >= maxEnemies` — checked BEFORE broadcasting the warning.
3. `spawnWave()` breaks early if `spawnSingleEnemy()` returns false.
4. `startGame()` resets `pendingEnemyCount = 0` and bumps `spawnGeneration`.

**Files:** `server/rooms/GameRoom.ts`, `server/rooms/GameRoom.test.ts`
**Regression tests:** 5 added. All pass.
**Verification:** Level 2 (unit tests). LAN human test required.

---

### S27g — Death / Respawn Snap-Back to Death Location

**Symptom:** After dying, the player briefly appeared at the respawn location, then the first movement input snapped them back to the death position.

**Root cause:** `MeshWalker` maintains a private `_facePos` (barycentric face position) used as the starting point for geodesic movement. The respawn code in `GameLoop.ts` and `GameInstance.ts` directly assigned `.position`, `.normal`, `.faceIndex` on the walker but never called `initGeodesicPosition()` to sync `_facePos`. On the first `moveFromInput()`, the walker started from the stale death-location `_facePos`.

**Fix:**
- Added `MeshWalker.teleportTo(point, faceIndex, normal?)` — reinitializes ALL internal state including `_facePos`.
- `GameLoop.ts` and `GameInstance.ts` now call `teleportTo()` on respawn instead of direct assignment.

**Files:** `src/movement/MeshWalker.ts`, `src/core/GameLoop.ts`, `src/core/GameInstance.ts`, `src/test/s27g-respawn-snap-back.regression.test.ts`
**Regression tests:** 3 added.

> **Also fixed (S27):** `Player.ts` had `getSafeRespawnPosition()` (diagonally opposite to death UV) but all callers hardcoded `respawn(0.5, 0.5)`. If a player died near center, they'd respawn at the same spot. Fixed all three call sites: `GameLoop.ts`, `GameInstance.ts`, `GameRoom.ts`.

---

### S27g — Aim Offset: Bullets Not Going Where You Aim

**Symptom:** Mouse aim direction didn't match where bullets actually traveled. Small constant offset, much worse immediately after respawn (could last 4–8 seconds).

**Root cause:** `GameLoop.ts` computed aim direction using `frame.tangent` and `frame.bitangent` (surface UV tangent vectors). But the camera lerps toward the player with `CAMERA_LERP_FACTOR = 0.12` per frame. The camera's actual `right`/`up` axes lag behind the surface tangent frame. At 60 fps with 0.12 lerp, convergence takes ~8 frames → persistent offset. After respawn, the camera is still at the old location while the surface frame is completely different → large aim error.

**Additionally:** `lastAimDirection` was never reset on respawn, carrying over a stale world-space direction.

**Fix:**
1. After `cameraController.update()`, call `camera.updateMatrixWorld()` to ensure matrixWorld is current.
2. Extract camera right (col 0) and up (col 1) from `camera.matrixWorld`.
3. Project both onto the surface plane (remove normal component).
4. Use these camera-aligned axes for aim instead of `frame.tangent/bitangent`.
5. Fallback to tangent frame if camera axes degenerate (camera parallel to surface).
6. Reset `lastAimDirection = null` on respawn.

**Files:** `src/core/GameLoop.ts`, `src/test/s27g-aim-offset.regression.test.ts`
**Regression tests:** 7 added.

---

### S27g — Drone/Companion Orbit Glitch (Axis Flipped, Flat Rendering)

**Symptom:** On the **cube** map, companion drones only oscillated up/down instead of orbiting in 3D. On the **torus** (and all other surfaces), companions appeared flat (2D squished) instead of 3D.

**Root cause (cube — 1D oscillation):** `CubeSurface.getPoint()` has a consistency fix that overrides `tangentV = (0, 0, -1)` on the top/bottom faces to prevent camera jump at face-strip crossings. On side strips, `tangentU` was also `(0, 0, -1)`. When `OrbitBehavior.setFrame()` received two parallel vectors, the orbit formula `center + tangent*cos + bitangent*sin` collapsed to 1D oscillation along Z.

**Root cause (torus/all — flat rendering):** `makeBasis(tangent, normal, bitangent)` created a **left-handed matrix** (det = −1) because `tangentU × tangentV = normal` for standard surface frames. Three.js `setFromRotationMatrix` assumes proper rotation (det = +1); with det = −1, extracted quaternions were incorrect → companion mesh axes collapsed → appeared flat/squished.

**Fix in `src/entities/Companion.ts`:**
1. **Orbit axes**: Compute `bitangent = normal × tangent` (always perpendicular to tangent) instead of using `playerTransform.bitangent` (which can be parallel to tangent on problem faces).
2. **Orientation matrix**: Use `makeBasis(tangent, normal, tangent × normal)` — cross product guarantees det = +1.

**Files:** `src/entities/Companion.ts`, `src/test/companion.test.ts`
**Regression tests:** 4 added (cube orbit 2D, torus orbit 2D, non-trivial quaternion, det=+1 algebraic check).

---

### S27h — Weapon HUD Showing Wrong Weapon

**Symptom:** User switches to Tesla coil, ammo depletes to 0, HUD still shows "Tesla Coil [0]" while the player is actually firing at blaster rate.

**Root cause:** `WeaponManager.pruneDepletedWeapons()` removed depleted weapons from inventory but did NOT update `currentWeapon`. The auto-switch (`autoSwitchOnDepletion()`) is only called from `canFire()` (on fire input). The HUD update path (`RenderLoop.ts:208`) calls `getInventory()` + `getCurrentWeapon()` every frame without triggering auto-switch, so `currentWeapon` stays stale.

**Fix:** Added currentWeapon update at the end of `pruneDepletedWeapons()`:
```typescript
if (this.currentWeapon !== WeaponType.Standard && !this.inventory.includes(this.currentWeapon)) {
  const nonStandard = this.inventory.filter(t => t !== WeaponType.Standard);
  this.currentWeapon = nonStandard.length > 0 ? nonStandard[0] : WeaponType.Standard;
}
```

**Files:** `src/weapons/WeaponManager.ts`, `src/weapons/WeaponManager.test.ts`
**Regression tests:** 2 added. 61 WeaponManager tests pass.
**Scope:** SP and local split-screen. LAN MP uses server-authoritative weapon state — unaffected.

---

### S27h — Weapon Rendering Broken in MP (All Weapons Look Like Blaster)

**Symptom:** In LAN MP, only the Standard (blaster) weapon had the correct visual. Plasma, Tesla, Spread, Homing, and others all rendered as blaster bullets.

**Three separate bugs:**

**Bug 1:** `weaponToBulletVisual()` in `network-main.ts` only mapped 3 of 10 weapon types. PlasmaMortar, GravityGun, BlackHole fell through to `Standard`.

**Bug 2:** Bullet visual type was determined by checking if the bullet's UV was within 0.05 of the LOCAL player's UV (proximity heuristic). This always failed for remote players' bullets, making them render as Standard. Also fragile if the player moved between ticks.

**Fix for Bug 1 & 2:** Store `bulletId → WeaponType` using `bullet.ownerId → state.players.get(ownerId).weaponType` lookup in `onStateChange`. Exact attribution for all players. Expanded `weaponToBulletVisual()` to handle all weapon types.

**Bug 3:** `equipWeapon()` has conditional auto-switch: only switches if `currentWeapon === Standard || newType === currentWeapon`. When the server changed weapon from PlasmaMortar to TeslaCoil, `equipWeapon(TeslaCoil)` wouldn't switch (PlasmaMortar ≠ Standard). Local weapon manager stayed on Plasma → fired wrong visual.

**Fix for Bug 3:** Added `forceSetWeapon()` to `WeaponManager` — always sets `currentWeapon` without conditional logic. Used in `network-main.ts` when syncing server-authoritative weapon state.

**Files:** `src/weapons/WeaponManager.ts`, `src/network-main.ts`, `src/weapons/WeaponManager.test.ts`
**Regression tests:** 2 added for `forceSetWeapon`.

---

### S27h — Sphere Poles Blocked (Can't Walk to North/South Pole)

**Symptom:** Player movement was blocked at the sphere's North and South poles. Walking toward the pole caused the player to circle it indefinitely without ever crossing through.

**Root cause:** `THREE.SphereGeometry` creates a UV sphere where all north-cap triangles share a single degenerate pole vertex. When `FaceWalker.walk()` detected exit through this vertex (`atVertex=true`), it only checked the 3 edges of the current triangle. None of those edges connect to a face "on the other side" — they only connect to adjacent same-hemisphere triangles.

**Fix:**
- `HalfEdgeMesh.ts`: Exposed `canonical: Uint32Array` and added `vertexToFaces: number[][]` (maps each canonical vertex to all faces sharing it). Built in O(N) during construction.
- `FaceWalker.ts`: When `atVertex=true`, identify the vertex via canonical index, gather ALL faces adjacent to it via `vertexToFaces`, pick the face whose centroid direction best aligns with movement, jump directly with a nudge off the vertex, project direction onto new face's tangent plane.

**Files:** `src/surfaces/geodesic/HalfEdgeMesh.ts`, `src/surfaces/geodesic/FaceWalker.ts`, `src/surfaces/geodesic/geodesic.test.ts`
**Regression tests:** 2 added (north pole crossing + south pole crossing). 48 geodesic tests pass.
**Code path:** `main.ts → GameLoop → MeshWalker → FaceWalker` — fix affects main game.

---

### S27h — Non-Host Player Sees Only "Game Paused" Text

**Symptom:** When the host paused in LAN MP, the non-host player saw only a static overlay with "Host has paused the game" — no buff list, no menu options, no interaction.

**Root cause:** `network-main.ts` had a hardcoded `pauseOverlay` div for non-host players (simple text), while the full `PauseMenu` component was only shown to the host.

**Fix:**
- Removed the non-host `pauseOverlay` div.
- Both host and non-host now use the full `PauseMenu`.
- `setIsHost(isHost)` called dynamically — host still gets END GAME / STOP SERVER buttons; non-host does not.
- Added `buildPauseMenuGameData()` helper that collects real buff data from `buffManager.getActiveBuffs()`.
- Also fixed: host's buff data was previously `buffs: []` (empty).
- ESC while paused (non-host): dismisses the menu overlay (game stays frozen until host resumes).

**Files:** `src/network-main.ts`, `src/ui/PauseMenu.ts`
**Verification:** Level 1 (compiles clean). User must test LAN session.

---

### S27h — Combined Team Score Always Shows Zero

**Symptom:** Large score number displayed under the wave counter always showed "0" and never updated.

**Root cause:** `#score-display` DOM element in `index.html` starts at "0". `network-main.ts` never updated it — only the per-player HUD elements were wired.

**Fix:**
- Cache `#score-display` and `#multiplier-display` refs at UI setup time.
- In `onStateChange`, calculate combined team score (`sum of all player scores`) and assign to `#score-display.textContent`.
- Move `#score-display` top from 20px to 45px (below wave label, not overlapping).
- Hide `#multiplier-display` (shows stale "×1" in network mode).

**Files:** `src/network-main.ts`
**Tests:** 5 unit tests in `src/network/combinedScore.test.ts` (score calculation logic).

---

### S27h — Buffs Persist Between Rounds

**Symptom:** After a round ended and voting → next game transition occurred, buff stacks carried over into the new game instead of resetting.

**Root cause:** `resetGameEntities()` in `network-main.ts` (called on voting→playing phase transition) cleared bullets, enemies, geoms, and pickups but did NOT call `buffManager.reset()`.

**Fix:** Added `buffManager.reset()` to `resetGameEntities()` in `src/network-main.ts` before `gameOverShown = false`.

**Note on SP:** Single-player was already clean — `gameOverScreen.onContinue` does a full page reload; `levelCompleteScreen.onNext/onReplay` calls `buffManager.dispose()` then `main()`.

**Files:** `src/network-main.ts`, `src/test/difficulty-rebalance.test.ts`
**Regression tests:** 2 added (all stacks cleared after reset; multipliers return to 1.0).

---

## Known Limitations

| Issue | Impact | Status |
|-------|--------|--------|
| **Dev mode only** | LAN hosting requires Vite dev server (`/__lan/` endpoints) | Can run `npm run server` manually for production |
| **Ghost enemies (collision disabled in MP spawn)** | Some enemies render but can't be shot (task `s27h-ghost-enemies-no-collision`) | Pending fix |
| **Buff/drone companions invisible in MP** | Buff pickups show UI ring but drones don't render (`s27g-buff-drone-entities-invisible`) | Pending fix |
| **Special weapon effects missing in MP** | Tesla spark, burning hands, etc. don't appear in LAN (`s27g-special-weapon-effects-missing-mp`) | Pending fix |
| **Client sync glitches on join** | Late-joining clients can see glitched geometry/stale bullets (`s27g-client-sync-glitched-geometry`) | Pending fix |
| **Spawn indicators still mismatched in some cases** | Fixed in S27g for the cap-overflow case; S27h reports further issues | Partially fixed |
| **Cube surface traversal blockers** | Random edges block movement on cube (`s27g-cube-map-broken-vertices-block-movement`) | Pending fix |
| **No reconnection** | If WebSocket drops, client must refresh | Not implemented |
| **Basic client prediction only** | Local player movement predicted; remote entities not interpolated | Acceptable on LAN |
| **Scan takes 1–2 seconds** | HTTP probe of 254 IPs per subnet | mDNS would be faster |

---

## Troubleshooting

### Server won't start / port conflict

```bash
ss -tlnp | grep -E '300[0-9]|2567'   # Check what's using the ports
# Kill stale processes first, then restart
```

### Client connects but game state is empty (all undefined)

This is the ES2022 Schema bug. Schema change-tracking setters were overwritten. Check `server/schema/GameState.ts` — all synced fields must use `declare` + constructor assignment. Run:
```bash
node -e "const g = require('./server/schema/GameState.js'); const s = new g.GameState(); console.log(s.encodeAll().length)"
# If output is 0: Schema encoding is broken
```

### Player/enemy positions look right but bullets don't hit

Check collision is enabled for all spawned entities. In LAN mode, collision registration happens server-side in `GameRoom.ts` — verify `spawnEnemy()` enables the hitbox.

### Weapons show wrong visual in MP

The `bulletWeaponType` map in `network-main.ts` must be populated in `onStateChange` before the render loop reads it. If a bullet arrives before its owner's state, the map lookup returns undefined → falls back to Standard visual.

### ERR_EMPTY_RESPONSE when loading the game

Almost always zombie servers. Run:
```bash
ss -tlnp | grep -E ':(300[0-9]|2567)\b' | awk '{print $NF}' | grep -oP 'pid=\K[0-9]+' | sort -u | xargs -r kill -15
```

### Camera spinning wildly after joining

Camera `up` vector must use `frame.bitangent`, NOT the surface normal. Lerp camera BEFORE `lookAt()`. See `// REGRESSION GUARD:` comments in `GameLoop.ts`.

### Movement feels sluggish/input lag in LAN

Normal — server-authoritative with ~33ms state patches. Local player has client-side prediction; if prediction feels off, verify `predSpeed` in `network-main.ts` matches `PLAYER_SPEED` in `GameRoom.ts`.

---

## Supported Maps

All 12 surfaces support LAN multiplayer. Known surface-specific issues:

| Surface | Status | Notes |
|---------|--------|-------|
| Sphere | Working | Pole traversal fixed in S27h |
| Torus | Working | Companion orbit fixed in S27g |
| Cube | Partially broken | Edge traversal blockers still present (S27g pending) |
| Cube-tunnel | Working | |
| Capsule | Working | |
| Pill | Working | |
| Möbius | Working | |
| Klein | Working | |
| Tunnel | Working | |
| Peanut | Working | |
| Cylinder | Working | |
| Knot | Working | |

## Player Count Scaling

The server scales enemy count and spawn rate based on player count. Enemy cap and spawn intervals are adjusted to keep gameplay balanced with more players.

| Players | Notes |
|---------|-------|
| 1 | Solo LAN game — same as SP difficulty |
| 2 | Recommended for testing |
| 3–4 | Max supported. More enemies spawn. Combined scoring. |

Server constants (in `server/rooms/GameRoom.ts`):
- `MAX_CLIENTS = 4`
- `MAX_ENEMIES = 50`
- `WEAPON_DROP_CHANCE = 8%` per enemy death

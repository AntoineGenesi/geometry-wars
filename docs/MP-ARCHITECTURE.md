# MP Architecture Reference — Why MP != SP

> **Purpose:** Permanent reference for AI agents and developers working on multiplayer features. Read this BEFORE touching any MP code.

## The Three Code Paths

| Path | Entry Point | Game Logic | Used For |
|------|-------------|------------|----------|
| **Single-Player** | `src/main.ts` | `src/core/GameLoop.ts` | Default game |
| **LAN Multiplayer** | `src/network-main.ts` | Inline (4400 lines) + Colyseus server | LAN play |
| **Playground** | `src/playground-main.ts` | `PlaygroundGame.ts` | Tests/demos only |

**Critical:** SP and MP do NOT share a game loop. `network-main.ts` has its own inline implementation of every system. Changes to `GameLoop.ts` do NOT automatically appear in MP.

## Architecture: SP vs MP

### SP Architecture
```
main.ts → Game.ts (Three.js) + GameLoop.ts (all systems)
         → GameContext (ctx) bundle passed to all systems
         → Single update loop: physics + rendering combined
```

### MP Architecture
```
network-main.ts (client)           server/rooms/GameRoom.ts (server)
  ├─ onFixedUpdate (input/physics)    ├─ 60Hz simulation loop
  ├─ onRender (interpolation/visual)  ├─ Enemy AI + spawning
  ├─ onStateChange (Colyseus sync)    ├─ Bullet physics (Christoffel UV)
  └─ Client prediction                ├─ Hit detection + damage
                                      └─ Score, lives, pickups
```

### Key Architectural Differences

| System | SP | MP Server | MP Client |
|--------|----|-----------| ----------|
| **Game loop** | `GameLoop.update()` | `setSimulationInterval(60Hz)` | `onFixedUpdate` + `onRender` |
| **Player movement** | `MeshWalker.moveFromInput()` (face walking) | UV-space + metric correction | Client prediction mirrors server |
| **Bullet physics** | `BulletPool.update()` + surface walking | Christoffel UV geodesics | FaceWalker visual rendering |
| **Hit detection** | `CollisionSystem` (world-space) | UV-distance + great-circle (sphere) | Server-authoritative |
| **Enemy AI** | `BaseEnemy` subclasses with behaviors | `ServerEnemyAI` (chase/flee/swarm/wander) | Interpolation only |
| **Damage calc** | `scorePowerMult * levelMult * buffMult * masteryMult * weaponMult` | `WEAPON_CONFIGS[type].damage` (flat) | Server-authoritative |
| **Pickups** | `PickupSpawner` (full lifecycle) | Weapon pickups server-side; buff/companion client-side | Mixed |
| **DDA** | Full system (tracker + engine + modifier + logger) | Client-side DDA feeds EnemySpawner (host only) | Host client runs DDA |
| **Camera** | `CameraController.update()` with smoothing | Same `CameraController` | Same |

## The Bullet Saga (S38–S41)

Bullets have been the most contentious MP system. The current architecture:

```
SERVER (authoritative):
  Christoffel UV equations for:
  - Bullet movement (geodesic on parametric surface)
  - Hit detection (UV-distance from bullet to enemy)
  - Pole crossing (V reflection + U shift)

CLIENT (visual only):
  FaceWalker meshSurface.moveGeodesic() for:
  - Visually correct great-circle paths on mesh geometry
  - Server resyncs UV/direction at ~20Hz to prevent drift
```

**Why separate?** FaceWalker produces true geodesics on triangle meshes but can diverge from Christoffel's parametric UV equations by up to 18 degrees. Using FaceWalker for hit detection caused phantom hits/misses. Using Christoffel for visuals produced straight UV-space lines instead of great-circle curves.

### Bullet Fix Timeline
1. **S38b** — `d309099`: Wrap-aware UV lerp (boundary fix)
2. **S39-01** — `bcaa53e`: Server pole crossing via Christoffel
3. **S40-04** — `9a5c863`: Client FaceWalker geodesic rendering added
4. **S40-08** — `cf5617e`: Replaced FaceWalker with Christoffel client-side (broke visuals)
5. **S41-01** — `5af0618`: Restored FaceWalker visual, kept Christoffel hit detection (current)

## Damage Parity

### SP Damage Formula
```
finalDamage = baseDamage * scorePowerMult * playerLevel.damageMult
            * buffManager.damageMult * masteryMult * weaponUpgradeMult
```

### MP Damage Formula (server)
```
finalDamage = WEAPON_CONFIGS[weaponType].damage
```

**Gap:** MP server does NOT apply player level multipliers, buff multipliers, mastery multipliers, or score-power multipliers. Only base weapon damage is used. This is the primary reason MP damage "feels off."

### Weapon Damage Constants (server)
| Weapon | Server Damage | SP Base Damage |
|--------|--------------|----------------|
| standard | 0.25 | 0.25 |
| spread | 1 | 1 |
| piercing | 3 | 3 |
| homing | 6 | 6 |
| chain_lightning | 4 | 4 |
| plasma_mortar | 20 | 20 |
| laser_beam | 2 | 2 |
| tesla_coil | 1 | 1 |

Base values match. The difference is entirely in multiplier stacking.

## Enemy AI Parity

### SP Enemy Behaviors (BaseEnemy subclasses)
30 enemy types with unique movement patterns: chase, flee, orbit, weave, dash, split, snake, carrier, etc. Each has its own class in `src/entities/enemies/`.

### MP Server Enemy AI
Server has basic AI strategies ported in stages:
- **S41-10** (`19acc13`): Added chase, flee, swarm behaviors
- Before that: only random/wander movement

**Remaining gaps:** Many SP enemy types (orbit, helix, lurker state machine, repulsor phases, duck cardinal movement) use simplified server implementations that don't match SP's exact behavior.

## Pickup Parity

### SP Pickups
- Weapon pickups: spawned by `PickupSpawner`, full 3D mesh rendering, spin animation
- Buff pickups: spawned on enemy death, full 3D mesh, glow effects
- Companion pickups: spawned on enemy death, 3D mesh
- Super pickups: spawned by wave system

### MP Pickups
- **Weapon pickups**: Server-authoritative spawning (8% drop rate), client renders 3D mesh — **works**
- **Buff pickups**: Client-side only, spawned on enemy death — **visual only, no server damage bonus**
- **Companion pickups**: Client-side only — **functional locally**
- **Super pickups**: Not implemented in MP

## Movement Speed Parity

### SP Movement
```
effectiveSpeed = PLAYER_MOVE_SPEED(3.0) * mapSizeScaleFactor * moveSpeedMultiplier * boostMult
```
Uses `MeshWalker` for geodesic face-walking on actual mesh geometry.

### MP Movement
```
PLAYER_SPEED = 0.095 UV/s  (≈ 3.0 / (pi * 10) for R=10 sphere)
```
Metric corrections per surface: `correctedDx = dx / max(sin(phi), 0.3)` for sphere, full 2-axis for peanut, sign-flip for torus.

**Key difference:** SP walks on mesh faces (world-space), MP moves in UV-space with metric corrections. The 0.095 constant was derived for a radius-10 sphere but may not scale identically for other surfaces.

## The Aim Saga (S38d–S40)

Three fix attempts:
1. **S38d-08** — Removed mouseY negation: `atan2(mouseY, mouseX)` — **WRONG** (inverted aim)
2. **S39-02** — Reverted to `atan2(-mouseY, mouseX)` — **partially correct**
3. **S40-03** — Camera-frame projection using `camera.matrixWorld` right/up vectors — **CORRECT** (current)

The root cause was that mouse screen coordinates need to be projected through the camera's local frame to match the surface tangent plane. A simple atan2 formula doesn't account for camera orbit rotation.

## Parity Checklist for New Features

When adding ANY gameplay feature to SP:

- [ ] Does it need to exist in MP? (most gameplay features do)
- [ ] **Server-side:** Add to `GameRoom.ts` if it affects game state (damage, spawning, scoring)
- [ ] **Client-side:** Add to `network-main.ts` if it's visual/audio only
- [ ] **Constants:** Are they shared or duplicated? (currently duplicated — tech debt)
- [ ] **Hit detection:** Does it need collision? Add to server's `checkCollisions()`
- [ ] **Pickups:** Server-authoritative or client-side?
- [ ] **Test:** Does the feature work on sphere AND non-sphere surfaces?
- [ ] **Pole crossing:** Does the feature behave correctly when V crosses 0 or 1?

## Known Tech Debt

1. **No shared constants module** — SP and MP define damage, speed, radius values independently
2. **No shared game loop** — All gameplay logic is duplicated between GameLoop.ts and network-main.ts
3. **Buff damage not server-authoritative** — Buff pickups are client-only; damage bonuses don't apply on server
4. **Player level multipliers missing** — Server doesn't know about kill-based level-up damage bonuses
5. **Weapon mastery not on server** — XP and mastery damage bonuses are client-only
6. **Super pickups missing** — Not implemented in MP at all
7. **Enemy AI simplified** — Many enemy types have basic chase instead of full SP behavior

## Files to Edit

| Change Type | SP File(s) | MP File(s) |
|-------------|-----------|------------|
| Player movement | `GameLoop.ts`, `MeshWalker.ts` | `network-main.ts` (client prediction), `GameRoom.ts` (server) |
| Bullet behavior | `Bullet.ts`, `BulletPool.ts` | `GameRoom.ts` (physics/hit), `network-main.ts` (visual) |
| Enemy spawning | `EnemySpawner.ts`, `WaveScheduler.ts` | `GameRoom.ts` |
| Enemy AI | `src/entities/enemies/*.ts` | `GameRoom.ts` (`updateEnemies()`) |
| Damage | `GameLoop.ts` (collision callbacks) | `GameRoom.ts` (`checkCollisions()`) |
| Hit detection | `CollisionSystem.ts` | `GameRoom.ts` (`checkCollisions()`) |
| Pickups | `PickupSpawner.ts` | `GameRoom.ts` (weapon), `network-main.ts` (buff/companion) |
| Camera | `CameraController.ts` | `CameraController.ts` (shared) |
| UI/HUD | `src/ui/*.ts` | `src/ui/*.ts` (mostly shared) |

## Common Failure Patterns

1. **"Fixed in SP, forgot MP"** — The #1 issue. Always check both code paths.
2. **"Bullets look wrong"** — Visual (FaceWalker) vs physics (Christoffel) divergence. Server resync prevents drift.
3. **"Damage feels off"** — MP server uses flat damage, no multiplier stacking from levels/buffs/mastery.
4. **"Aim is inverted"** — Must use camera-frame projection, not simple atan2.
5. **"Enemies are dumb"** — Server AI is simpler than SP. Only basic behaviors ported.
6. **"Pole crossing breaks"** — Need V reflection + U shift + vFlip tracking on both server and client.
7. **"Hit detection radius wrong"** — Sphere uses world-space great-circle; non-sphere uses UV-distance with different constants.

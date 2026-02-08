# Architecture

## Movement System

Two movement systems coexist, bridged via coordinate conversion.

### Mesh-Based BVH (Player + Bullets)

- **MeshSurface** (`src/experimental/mesh-movement/MeshSurface.ts`): Wraps any `THREE.Mesh` with a BVH from `three-mesh-bvh`. Provides `closestPointOnSurface()`, `moveOnSurface()`, `raycast()`, and tangent frame computation. No UV coordinates, no shape-specific code.
- **MeshWalker** (`src/experimental/mesh-movement/MeshWalker.ts`): Persistent tangent frame for smooth movement. `moveFromInput(dx, dy, dt)` moves along the surface tangent plane, then snaps to the mesh via BVH. `getAimDirection(screenDir)` converts screen-space aim to surface-tangent direction. Speed is in world units/sec, constant everywhere.

### UV-Based (Enemies + Geoms)

- **Surface** (`src/surfaces/Surface.ts`): Abstract base with 10 implementations (Sphere, Torus, Cube, Cylinder, Peanut, Capsule, Icosahedron, Mobius, DentedSphere, SphereWithTunnel). Each provides `getPoint(u,v)`, `moveOnSurface(u,v,du,dv)`, and `worldToSurface(pos)`.
- **UV Bridge**: `surface.worldToSurface()` converts world positions to UV, allowing MeshWalker-based player to interact with UV-based enemies.

## Entity System

- **Entity** (`src/core/Entity.ts`): Base class with mesh, position, alive flag.
- **EntityManager** (`src/core/EntityManager.ts`): Manages entity lifecycle (add/remove/update).
- **Player** (`src/entities/Player.ts`): Lives, shield, invincibility, bomb count.
- **BaseEnemy** (`src/entities/enemies/BaseEnemy.ts`): 15 types registered in EnemySpawner. Constructor: `(surfaceU, surfaceV, health, scoreValue, geomCount, speed, radius?)`. Types: Grunt, Weaver, Wanderer, Snake, Spinner, SpinnerSpawn, Rocket, Duck, Mayfly, Painter, Virus, Spawner, Neutron, Repulsor, Gate. Titan variants: TitanGrunt, TitanSpinner, TitanWeaver. Boss type.
- **Bullet** (`src/entities/Bullet.ts`): Pooled. Uses MeshSurface when available, falls back to spherical paths. Tracks `ownerId` for kill attribution.
- **Geom** (`src/entities/Geom.ts`): Pooled score pickups dropped by enemies.

## Weapon System

- **WeaponTypes** (`src/weapons/WeaponTypes.ts`): 10 types -- Standard, Spread, Piercing, ChainLightning, Homing, PlasmaMortar, GravityGun, LaserBeam, BlackHole, TeslaCoil. Each has damage, fire rate, ammo, projectile speed.
- **WeaponManager** (`src/weapons/WeaponManager.ts`): Handles current weapon, switching, ammo depletion.
- **WeaponPickup** (`src/weapons/WeaponPickup.ts`): Timed surface pickups that grant weapon changes.

## Drone System

- **DroneFactory** (`src/weapons/DroneFactory.ts`): Creates 6 drone types from `DroneType` enum.
- Types: Attack (shoots), Collect (gathers geoms), Defend (blocks), Ram (charges enemies), Snipe (long-range), Sweep (area clear).
- Each drone orbits the player and acts autonomously based on type.

## Super State System

- **SuperStateManager** (`src/weapons/SuperState.ts`): Manages active super state effects (12s default duration).
- 7 states: QuadFire, SplitFire, ReverseFire, Missile, Magnet, TrailBomb, Shield.
- **SuperStatePickup** (`src/weapons/SuperStatePickup.ts`): Surface pickups that activate super states.

## Effects

- **ParticleSystem** (`src/effects/ParticleSystem.ts`): GPU-based, 5000 particle pool.
- **ScreenShake** (`src/effects/ScreenShake.ts`): Camera shake on events.
- **TrailEffect** (`src/effects/TrailEffect.ts`): Entity movement trails.
- **GlowTrail** (`src/effects/GlowTrail.ts`): Neon glow trails.
- **EntityGlow** (`src/effects/EntityGlow.ts`): Per-entity glow effect.
- **ChainLightning** (`src/effects/ChainLightning.ts`): Visual arcs for chain lightning weapon.
- **ScorePopup** (`src/effects/ScorePopup.ts`): Floating score text on kills.

## Audio

- **SoundEngine** (`src/audio/SoundEngine.ts`): 11 procedural synth sounds via Web Audio API (shoot, enemyDeath, playerDeath, bomb, geomPickup, multiplierUp, weaponPickup, shieldHit, spawn, menuSelect, menuHover).
- **BackgroundMusic** (`src/audio/BackgroundMusic.ts`): 128bpm procedural beat. Intensity scales with gameplay (enemy count, score multiplier).

## Multiplayer

- **KillTracker** (`src/multiplayer/KillTracker.ts`): Tracks kills, assists, and combined totals per player. Assist threshold: 20% of enemy max HP. Assist reward: 40% of base score.
- **AuraManager** (`src/multiplayer/AuraSystem.ts`): 5-tier proximity buff system. Outer ring (cyan): damage multiplier + heal rate. Inner ring (magenta): stronger buffs at tiers 3-5. Healing accumulates toward +1 life at 30 HP threshold.
- **NetworkClient** (`src/network/NetworkClient.ts`): Colyseus client wrapper for network multiplayer.

## Camera

Camera follows player along surface normal. Uses MeshWalker's persistent tangent frame for the `up` vector, preventing flips on complex surfaces like torus. Distance: 15 world units from player. `game.disableBuiltInCameraUpdate = true` prevents the default orbit camera from overriding.

## Network Multiplayer

Server-authoritative multiplayer using Colyseus 0.15.x with Schema v2 binary state synchronization.

- **Server**: `server/rooms/GameRoom.ts` runs a 60 Hz game loop with input processing, enemy AI, collision detection, and entity spawning. State patches broadcast every 50ms.
- **Schema**: `server/schema/GameState.ts` defines 6 synced classes (PlayerState, BulletState, EnemyState, GeomState, WeaponPickupState, GameState) using `declare` + `defineTypes()` to avoid ES2022 class field conflicts with Schema setters.
- **Client**: `src/network/NetworkClient.ts` wraps Colyseus client with typed callbacks. `src/network-main.ts` renders server state onto Three.js surfaces.
- **LAN Hosting**: `vite-plugin-lan.ts` adds `/__lan/*` middleware to Vite dev server, spawning Colyseus as a child process. `src/network/LANClient.ts` provides the client-side API. Includes subnet scanning for server discovery.

For full details on connection flow, the ES2022 encoding bug, LAN architecture, and lessons learned, see **[LAN Multiplayer Architecture](./lan-multiplayer-architecture.md)**.

## Game Loop

- **Game** (`src/core/Game.ts`): Renderer, scene, camera, animation loop.
- **GameClock** (`src/core/GameClock.ts`): Delta time, pause support.
- **GameMode** (`src/core/GameMode.ts`): State machine for game flow.
- **ScoreManager** (`src/core/ScoreManager.ts`): Score, multiplier, lives, bombs.
- **EnemySpawner** (`src/entities/enemies/EnemySpawner.ts`): Wave-based enemy spawning.
- **LevelData** (`src/core/LevelData.ts`): 50 adventure levels across 6 sections.

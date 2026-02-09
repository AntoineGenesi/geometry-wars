## 2026-02-09 - LAN Multiplayer Rewrite: Reuse Real Game Components

**Context:** The LAN/network multiplayer mode (`network-main.ts`) was a separate reimplementation that created its own crude meshes for players and enemies instead of reusing the real game classes. Players were basic ConeGeometry/BoxGeometry shapes instead of the proper chevron prism mesh (`buildChevron3D`). Enemies were simple colored boxes/cones instead of the full GeometryBuilder meshes used by single player and co-op. Many subsystems were missing (KillLog, TotalKillCounter, WeaponPickup class, GlowTrail).

The user explicitly said: "we shouldn't have three different copies of the game, that's LUDICROUS. It should be re-utilizing the same stuff."

**The Root Problem:**

Three separate game implementations existed:
1. `main.ts` (single player) -- uses Game class, real Player, real enemies, all effects. Works great.
2. `multiplayer-main.ts` (local co-op) -- uses Game class, real Player, real enemies, all effects. Works great.
3. `network-main.ts` (LAN) -- used Game class for bloom/scene BUT created its own crude meshes for players and enemies. Looked visually different from single player.

The fundamental issue was that `network-main.ts`:
- Created player meshes with `new THREE.ConeGeometry(0.3, 0.8, 4)` instead of using the real `Player` class (which uses `buildChevron3D`)
- Created enemy meshes with basic `THREE.BoxGeometry(0.3, 0.3, 0.3)` instead of using `EnemySpawner.spawn()` (which creates real Diamond3D, Octahedron3D, etc. meshes via GeometryBuilder)
- Used `TrailEffect` instead of `GlowTrail`
- Was missing: KillLog, TotalKillCounter, real WeaponPickup, score popups with values, multiplier color scaling

**What Was Changed:**

| Component | Before (broken) | After (shared) |
|-----------|-----------------|----------------|
| Player mesh | Custom `createPlayerMesh()` with ConeGeometry | Real `Player` class with `buildChevron3D` |
| Player color | Inline MeshBasicMaterial | `player.setColor()` (same as co-op) |
| Player orientation | Manual quaternion math | `orientPlayerOnSurface()` (same as co-op) |
| Player trail | `TrailEffect` | `GlowTrail` (same as single player) |
| Enemy mesh | Custom `createEnemyMesh()` with basic shapes | `EnemySpawner.spawn()` with real GeometryBuilder meshes |
| Enemy positioning | Manual `surface.getPoint()` | `enemy.applySurfaceTransform()` (same as co-op) |
| Death effects | Only particles + shake | Particles + shake + score popup + kill log + grid deformation + sound |
| Weapon pickups | Custom `THREE.OctahedronGeometry` | Real `WeaponPickup` class (same as single player) |
| Kill tracking | None | `KillLog` + `TotalKillCounter` (same as single player) |
| Score display | Plain text `Lives: 3` | Hearts + multiplier colors (same as single player HUD logic) |
| Enemy color map | Incomplete, different colors | Same color map as single player / co-op |

**What Is Now Shared Between All Three Modes:**

- `Game` class (scene, renderer, bloom, vignette, game loop)
- `Player` class (mesh, chevron shape, setColor, orient on surface)
- `EnemySpawner` + all `BaseEnemy` subclasses (real enemy meshes)
- `SurfaceFactory.create()` (same surface creation)
- `MeshSurface` (BVH, depth-based visibility)
- `ParticleSystem` (death, bullet impact, player death)
- `ScreenShake`
- `ScorePopupManager` (with score values)
- `KillLog` + `TotalKillCounter`
- `WeaponPickup` (real weapon pickup meshes)
- `GlowTrail` (player trail effect)
- `AllyGlowManager` (remote player indicators)
- `SoundEngine` + `BackgroundMusic`
- `BulletPool` + `GeomPool`
- Lighting setup (ambient + directional + fill)
- Camera follow logic (surface normal + lerp + smooth up vector)
- Depth-based opacity for backface enemies
- Grid deformation on death/impact

**What Still Differs (by necessity):**

- **Input handling**: Network mode sends input to server; single player/co-op processes locally
- **Game logic**: Server runs collision detection, spawning, scoring; local modes run locally
- **Entity lifecycle**: Server creates/destroys entities; client creates visual entities on demand
- **HUD**: Network mode uses a simpler programmatic HUD (no HTML elements from index.html)
- **Spawn warnings**: EnemySpawner creates spawn warning indicators; in network mode they appear briefly then the enemy is immediately made visible (since the server already decided when the enemy exists)
- **Enemy AI**: EnemySpawner.update() runs enemy AI locally, but positions are overridden by server state in onStateChange. This means enemies may move slightly between server updates, then snap back -- creating minor visual smoothing rather than jitter.

**Architectural Decision: EnemySpawner in Network Mode**

The enemies are created via `EnemySpawner.spawn()` to get the correct visual meshes. However, `EnemySpawner.update()` also runs enemy AI. We call `update()` anyway because:
1. It cleans up spawn warning indicator meshes (without this, they'd leak)
2. The AI-driven movement between server updates provides some visual smoothing
3. Server positions override everything in `onStateChange` at ~30Hz

Alternative considered: extract mesh creation into a separate factory. This would be cleaner but requires refactoring EnemySpawner which is a shared module -- high disruption for the spawn warning cleanup issue alone.

**Server-to-Client Type Mapping:**

The server uses some enemy type names that don't exist in the client's `EnemyType` (e.g., "arrow", "blackhole", "proton"). These are mapped to the closest local visual type via `SERVER_TO_SPAWNER_TYPE`. Similarly, weapon type strings from the server are mapped to `WeaponType` enum values via `SERVER_TO_WEAPON_TYPE`.

**What Could NOT Be Verified Without Live Testing:**

1. Visual parity with single player (do enemies look identical?)
2. Spawn warning behavior (does the brief warning ring look OK or should it be suppressed?)
3. Enemy movement smoothing (does the AI-then-override approach look smooth or jittery?)
4. Score popup positioning (do they appear at correct world positions?)
5. Map selection flow (does the server's surfaceType propagate correctly to the client?)
6. Depth-based opacity (does the same MeshSurface.getVisibility() work for spawner-created enemies?)

**Reversibility:** Medium - The old `network-main.ts` is fully replaced. To revert, use git. To iterate further, the shared components are clean imports that can be swapped.

**What Would Need to Change for Full Game Class Integration:**

The ideal long-term architecture would be:
1. Have the server send events (enemy_spawned, enemy_died, player_hit) rather than full state
2. Run a real Game instance on the client with the same game logic
3. Use server events to reconcile (server-authoritative correction of client prediction)

This would require significant server-side refactoring (event-based protocol instead of state-sync) and is a larger project.

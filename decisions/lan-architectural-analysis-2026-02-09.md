## 2026-02-09 - LAN Multiplayer: Why It Looks Different From Co-op

### Context

The user reported that LAN multiplayer looks and feels "completely different" from local co-op split-screen, despite both being multiplayer modes. This has been reported 3+ times across sessions. Previous agents claimed fixes that didn't address the core issue.

---

### Root Cause: Two Completely Separate Implementations

The fundamental problem is architectural. There are TWO game implementations that share almost no code:

1. **`multiplayer-main.ts` (co-op)** - Uses the REAL game systems: `Player`, `MeshWalker`, `EnemySpawner`, `WeaponManager`, `ParticleSystem`, `ScreenShake`, `ScorePopupManager`, `KillLog`, `AuraManager`, `SplitScreenRenderer`. This is basically the full game with multiple players.

2. **`network-main.ts` (LAN)** - A stripped-down reimplementation that creates its own basic THREE.js meshes for players/enemies, handles state sync from Colyseus server, and renders a much simpler version of the game.

### Detailed Comparison of Missing Features (Before Fix)

| Feature | Co-op | LAN (Before) |
|---------|-------|--------------|
| Lighting | 3 lights (ambient + directional + fill) | NONE |
| Surface config | gridColor, surfaceColor, opacity, radius, grid segments | Bare default (no config) |
| Surface material | Dark transparent MeshBasicMaterial | Default surface material |
| Camera distance | 15 | 20 |
| Camera up smoothing | Lerped up vector | Hard-set (jerky) |
| Player mesh | Full Player class with colored chevron | Simple cone+box placeholder |
| Player movement | MeshWalker geodesic at 3.0 world units/s | Server UV-space at 0.08 UV/s (~1.26 world units/s) |
| Enemies | 15+ types via EnemySpawner with real meshes | Simple box/cone placeholders |
| Enemy death effects | Particles + screen shake + grid deformation + sound | NONE |
| Player death effects | Particles + screen shake + sound | NONE |
| Score popups | ScorePopupManager with floating text | NONE |
| Screen shake | Full ScreenShake system | NONE |
| Grid deformation | surface.applyForce() + surface.updateGrid() | NONE |
| Kill log | KillLog + TotalKillCounter | NONE |
| Weapon system | Full WeaponManager with 10 weapons | Basic text HUD only |
| Sound effects | Shoot, death, pickup, bomb sounds | NONE |
| Background music | BackgroundMusic with intensity scaling | NONE |
| Bullet projection | BVH-based surface projection | Basic position interpolation |

### Why Previous Fixes Failed

Previous agents focused on narrow bugs (map selection, movement inversion, lag) while missing the elephant in the room: the LAN mode was a completely different, much simpler rendering system. Even fixing all three bugs doesn't make it "look like co-op" because:

1. **No lighting** = everything flat and dark
2. **No surface config** = default grid colors instead of the game's dark-purple aesthetic
3. **No death effects** = enemies just vanish silently
4. **No screen shake** = no impact feel
5. **No sound** = silent game
6. **Wrong camera distance** = too far away, everything feels small

These are not bugs - they were simply never implemented. The agents treated symptoms (map, movement, lag) without diagnosing the architectural cause.

---

### Changes Made in This Fix

#### 1. Visual Quality (network-main.ts)

- **Added 3 lights** matching co-op exactly (ambient 0x404080, directional, fill light)
- **Added surface config** with same gridColor, surfaceColor, opacity, radius, grid segments as co-op
- **Added surface mesh material override** (dark transparent MeshBasicMaterial)
- **Added ScreenShake** system
- **Added ScorePopupManager**
- **Added grid deformation** (surface.applyForce on enemy deaths, surface.updateGrid every frame)
- **Added enemy death effects** (particles, screen shake, grid force, sound)
- **Added player death effects** (particles, screen shake, sound)
- **Added shoot sound** with fire-rate throttle
- **Added BackgroundMusic** with intensity scaling
- **Fixed camera distance** from 20 to 15 (matches co-op)
- **Fixed camera up vector** - now uses lerp like co-op (prevents jerky rotation)
- **Added bullet surface projection** in render callback

#### 2. Movement Speed (server/rooms/GameRoom.ts)

- **Increased PLAYER_SPEED** from 0.08 to 0.19 UV/s
  - 0.08 UV/s on radius-5 sphere = ~1.26 world units/s (too slow)
  - 0.19 UV/s on radius-5 sphere = ~2.98 world units/s (matches co-op's 3.0)
- **Increased enemy speeds** proportionally (all ~2.4x)
- **Increased BULLET_SPEED** from 0.15 to 0.26 UV/s (matches co-op's 4.0 world units/s)

#### 3. Map Selection

The deferred surface creation from the previous fix is architecturally correct:
- Surface is created AFTER connecting, reading server's `state.surfaceType`
- `getServerSurfaceType()` reads from Colyseus room state
- The surface now gets the SAME config as co-op (gridColor, opacity, etc.)

The remaining risk is a timing issue: if `room.state.surfaceType` is empty string when read immediately after connect, the `|| 'sphere'` fallback triggers. The polling mechanism in NetworkClient should handle this, but cannot be verified without end-to-end testing.

---

### What Was NOT Fixed (Honest Assessment)

1. **Player mesh mismatch**: LAN still uses simple cone+box meshes, not the real Player class. The Player class is deeply coupled to local game systems (MeshWalker, WeaponManager) and cannot be trivially used with server-authoritative state. Proper fix requires a "render-only Player" that takes UV coordinates from server.

2. **Enemy mesh mismatch**: LAN uses basic Box/Cone/Torus geometry, not the real enemy meshes from EnemySpawner. Same architectural issue - enemies are deeply coupled to local game logic.

3. **No client-side prediction**: Movement still has ~33-66ms latency because it's purely server-authoritative. A proper fix requires implementing client-side prediction + server reconciliation.

4. **Weapon pickups are server-side only**: The visual weapon meshes in LAN are basic octahedrons, not the real WeaponPickup class.

5. **Map selection cannot be 100% verified**: Without running 2 browser clients + Colyseus server, the fix cannot be confirmed by code analysis alone. The code trace shows it SHOULD work.

---

### Long-Term Proper Fix

The right solution is to make network-main.ts use the SAME rendering pipeline as co-op:
1. Create a `NetworkInputAdapter` that maps Colyseus server state to local game entities
2. Use real `Player`, `EnemySpawner`, `WeaponManager` classes in "render-only" mode
3. Feed server-authoritative positions into MeshWalker (position override, no physics)
4. Add client-side prediction for local player

This is a multi-day refactor. The current fix brings the visual quality much closer by adding all the missing effects, sounds, and matching surface/camera/lighting configuration.

---

### Build Verification

- `npx tsc --noEmit`: PASS (zero errors)
- `npx vitest run`: 1250 tests pass, 16 pre-existing failures in companion.test.ts (document not defined in test env)

### Reversibility

**Easy** - Changes are in 2 files:
- `src/network-main.ts`: All visual improvements
- `server/rooms/GameRoom.ts`: Speed constants only

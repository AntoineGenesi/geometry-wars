# S26 Visual Parity Audit — Why Nothing Worked

**Date:** 2026-02-21
**Auditor:** Read-only analysis of current repo state

---

## Executive Summary

S26 merged 8 visual parity sub-tasks into `src/network-main.ts`, and the code changes are genuinely present in the file. However, three categories of failure explain why the user experienced no improvement: (1) the S26 tasks were scoped to **additive visual polish** (glow trails, buff auras, LOD, etc.) while the user's complaints are about **missing fundamental gameplay systems** that were NEVER in scope for S26; (2) several S26 changes were wired only partially — infrastructure instantiated but never fully exercised; and (3) two critical non-visual bugs (`mapSize` not applied in LAN, invalid surface types in VotingScreen) cause the "weird maps" and possible server crashes reported. The S26 worker agents accurately reported Level 1 verification (TypeScript only) and said "user testing required" — but the orchestrator falsely summarized them as "0 regressions, all working."

---

## Feature-by-Feature Audit

### Camera Tilt / Orbit
- **S26 Task:** NOT IN SCOPE — no S26 task addressed camera tilt in LAN
- **Commit:** N/A
- **Code exists in repo:** YES — `src/core/CameraController.ts` has full orbit/tilt via middle mouse
- **Imported in network-main.ts:** NO — `CameraController` is not imported
- **Instantiated:** NO
- **Called in game loop:** NO — LAN camera uses a hardcoded 5-line lerp (lines 2461-2476)
- **Output consumed/rendered:** N/A
- **Failure mode:** CameraController was NEVER added to LAN multiplayer. No S26 task targeted this. The manual camera in LAN has no orbit/tilt support. Middle mouse does nothing in LAN mode. This is a fundamental gap that predates S26 and was not part of the S26 visual parity scope.

### Spawn Warnings (pre-spawn red ring)
- **S26 Task:** NOT IN SCOPE — deliberately disabled, not a visual parity gap
- **Commit:** N/A (existing behavior, not S26)
- **Code exists in repo:** YES — `EnemySpawner.spawn()` supports spawn warnings via `skipSpawnWarning=false`
- **Imported in network-main.ts:** YES — EnemySpawner is used
- **Instantiated:** YES — `enemySpawner.spawn(..., true)` — `skipSpawnWarning=true`
- **Called in game loop:** YES — but with warnings intentionally disabled
- **Output consumed/rendered:** N/A — intentionally disabled
- **Failure mode:** This is an intentional design decision documented in `network-main.ts` lines 1339-1341: "Pass skipSpawnWarning=true to avoid creating red ring indicators that would never be cleaned up (enemySpawner.update() is not called in network mode)." Spawn warnings require `enemySpawner.update()` to animate and clean them up. Since the server is authoritative for enemy positions, running `enemySpawner.update()` would cause enemy AI to fight the server state. This is an architectural constraint, not an S26 failure. Fixing it requires a different approach: either send a pre-spawn warning event from the server, or run a warning-only update pass without enemy AI.

### Bloom / Post-Processing
- **S26 Task:** `s26-mp-vp-p1-visual-style-surface` (commit `94e90e0`)
- **Commit:** `94e90e0` — merged, 45 lines added to network-main.ts
- **Code exists in repo:** YES — `loadVisualStyle()` called, bloom applied at Game creation (line 364-371)
- **Imported in network-main.ts:** YES
- **Instantiated:** YES — `new Game({ bloom: { strength: savedStyle?.bloomStrength ?? 1.0, ... } })`
- **Called in game loop:** YES — Game.ts handles bloom internally via EffectComposer
- **Output consumed/rendered:** YES — bloom renders
- **Failure mode:** WORKING. Bloom was already present in LAN before S26. S26 made it respect the user's saved visual style settings. If user sees no bloom, they may have saved a style with bloom disabled, or the threshold is set too high. The ShockwaveEffect replacing the vignette pass was also already present. This feature works.

### Screen Shake
- **S26 Task:** NOT IN SCOPE — was already present in LAN before S26
- **Commit:** Pre-S26
- **Code exists in repo:** YES
- **Imported in network-main.ts:** YES — line 34, 682
- **Instantiated:** YES — `const screenShake = new ScreenShake()`
- **Called in game loop:** YES — `screenShake.update(dt)` in onFixedUpdate, offset applied in onRender
- **Output consumed/rendered:** YES
- **Failure mode:** WORKING. Screen shake was already present. S26 did not change it.

### Entity Glow (pulsing halo on player)
- **S26 Task:** `s26-mp-vp-p1-entity-glow-trails` (commit `ae72b68` / `2d03a80`)
- **Commit:** `2d03a80` added 44 lines to network-main.ts
- **Code exists in repo:** YES — `EntityGlow, EntityGlowManager, GlowPresets` imported
- **Imported in network-main.ts:** YES — line 37
- **Instantiated:** YES — `const glowManager = new EntityGlowManager()` (line 709); `glowManager.addGlow(player.mesh, ...)` called in `getOrCreatePlayer()` for local player (line 1312)
- **Called in game loop:** YES — `glowManager.update(dt)` in onFixedUpdate (line 2199)
- **Output consumed/rendered:** YES — glow halos render
- **Failure mode:** WORKING — code is wired correctly. Note: `glowManager.addGlow()` is called instead of explicitly creating `EntityGlow` and using `attachTo()` like main.ts does. This is a different API path but should produce the same result if `EntityGlowManager.addGlow()` works correctly. If glow is invisible, it may be because `getOrCreatePlayer()` is called before the local player ID is known — but there is a guard `if (id === localPlayerId)` which should work once `localPlayerId` is set.

### Enemy Glow Trails (Mayfly/Rocket/Duck)
- **S26 Task:** `s26-mp-vp-p1-entity-glow-trails` (commit `2d03a80`)
- **Commit:** `2d03a80`
- **Code exists in repo:** YES
- **Imported in network-main.ts:** YES — `GlowTrail` on line 36
- **Instantiated:** YES — created in `getOrCreateEnemy()` for `FAST_ENEMY_TYPES` (lines 1347-1352)
- **Called in game loop:** YES — `enemyGlowTrails.forEach(t => t.update(dt))` in onFixedUpdate (line 2210), `enemyTrail.addPoint(...)` in onRender (line 2344-2346)
- **Output consumed/rendered:** YES
- **Failure mode:** PARTIALLY WORKING but with a subtle type-case bug. `network-main.ts` defines `FAST_ENEMY_TYPES = new Set<string>(['mayfly', 'rocket', 'duck'])` (lowercase, line 739) and checks against `spawnerType` from `SERVER_TO_SPAWNER_TYPE` mapping (also lowercase EnemyType strings). This should match correctly since `spawnerType` comes from the mapping which returns lowercase values. However, note that `main.ts` checks `enemy.constructor.name` (class names like `'Mayfly'`). In LAN the FAST_ENEMY_TYPES uses `spawnerType` string instead — this is correct for LAN because we're working with server type strings, not class names. The trails should work when these enemy types appear on screen.

### LOD Manager
- **S26 Task:** `s26-mp-vp-p1-lod-adaptive-quality` (commit `de6d937`)
- **Commit:** `de6d937` — 74 lines added
- **Code exists in repo:** YES
- **Imported in network-main.ts:** YES — line 61
- **Instantiated:** YES — `const lodManager = new LODManager()` (line 576)
- **Called in game loop:** YES — `lodManager.update(camera, enemyArray)` in onRender (line 2356)
- **Output consumed/rendered:** YES — `enemyInstanceManager.updateInstancesWithLOD(...)` (line 2357)
- **Failure mode:** WORKING. LOD is correctly wired. This is a performance system, not a visible feature — user would not notice it directly.

### Adaptive Quality
- **S26 Task:** `s26-mp-vp-p1-lod-adaptive-quality` (commit `de6d937`)
- **Commit:** `de6d937`
- **Code exists in repo:** YES
- **Imported in network-main.ts:** YES — line 62
- **Instantiated:** YES — `const adaptiveQuality = new AdaptiveQuality({ initialLevel: QualityLevel.ULTRA })` (line 579)
- **Called in game loop:** YES — `adaptiveQuality.update(dt)` in onFixedUpdate (line 2048)
- **Output consumed/rendered:** YES — `onQualityChange` callback adjusts bloom, particle budget, LOD (lines 582-628)
- **Failure mode:** WORKING. Quality system is correctly wired.

### Buff System Visuals (BuffManager, BuffHUD, BuffAuraRenderer, etc.)
- **S26 Task:** `s26-mp-vp-p2-buff-system` (commit `ba9a5e0` / `a841c07`)
- **Commit:** `a841c07` — 54 lines added
- **Code exists in repo:** YES — all 5 buff components imported and instantiated
- **Imported in network-main.ts:** YES — lines 53-57
- **Instantiated:** YES — lines 724-732
- **Called in game loop:** YES — aura updates in onFixedUpdate (lines 2222-2252), disposed in beforeunload
- **Output consumed/rendered:** EFFECTIVELY NO — task documents correctly: "Since buffManager will have NO active buffs (server doesn't send buff state), the aura renderers will be invisible." The infrastructure is there but server never sends buff state, so buffs never appear. This is a known gap documented in the task file.
- **Failure mode:** Infrastructure is present but inert. The buff system in LAN will remain invisible until the server is updated to send buff state. This was the INTENDED behavior per task design.

### Bullet Visual Types (Spread/Homing/Piercing)
- **S26 Task:** `s26-mp-vp-p2-bullet-visual-types` (commit `5b7fae8` / `90288ef`)
- **Commit:** `90288ef` — 30 lines added
- **Code exists in repo:** YES — `weaponToBulletVisual()` function exists (lines 91-98)
- **Imported in network-main.ts:** YES — `BulletVisualType` on line 60
- **Instantiated:** YES — used when adding bullets to `bulletInstanceManager`
- **Called in game loop:** YES — UV proximity heuristic in onRender (lines 2426-2436)
- **Output consumed/rendered:** YES — when local player uses Spread/Homing/Piercing
- **Failure mode:** WORKING with caveats. The heuristic (UV proximity to local player) is imperfect — remote player bullets always get Standard visual. But this is documented behavior per the task design.

### Player Level Aura Ring
- **S26 Task:** `s26-mp-vp-p2-player-level-score` (commit `4f85db8` / `de1a826`)
- **Commit:** `de1a826` — 28 lines added
- **Code exists in repo:** YES
- **Imported in network-main.ts:** YES — line 52
- **Instantiated:** YES — `const playerLevel = new PlayerLevel()` (line 714); `const levelUpNotification = new LevelUpNotification()` (line 715)
- **Called in game loop:** YES — `playerLevel.update(dt, auraPoint.position, auraPoint.normal)` in onFixedUpdate (line 2220)
- **Output consumed/rendered:** PARTIALLY — `scene.add(playerLevel.auraRing)` called in `getOrCreatePlayer()` when `id === localPlayerId` (line 1314). However, `playerLevel.addKill()` is never called in network-main.ts — the level never increases. Kills are counted server-side; no kill event is forwarded to `playerLevel`. The aura ring appears at level 1 but never grows.
- **Failure mode:** Wired but non-functional for leveling. The aura ring exists at default size. The task notes this: "Stat multipliers from PlayerLevel are NOT applicable in LAN because the server controls those values." But `addKill()` for visual progression was also never wired. Score display improvements and combo display were also out of scope (task status was "Pending" — it says Status: Pending but the commit exists — the task file shows the Status field was not updated from its pre-execution state).

### Debug Overlay (F3 key)
- **S26 Task:** `s26-mp-vp-p3-debug-settings-ui` (commit `c760ca0` / `772e75a`)
- **Commit:** `772e75a` — 31 lines added
- **Code exists in repo:** YES
- **Imported in network-main.ts:** YES — lines 84-85
- **Instantiated:** YES — `const perfTracker = new PerformanceTracker('network')` (line 393); `const debugOverlay = new DebugOverlay(perfTracker)` (line 394)
- **Called in game loop:** YES — `perfTracker` updated in onFixedUpdate, `debugOverlay.update()` called in onRender (line 2541)
- **Output consumed/rendered:** YES — F3 key shows overlay
- **Failure mode:** WORKING.

### Visual Style / Surface Appearance
- **S26 Task:** `s26-mp-vp-p1-visual-style-surface` (commit `94e90e0`)
- **Commit:** `94e90e0` — 45 lines added to network-main.ts
- **Code exists in repo:** YES
- **Imported in network-main.ts:** YES — lines 82-83
- **Instantiated:** YES — `const savedStyle = loadVisualStyle()` (line 360)
- **Called in game loop:** YES — surface config uses savedStyle in `initSurface()` (lines 514-527)
- **Output consumed/rendered:** YES
- **Failure mode:** WORKING. Visual style is now applied in LAN.

### Mobile Touch Input
- **S26 Task:** `s26-mp-vp-p1-mobile-touch` (commit `f14f697` / `01b4dfa`)
- **Commit:** `01b4dfa` — 31 lines added
- **Code exists in repo:** YES
- **Imported in network-main.ts:** YES — lines 39-40
- **Instantiated:** YES — `const mobile = isMobile()` (line 332); `const input = mobile ? new TouchInput() : new InputManager()` (line 766)
- **Called in game loop:** YES
- **Output consumed/rendered:** YES
- **Failure mode:** WORKING on mobile.

---

## Critical Bugs NOT Covered by S26 Visual Parity Tasks

### Map Size Not Applied in LAN (CRITICAL)
- **S26 Task:** `s26-mp-map-size-entity-mismatch` was a separate task that fixed `MeshSurface.ts` and `main.ts`. It did NOT fix `network-main.ts`.
- **Root cause:** `network-main.ts` never reads `state.mapSize` from `NetworkGameState`. The `initSurface()` function creates the surface at scale 1.0 (default MEDIUM) regardless of what the server sent. `MapSize`, `getMapSizeScaleFactor`, `getDefaultMapSizeForSurface` are imported in `main.ts` (line 79) but ABSENT from `network-main.ts`.
- **Evidence:** `grep -n "mapSize\|MapSize\|scaleFactor" src/network-main.ts` returns zero results.
- **Effect:** When server selects non-MEDIUM map size (Small/Large/Epic), the client surface stays at MEDIUM scale. The server sends enemy UV coordinates for a differently-scaled surface. Visual result: enemies appear at wrong positions relative to the surface. "Maps in the multiplayer are weird."

### Invalid Surface Types in VotingScreen
- **S26 Task:** `s26-mp-lobby-p3-voting-ui` created VotingScreen with these surface options: `sphere, torus, cube, pill, capsule, knot, cylinder, cube-tunnel`
- **Root cause:** `SurfaceFactory.getAvailableTypes()` returns: `['sphere', 'cube', 'pill', 'pipe', 'torus', 'peanut', 'capsule', 'icosahedron', 'mobius', 'sphere-tunnel', 'cube-ring', 'cube-tunnel', 'mobius-bevel']` — this does NOT include `cylinder` or `knot`.
- **Effect:** If user votes for `cylinder` or `knot`, server sets `state.surfaceType = 'cylinder'`, client calls `isValidSurfaceType('cylinder')` which returns `false`, client silently falls back to URL surface type instead of the voted surface. The game appears to start on the wrong map, confusing all players.
- **Server crash on cylinder/KotH:** The server does NOT crash from `cylinder` surface selection — it stores the string and uses UV math that works for any surface name. The "server crash" reported by the user may be a different issue: the `king` and `rainbow` game modes exist in VotingScreen but have NO implementation on the server (server just stores `gameMode = 'king'` and continues running `waves` logic). A crash could occur if the client tries to apply game-mode-specific logic that expects a `king` zone or rainbow scoring system which don't exist in LAN. Needs further investigation.

### Spawn Warnings Architecturally Disabled
- **Root cause (architectural):** `enemySpawner.update()` is intentionally NOT called in LAN mode because the server is authoritative. Spawn warnings animate via `EnemySpawner.update()`. Without calling it, warnings cannot function.
- **Fix path:** Server must send a `pre_spawn` event N seconds before the enemy appears. Client shows the warning ring, then the enemy appears when the server sends it. This requires a server change.

### CameraController Absent from LAN
- **Root cause:** `CameraController` was added to `main.ts` in an earlier session but never added to `network-main.ts`. No S26 task was scoped to add it.
- **Evidence:** `CameraController` appears in `src/main.ts` line 92 (import) and line 1049 (instantiation). It does NOT appear anywhere in `src/network-main.ts`.
- **Effect:** Middle mouse orbit and camera tilt do not work in LAN. The camera simply lerps toward `sp.normal * CAMERA_DISTANCE` with no orbit capability.

---

## Root Cause Analysis

The S26 visual parity work failed to deliver the expected experience for three distinct reasons:

**1. Task scope mismatch vs user expectations.** The S26 tasks were designed to add visual polish systems (glow trails, buff auras, LOD, mobile input). The user expected ALL single-player features to work in LAN, including fundamental gameplay systems like spawn warnings and camera tilt. Spawn warnings were explicitly excluded from scope because they require architectural server changes. Camera tilt was never identified as a gap and was not in any S26 task.

**2. Verification level too low.** Every S26 visual parity worker reported "Level 1 — TypeScript compiles" and "user testing required." None reached Level 5 (Puppeteer screenshot). The S26 session report claimed "0 regressions" but this only reflects test suite pass rates — not LAN gameplay functionality. The orchestrator's report was inaccurate: "0 regressions" means no existing tests broke, NOT that new features work.

**3. Critical non-visual bugs were missed.** The `mapSize` system was fixed in `MeshSurface.ts` and `main.ts` by `s26-mp-map-size-entity-mismatch`, but the equivalent fix was never applied to `network-main.ts`. The VotingScreen was built with surface types (`cylinder`, `knot`) not supported by `SurfaceFactory`, and game modes (`king`, `rainbow`) with no server-side implementation. These bugs directly cause the "weird maps" and crash behavior the user reported.

---

## Fix Recommendations (Ordered by Severity)

### Priority 1 — Fix mapSize in LAN (fixes "weird maps")
Add to `network-main.ts` `initSurface()`:
- Import `MapSize, getDefaultMapSizeForSurface, getMapSizeScaleFactor` from `./core/MapSize`
- Read `state.mapSize` in `onStateChange()` and pass it to `initSurface()`
- In `initSurface()`, apply `surface.group.scale.setScalar(mapSizeScaleFactor)` after surface creation
- Pass `mapSizeScaleFactor` to `makeSurfaceTransformFn()` (same fix as `main.ts` line 551)
- CRITICAL: call `surface.mesh.updateMatrixWorld(true)` before creating `MeshSurface`

### Priority 2 — Fix VotingScreen surface types (fixes invalid choices)
Remove `cylinder` and `knot` from VotingScreen `SURFACES` array OR add `cylinder` and `knot` to `SurfaceFactory.getAvailableTypes()` if they are valid surfaces. Based on codebase inspection, `cylinder` is not a standalone surface type — remove it from VotingScreen.

### Priority 3 — Fix VotingScreen game modes (fixes king/rainbow crash/confusion)
Remove `king` and `rainbow` modes from VotingScreen `MODES` array, OR implement them on the server. The server currently stores `gameMode` but applies no mode-specific logic. At minimum, show only `waves` until other modes are implemented.

### Priority 4 — Add CameraController to LAN (fixes camera tilt)
In `network-main.ts`:
- Import `CameraController` from `./core/CameraController`
- Instantiate `const cameraController = new CameraController(camera)` after game creation
- Replace the manual camera lerp block in `onRender` (lines 2461-2476) with `cameraController.update(...)`, BUT this requires a `MeshWalker` — which LAN doesn't use. Alternative: extend `CameraController` to accept position/normal/tangentFrame directly instead of requiring a `MeshWalker`.
- The simpler path: expose `cameraController.update(position, normal, tangentFrame, dt)` that accepts surface frame data directly.

### Priority 5 — Spawn warnings via server pre-spawn events
Design: Server sends a `pre_spawn` message 1.5 seconds before each enemy spawn. Client calls `enemySpawner.spawnWarning(u, v)` to create the ring. After 1.5 seconds, server sends the enemy in state and client calls `getOrCreateEnemy()`. This requires server changes to `GameRoom.ts`.

### Priority 6 — Wire playerLevel.addKill()
In `onStateChange()`, when an enemy is removed from `networkEnemies` (dies), call `playerLevel.addKill()` if the local player is identified as having killed it (nearest player heuristic). This makes the aura ring grow with kills.

---

## What S26 Actually Fixed (Working Correctly)

These S26 changes ARE working and represent genuine improvements:
- Visual style applied in LAN (saved grid/surface colors, bloom settings)
- Mobile touch input wired
- LOD and adaptive quality wired
- Entity glow and enemy glow trails for fast enemies wired
- Buff visual infrastructure (inert but ready for server integration)
- Bullet visual types for local player (Spread/Homing/Piercing)
- Debug overlay (F3) working
- Player level aura ring visible (at level 1, non-progressive)
- Shockwave effect and screen shake (both pre-existing and working)
- Voting system and post-game lobby (works, but with invalid surface/mode options)
- GameOverScreen auto-transition to VotingScreen

The user's perception that "nothing worked" is an overstatement — the existing LAN visual quality improved. But the user's core complaints (no spawn warnings, no camera tilt, weird maps) are real and unaddressed.

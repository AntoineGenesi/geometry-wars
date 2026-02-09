# LAN Same-PC Lag-Out Fix - 2026-02-10

## Context

User tested LAN on same PC (two browser tabs). It "almost worked" -- at the very start it seemed like it was going to work, but it lagged out shortly after the 2nd player joined. This is the 7th round of LAN fixes.

Previous rounds focused on: map sync, movement inversion, lag/tick rates, visual parity, code reuse, client-side prediction, isHost race condition. This round focuses specifically on the lag-out-on-join performance issue.

## Root Causes Found

### 1. Triple-fire onStateChange (PRIMARY CAUSE)

When player 2 joins, THREE separate mechanisms in NetworkClient.ts all triggered `onStateChange` simultaneously:

1. `room.onStateChange()` (Colyseus patch callback, line 168)
2. `room.state.players.onAdd()` (line 174) -- also called `convertState()` + `onStateChange()`
3. `room.state.listen('gameStarted')` (line 217) -- also called `convertState()` + `onStateChange()`

Each `onStateChange` call does:
- `Array.from()` x4 (copies all bullets/enemies/geoms/pickups)
- Iterates ALL players: creates/updates Player meshes, computes surface transforms, orients on surface
- Iterates ALL enemies: creates/updates via EnemySpawner, computes surface transforms, runs mesh.traverse() for visibility
- Iterates ALL bullets: surface.getPoint() for each, lerp positions
- Iterates ALL geoms: updates UV coordinates
- Iterates ALL weapon pickups: creates/updates WeaponPickup instances
- Updates ALL UI elements

When player 2 joins, all of this runs 3x in a single frame. The lag spike is the synchronous processing of 3 full state syncs.

### 2. EnemySpawner.update() running redundant enemy AI

`network-main.ts` called `enemySpawner.update()` every frame. This runs:
- `enemy.update(dt)` for EACH enemy (AI movement toward player)
- `enemy.applySurfaceTransform()` for EACH enemy
- `applySeparation()` across ALL enemy pairs (O(n^2))
- Spawn warning mesh updates

ALL of this computation is overwritten by the next `onStateChange` which sets enemy positions from the server. The AI computation is pure waste. On same-PC with 2 tabs: server + tab1 AI + tab2 AI = 3x the CPU work for enemies.

### 3. mesh.traverse() in onStateChange callback

Every enemy had `enemy.mesh.traverse()` called in the `onStateChange` handler (30Hz) for depth-based opacity. `traverse()` walks the entire scene graph subtree. This should be in the render loop (once per frame).

### 4. O(n*poolSize) bullet tracking

New bullets triggered `bulletPool.forEachActive()` (scans 200 pool slots) to find the newly allocated index. With N new bullets per state change, this was O(N * 200).

### 5. Array.from() GC pressure

`convertState()` created 4 new arrays via `Array.from()` per call. At 30Hz = 120 allocations/sec. With triple-fire = 360/sec.

## Changes Made

### File: src/network/NetworkClient.ts

1. **Debounced onStateChange via requestAnimationFrame**: Added `scheduleStateChange()` method that coalesces multiple triggers (onStateChange + onAdd + listen) into a single call per frame. Uses `requestAnimationFrame` so only one `convertState()` + callback fires per frame, regardless of how many Colyseus events triggered in the same tick.

2. **Removed redundant onStateChange calls from onAdd/listen handlers**: `players.onAdd`, `listen('gameStarted')`, and `listen('gameOver')` now call `scheduleStateChange()` instead of immediately calling `convertState()` + `onStateChange()`.

3. **Eliminated Array.from() copies**: `convertState()` now passes Colyseus ArraySchema objects directly instead of copying them. The `onStateChange` handler only reads via `.forEach()` which works on both.

### File: src/network-main.ts

1. **Removed enemySpawner.update() call**: Stopped calling the EnemySpawner's update method which ran full enemy AI (movement, separation, spawn warnings) that was immediately overwritten by server state. Added comment explaining why.

2. **Moved depth-based opacity to render loop**: `mesh.traverse()` for enemy visibility now runs in `game.onRender` instead of `onStateChange`. Runs once per frame instead of on every 30Hz state patch.

3. **Optimized bullet pool index tracking**: Replaced `forEachActive()` scan (O(poolSize) per new bullet) with direct `findInactive` scan before spawn. New bullets find their pool index in O(1) amortized time.

## What's Different From Previous Fix Attempts

Previous fixes addressed:
- Map sync (surface type from URL vs server) -- already working
- Movement inversion (moveY negation) -- already working
- Lag/tick rates (50ms -> 33ms patch rate) -- already working
- Visual parity (real game classes) -- already working
- Client-side prediction -- already working
- isHost race condition -- already working

This fix addresses **performance**, specifically the burst of redundant work when player 2 joins. No previous fix touched these code paths:
- The `onAdd`/`listen` handlers redundantly calling `convertState()` + `onStateChange()`
- The `enemySpawner.update()` running wasted AI computation
- The `mesh.traverse()` in state change callback
- The `Array.from()` allocation overhead

The key insight: the lag-out happens not because of a single bug, but because of accumulated CPU waste. On same-PC with two tabs, the browser is running: Colyseus server + Tab 1 (enemy AI + 3x state sync + mesh traversals) + Tab 2 (enemy AI + 3x state sync + mesh traversals). This fix eliminates the redundant work.

## Verification

- **Level 1**: TypeScript compiles clean (`npx tsc --noEmit`: 0 errors)
- **Level 3**: Server starts and responds to health/API endpoints
- **Level 4**: NOT verified (cannot open browser tabs from this environment)

## Decisions

1. **Removed enemySpawner.update() entirely** rather than throttling it. The previous code comment said "harmless since server positions override everything in onStateChange" but this was wrong -- it's not harmless, it's significant wasted CPU, especially with 50 enemies and O(n^2) separation. If enemies visually "snap" between server updates, consider adding simple lerp interpolation in the render loop instead of running full AI.

2. **Used requestAnimationFrame for debounce** rather than setTimeout(0) or microtask. RAF aligns with the render loop, so the state update happens right before the next render. This is more efficient than firing between frames.

3. **Passed ArraySchema directly** instead of copying. This is safe because the handler only reads via forEach. If future code modifies the arrays, this would need to be reverted.

## Reversibility

Easy -- changes are in 2 files. All changes are defensive (reducing work, not changing logic). The core game loop, state sync protocol, and visual pipeline are unchanged.

---

## USER TEST PLAN

### Prerequisites
- Dev server running: `npm run dev`
- No need to manually start the Colyseus server (the LAN hosting Vite plugin handles it)

### Steps

1. Open browser to `http://localhost:3000`
2. Click "LAN" in the start menu
3. Click "HOST GAME" -- wait for "Hosting at..." message
4. Click "ENTER GAME" -- this opens the network mode as Player 1
5. Open a SECOND browser tab to `http://localhost:3000`
6. In the second tab, click "LAN" then "SCAN LAN" (or manually enter `ws://localhost:2567`)
7. Join the game in the second tab
8. In Player 1's tab (the host), click "START GAME"

### What to Watch For

- **IMMEDIATELY after Player 2 joins** (step 7): Does the game freeze/lag for a moment? This is the bug we're fixing. It should now be smooth.
- **During gameplay with 2 players**: Is the game responsive in both tabs? Does it stay smooth as enemies spawn?
- **After 1-2 minutes**: Does performance degrade over time, or stay stable?

### What to Report

If it lags out again:
1. When exactly does the lag happen? (On join? After N seconds? When enemies spawn?)
2. Does the browser console show any errors? (F12 -> Console)
3. Does one tab lag more than the other?
4. What does Task Manager show for CPU usage?

If it works:
1. How does it feel compared to the previous test?
2. Is movement responsive in both tabs?
3. Can both players shoot and kill enemies?
4. Do enemies appear and die with effects?

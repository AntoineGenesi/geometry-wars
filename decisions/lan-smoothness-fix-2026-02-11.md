## 2026-02-11 - LAN Smoothness Fix: 60Hz Interpolation + Server-Side Input Decoupling

**Context:** LAN multiplayer feels laggy and stuttery compared to local co-op, despite using the same visual components. User described it as "laggy and weird and not smooth like coop."

**Root Cause Analysis (comparing multiplayer-main.ts vs network-main.ts):**

The fundamental difference between co-op and LAN is the update frequency:
- Co-op: ALL entities update every frame (60fps) via local game logic
- LAN: Entities only moved when server state patches arrived (30Hz via Colyseus setPatchRate(33))

Between those 30Hz patches, enemies and remote players were FROZEN for 33ms. The human eye perceives ~16ms frame-to-frame stutter as smooth (60fps), but 33ms gaps create visible jitter.

**Three specific root causes fixed:**

### 1. Interpolation at Wrong Frequency
- **Before:** `onStateChange()` (30Hz) did `enemy.surfacePosition.u += (target - current) * 0.35`
- **Problem:** This lerp ran ONCE per server patch. Between patches, enemies were static.
- **After:** `onStateChange()` stores target UV; `onRender()` (60Hz) lerps toward target each frame
- **Lerp factors:** Enemy=0.15, RemotePlayer=0.2 (per-frame at 60fps = smooth convergence)

### 2. Server Movement Speed Tied to Client Input Rate
- **Before:** `handleInput()` applied `moveX * PLAYER_SPEED * (1/TICK_RATE)` per message
- **Problem:** Movement distance = (messages/sec) * (distance/message). At 30Hz input, player moved at half the speed of 60Hz input. User perceived this as "sluggish."
- **After:** `handleInput()` stores latest input in `playerInputs` map; new `applyPlayerMovement(dt)` runs in `tick()` at consistent 60Hz. Movement speed is now independent of client send rate.
- **Client input rate:** Increased from 33ms (30Hz) to 16ms (60Hz) to match server tick rate.

### 3. Camera Used worldToSurface Round-Trip
- **Before:** `surface.worldToSurface(mesh.position)` -> `surface.getPoint(u,v)` every frame
- **Problem:** Floating-point round-trip added micro-jitter to camera position
- **After:** Use `surface.getPoint(player.surfaceU, player.surfaceV)` directly from stored UV

**Why this fix is different from previous 10+ attempts:**
- Previous fixes addressed individual bugs (map sync, movement inversion, pole singularities)
- This fix addresses the ARCHITECTURAL reason LAN feels laggy: interpolation frequency
- The same approach is used by virtually all networked games (client-side interpolation at render rate)

**Trade-offs:**
1. Enemies and remote players are always slightly behind their true server position (1-2 frames of interpolation lag). This is imperceptible and vastly better than 33ms freezes.
2. Client sends input at 60Hz instead of 30Hz, doubling bandwidth per player (~120 bytes/s -> ~240 bytes/s). Negligible for LAN.
3. Server stores input per player (Map overhead of ~4 entries). Negligible.

**Verification Level:** 2 (TypeScript compiles + 1662/1662 unit tests pass + 13/13 LAN E2E tests pass). Level 4 (user confirms smoothness) requires user testing.

**Reversibility:** Easy - revert the two files (network-main.ts, GameRoom.ts). The changes are isolated to interpolation logic and input handling.

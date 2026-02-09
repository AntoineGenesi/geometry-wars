## 2026-02-09 - LAN Multiplayer Fix: Three Critical Bugs

### Context
LAN multiplayer was reported as "completely broken" by the user despite previous agents claiming it was fixed. Three specific bugs were reported:
1. **Wrong map**: Host selects cube, client loads sphere
2. **Movement inverted**: Press W, character goes down
3. **Very laggy**: Unresponsive feel

Previous agents modified StartMenu.ts, GameRoom.ts, network-main.ts, and NetworkClient.ts but the bugs persisted. This investigation was a fresh trace of the full data flow.

---

### Bug 1: Wrong Map (Surface Type Not Syncing)

**Root Cause**: The client created its local surface from the URL `?surface=` parameter BEFORE connecting to the server. The server's authoritative `surfaceType` (stored in GameState schema and synced via Colyseus) was never used for surface creation.

**Trace**:
1. Host selects "cube" in StartMenu -> URL becomes `?mode=network&surface=cube`
2. `network-main.ts` loads, calls `getSurfaceType()` which reads URL param -> `'cube'` (correct for host)
3. Client joins via manual connect or lobby -> URL gets `surface=` from `this.lanSelectedSurface` (defaults to `'sphere'` unless user explicitly selects)
4. `network-main.ts` loads, calls `getSurfaceType()` -> reads URL param -> `'sphere'` (WRONG!)
5. Surface created immediately at line 72: `SurfaceFactory.create(surfaceType)` -> sphere, not cube

**Why previous fixes didn't work**: Previous agents may have added surface type to server metadata and lobby browser entries, but the fundamental issue was that `network-main.ts` created the surface eagerly from the URL parameter, never consulting the server state.

**Fix**: Deferred surface creation. The surface is now created AFTER connecting to the server, reading `state.surfaceType` from the Colyseus room state. Two paths ensure this:
1. After `network.connect()` resolves: read `network.getServerSurfaceType()` and call `initSurface()`
2. On first `onStateChange` callback: also calls `initSurface()` as a safety net

Added `getServerSurfaceType()` method to `NetworkClient.ts` that reads from the room state.

**Files changed**:
- `src/network-main.ts`: Removed eager surface creation, added deferred `initSurface()` function, surface/meshSurface are now `let` (nullable) with guards
- `src/network/NetworkClient.ts`: Added `getServerSurfaceType()` method

---

### Bug 2: Movement Inverted (Press W, Go Down)

**Root Cause**: The `moveY` value from InputManager was sent to the server without sign correction, but the server's UV coordinate system and the camera's up vector created an inversion.

**Trace**:
1. Press W -> InputManager returns `moveY = -1` (screen convention: up = negative)
2. Sent to server as `moveY: -1`
3. Server: `dy = -1 * PLAYER_SPEED * (1/TICK_RATE)` -> negative
4. Server: `surfaceV += dy` -> surfaceV decreases
5. On the client, `camera.up = sp.tangentV` (line 604 in old code, 677 in new)
6. `tangentV` = d(position)/dV, the direction of INCREASING V
7. So "up on screen" = increasing V direction
8. But W causes V to DECREASE -> player moves DOWN on screen

**Why previous fixes didn't work**: Previous agents attempted to fix aim angle inversion (negating aimAngle in GameRoom.ts) but the movement inversion is a separate issue. The aimAngle negation for `atan2(-mouseY, mouseX)` was actually correct (converts screen Y-down to math Y-up for angle calculation). The movement direction was never addressed.

**Fix**: Negate `moveY` before sending to server: `moveY: -inputState.moveY`. Now:
- W -> InputManager `moveY = -1` -> sent as `moveY = +1` -> server increases V -> player moves UP on screen

**File changed**: `src/network-main.ts` line 618: `moveY: -inputState.moveY`

---

### Bug 3: Lag

**Root Cause**: Multiple factors:
1. Server patch rate was 50ms (20Hz) -- state updates sent to clients only 20 times per second
2. Client input send rate was 50ms (20Hz) -- inputs sent to server only 20 times per second
3. No client-side prediction (player position is purely server-authoritative)
4. Combined round-trip: up to 50ms input delay + 50ms patch delay = 100ms perceived latency

**Partial Fix** (what we can do without architectural changes):
1. **Server patch rate**: Reduced from 50ms to 33ms (~30Hz). This reduces the time between state broadcasts.
2. **Client input rate**: Increased from 50ms/20Hz to 33ms/30Hz. Inputs reach server faster.

**What would fully fix lag but requires major work**:
- Client-side prediction: Apply input locally immediately, reconcile with server state
- Interpolation/extrapolation: Smooth between server state updates
- These are significant architectural additions beyond the scope of this bug fix

**Files changed**:
- `server/rooms/GameRoom.ts`: `setPatchRate(33)` (was 50)
- `src/network-main.ts`: `INPUT_SEND_INTERVAL = 0.033` (was 0.05)

---

### Summary of All Changes

| File | Change | Bug Fixed |
|------|--------|-----------|
| `src/network-main.ts` | Deferred surface creation using server state | Map sync |
| `src/network-main.ts` | Negate moveY before sending to server | Movement inversion |
| `src/network-main.ts` | Increase input rate to 30Hz | Lag reduction |
| `src/network-main.ts` | Null guards for deferred surface | TypeScript safety |
| `src/network/NetworkClient.ts` | Added `getServerSurfaceType()` method | Map sync |
| `server/rooms/GameRoom.ts` | Reduced patch rate from 50ms to 33ms | Lag reduction |

### Build Verification
- `npx tsc --noEmit`: PASS (zero errors)
- `npx vitest run`: 1250 tests pass, 16 pre-existing failures in companion.test.ts (document not defined in test env)

### What Could NOT Be Verified
- **End-to-end testing with 2 clients**: Cannot run a browser + Colyseus server in this environment. The fixes are based on rigorous code analysis, not runtime testing.
- **Movement feel on non-sphere surfaces**: The moveY negation is correct for sphere (where tangentV points "south"). For other surfaces (cube, torus, etc.), the tangentV direction may vary. This needs manual testing on each surface type.
- **Lag improvement perception**: The 30Hz patch rate should feel noticeably better than 20Hz, but the lack of client-side prediction means there will always be ~33-66ms of latency. Full fix requires an architectural change (client prediction).

### Reversibility
- **Easy**: All changes are in 3 files. Reverting the changes is straightforward via git.
- **Map sync**: If the deferred surface creation causes timing issues (e.g., surface needed before server connection completes), revert to eager creation from URL parameter as a fallback.
- **Movement negation**: If movement feels wrong on a specific surface, the negation can be made surface-type-dependent.

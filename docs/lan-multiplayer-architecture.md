# LAN Multiplayer Architecture

Comprehensive documentation of the network multiplayer system in Geometry Wars 3D Dimensions, covering Colyseus server architecture, state synchronization, the ES2022 schema bug and its fix, LAN hosting via Vite plugin, and connection flow internals.

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Technology Choices](#2-technology-choices)
3. [State Synchronization Model](#3-state-synchronization-model)
4. [The ES2022 Bug: A Debugging Narrative](#4-the-es2022-bug-a-debugging-narrative)
5. [Connection Flow](#5-connection-flow)
6. [Client Architecture](#6-client-architecture)
7. [LAN Hosting System](#7-lan-hosting-system)
8. [Host vs Joiner: Two Distinct Bug Fixes](#8-host-vs-joiner-two-distinct-bug-fixes)
9. [Known Issues and Future Work](#9-known-issues-and-future-work)
10. [Lessons Learned](#10-lessons-learned)

---

## 1. Architecture Overview

The network multiplayer system uses a **server-authoritative** model where a Colyseus game server owns all game state and clients render what the server tells them. There is no client-side prediction or rollback -- the server is the single source of truth.

```
+-------------------+       +-------------------+       +-------------------+
|   Client A        |       |   Colyseus Server  |       |   Client B        |
|   (Browser)       |       |   (Node.js)        |       |   (Browser)       |
|                   |       |                    |       |                   |
|  NetworkClient    |<----->|  GameRoom          |<----->|  NetworkClient    |
|  network-main.ts  | WS    |  GameState schema  | WS    |  network-main.ts  |
|  Three.js render  |       |  60 Hz tick        |       |  Three.js render  |
+-------------------+       +-------------------+       +-------------------+
        |                           |                           |
        v                           v                           v
   Input -> server            Simulation loop            Input -> server
   State <- render            State patches out          State <- render
```

### End-to-End Data Flow

1. **Input**: Each client captures keyboard/mouse input via `InputManager`, converts it to a `NetworkInput` message (`moveX`, `moveY`, `aimAngle`, `shooting`, `bomb`), and sends it to the server every frame via WebSocket.

2. **Simulation**: The server runs a 60 Hz game loop (`setSimulationInterval`) that processes inputs, moves entities, runs collision detection, spawns enemies, and mutates the `GameState` schema.

3. **State Sync**: Colyseus automatically detects mutations to `GameState` properties (via getter/setter change tracking) and broadcasts binary delta patches to all clients every 50ms (`setPatchRate(50)`).

4. **Rendering**: Each client's `onStateChange` callback receives the decoded state and maps it onto Three.js objects -- positioning player meshes, enemy meshes, bullets, geoms, and weapon pickups on the shared surface.

### Key Files

| File | Role |
|------|------|
| `server/index.ts` | Express + Colyseus server setup, `/health` and `/api/info` endpoints |
| `server/rooms/GameRoom.ts` | Game room: 60 Hz tick, input handling, enemy AI, collision, spawning |
| `server/schema/GameState.ts` | Schema definitions for all synced state (6 classes) |
| `server/package.json` | `{"type": "commonjs"}` -- CJS override for ESM interop |
| `src/network/NetworkClient.ts` | Client-side Colyseus wrapper with typed callbacks |
| `src/network/LANClient.ts` | Client-side fetch wrapper for Vite LAN plugin endpoints |
| `src/network-main.ts` | Network game mode: connects, renders server state, sends input |
| `vite-plugin-lan.ts` | Vite plugin: spawns/stops Colyseus as child process, LAN scan |
| `vite.config.ts` | Registers `lanPlugin()` |

---

## 2. Technology Choices

### Why Colyseus 0.15.x

Colyseus was chosen for several reasons:

- **Rooms abstraction**: Built-in concept of game rooms with lifecycle hooks (`onCreate`, `onJoin`, `onLeave`, `onDispose`). Maps directly to "one game session = one room."
- **Automatic binary state sync**: Schema v2 handles serialization, delta compression, and patch broadcasting without manual message framing.
- **WebSocket transport**: Works in browsers without plugins. Uses `@colyseus/ws-transport` over `ws` (the de facto Node.js WebSocket library).
- **Matchmaking**: Built-in `joinOrCreate` semantics -- first client creates the room, subsequent clients join it.
- **Small footprint**: Server is ~100 lines of game logic in `GameRoom.ts`, ~230 lines of schema in `GameState.ts`. The framework handles the networking boilerplate.

The specific version `0.15.57` (server) / `0.15.28` (client) was used because it was the latest stable release at the time of implementation. Schema v2 (`@colyseus/schema@^2.0.37`) is required for compatibility with Colyseus 0.15.

### Why Schema v2 with `defineTypes` (Not Decorators)

Colyseus Schema v2 offers two APIs for declaring synced properties:

```typescript
// Option A: Decorators (requires experimentalDecorators + emitDecoratorMetadata)
class PlayerState extends Schema {
  @type("string") id: string = "";
}

// Option B: defineTypes() (works without any TS config changes)
class PlayerState extends Schema {
  declare id: string;
  constructor() { super(); this.id = ""; }
}
defineTypes(PlayerState, { id: "string" });
```

**Option B was chosen** because:

1. **No tsconfig pollution**: The project targets ES2022. Adding `experimentalDecorators` and `emitDecoratorMetadata` would conflict with the modern decorator proposal and affect the entire project.
2. **Runtime compatibility**: `defineTypes()` is a plain function call that runs after the class definition. It installs the same getter/setter descriptors as the decorator approach but without requiring any compiler transforms.
3. **Transparency**: The schema definition is explicitly visible in one place, separate from the class body. This makes it easier to audit what is synced.

### Why `declare` Keyword (The Critical Detail)

This is documented fully in [Section 4](#4-the-es2022-bug-a-debugging-narrative), but in short: ES2022 class fields use `Object.defineProperty` semantics which destroy Schema's change-tracking setters. The `declare` keyword emits zero JavaScript, preserving the setters. This was the fix for the state encoding bug.

---

## 3. State Synchronization Model

### What Is Synced

The `GameState` schema contains five entity collections and four scalar fields:

```
GameState
  |-- players: MapSchema<PlayerState>     (keyed by sessionId)
  |-- bullets: ArraySchema<BulletState>   (ordered list)
  |-- enemies: ArraySchema<EnemyState>    (ordered list)
  |-- geoms: ArraySchema<GeomState>       (ordered list)
  |-- weaponPickups: ArraySchema<WeaponPickupState>
  |-- surfaceType: string                 ("sphere", "torus", etc.)
  |-- waveNumber: number
  |-- gameTime: number
  |-- gameStarted: boolean
  |-- gameOver: boolean
```

#### PlayerState (14 fields)

```
id, name, surfaceU, surfaceV, aimAngle, lives, bombs,
score, multiplier, alive, shooting, color, weaponType, weaponAmmo
```

Players are stored in a `MapSchema` keyed by Colyseus `sessionId`. This allows efficient add/remove notifications (`onAdd`/`onRemove` callbacks) when players join or leave.

#### BulletState (9 fields)

```
id, ownerId, x, y, z, dirX, dirY, dirZ, age
```

Bullets use world-space position (x, y, z) and direction (dirX, dirY, dirZ) rather than UV coordinates because the server manages bullet physics in UV space but the client needs to project them onto the surface for rendering.

#### EnemyState (6 fields), GeomState (4 fields), WeaponPickupState (6 fields)

Minimal data: position (surfaceU, surfaceV), type/state flags, and identifiers.

### How Patches Work

```
Server tick (60 Hz)
    |
    v
Mutate schema properties (e.g., enemy.surfaceU += speed * dt)
    |
    v
Schema setter records change in $changes.allChanges
    |
    v
Patch rate timer (every 50ms)
    |
    v
Colyseus encodes all changes since last patch into binary delta
    |
    v
Binary patch sent to each client via WebSocket
    |
    v
Client's Schema decoder applies patch to local state object
    |
    v
room.onStateChange() fires with updated state
```

### Patch Frequency

- **Simulation rate**: 60 Hz (`setSimulationInterval(tick, 1000/60)`)
- **Patch rate**: 20 Hz (`setPatchRate(50)` = every 50ms)
- **Input rate**: Every frame (~60 Hz from `requestAnimationFrame`)

The simulation runs faster than patches are sent. This means 3 simulation ticks accumulate changes before each patch is broadcast. Colyseus coalesces changes automatically -- if `enemy.surfaceU` changes 3 times between patches, only the final value is sent.

### Bandwidth Characteristics

Each patch contains only the delta (changed fields since last patch). For a typical game with 1 player and 20 enemies:

- **Steady state**: ~200-500 bytes per patch (enemy positions updating)
- **Spike**: ~2-5 KB when many entities spawn/die simultaneously
- **At 20 patches/sec**: ~4-10 KB/s sustained bandwidth per client

---

## 4. The ES2022 Bug: A Debugging Narrative

This section documents the most significant bug encountered during multiplayer implementation. It took 7 diagnostic scripts to diagnose and produced zero error messages -- the system silently produced empty state.

### The Symptom

After implementing the full Colyseus server and client:

- Client connects successfully (WebSocket handshake completes)
- Server logs confirm `players.size=1` after join
- Client receives `ROOM_STATE` message
- **All state values on the client are `undefined`**
- The game renders a surface with no players, no enemies, nothing

### The Diagnostic Trail

**Step 1: Verify server state is populated**

Server-side logging confirmed that after `onJoin`, the `GameState` had a player in `this.state.players` with correct values. The data existed on the server.

**Step 2: Inspect the ROOM_STATE message**

The Colyseus protocol sends the full initial state as a `ROOM_STATE` message after the client joins. Logging revealed this message contained only 1 byte -- just the protocol opcode, with zero bytes of actual state data.

**Step 3: Test encodeAll() manually**

```typescript
// In GameRoom.onCreate(), after setting up state:
const encoded = this.state.encodeAll();
console.log('encodeAll length:', encoded.length);
// Output: encodeAll length: 0
```

The server's own `encodeAll()` returned an empty array, even though the state had values. This meant the encoding layer was broken, not the transport.

**Step 4: Inspect change tracking**

```typescript
console.log('$changes.allChanges.size:', this.state.$changes.allChanges.size);
// Output: 0
```

Despite setting `this.state.surfaceType = 'sphere'` and `this.state.players.set(...)`, the change tracker had zero recorded changes. Properties were being set but the change tracker was not being notified.

**Step 5: Check the setter descriptors**

```typescript
const desc = Object.getOwnPropertyDescriptor(this.state, 'surfaceType');
console.log('descriptor:', desc);
// Output: { value: 'sphere', writable: true, enumerable: true, configurable: true }
```

This was the breakthrough. The property descriptor was a **plain value property**, not a getter/setter pair. Schema relies on installing getter/setter descriptors that call `this.$changes.change(field)` on every set. Those setters were gone.

**Step 6: Identify the overwrite**

The `Schema` constructor calls `Object.defineProperties(this, ...)` to install getter/setter pairs for every registered field. But when TypeScript compiles a class field like:

```typescript
class GameState extends Schema {
  surfaceType: string = 'sphere';
}
```

With ES2022 target, this compiles to:

```javascript
class GameState extends Schema {
  constructor() {
    super(); // Schema installs getter/setter here
    Object.defineProperty(this, 'surfaceType', {
      value: 'sphere',
      writable: true,
      enumerable: true,
      configurable: true
    });
    // ^ This OVERWRITES the getter/setter with a plain value!
  }
}
```

The ES2022 specification mandates `[[Define]]` semantics for class fields, meaning they use `Object.defineProperty` instead of simple assignment. This is incompatible with any library that relies on prototype or instance getter/setter interception.

**Step 7: Verify the fix**

The `declare` keyword in TypeScript emits **no JavaScript whatsoever**. It is purely a type-level construct:

```typescript
class GameState extends Schema {
  declare surfaceType: string; // Emits NOTHING in JS
  constructor() {
    super();                    // Schema installs getter/setter
    this.surfaceType = 'sphere'; // Goes THROUGH the setter -> change tracked!
  }
}
```

After applying `declare` to all 6 schema classes (PlayerState, BulletState, EnemyState, GeomState, WeaponPickupState, GameState), the state encoded correctly and clients received full state.

### Root Cause Diagram

```
TypeScript Source                    Compiled JavaScript (ES2022)
--------------------                 ----------------------------

class Foo extends Schema {           class Foo extends Schema {
  bar: string = 'x';       --->       constructor() {
}                                        super();
                                         // Schema installs: get bar() / set bar(v) { track(v) }
                                         Object.defineProperty(this, 'bar', {value:'x'});
                                         // ^ OVERWRITES the setter. Change tracking destroyed.
                                       }
                                     }

class Foo extends Schema {           class Foo extends Schema {
  declare bar: string;      --->       constructor() {
  constructor() {                        super();
    super();                             // Schema installs: get bar() / set bar(v) { track(v) }
    this.bar = 'x';                      this.bar = 'x';
  }                                      // ^ Goes through setter. Change tracking works!
}                                      }
                                     }
```

### Why `!:` (Definite Assignment) Also Fails

One might expect `bar!: string;` (no initializer, just assertion) to work. But esbuild (used by both Vite and tsx) still emits `Object.defineProperty` for it under ES2022 semantics, because the spec says all class field declarations use `[[Define]]` regardless of whether they have an initializer.

### The Fix (Applied in `server/schema/GameState.ts`)

All 6 schema classes use this pattern:

```typescript
export class PlayerState extends Schema {
  declare id: string;
  declare name: string;
  declare surfaceU: number;
  // ... all fields use declare ...

  constructor() {
    super(); // Schema installs getters/setters
    this.id = '';
    this.name = '';
    this.surfaceU = 0.5;
    // ... defaults set through tracked setters ...
  }
}

defineTypes(PlayerState, {
  id: 'string',
  name: 'string',
  surfaceU: 'number',
  // ...
});
```

**Decision log**: `decisions/colyseus-schema-es2022-fix.md`

---

## 5. Connection Flow

Step-by-step breakdown of what happens when a client calls `network.connect()`:

```
Client                                Server
------                                ------
1. new Client('ws://host:2567')
   |
2. client.joinOrCreate('game', opts)
   |
   |--- HTTP POST /matchmake/joinOrCreate/game -->
   |                                              |
   |                                    3. Server finds/creates GameRoom
   |                                       GameRoom.onCreate() runs if new
   |                                              |
   |<-- { room: {...}, sessionId, ...} -----------|
   |    (matchmake reservation)
   |
4. WebSocket connect to room
   |--- WS upgrade to /game/{roomId} ------------>
   |                                              |
5. Schema handshake (Reflection)                  |
   |<-- ROOM_STATE_REFLECTION message ------------|
   |    (schema structure: field names, types,    |
   |     indices for binary encoding)             |
   |                                              |
   |--- JOIN_ROOM acknowledgment ---------------->|
   |                                              |
   |                                    6. GameRoom.onJoin(client, opts)
   |                                       Creates PlayerState
   |                                       Adds to state.players
   |                                              |
7. Initial state                                  |
   |<-- ROOM_STATE message -----------------------|
   |    (full binary-encoded state snapshot)       |
   |                                              |
8. Client decodes state                           |
   room.state is now populated                    |
   |                                              |
9. State polling (workaround)                     |
   NetworkClient polls room.state every 100ms     |
   until players.size > 0, then fires             |
   onStateChange callback manually                |
   |                                              |
10. Ongoing patches                               |
   |<-- STATE_PATCH messages (every 50ms) --------|
   |    (binary deltas of changed fields)         |
   |                                              |
   |--- 'input' messages (every frame) ---------->|
   |    {moveX, moveY, aimAngle, shooting, bomb}  |
```

### Why the Polling Workaround (Step 9)

The initial `onStateChange` event fires during `joinOrCreate()`, before the client's callback handler has been registered via `setupListeners()`. Since the game has not started yet, the server tick does nothing and no further state changes occur. Without polling, the client would never see the initial state.

The poll checks `room.state.players.size > 0` every 100ms for up to 2 seconds (20 attempts). Once the state is populated, it fires `onStateChange` manually and clears the interval.

---

## 6. Client Architecture

### NetworkClient (`src/network/NetworkClient.ts`)

The `NetworkClient` class wraps the Colyseus `Client` and `Room` objects, providing:

1. **Typed interfaces**: `NetworkPlayerState`, `NetworkBulletState`, `NetworkEnemyState`, etc. mirror the server schemas but are plain TypeScript interfaces (no Schema dependency on client).

2. **Callback system**: `NetworkCallbacks` interface with optional handlers for `onStateChange`, `onPlayerJoin`, `onPlayerLeave`, `onEnemySpawn`, `onEnemyDeath`, `onGameStart`, `onGameOver`, `onError`.

3. **State conversion**: `convertState()` extracts data from Colyseus Schema objects into plain JavaScript objects/arrays that the rendering code can consume.

4. **Input sending**: `sendInput(input)` sends a message on channel `'input'` to the server.

5. **Game control**: `startGame()` sends a `'start'` message.

### Listener Architecture

```
room.onStateChange(state)          --> fires onStateChange callback (full state)
room.state.players.onAdd(p, key)   --> fires onPlayerJoin + full state refresh
room.state.players.onRemove(p, k)  --> fires onPlayerLeave
room.state.enemies.onAdd(e)        --> fires onEnemySpawn
room.state.enemies.onRemove(e)     --> fires onEnemyDeath
room.state.bullets.onAdd(b)        --> fires onBulletSpawn
room.state.geoms.onAdd(g)          --> fires onGeomSpawn
room.state.geoms.onRemove(g)       --> fires onGeomCollect
room.state.listen('gameStarted')   --> fires onGameStart + full state refresh
room.state.listen('gameOver')      --> fires onGameOver + full state refresh
room.onLeave(code)                 --> sets connected = false
room.onError(code, msg)            --> fires onError
```

Several listeners fire an additional full state refresh (`convertState` + `onStateChange`). This is a defensive measure against race conditions where `onStateChange` might have been missed because the listener was registered late.

### network-main.ts Rendering Pipeline

The network game mode (`src/network-main.ts`) is a standalone entry point that:

1. Creates a `Game` instance with bloom enabled
2. Creates a `Surface` and `MeshSurface` for the selected shape
3. Sets up Three.js object pools (BulletPool, GeomPool, particles)
4. Connects via `NetworkClient`
5. On each `onStateChange`:
   - Maps server player states to Three.js meshes (chevron ships)
   - Maps server enemy states to colored geometry meshes
   - Clears and respawns bullets from server state
   - Clears and respawns geoms from server state
   - Manages weapon pickup meshes (octahedrons with spin animation)
   - Applies depth-based opacity for enemies on far side of surface
   - Manages ally glow sprites for remote players
   - Updates HUD (score, lives, bombs, wave, player list, weapon)
6. On each frame (`onFixedUpdate`): sends input to server
7. On each render (`onRender`): camera follows local player along surface normal

---

## 7. LAN Hosting System

### The Problem

Browsers cannot listen on ports, do mDNS discovery, or send UDP broadcasts. True peer-to-peer without any server requires WebRTC with manual SDP exchange -- a terrible user experience.

### The Solution: Vite Plugin Architecture

```
+-------------------------------------------------+
|                Vite Dev Server                   |
|   vite-plugin-lan.ts                             |
|                                                  |
|   /__lan/start  --> spawn('tsx server/index.ts') |
|   /__lan/stop   --> kill child process           |
|   /__lan/status --> hosting state + LAN IPs      |
|   /__lan/scan   --> HTTP scan /24 subnet         |
+-------------------------------------------------+
         ^                    |
         |                    v
  LANClient.ts         Colyseus child process
  (fetch calls)        (port 2567)
         ^                    |
         |                    v
  StartMenu.ts         game clients connect
  (UI buttons)         via WebSocket
```

### vite-plugin-lan.ts

A Vite plugin that adds middleware endpoints to the dev server:

| Endpoint | Method | Action |
|----------|--------|--------|
| `/__lan/start` | POST | Spawns `tsx server/index.ts` as child process. Polls `/health` every 500ms for up to 15 seconds. Returns LAN IP addresses on success. |
| `/__lan/stop` | POST | Kills the child process. |
| `/__lan/status` | GET | Returns `{ hosting, addresses, port }`. |
| `/__lan/scan` | GET | Scans all /24 subnets of the host's LAN interfaces. Hits `http://X.X.X.{1-254}:2567/api/info` with 400ms timeout. Returns servers that respond with `{"game":"geometry-wars-3d"}`. |

Key implementation details:

- Uses `os.networkInterfaces()` to discover LAN IPs
- Derives /24 subnet from each IP and scans all 254 addresses in parallel
- Self-detection: if the plugin is already hosting, includes self in scan results with `self: true` flag
- Cleanup: kills child process when Vite shuts down (`server.httpServer.on('close')`)

### LANClient (`src/network/LANClient.ts`)

A thin fetch wrapper used by the `StartMenu`:

```typescript
class LANClient {
  isAvailable(): Promise<boolean>    // Check if /__lan/status responds
  getStatus(): Promise<LANStatus>    // Get hosting state
  startHost(): Promise<LANStartResult> // POST /__lan/start
  stopHost(): Promise<void>           // POST /__lan/stop
  scan(): Promise<LANScanResult>      // GET /__lan/scan
  getServerWsUrl(ip, port): string    // Build ws://ip:port
  getJoinUrl(ip, port, surface, vitePort): string // Build full join URL
}
```

### StartMenu LAN Panel

The StartMenu's LAN section provides two flows:

**Host Flow:**
1. Click "HOST GAME" -- shows surface selection grid
2. Select a map, click "START HOSTING"
3. Plugin spawns Colyseus server as child process
4. On success: displays two URLs (Same PC / LAN) with copy buttons
5. Click "ENTER GAME" -- launches `network-main.ts` with `serverUrl=ws://localhost:2567`

**Join Flow:**
1. Either:
   - Enter host IP manually, click "CONNECT"
   - Click "SCAN LAN" -- plugin scans subnet, displays found servers
2. Click on a found server (or connect by IP)
3. Launches `network-main.ts` with `serverUrl=ws://{ip}:2567`

### CJS/ESM Interop Fix

The Vite plugin spawns the server using `tsx server/index.ts`. The root `package.json` has `"type": "module"`, which forces Node.js to treat all `.ts`/`.js` files as ESM. But the `colyseus` package (v0.15.57) ships as CommonJS.

Node 20's ESM loader cannot destructure named exports from CJS packages:
```typescript
import { Room, Client } from 'colyseus'; // SyntaxError in ESM mode
```

The fix: `server/package.json` with `{"type": "commonjs"}` overrides the parent's module type for the server directory only. tsx respects this per-directory override and transpiles server files to CJS, which can then `require()` the CJS colyseus package without interop issues.

**Decision log**: `decisions/lan-hosting-2026-02-08.md`

---

## 8. Host vs Joiner: Two Distinct Bug Fixes

Two separate bugs made LAN multiplayer non-functional initially. One affected the host side, the other the joiner side.

### Bug 1: MenuBackground Canvas (Host Side)

**Symptom**: After clicking "ENTER GAME" from the LAN host panel, the game appeared to load but nothing was visible. The Three.js scene rendered but was hidden.

**Root cause**: The `MenuBackground` class creates its own `WebGLRenderer` with a dedicated canvas at `z-index: 999`. When the `StartMenu` was hidden, `MenuBackground.stop()` paused the animation loop but did not remove the canvas from the DOM. The menu background canvas sat on top of the game's canvas, blocking all visuals.

**Fix**: `MenuBackground.dispose()` now removes the canvas from the DOM first (`this.canvas.remove()`), then disposes GPU resources. `StartMenu.dispose()` calls `this.menuBackground.dispose()`. The canvas removal is done before GPU cleanup so the UI unblocks even if cleanup throws.

### Bug 2: Schema Encoding (Joiner Side)

**Symptom**: Joiner connects, sees "Waiting for players...", but never sees any game state. All synced values are `undefined`.

**Root cause**: The ES2022 `Object.defineProperty` bug described in [Section 4](#4-the-es2022-bug-a-debugging-narrative). Server encodes empty state because change tracking setters have been overwritten.

**Fix**: `declare` keyword for all schema properties, defaults set in constructor body.

### Combined Timeline

```
1. Host clicks "HOST GAME"
   --> Plugin spawns Colyseus server (tsx server/index.ts)
   --> Server starts but encodeAll() returns empty (Bug 2)

2. Host clicks "ENTER GAME"
   --> StartMenu.hide() called, but MenuBackground canvas blocks view (Bug 1)
   --> Even if visible, state would be empty

3. Joiner enters IP, clicks "CONNECT"
   --> Connects to server via WebSocket
   --> Receives ROOM_STATE with 0 bytes of data (Bug 2)
   --> All state undefined

Fix 1: MenuBackground.dispose() removes canvas
Fix 2: declare keyword preserves Schema setters
Both fixes required for functional LAN multiplayer.
```

---

## 9. Known Issues and Future Work

### Current Limitations

| Issue | Impact | Mitigation |
|-------|--------|------------|
| **Dev mode only** | LAN hosting requires Vite dev server for `/__lan/` endpoints | Can run `npm run server` manually for production |
| **No interest management** | All clients receive all entity updates regardless of viewport | Fine for 4 players + 50 enemies; would need fixing at 100+ entities |
| **No client-side prediction** | Input latency equals round-trip time to server | Acceptable on LAN (~1-5ms); problematic over WAN |
| **Full state re-sync on state change** | `onStateChange` rebuilds all entities from scratch | Colyseus handles diffing internally; rendering does reconcile via Maps |
| **No reconnection** | If WebSocket drops, client must refresh | Colyseus supports `reconnect()` but it is not wired up |
| **Scan takes 1-2 seconds** | Sequential HTTP probe of 254 IPs | Could add mDNS via `bonjour-service` for instant discovery |

### Future Work

1. **Interest Management / Area of Interest**: Only send entity updates for entities near the player's viewport. Colyseus supports custom filters via `@filterChildren`.

2. **Delta Compression**: Currently using Schema's built-in delta encoding. Could add custom quantization for positions (fixed-point instead of float64) to reduce bandwidth.

3. **WebTransport**: Replace WebSocket with WebTransport (QUIC-based) for lower latency and unreliable channels. Colyseus has experimental WebTransport support.

4. **Client-Side Prediction**: Implement input prediction with server reconciliation to mask latency. Would require:
   - Client applies input locally and renders immediately
   - Server sends authoritative state
   - Client reconciles by replaying unacknowledged inputs on top of server state

5. **Standalone LAN Server**: `npm run lan` command that bundles both client (served via Express static files) and server into a single process, eliminating the Vite dev server requirement.

6. **mDNS Discovery**: Use `bonjour-service` (or similar) for zero-configuration LAN discovery instead of brute-force subnet scanning.

7. **Spectator Mode**: Allow additional clients to watch without playing. Would need a `spectator` role in `GameRoom.onJoin`.

---

## 10. Lessons Learned

### 1. ES2022 Class Fields Break Getter/Setter Libraries

**Any library that installs getter/setter descriptors on `this` in the constructor** (Colyseus Schema, MobX, Vue reactivity, etc.) is incompatible with ES2022 class field initializers. The `declare` keyword or `useDefineForClassFields: false` in tsconfig are the two escape hatches. Always test schema encoding after changing TypeScript target or bundler settings.

### 2. Silent Failures Are the Worst Failures

The Schema encoding bug produced zero error messages. No exceptions, no warnings, no assertion failures. The system appeared to work (connection succeeded, handshake completed) but silently transmitted empty data. Always add sanity checks for critical paths:

```typescript
// Add this in GameRoom.onJoin():
const encoded = this.state.encodeAll();
if (encoded.length === 0 && this.state.players.size > 0) {
  console.error('CRITICAL: State encoding is broken! Check ES2022 class fields.');
}
```

### 3. CJS/ESM Interop Requires Per-Directory Control

Node.js 20 with `"type": "module"` cannot destructure named exports from CJS packages. The cleanest fix is `server/package.json` with `{"type": "commonjs"}` -- a standard Node.js mechanism that is well-documented but easy to forget.

### 4. Colyseus Timing: Register Listeners Before State Arrives

The initial `onStateChange` fires during `joinOrCreate()`, before custom listeners are registered. Either:
- Register listeners synchronously inside the `joinOrCreate()` promise chain (before awaiting), or
- Use a polling workaround (as implemented in `NetworkClient.connect()`)

### 5. MenuBackground Canvas Z-Index

When a component creates its own WebGL renderer/canvas, its `dispose()` method **must** remove the canvas from the DOM. Stopping the animation loop is not enough -- the canvas remains in the DOM as a visual blocker.

### 6. Vite Plugin Pattern Works Well for Dev-Only Features

The `vite-plugin-lan.ts` pattern of adding middleware to the Vite dev server is clean and self-contained. The plugin can be removed from `vite.config.ts` with zero impact on the rest of the codebase. This pattern works well for any dev-only feature that needs server-side logic.

### 7. Subnet Scanning Is Good Enough

While mDNS would be more elegant, HTTP subnet scanning (254 parallel requests with 400ms timeout) is fast enough for LAN game discovery. It takes 1-2 seconds and requires no additional dependencies. The `/api/info` endpoint pattern (respond with a known JSON signature) is simple and reliable.

### 8. Server-Side Schema: Keep It Flat

Deeply nested schemas multiply the risk of the `defineProperty` bug and make debugging harder. The current flat structure (6 independent schema classes, no nesting beyond collections) is easy to reason about and debug.

---

## Appendix: Server Room Configuration

```typescript
// GameRoom constants
TICK_RATE = 60          // Simulation ticks per second
PATCH_RATE = 50         // ms between state patches (= 20 patches/sec)
MAX_CLIENTS = 4         // Max players per room
PLAYER_SPEED = 0.08     // UV-space units per tick
BULLET_SPEED = 0.15     // UV-space units per tick
BULLET_LIFETIME = 3.0   // seconds
SPAWN_INTERVAL = 2.0    // seconds between enemy spawns
MAX_ENEMIES = 50        // Max enemies alive
WEAPON_DROP_CHANCE = 8% // Per enemy death
WEAPON_PICKUP_LIFETIME = 20s
```

## Appendix: Enemy Speed Table (Server-Side)

| Type | Speed (UV/s) | Health | Score |
|------|-------------|--------|-------|
| grunt | 0.03 | 1 | 25 |
| arrow | 0.06 | 1 | 75 |
| weaver | 0.04 | 2 | 50 |
| spinner | 0.025 | 3 | 100 |
| snake | 0.05 | 1 | 50 |
| gate | 0.02 | 2 | 150 |
| blackhole | 0.01 | 10 | 200 |
| repulsor | 0.035 | 3 | 50 |
| mayfly | 0.08 | 1 | 150 |
| proton | 0.04 | 5 | 100 |
| ufo | 0.02 | 5 | 300 |
| mines | 0 (stationary) | 1 | 25 |
| mutator | 0.03 | 4 | 200 |
| bubbles | 0.025 | 2 | 50 |
| spawnlet | 0.05 | 1 | 25 |

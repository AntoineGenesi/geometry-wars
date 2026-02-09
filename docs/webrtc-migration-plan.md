# WebRTC Migration Plan: Colyseus to Peer-to-Peer

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Current Architecture (Colyseus)](#2-current-architecture-colyseus)
3. [WebRTC Architecture for Games](#3-webrtc-architecture-for-games)
4. [The UDP Question](#4-the-udp-question)
5. [Migration Plan](#5-migration-plan)
6. [Distribution Scenarios](#6-distribution-scenarios)
7. [Performance Comparison](#7-performance-comparison)
8. [Benefits Summary](#8-benefits-summary)
9. [Code Examples](#9-code-examples)
10. [Risk Assessment and Trade-offs](#10-risk-assessment-and-trade-offs)
11. [Recommended Migration Phases](#11-recommended-migration-phases)

---

## 1. Executive Summary

The game currently uses **Colyseus ^0.15** over WebSocket (TCP) with a dedicated Node.js server (`server/index.ts` on port 2567) acting as the authoritative game state owner. Clients send input, the server runs the simulation at 60Hz, and broadcasts state patches at ~30Hz.

**WebRTC** enables a fundamentally different architecture: one browser becomes the "host" and runs the game logic, while other browsers connect directly via `RTCDataChannel`. No server is needed for gameplay. A tiny signaling step (exchangeable via copy-paste room codes, a free PeerJS cloud relay, or a static signaling server) is the only coordination required.

Key benefits:
- **Zero server infrastructure** for gameplay (deployable on GitHub Pages / Netlify)
- **UDP-like transport** via `RTCDataChannel` with `ordered: false, maxRetransmits: 0`
- **Lower latency** on LAN (direct peer connection, no server hop)
- **NAT traversal** built-in (STUN/TURN)
- The game logic (`GameRoom.ts` tick loop, collision detection, enemy AI) **runs identically** -- only the transport layer changes

---

## 2. Current Architecture (Colyseus)

### How It Works Today

```
                    Colyseus Server (Node.js, port 2567)
                    +---------------------------------+
                    | GameRoom.ts                     |
                    |   - 60Hz tick loop              |
                    |   - Authoritative game state    |
                    |   - GameState (Schema)          |
                    |     - players: MapSchema        |
                    |     - enemies: ArraySchema      |
                    |     - bullets: ArraySchema      |
                    |     - geoms: ArraySchema        |
                    |     - weaponPickups: ArraySchema |
                    |   - InterestManager (disabled)  |
                    +--------+----------+-------------+
                             |          |
                    WebSocket|          |WebSocket
                    (TCP)    |          |(TCP)
                             v          v
                    +--------+--+  +----+-------+
                    | Client A  |  | Client B   |
                    | (browser) |  | (browser)  |
                    | Sends:    |  | Sends:     |
                    |  input{}  |  |  input{}   |
                    | Receives: |  | Receives:  |
                    |  state    |  |  state     |
                    |  patches  |  |  patches   |
                    +-----------+  +------------+
```

### Key Files

| File | Role |
|------|------|
| `server/index.ts` | Express + Colyseus server setup, port 2567 |
| `server/rooms/GameRoom.ts` | Authoritative game loop (60Hz tick, 30Hz patch rate) |
| `server/schema/GameState.ts` | Colyseus Schema definitions (PlayerState, EnemyState, etc.) |
| `server/systems/InterestManager.ts` | Per-client entity filtering (currently disabled) |
| `server/systems/PriorityQueue.ts` | UV-distance priority classification |
| `src/network/NetworkClient.ts` | Client-side Colyseus wrapper (connect, sendInput, callbacks) |
| `src/network/LANClient.ts` | LAN discovery + hosting API |
| `src/network-main.ts` | Network multiplayer entry point (renders server state) |

### Data Flow

1. **Client** captures input (WASD, mouse, shooting) at 30Hz
2. **Client** sends `{ moveX, moveY, aimAngle, shooting, bomb }` via `room.send('input', ...)`
3. **Server** applies input to player position (UV space), spawns bullets
4. **Server** runs simulation: move enemies, update bullets, check collisions
5. **Server** Colyseus auto-patches state diffs to all clients at 30Hz (33ms interval)
6. **Client** receives state patches, positions entities on surface via `surface.getPoint(u, v)`

### What Colyseus Provides

- **Schema serialization**: Automatic binary diff-patching (only changed fields sent)
- **Room management**: Join/create/leave lifecycle
- **Transport**: WebSocket (TCP)
- **State listeners**: `.onStateChange()`, `.listen()`, `.onAdd()`, `.onRemove()`

### What Colyseus Does NOT Provide

- UDP transport (WebSocket = TCP only)
- NAT traversal (requires port forwarding for internet play)
- Peer-to-peer connections
- Browser-only hosting (always needs a Node.js process)

---

## 3. WebRTC Architecture for Games

### RTCDataChannel: The Key Primitive

WebRTC is primarily known for video/audio calling, but `RTCDataChannel` is its hidden gem for games. It provides:

- **Browser-to-browser data transfer** (no server needed after connection)
- **Configurable reliability**: choose TCP-like (ordered, reliable) or UDP-like (unordered, unreliable)
- **Binary data support**: send `ArrayBuffer` directly
- **Built-in NAT traversal** via ICE (STUN/TURN)
- **Encryption**: DTLS encryption mandatory (secure by default)

### Channel Modes

```typescript
// TCP-like: ordered, reliable (retransmits lost packets)
const reliable = peerConnection.createDataChannel('reliable', {
  ordered: true,
  // Default: reliable
});

// UDP-like: unordered, unreliable (drops lost packets, no head-of-line blocking)
const unreliable = peerConnection.createDataChannel('unreliable', {
  ordered: false,
  maxRetransmits: 0,
});

// Semi-reliable: ordered, limited retransmits
const semiReliable = peerConnection.createDataChannel('semi', {
  ordered: true,
  maxRetransmits: 3,
});
```

**For this game, we use TWO channels:**

| Channel | Mode | Purpose |
|---------|------|---------|
| `state` | Unreliable (`ordered: false, maxRetransmits: 0`) | Position updates, aim angles, enemy positions. If a packet is lost, the next one supersedes it anyway. |
| `events` | Reliable (`ordered: true`) | Kills, score changes, weapon pickups, spawn events, game start/over. These must arrive and in order. |

### Signaling: How Peers Find Each Other

WebRTC requires a one-time "signaling" step to exchange connection metadata (SDP offers/answers + ICE candidates). This does NOT carry gameplay data -- it is only used to establish the connection.

**Three signaling approaches:**

#### Option A: Copy-Paste Room Code (Zero Infrastructure)

The host generates an SDP offer, encodes it as a compact string (base64), and displays it as a room code. The joiner pastes this code into their browser, which generates an answer code to paste back. After exchange, the direct connection is established.

- Pros: Truly zero server needed, works offline
- Cons: UX friction (copy-paste two codes), impractical for >2 players
- Best for: Local/LAN play, development, demos

#### Option B: PeerJS Cloud (Free, Zero Setup)

[PeerJS](https://peerjs.com/) provides a free signaling server. Each peer gets a random ID. The host shares their ID (or a derived room code). PeerJS handles SDP/ICE exchange behind the scenes.

- Pros: One-click experience, free tier handles thousands of connections
- Cons: Depends on PeerJS cloud availability, adds ~200ms to initial connection
- Best for: Internet play, casual sharing
- Fallback: Can self-host PeerJS server (tiny Node.js app, ~20 lines)

#### Option C: Custom Signaling Server (Self-Hosted)

A minimal WebSocket or HTTP server that relays SDP/ICE between peers. Can run on the same machine as the game, on a free tier (Fly.io, Railway), or embedded in an Electron app.

- Pros: Full control, can add matchmaking/lobbies
- Cons: Requires hosting (even if minimal)
- Best for: Production deployment, Steam/Electron builds

### NAT Traversal: STUN and TURN

**STUN** (Session Traversal Utilities for NAT): Tells a peer its public IP/port. Free servers available from Google (`stun:stun.l.google.com:19302`). Works for ~85% of NAT configurations.

**TURN** (Traversal Using Relays around NAT): When direct connection fails (symmetric NAT), traffic is relayed through a TURN server. This adds latency but guarantees connectivity. Costs bandwidth on the relay server.

**For LAN play**: STUN/TURN are not needed. Peers connect directly via local IP addresses.

**For internet play**: Use Google's free STUN. Add a TURN fallback for the ~15% of users behind symmetric NAT (Twilio, Metered.ca, or self-hosted coturn offer free tiers).

```typescript
const config: RTCConfiguration = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    // TURN fallback (only needed for internet play through strict NATs)
    // { urls: 'turn:your-turn-server.com:3478', username: 'user', credential: 'pass' },
  ],
};
```

### Topology: Host-Peer vs Full Mesh

**For 2-4 players, the correct choice is Host-Peer (star topology).**

#### Host-Peer (Recommended)

```
         Host Browser
        (runs game logic)
       /        |        \
      /         |         \
  Peer A     Peer B     Peer C
```

- Host runs the authoritative simulation (same code as current `GameRoom.ts`)
- Peers send input to host, host broadcasts state to all peers
- **Identical architecture to current Colyseus setup** -- the host browser replaces the Node.js server
- Connections: N-1 (for 4 players: 3 connections)
- If host disconnects: game ends (same as current behavior)

#### Full Mesh (Not Recommended)

```
    A --- B
    |  X  |
    C --- D
```

- Every peer connected to every other peer
- Connections: N*(N-1)/2 (for 4 players: 6 connections)
- Requires consensus protocol for game state
- Much more complex, no clear authority for collisions
- Only advantage: no single point of failure

**Verdict: Host-Peer.** It maps 1:1 to the current architecture. The `GameRoom.ts` code barely changes -- it just runs in a browser instead of Node.js.

---

## 4. The UDP Question

### The Core Problem

**WebSocket (used by Colyseus) = TCP only.**

TCP guarantees ordered, reliable delivery. This means:

1. If packet #5 is lost, packets #6, #7, #8 are held in the kernel buffer until #5 is retransmitted and received. This is **head-of-line blocking**.
2. For game state updates, this is wasteful: packet #8 already contains the latest positions, so #5 is stale by the time it arrives.
3. On a lossy connection (Wi-Fi, internet), this causes **latency spikes** of 50-200ms whenever a packet is lost.

### WebRTC DataChannel = The Only UDP-Like Option in Browsers

There is no raw UDP socket API in browsers. `WebRTC DataChannel` with `ordered: false, maxRetransmits: 0` is the closest thing:

- Uses **SCTP over DTLS over UDP** internally
- With the unreliable configuration, lost packets are simply dropped
- No head-of-line blocking
- Packets arrive as fast as the network allows

**This is THE way to get UDP-like behavior in a browser. There is no alternative.**

### What Benefits from UDP vs TCP

| Data Type | Transport | Why |
|-----------|-----------|-----|
| Player positions (surfaceU, surfaceV) | **Unreliable** (UDP-like) | Old positions are superseded by new ones. Dropping one is fine. |
| Enemy positions | **Unreliable** | Same reasoning. The next update corrects any missed frame. |
| Aim angles | **Unreliable** | Cosmetic, constantly updating. |
| Bullet positions | **Unreliable** | Visual only on clients; host is authoritative for collision. |
| Kills / deaths | **Reliable** | Must arrive. Missing a kill breaks score tracking. |
| Score changes | **Reliable** | Cumulative state, must be consistent. |
| Weapon pickups | **Reliable** | Discrete event, must not be missed. |
| Enemy spawns | **Reliable** | Client needs to create the mesh. |
| Game start / game over | **Reliable** | Critical lifecycle events. |
| Wave number changes | **Reliable** | UI display, infrequent. |

### Head-of-Line Blocking: Real-World Impact

On a connection with 2% packet loss (typical Wi-Fi):

- **TCP (Colyseus WebSocket)**: Every ~50 packets, one is lost. The next 1-3 packets are delayed by 50-150ms while TCP retransmits. This causes **visible jitter** in enemy/player movement.
- **UDP-like DataChannel**: The lost packet is simply skipped. The next update arrives on time. Movement appears smooth because the latest position is always current.

For a game running at 30Hz state updates, TCP head-of-line blocking can cause 2-4 visible "hitches" per second on a lossy connection. UDP-like DataChannel eliminates this entirely.

---

## 5. Migration Plan

### Architectural Principle

The game logic in `GameRoom.ts` (tick loop, collision detection, enemy AI, spawning) is **transport-agnostic**. It currently receives input via Colyseus message handlers and stores state in Colyseus Schema objects. The migration replaces:

1. **Colyseus Schema** with plain TypeScript interfaces + binary serialization
2. **Colyseus Room** with a `HostGame` class that runs in the browser
3. **WebSocket transport** with `RTCDataChannel`
4. **Colyseus Client** with a `PeerClient` class

Everything else (Three.js rendering, surface system, MeshWalker, weapons, particles) stays exactly the same.

### Step-by-Step Migration

#### Step 1: Extract Game Logic from Colyseus Dependencies

Create `src/game/GameSimulation.ts` -- a pure TypeScript class containing the game logic currently in `GameRoom.ts`, but without any Colyseus imports.

```
BEFORE (Colyseus-coupled):
  server/rooms/GameRoom.ts
    - extends Room<GameState>
    - uses Schema, MapSchema, ArraySchema
    - uses this.broadcast(), this.onMessage()
    - uses this.setSimulationInterval()

AFTER (transport-agnostic):
  src/game/GameSimulation.ts
    - plain class, no Colyseus dependencies
    - uses plain TypeScript interfaces for state
    - exposes: applyInput(playerId, input), tick(dt), getState()
    - emits events via callback interface
```

The key insight: `GameRoom.tick()` already works with plain data. The Colyseus Schema objects are just containers. Replace `PlayerState extends Schema` with a plain interface, and the tick logic is identical.

**What changes:**

| Current (Colyseus) | New (Transport-Agnostic) |
|---------------------|------------------------|
| `new PlayerState()` (Schema) | `{ id: '', surfaceU: 0.5, ... }` (plain object) |
| `this.state.players.set(id, player)` | `this.players.set(id, player)` |
| `this.state.enemies.push(enemy)` | `this.enemies.push(enemy)` |
| `this.onMessage('input', handler)` | `this.applyInput(playerId, input)` |
| `this.setSimulationInterval(fn, ms)` | `setInterval(fn, ms)` or `requestAnimationFrame` loop |
| `this.broadcast('game_ended')` | `this.callbacks.onGameEnded()` |

**What stays identical:**

- `handleInput()` logic
- `tryShoot()` logic
- `tick()` loop structure
- `updateBullets()`, `updateEnemies()`, `checkCollisions()`
- `spawnEnemy()`, `spawnGeom()`, `spawnWeaponPickup()`
- All game constants (speeds, spawn rates, weapon configs)

#### Step 2: Implement Binary State Serialization

Replace Colyseus Schema's automatic diff-patching with a custom binary serializer using `ArrayBuffer` and `DataView`. This is straightforward because the state is mostly arrays of numbers.

**State layout for a single position update packet:**

```
[1 byte: packet type] [4 bytes: sequence number] [payload...]

Player position (14 bytes per player):
  [2 bytes: playerId hash]
  [4 bytes: surfaceU as Float32]
  [4 bytes: surfaceV as Float32]
  [4 bytes: aimAngle as Float32]

Enemy position (10 bytes per enemy):
  [2 bytes: enemyId hash]
  [4 bytes: surfaceU as Float32]
  [4 bytes: surfaceV as Float32]
```

At 50 enemies + 4 players + 20 bullets, a full state update is:
- Players: 4 * 14 = 56 bytes
- Enemies: 50 * 10 = 500 bytes
- Bullets: 20 * 10 = 200 bytes
- Header: 5 bytes
- **Total: ~761 bytes per update**

At 30Hz: **~22 KB/s**. Negligible bandwidth.

Compare to Colyseus JSON-based patches: typically 2-5x larger due to key names and JSON encoding overhead.

#### Step 3: Implement WebRTC Host

Create `src/network/WebRTCHost.ts`:

```
WebRTCHost
  - Creates RTCPeerConnection for each joining peer
  - Creates two DataChannels per peer: 'state' (unreliable) + 'events' (reliable)
  - Runs GameSimulation locally
  - Serializes state to binary, sends on 'state' channel at 30Hz
  - Sends events (kills, spawns, pickups) on 'events' channel
  - Receives input from peers on 'state' channel
```

#### Step 4: Implement WebRTC Peer Client

Create `src/network/WebRTCPeer.ts`:

```
WebRTCPeer
  - Connects to host via RTCPeerConnection
  - Receives state updates on 'state' channel, deserializes, updates local rendering
  - Receives events on 'events' channel
  - Sends input on 'state' channel at 30Hz
  - Provides the same callback interface as current NetworkClient
```

#### Step 5: Implement Signaling

Create `src/network/Signaling.ts`:

Three signaling backends behind a common interface:

```typescript
interface SignalingProvider {
  createRoom(): Promise<string>;       // Returns room code
  joinRoom(code: string): Promise<void>;
  onPeerConnected(callback: (peerId: string, connection: RTCPeerConnection) => void): void;
}

class CopyPasteSignaling implements SignalingProvider { ... }
class PeerJSSignaling implements SignalingProvider { ... }
class WebSocketSignaling implements SignalingProvider { ... }
```

#### Step 6: Update network-main.ts

Replace `NetworkClient` usage with `WebRTCPeer`:

```
BEFORE:
  const network = new NetworkClient('ws://localhost:2567');
  network.connect({ name, surfaceType });
  network.sendInput(input);

AFTER:
  const peer = new WebRTCPeer();
  peer.joinRoom(roomCode);  // Signaling exchange
  peer.sendInput(input);    // Same interface, different transport
```

#### Step 7: Preserve Colyseus as a Fallback

Keep the current Colyseus code in `server/` as an alternative backend. The client can detect which mode to use:

```typescript
if (mode === 'webrtc') {
  // New peer-to-peer path
} else if (mode === 'network') {
  // Existing Colyseus path (for dedicated servers, Electron embedded)
}
```

### File Structure After Migration

```
src/
  game/
    GameSimulation.ts      -- Transport-agnostic game logic (extracted from GameRoom.ts)
    GameState.ts           -- Plain TypeScript interfaces (no Schema)
    BinarySerializer.ts   -- ArrayBuffer serialization/deserialization
  network/
    WebRTCHost.ts          -- Browser-side host (runs GameSimulation + WebRTC)
    WebRTCPeer.ts          -- Client peer (receives state, sends input)
    Signaling.ts           -- Signaling abstraction (PeerJS / copy-paste / WS)
    NetworkClient.ts       -- KEPT: Colyseus client (fallback)
    LANClient.ts           -- KEPT: LAN discovery (fallback)
  webrtc-main.ts           -- New entry point for WebRTC mode
  network-main.ts          -- KEPT: Colyseus entry point
server/
  (all files KEPT as Colyseus fallback for dedicated server mode)
```

---

## 6. Distribution Scenarios

### Scenario A: Browser-Only (GitHub Pages / Netlify)

**This is the primary use case for WebRTC migration.**

```
User A opens https://your-game.netlify.app
  -> Clicks "Host Game"
  -> Gets room code: "ABCD-1234"
  -> Shares code with friend

User B opens https://your-game.netlify.app
  -> Clicks "Join Game"
  -> Enters code: "ABCD-1234"
  -> WebRTC connection established
  -> Game starts
```

**Infrastructure needed:**
- Static file hosting (free: GitHub Pages, Netlify, Vercel, Cloudflare Pages)
- PeerJS cloud for signaling (free, or self-host on free tier)
- Google STUN servers (free, always available)
- Optional: TURN server for strict NATs (free tier from Metered.ca or Twilio)

**Total cost: $0/month** for LAN and most internet play.

**Pros:**
- Deploy with `vite build && netlify deploy`
- No Node.js server to maintain
- Scales to unlimited concurrent games (each game is self-contained between peers)
- Works offline on LAN (no internet needed after initial page load)

**Cons:**
- Host browser must stay open (if host closes tab, game ends)
- Host browser runs game logic + rendering (higher CPU usage)
- No persistent state (no leaderboards, no accounts without a separate backend)

### Scenario B: Electron / Steam Desktop App

Bundle the game as a desktop application using Electron (or Tauri for smaller binaries).

**Two sub-options:**

#### B1: Electron + WebRTC (Recommended)

Same architecture as browser-only, but wrapped in Electron. The Electron app IS a browser (Chromium), so WebRTC works identically.

```
Electron App
  -> Same index.html + JS bundle
  -> WebRTC host/peer works out of the box
  -> Can add system tray, auto-updates, Steam integration
```

**Pros:**
- Identical code to browser version
- No separate server process
- Steam SDK integration via `greenworks` or `steamworks.js`
- Can use Steam networking as an alternative signaling channel

**Cons:**
- Electron bundle is ~150-200MB (Chromium runtime)
- Still peer-to-peer (host must stay running)

#### B2: Electron + Embedded Colyseus Server

The Electron app spawns a local Colyseus server as a child process. Other players connect to this server over LAN or internet (with port forwarding).

```
Electron App
  -> Spawns Node.js child process running server/index.ts
  -> Main window connects to ws://localhost:2567
  -> Other players connect to ws://<host-ip>:2567
```

**Pros:**
- Dedicated server process (doesn't compete with rendering for CPU)
- Full Colyseus features (lobbies, matchmaking, etc.)
- Familiar architecture

**Cons:**
- Must bundle Node.js runtime (~50MB) or use `pkg` to compile server
- Port forwarding required for internet play (no NAT traversal)
- Total bundle: Electron (~150MB) + Node.js (~50MB) = ~200MB
- More complex packaging/auto-update process
- Two processes to manage (server + renderer)

#### B3: Comparison

| Aspect | Electron + WebRTC | Electron + Colyseus |
|--------|-------------------|---------------------|
| Bundle size | ~150MB | ~200MB |
| Internet play | Works through NAT (STUN/TURN) | Requires port forwarding |
| LAN play | Works automatically | Works automatically |
| CPU usage (host) | Higher (game + rendering in one process) | Better (separate processes) |
| Complexity | Lower (one process) | Higher (spawn + manage server process) |
| Steam networking | Can use as signaling | Can use as transport |

**Recommendation for Steam:** Start with Electron + WebRTC. If CPU becomes an issue for the host player (unlikely for 2-4 players), consider offloading the game simulation to a Web Worker (same process, separate thread, communicating via `postMessage`).

### Scenario C: Hybrid (Signaling Server + WebRTC)

For a production deployment with matchmaking and lobbies:

```
                     Tiny Signaling Server
                   (Node.js, $0 on Fly.io free tier)
                   +------------------------+
                   | - Room creation/listing |
                   | - SDP/ICE relay         |
                   | - Player count tracking |
                   +--------+-------+-------+
                            |       |
                   signaling|       |signaling
                   (HTTP)   |       |(HTTP)
                            v       v
                   +--------+-+  +--+----------+
                   | Host     |  | Peer        |
                   | Browser  |==| Browser     |
                   |          |  |             |
                   +----------+  +-------------+
                         WebRTC DataChannel
                     (direct, no server in path)
```

The signaling server is stateless and tiny (~100 lines of code). It handles:
- Room creation (generate code, store host's SDP offer)
- Room joining (relay SDP answer back to host)
- Room listing (for a lobby browser)
- ICE candidate relay

After connection establishment, the signaling server is no longer involved. All gameplay data flows directly between peers.

**Cost:** Free on Fly.io, Railway, or Render free tiers. A single instance handles thousands of simultaneous signaling exchanges because each one is a few KB of data and completes in <1 second.

---

## 7. Performance Comparison

### Latency

#### Colyseus (Current)

```
Client A input -> [TCP/WebSocket] -> Server -> [process] -> [TCP/WebSocket] -> Client B render
                   ~1-3ms (LAN)                  ~1ms        ~1-3ms (LAN)
                   ~20-50ms (internet)                       ~20-50ms (internet)

Total LAN roundtrip:  ~5-8ms
Total internet:       ~40-100ms + TCP retransmit spikes (50-200ms on packet loss)
```

#### WebRTC DataChannel (Proposed)

```
Client A input -> [DataChannel/UDP-like] -> Host Browser -> [process] -> [DataChannel/UDP-like] -> Client B
                   ~0.5-1ms (LAN)                           ~1ms         ~0.5-1ms (LAN)
                   ~15-40ms (internet)                                    ~15-40ms (internet)

Total LAN roundtrip:  ~2-4ms
Total internet:       ~30-80ms, NO retransmit spikes (unreliable mode)
```

**LAN improvement: ~50% lower latency** (UDP avoids TCP overhead: no SYN/ACK, no Nagle's algorithm, no congestion window).

**Internet improvement: ~20-40% lower average latency** plus elimination of TCP retransmit spikes. The jitter (variance) improvement is more significant than the average improvement.

### Bandwidth

#### Colyseus Schema Patches

Colyseus uses a binary delta encoding, but it includes field indexes, type markers, and container operations (add/remove from ArraySchema). A typical state update for 50 enemies + 4 players:

- Schema overhead per field: ~2-3 bytes (type + index)
- Changed fields per enemy per tick: ~2 (surfaceU, surfaceV)
- Estimate: `50 enemies * 2 fields * (4 bytes value + 3 bytes overhead) = 700 bytes`
- Players + bullets + metadata: ~300 bytes
- **Total: ~1,000 bytes per patch at 30Hz = ~30 KB/s per client**

#### Custom Binary Serialization over DataChannel

No field indexes, no type markers, no container operations. Fixed-layout binary format:

- Per enemy: 10 bytes (2 id + 4 u + 4 v)
- Per player: 14 bytes (2 id + 4 u + 4 v + 4 aim)
- Header: 5 bytes
- **Total: ~761 bytes per update at 30Hz = ~22 KB/s per client**

**Bandwidth improvement: ~25-35% smaller** due to no schema overhead.

For comparison, JSON over WebSocket (what many games use):

```json
{"enemies":[{"id":"e1","u":0.5123,"v":0.7891}, ...]}
```

This would be ~3-5 KB per update. Binary is 4-7x more efficient than JSON.

### CPU Usage

| Aspect | Colyseus Server | WebRTC Host Browser |
|--------|----------------|---------------------|
| Game logic | Dedicated Node.js process | Shares with rendering |
| Serialization | Schema auto-patching (optimized C++) | Custom JS binary serializer |
| Networking | Single WebSocket server | N-1 DataChannel connections |
| Rendering | None (server-only) | Full Three.js rendering |

For 2-4 players with 50-100 enemies, the game logic is lightweight (< 1ms per tick). The host browser has plenty of headroom. The game already targets 60fps with 10K+ entities -- adding a lightweight network tick is negligible.

If host CPU does become a concern, the `GameSimulation` can be moved to a **Web Worker**, running on a separate CPU core and communicating with the main thread via `postMessage` + `SharedArrayBuffer` (the project already uses this pattern for physics -- see `src/workers/WorkerBridge`).

### Real-World Numbers

Based on WebRTC benchmarks for game-like workloads (binary DataChannel, 30Hz sends):

| Metric | WebSocket TCP | DataChannel Unreliable | Improvement |
|--------|--------------|----------------------|-------------|
| LAN latency (median) | 2-3ms | 0.5-1ms | 2-3x |
| Internet latency (median) | 30-50ms | 20-40ms | 1.3-1.5x |
| Internet latency (P99) | 80-200ms (TCP retransmit) | 40-60ms | 2-4x |
| Jitter (standard deviation) | 5-15ms | 1-3ms | 3-5x |
| Bandwidth per client | ~30 KB/s | ~22 KB/s | 1.3x |
| Connection setup time | ~50ms (WS handshake) | ~500ms-2s (ICE + DTLS) | Slower initial |

The P99 latency improvement is the most impactful for gameplay feel. TCP's worst-case behavior (retransmit stall) is completely eliminated.

---

## 8. Benefits Summary

### For the Developer

1. **No server infrastructure** -- Deploy on any static hosting. No Node.js, no WebSocket server, no port management.
2. **Simpler deployment** -- `vite build` produces a folder of static files. Upload anywhere.
3. **No server costs** -- Each game session is self-contained between peers. You can have 10,000 simultaneous games and pay $0.
4. **Same game code** -- `GameSimulation.ts` is the same logic as `GameRoom.ts`, just without Colyseus imports.
5. **Better testing** -- Game logic runs in the browser, can be tested with Vitest without spinning up a server.
6. **Colyseus fallback** -- Keep the server code for dedicated server scenarios (tournaments, ranked play).

### For the Player

1. **Lower latency** -- UDP-like transport eliminates TCP head-of-line blocking.
2. **Smoother movement** -- No jitter spikes from TCP retransmits.
3. **Easier LAN play** -- No port forwarding, no server process. Open URL, share code, play.
4. **Internet play through NAT** -- WebRTC's ICE handles NAT traversal automatically. No "port forward 2567" instructions.
5. **One-click hosting** -- Press "Host", get a code. No separate server download.

### For Distribution

1. **Browser demo** -- Share a URL, instant play. Best possible try-before-you-buy.
2. **Steam/Electron** -- Same code, wrapped in desktop shell. WebRTC works in Electron.
3. **Mobile (future)** -- WebRTC works in mobile browsers. The game could eventually run on phones.
4. **Offline LAN** -- After loading the page once, WebRTC works without internet (peers connect via local IP).

---

## 9. Code Examples

### 9.1 Basic DataChannel Setup (TypeScript)

```typescript
/**
 * Establish a WebRTC DataChannel connection between two peers.
 * This example shows the host side (creates offer).
 */

// ICE server configuration (Google's free STUN servers)
const ICE_SERVERS: RTCConfiguration = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ],
};

// ---- HOST SIDE ----

async function createHostConnection(): Promise<{
  connection: RTCPeerConnection;
  stateChannel: RTCDataChannel;
  eventChannel: RTCDataChannel;
  offer: string;
}> {
  const connection = new RTCPeerConnection(ICE_SERVERS);

  // Create two channels: unreliable for state, reliable for events
  const stateChannel = connection.createDataChannel('state', {
    ordered: false,
    maxRetransmits: 0,
  });
  stateChannel.binaryType = 'arraybuffer';

  const eventChannel = connection.createDataChannel('events', {
    ordered: true,
    // reliable by default
  });
  eventChannel.binaryType = 'arraybuffer';

  // Gather ICE candidates
  const iceCandidates: RTCIceCandidate[] = [];
  connection.onicecandidate = (event) => {
    if (event.candidate) {
      iceCandidates.push(event.candidate);
    }
  };

  // Create offer
  const offer = await connection.createOffer();
  await connection.setLocalDescription(offer);

  // Wait for ICE gathering to complete
  await new Promise<void>((resolve) => {
    if (connection.iceGatheringState === 'complete') {
      resolve();
    } else {
      connection.onicegatheringstatechange = () => {
        if (connection.iceGatheringState === 'complete') resolve();
      };
    }
  });

  // The complete offer (SDP + ICE candidates) encoded as a shareable string
  const fullOffer = JSON.stringify({
    sdp: connection.localDescription,
    candidates: iceCandidates,
  });
  const offerCode = btoa(fullOffer);

  return { connection, stateChannel, eventChannel, offer: offerCode };
}

// Process the joiner's answer
async function processAnswer(
  connection: RTCPeerConnection,
  answerCode: string,
): Promise<void> {
  const { sdp, candidates } = JSON.parse(atob(answerCode));
  await connection.setRemoteDescription(sdp);
  for (const candidate of candidates) {
    await connection.addIceCandidate(candidate);
  }
}

// ---- PEER (JOINER) SIDE ----

async function joinHost(offerCode: string): Promise<{
  connection: RTCPeerConnection;
  stateChannel: RTCDataChannel;
  eventChannel: RTCDataChannel;
  answer: string;
}> {
  const { sdp: offerSdp, candidates: offerCandidates } = JSON.parse(atob(offerCode));

  const connection = new RTCPeerConnection(ICE_SERVERS);

  // Wait for host's data channels to arrive
  const channels = new Map<string, RTCDataChannel>();
  const channelPromise = new Promise<void>((resolve) => {
    connection.ondatachannel = (event) => {
      event.channel.binaryType = 'arraybuffer';
      channels.set(event.channel.label, event.channel);
      if (channels.size === 2) resolve();
    };
  });

  // Set remote description (host's offer)
  await connection.setRemoteDescription(offerSdp);

  // Add host's ICE candidates
  for (const candidate of offerCandidates) {
    await connection.addIceCandidate(candidate);
  }

  // Create answer
  const answer = await connection.createAnswer();
  await connection.setLocalDescription(answer);

  // Gather our ICE candidates
  const iceCandidates: RTCIceCandidate[] = [];
  await new Promise<void>((resolve) => {
    connection.onicecandidate = (event) => {
      if (event.candidate) {
        iceCandidates.push(event.candidate);
      }
    };
    if (connection.iceGatheringState === 'complete') {
      resolve();
    } else {
      connection.onicegatheringstatechange = () => {
        if (connection.iceGatheringState === 'complete') resolve();
      };
    }
  });

  const fullAnswer = JSON.stringify({
    sdp: connection.localDescription,
    candidates: iceCandidates,
  });
  const answerCode = btoa(fullAnswer);

  // Wait for data channels
  await channelPromise;

  return {
    connection,
    stateChannel: channels.get('state')!,
    eventChannel: channels.get('events')!,
    answer: answerCode,
  };
}
```

### 9.2 Binary State Serialization (ArrayBuffer)

```typescript
/**
 * Binary serialization for game state over DataChannel.
 *
 * Packet format:
 *   [0]:     uint8  - packet type (0 = state update, 1 = input, 2 = event)
 *   [1-4]:   uint32 - sequence number
 *   [5...]:  payload (varies by type)
 *
 * State update payload:
 *   [5]:     uint8  - player count
 *   [6]:     uint16 - enemy count
 *   [8]:     uint16 - bullet count
 *   [10...]: player data (PLAYER_BYTES per player)
 *   [...]:   enemy data (ENEMY_BYTES per enemy)
 *   [...]:   bullet data (BULLET_BYTES per bullet)
 */

const PACKET_TYPE = {
  STATE_UPDATE: 0,
  INPUT: 1,
  EVENT: 2,
} as const;

const HEADER_BYTES = 5;       // type(1) + sequence(4)
const STATE_HEADER_BYTES = 5;  // playerCount(1) + enemyCount(2) + bulletCount(2)
const PLAYER_BYTES = 19;       // id(1) + u(4) + v(4) + aim(4) + score(4) + flags(2)
const ENEMY_BYTES = 11;        // id(2) + type(1) + u(4) + v(4)
const BULLET_BYTES = 14;       // id(2) + u(4) + v(4) + dirX(2) + dirY(2)

interface SerializablePlayer {
  index: number;       // 0-3 player slot
  surfaceU: number;
  surfaceV: number;
  aimAngle: number;
  score: number;
  alive: boolean;
  shooting: boolean;
}

interface SerializableEnemy {
  id: number;          // numeric hash
  type: number;        // enum index
  surfaceU: number;
  surfaceV: number;
}

interface SerializableBullet {
  id: number;
  surfaceU: number;
  surfaceV: number;
  dirX: number;
  dirY: number;
}

/**
 * Serialize a full game state snapshot into an ArrayBuffer.
 */
function serializeState(
  sequence: number,
  players: SerializablePlayer[],
  enemies: SerializableEnemy[],
  bullets: SerializableBullet[],
): ArrayBuffer {
  const totalBytes = HEADER_BYTES + STATE_HEADER_BYTES
    + players.length * PLAYER_BYTES
    + enemies.length * ENEMY_BYTES
    + bullets.length * BULLET_BYTES;

  const buffer = new ArrayBuffer(totalBytes);
  const view = new DataView(buffer);
  let offset = 0;

  // Header
  view.setUint8(offset, PACKET_TYPE.STATE_UPDATE); offset += 1;
  view.setUint32(offset, sequence, true); offset += 4;

  // State header
  view.setUint8(offset, players.length); offset += 1;
  view.setUint16(offset, enemies.length, true); offset += 2;
  view.setUint16(offset, bullets.length, true); offset += 2;

  // Players
  for (const p of players) {
    view.setUint8(offset, p.index); offset += 1;
    view.setFloat32(offset, p.surfaceU, true); offset += 4;
    view.setFloat32(offset, p.surfaceV, true); offset += 4;
    view.setFloat32(offset, p.aimAngle, true); offset += 4;
    view.setUint32(offset, p.score, true); offset += 4;
    const flags = (p.alive ? 1 : 0) | (p.shooting ? 2 : 0);
    view.setUint16(offset, flags, true); offset += 2;
  }

  // Enemies
  for (const e of enemies) {
    view.setUint16(offset, e.id, true); offset += 2;
    view.setUint8(offset, e.type); offset += 1;
    view.setFloat32(offset, e.surfaceU, true); offset += 4;
    view.setFloat32(offset, e.surfaceV, true); offset += 4;
  }

  // Bullets
  for (const b of bullets) {
    view.setUint16(offset, b.id, true); offset += 2;
    view.setFloat32(offset, b.surfaceU, true); offset += 4;
    view.setFloat32(offset, b.surfaceV, true); offset += 4;
    view.setInt16(offset, Math.round(b.dirX * 32767), true); offset += 2; // normalized to int16
    view.setInt16(offset, Math.round(b.dirY * 32767), true); offset += 2;
  }

  return buffer;
}

/**
 * Deserialize a state update from an ArrayBuffer.
 */
function deserializeState(buffer: ArrayBuffer): {
  sequence: number;
  players: SerializablePlayer[];
  enemies: SerializableEnemy[];
  bullets: SerializableBullet[];
} {
  const view = new DataView(buffer);
  let offset = 0;

  // Header
  const packetType = view.getUint8(offset); offset += 1;
  if (packetType !== PACKET_TYPE.STATE_UPDATE) {
    throw new Error(`Expected state update packet, got ${packetType}`);
  }
  const sequence = view.getUint32(offset, true); offset += 4;

  // State header
  const playerCount = view.getUint8(offset); offset += 1;
  const enemyCount = view.getUint16(offset, true); offset += 2;
  const bulletCount = view.getUint16(offset, true); offset += 2;

  // Players
  const players: SerializablePlayer[] = [];
  for (let i = 0; i < playerCount; i++) {
    const index = view.getUint8(offset); offset += 1;
    const surfaceU = view.getFloat32(offset, true); offset += 4;
    const surfaceV = view.getFloat32(offset, true); offset += 4;
    const aimAngle = view.getFloat32(offset, true); offset += 4;
    const score = view.getUint32(offset, true); offset += 4;
    const flags = view.getUint16(offset, true); offset += 2;
    players.push({
      index,
      surfaceU,
      surfaceV,
      aimAngle,
      score,
      alive: (flags & 1) !== 0,
      shooting: (flags & 2) !== 0,
    });
  }

  // Enemies
  const enemies: SerializableEnemy[] = [];
  for (let i = 0; i < enemyCount; i++) {
    const id = view.getUint16(offset, true); offset += 2;
    const type = view.getUint8(offset); offset += 1;
    const surfaceU = view.getFloat32(offset, true); offset += 4;
    const surfaceV = view.getFloat32(offset, true); offset += 4;
    enemies.push({ id, type, surfaceU, surfaceV });
  }

  // Bullets
  const bullets: SerializableBullet[] = [];
  for (let i = 0; i < bulletCount; i++) {
    const id = view.getUint16(offset, true); offset += 2;
    const surfaceU = view.getFloat32(offset, true); offset += 4;
    const surfaceV = view.getFloat32(offset, true); offset += 4;
    const dirXRaw = view.getInt16(offset, true); offset += 2;
    const dirYRaw = view.getInt16(offset, true); offset += 2;
    bullets.push({
      id,
      surfaceU,
      surfaceV,
      dirX: dirXRaw / 32767,
      dirY: dirYRaw / 32767,
    });
  }

  return { sequence, players, enemies, bullets };
}

/**
 * Serialize player input (sent from peer to host).
 */
function serializeInput(
  sequence: number,
  moveX: number,
  moveY: number,
  aimAngle: number,
  shooting: boolean,
  bomb: boolean,
): ArrayBuffer {
  const buffer = new ArrayBuffer(HEADER_BYTES + 11);
  const view = new DataView(buffer);

  view.setUint8(0, PACKET_TYPE.INPUT);
  view.setUint32(1, sequence, true);
  view.setFloat32(5, moveX, true);
  view.setFloat32(9, moveY, true);
  // Aim angle not needed every frame -- pack into 2 bytes (65536 angles = <0.01 degree precision)
  // Actually let's use Float32 for simplicity
  // We have room -- input packets are tiny
  // Redefine: 5 header + 4 moveX + 4 moveY + 4 aimAngle + 1 flags = 18 bytes

  // Let me redo this properly:
  const inputBuffer = new ArrayBuffer(HEADER_BYTES + 13);
  const inputView = new DataView(inputBuffer);
  inputView.setUint8(0, PACKET_TYPE.INPUT);
  inputView.setUint32(1, sequence, true);
  inputView.setFloat32(5, moveX, true);
  inputView.setFloat32(9, moveY, true);
  inputView.setFloat32(13, aimAngle, true);
  const flags = (shooting ? 1 : 0) | (bomb ? 2 : 0);
  inputView.setUint8(17, flags);

  return inputBuffer;
}
```

### 9.3 Signaling via Room Code (PeerJS-based)

```typescript
/**
 * Simple PeerJS-based signaling for WebRTC game rooms.
 *
 * Dependencies: npm install peerjs
 *
 * Host flow:
 *   1. Create PeerJS peer with a generated room code as the ID
 *   2. Display room code to user
 *   3. Wait for incoming connections
 *
 * Joiner flow:
 *   1. Create PeerJS peer (auto-generated ID)
 *   2. Connect to the room code (host's peer ID)
 *   3. DataChannel established automatically by PeerJS
 */
import Peer, { DataConnection } from 'peerjs';

// Generate a human-readable room code (4 chars, e.g., "GWAR")
function generateRoomCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // No I or O (confusable)
  let code = '';
  for (let i = 0; i < 4; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

// Prefix to namespace our peer IDs on the PeerJS cloud
const PEER_PREFIX = 'geowars3d-';

interface RoomCallbacks {
  onPeerConnected: (peerId: string, conn: DataConnection) => void;
  onPeerDisconnected: (peerId: string) => void;
  onError: (error: Error) => void;
}

/**
 * Create a game room (host side).
 */
async function hostRoom(callbacks: RoomCallbacks): Promise<{
  roomCode: string;
  peer: Peer;
  destroy: () => void;
}> {
  const roomCode = generateRoomCode();
  const peerId = PEER_PREFIX + roomCode;

  return new Promise((resolve, reject) => {
    const peer = new Peer(peerId, {
      // Use PeerJS cloud (free) or self-hosted:
      // host: 'your-peerjs-server.com', port: 9000, path: '/myapp'
    });

    peer.on('open', () => {
      console.log(`[Host] Room created: ${roomCode}`);

      peer.on('connection', (conn) => {
        console.log(`[Host] Peer connected: ${conn.peer}`);
        conn.on('open', () => {
          callbacks.onPeerConnected(conn.peer, conn);
        });
        conn.on('close', () => {
          callbacks.onPeerDisconnected(conn.peer);
        });
        conn.on('error', (err) => {
          callbacks.onError(err);
        });
      });

      resolve({
        roomCode,
        peer,
        destroy: () => peer.destroy(),
      });
    });

    peer.on('error', (err) => {
      reject(err);
    });
  });
}

/**
 * Join a game room (peer side).
 */
async function joinRoom(
  roomCode: string,
  callbacks: RoomCallbacks,
): Promise<{
  conn: DataConnection;
  peer: Peer;
  destroy: () => void;
}> {
  const hostPeerId = PEER_PREFIX + roomCode.toUpperCase();

  return new Promise((resolve, reject) => {
    const peer = new Peer(); // Auto-generated ID

    peer.on('open', () => {
      const conn = peer.connect(hostPeerId, {
        reliable: true, // PeerJS default; we'll create custom DataChannels for unreliable
        serialization: 'none', // We handle our own serialization
      });

      conn.on('open', () => {
        console.log(`[Peer] Connected to room ${roomCode}`);
        callbacks.onPeerConnected(hostPeerId, conn);
        resolve({
          conn,
          peer,
          destroy: () => peer.destroy(),
        });
      });

      conn.on('close', () => {
        callbacks.onPeerDisconnected(hostPeerId);
      });

      conn.on('error', (err) => {
        callbacks.onError(err);
        reject(err);
      });
    });

    peer.on('error', (err) => {
      reject(err);
    });
  });
}
```

### 9.4 WebRTC Host Integration (Sketch)

```typescript
/**
 * WebRTCHost: Runs GameSimulation in the browser and serves state to peers.
 *
 * This replaces the Colyseus GameRoom for peer-to-peer mode.
 */

interface PeerConnection {
  peerId: string;
  rtcConnection: RTCPeerConnection;
  stateChannel: RTCDataChannel;   // unreliable: position updates
  eventChannel: RTCDataChannel;   // reliable: kills, spawns, pickups
  playerId: string;
}

class WebRTCHost {
  private simulation: GameSimulation;
  private peers: Map<string, PeerConnection> = new Map();
  private sequence: number = 0;
  private tickInterval: number | null = null;

  // Tick rates
  private readonly TICK_RATE = 60;         // Simulation rate
  private readonly STATE_SEND_RATE = 30;   // State broadcast rate
  private tickCount = 0;

  constructor(surfaceType: string) {
    this.simulation = new GameSimulation(surfaceType);
  }

  /** Start the game simulation loop */
  start(): void {
    this.simulation.startGame();

    this.tickInterval = window.setInterval(() => {
      this.tickCount++;

      // Run simulation
      this.simulation.tick(1 / this.TICK_RATE);

      // Broadcast state at lower rate
      if (this.tickCount % (this.TICK_RATE / this.STATE_SEND_RATE) === 0) {
        this.broadcastState();
      }
    }, 1000 / this.TICK_RATE);
  }

  /** Add a connected peer */
  addPeer(peer: PeerConnection): void {
    this.peers.set(peer.peerId, peer);

    // Add player to simulation
    peer.playerId = this.simulation.addPlayer(peer.peerId);

    // Listen for input from peer
    peer.stateChannel.onmessage = (event: MessageEvent) => {
      const input = deserializeInput(event.data as ArrayBuffer);
      this.simulation.applyInput(peer.playerId, input);
    };

    // Send initial state on reliable channel
    peer.eventChannel.send(JSON.stringify({
      type: 'init',
      playerId: peer.playerId,
      surfaceType: this.simulation.surfaceType,
    }));
  }

  /** Broadcast current state to all peers */
  private broadcastState(): void {
    const state = this.simulation.getState();
    const buffer = serializeState(
      this.sequence++,
      state.players,
      state.enemies,
      state.bullets,
    );

    for (const peer of this.peers.values()) {
      if (peer.stateChannel.readyState === 'open') {
        try {
          peer.stateChannel.send(buffer);
        } catch {
          // Channel may have closed; remove on next check
        }
      }
    }
  }

  /** Send a reliable event to all peers */
  broadcastEvent(event: GameEvent): void {
    const json = JSON.stringify(event);
    for (const peer of this.peers.values()) {
      if (peer.eventChannel.readyState === 'open') {
        peer.eventChannel.send(json);
      }
    }
  }

  /** Stop the simulation */
  stop(): void {
    if (this.tickInterval !== null) {
      clearInterval(this.tickInterval);
      this.tickInterval = null;
    }
    for (const peer of this.peers.values()) {
      peer.rtcConnection.close();
    }
    this.peers.clear();
  }
}
```

### 9.5 Delta Compression (Optional Optimization)

For further bandwidth reduction, only send fields that changed since the last acknowledged state:

```typescript
/**
 * Delta-compressed state update.
 *
 * Instead of sending all 50 enemy positions every frame,
 * track which enemies moved since the last ACK and only send those.
 *
 * Packet format:
 *   [header]
 *   [uint16: changed enemy count]
 *   [uint16: enemy id, float32: u, float32: v] * changed count
 *
 * Typical scenario: 50 enemies, 30 moved this tick
 * Full update:   50 * 11 = 550 bytes
 * Delta update:  30 * 10 = 300 bytes + 2 byte count header = 302 bytes
 * Savings: ~45%
 */
function serializeDeltaState(
  sequence: number,
  previousState: Map<number, { u: number; v: number }>,
  currentEnemies: SerializableEnemy[],
  threshold: number = 0.001, // Minimum UV change to include
): { buffer: ArrayBuffer; newState: Map<number, { u: number; v: number }> } {

  const changed: SerializableEnemy[] = [];
  const newState = new Map<number, { u: number; v: number }>();

  for (const enemy of currentEnemies) {
    newState.set(enemy.id, { u: enemy.surfaceU, v: enemy.surfaceV });

    const prev = previousState.get(enemy.id);
    if (!prev
      || Math.abs(prev.u - enemy.surfaceU) > threshold
      || Math.abs(prev.v - enemy.surfaceV) > threshold
    ) {
      changed.push(enemy);
    }
  }

  // Serialize only changed enemies
  const buffer = new ArrayBuffer(HEADER_BYTES + 2 + changed.length * ENEMY_BYTES);
  const view = new DataView(buffer);
  // ... (serialize as before, but only changed entries)

  return { buffer, newState };
}
```

---

## 10. Risk Assessment and Trade-offs

### Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| Host browser tab closure kills the game | Medium | Same as current behavior (Colyseus host disconnect = game over). Add auto-save/rejoin. |
| Host's CPU is loaded (game logic + rendering) | Low | Game logic is <1ms per tick. Can offload to Web Worker if needed. |
| WebRTC connection failures on strict NATs | Medium | Use TURN server as fallback (~15% of users need it). Free tiers available. |
| PeerJS cloud goes down | Low | Self-host PeerJS (trivial) or switch to manual signaling. |
| Browser compatibility | Low | WebRTC DataChannel is supported in all modern browsers (Chrome, Firefox, Safari, Edge) since 2017. |
| Cheating (host can cheat) | Low | Same as current architecture (server is authoritative, host IS the server). No change in trust model. |
| >4 players | Low | Host-peer scales to ~8 players before DataChannel bandwidth becomes a concern. Our target is 2-4. |

### What We Lose

1. **Colyseus Schema auto-patching**: Must implement custom serialization. This is more work but gives more control and better performance.
2. **Server-side persistence**: No central server to store replays, leaderboards. Can add a separate API for this.
3. **Matchmaking infrastructure**: PeerJS room codes replace Colyseus room listing. For a lobby browser, need a signaling server.
4. **Hot-reloading server logic**: Currently can restart the Colyseus server without restarting clients. With WebRTC, the host IS a client.

### What We Gain

See [Section 8: Benefits Summary](#8-benefits-summary).

### Decision: When to Use Which

| Scenario | Recommended Transport |
|----------|-----------------------|
| LAN party (2-4 players, same network) | **WebRTC** -- zero setup, lowest latency |
| Casual internet play (share link with friend) | **WebRTC + PeerJS signaling** -- zero infrastructure |
| Competitive/ranked play | **Colyseus dedicated server** -- trusted authority, no host advantage |
| Steam release (desktop app) | **WebRTC** primary, **Colyseus** optional for dedicated servers |
| Tournament with spectators | **Colyseus** -- server can relay to spectator clients |
| Mobile browser | **WebRTC** -- works in mobile Chrome/Safari |

---

## 11. Recommended Migration Phases

### Phase 1: Extract Game Logic (Effort: 1-2 days)

- Create `src/game/GameSimulation.ts` by copying `GameRoom.ts` logic
- Remove all Colyseus imports (`Schema`, `MapSchema`, `ArraySchema`, `Room`, `Client`)
- Replace Schema classes with plain TypeScript interfaces
- Replace `this.onMessage()` with `applyInput()` method
- Replace `this.broadcast()` with callback interface
- Add `getState()` method that returns current state snapshot
- **Test**: Verify that `GameSimulation` produces identical behavior to `GameRoom` using existing tests as reference

### Phase 2: Binary Serialization (Effort: 1 day)

- Create `src/game/BinarySerializer.ts`
- Implement `serializeState()` and `deserializeState()`
- Implement `serializeInput()` and `deserializeInput()`
- Implement reliable event serialization (JSON is fine for these -- they are infrequent)
- **Test**: Round-trip serialization tests (serialize -> deserialize -> compare)

### Phase 3: WebRTC Transport (Effort: 2-3 days)

- Create `src/network/WebRTCHost.ts`
- Create `src/network/WebRTCPeer.ts`
- Create `src/network/Signaling.ts` (start with PeerJS, simplest)
- Create `src/webrtc-main.ts` entry point
- Wire up: host runs `GameSimulation`, broadcasts via DataChannel, peers render
- **Test**: Two browser tabs on localhost, verify gameplay works

### Phase 4: UI Integration (Effort: 1 day)

- Add "Host Game (P2P)" and "Join Game" buttons to `StartMenu`
- Display room code when hosting
- Add room code input field for joining
- Add connection status indicator
- Keep existing "LAN Host" button for Colyseus mode (fallback)

### Phase 5: Polish and Edge Cases (Effort: 1-2 days)

- Handle peer disconnection gracefully
- Handle host disconnection (show "Host left" message)
- Add reconnection logic (optional)
- Test on different networks (LAN, Wi-Fi, internet)
- Test NAT traversal (connect between two different networks)
- Add TURN server configuration for strict NAT fallback

### Phase 6 (Optional): Electron Packaging

- Set up Electron builder
- Verify WebRTC works inside Electron
- Add Steam SDK integration
- Build installer/package

### Total Estimated Effort: 6-9 days

The heaviest lift is Phase 1 (extracting game logic from Colyseus) and Phase 3 (WebRTC transport). Phase 2 is mechanical. Phases 4-5 are standard UI/integration work.

---

## Appendix A: Library Options

| Library | Purpose | Size | Notes |
|---------|---------|------|-------|
| [PeerJS](https://peerjs.com/) | Signaling + simplified WebRTC | ~50KB | Free cloud signaling, wraps RTCPeerConnection |
| [simple-peer](https://github.com/feross/simple-peer) | Simplified WebRTC wrapper | ~20KB | Lightweight, BYO signaling, widely used |
| [trystero](https://github.com/dmotz/trystero) | Serverless WebRTC rooms | ~10KB | Uses BitTorrent/IPFS/Firebase for signaling, zero server |
| Raw `RTCPeerConnection` | Native browser API | 0KB | Full control, more code to write |
| [geckos.io](https://github.com/geckosio/geckos.io) | UDP-like game networking | ~30KB | Built specifically for games, WebRTC-based |

**Recommendation**: Start with **simple-peer** for maximum control with minimal abstraction, or **PeerJS** for fastest time to working prototype. **geckos.io** is worth evaluating as it was designed specifically for game networking over WebRTC.

## Appendix B: Quick Reference -- Colyseus vs WebRTC

| Feature | Colyseus | WebRTC DataChannel |
|---------|----------|--------------------|
| Transport | TCP (WebSocket) | UDP-like (unreliable mode) or TCP-like (reliable mode) |
| Server required | Yes (Node.js) | No (browser-to-browser) |
| NAT traversal | No (manual port forwarding) | Yes (STUN/TURN) |
| Serialization | Schema (auto diff-patch) | Custom binary (ArrayBuffer) |
| Latency (LAN) | 2-3ms | 0.5-1ms |
| Latency (internet) | 30-50ms median, 80-200ms P99 | 20-40ms median, 40-60ms P99 |
| Head-of-line blocking | Yes (TCP) | No (unreliable mode) |
| Max reliable message size | Unlimited (TCP stream) | ~256KB per message (SCTP limit, chunking needed for larger) |
| Browser support | N/A (server-side) | All modern browsers since 2017 |
| Connection setup time | ~50ms (WebSocket handshake) | ~500ms-2s (ICE + DTLS negotiation) |
| Hosting cost | $5-20/month (Node.js server) | $0 (static hosting + free STUN) |
| Complexity | Lower (Colyseus handles plumbing) | Higher (manual serialization + signaling) |

## Appendix C: WebRTC Browser Support

| Browser | DataChannel Support | Notes |
|---------|-------------------|-------|
| Chrome/Edge | Full | Since Chrome 26 (2013) |
| Firefox | Full | Since Firefox 22 (2013) |
| Safari | Full | Since Safari 11 (2017) |
| iOS Safari | Full | Since iOS 11 (2017) |
| Chrome Android | Full | Since Chrome 28 (2013) |
| Electron | Full | Uses Chromium internally |
| Node.js | Via `wrtc` npm package | For dedicated server fallback |

**Conclusion:** WebRTC DataChannel has universal browser support. There are no compatibility concerns for any target platform.

---

## 12. Recommended Hybrid Approach: Colyseus + WebRTC Transport

After analysis, the **smartest migration path** is NOT full WebRTC (replacing Colyseus entirely) but rather keeping Colyseus and swapping only the transport layer. This gives us UDP benefits without losing server authority.

### Three Options Compared

| Approach | Server Needed? | UDP? | Cheat Protection | Migration Risk | Distribution |
|----------|---------------|------|-----------------|----------------|-------------|
| **Current (Colyseus + WebSocket)** | Yes (Node.js) | No (TCP only) | Yes (server authority) | None | Requires server hosting |
| **Colyseus + geckos.io (hybrid)** | Yes (Node.js) | Yes (WebRTC DataChannel) | Yes (server authority) | Low | Requires server hosting |
| **Full WebRTC (no server)** | No | Yes | No (host is a player) | High | GitHub Pages / static hosting |

### Why Hybrid is Best

1. **Lowest risk** — game logic stays identical, only transport changes
2. **Keep server authority** — no cheating concerns, consistent state
3. **Gain UDP** — unreliable channels for positions/aim (no head-of-line blocking)
4. **Gain lower latency** — WebRTC DataChannel ~1-3ms LAN vs WebSocket ~5-10ms
5. **Dual channels** — unreliable for high-frequency data (positions), reliable for events (kills, scores)
6. **geckos.io** handles signaling, STUN/TURN, and NAT traversal automatically

### What is geckos.io?

geckos.io is a real-time client/server library that uses WebRTC DataChannels instead of WebSocket. It provides:
- A Node.js server component (replaces or wraps the WebSocket layer)
- A browser client component (replaces the WebSocket connection)
- Unreliable + reliable channel support out of the box
- Built-in signaling (no separate signaling server needed)
- Automatic STUN/TURN handling

### Integration with Colyseus

Two possible approaches:
1. **Replace Colyseus transport**: Use geckos.io as a custom Colyseus transport (Colyseus supports custom transports)
2. **Replace Colyseus entirely**: Use geckos.io directly as the networking layer with custom state sync

Option 1 is cleaner if Colyseus supports it. Option 2 gives more control but requires reimplementing state sync.

### Performance Expectations

| Metric | WebSocket (current) | WebRTC DataChannel (hybrid) |
|--------|--------------------|-----------------------------|
| LAN median latency | 5-10ms | 1-3ms |
| LAN P99 latency | 30-50ms | 5-10ms |
| Internet median | 30-80ms | 20-60ms |
| Packet loss handling | Retransmit + block (TCP) | Drop + continue (UDP) |
| Jitter | High during loss | Consistent |
| Bandwidth | JSON over text frames | Binary over SCTP |

### Next Step

Research geckos.io specifically: API, Colyseus compatibility, integration pattern. Then prototype on a branch.

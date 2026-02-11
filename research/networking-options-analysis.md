# Networking Architecture Analysis: Geometry Wars 3D

**Date:** 2026-02-12
**Purpose:** Comprehensive analysis of networking options for browser-based multiplayer 3D shooter
**Prior Research:** `research/geckos-webrtc-research.md` (2026-02-10), 11 LAN decision files
**Current Setup:** Colyseus ^0.15 (WebSocket/TCP), authoritative server, LAN broken through 10+ fix attempts

---

## Table of Contents

1. [Why LAN Keeps Breaking (Root Cause Analysis)](#1-why-lan-keeps-breaking)
2. [WebSocket vs WebRTC for Game Networking](#2-websocket-vs-webrtc)
3. [Server Architecture Options](#3-server-architecture-options)
4. [Networking Library Comparison Matrix](#4-networking-library-comparison)
5. [How Real Browser Games Do It](#5-how-real-browser-games-do-it)
6. [Binary Serialization & Bandwidth](#6-binary-serialization--bandwidth)
7. [Client-Side Prediction & Reconciliation](#7-client-side-prediction--reconciliation)
8. [Mobile & iOS Considerations](#8-mobile--ios-considerations)
9. [The "Instant Join" Problem](#9-the-instant-join-problem)
10. [Recommendations for Geometry Wars](#10-recommendations)
11. [Sources](#11-sources)

---

## 1. Why LAN Keeps Breaking

### It Is NOT a Colyseus Problem

After reviewing all 11 LAN decision files (`decisions/lan-*.md`), the 802-line `GameRoom.ts`, and the 1800+ line `network-main.ts`, the recurring failures are **architectural and implementation problems**, not Colyseus limitations.

### The Five Real Root Causes

#### Root Cause 1: Three Separate Game Implementations

The game has three entry points with duplicated logic:
- `src/main.ts` -- single player
- `src/multiplayer-main.ts` -- local co-op (1347 lines)
- `src/network-main.ts` -- LAN multiplayer (1800+ lines)

Each has its own camera setup, surface initialization, player creation, input handling, and audio init. A bug fix in one does NOT propagate to the others. This is the single biggest cause of regressions.

**Evidence:** The `lan-deep-audit-2026-02-11.md` Issue #8 identifies this explicitly. The `InputManager.blur` fix had to be manually ported to `network-main.ts`. Camera fixes in `PlaygroundGame.ts` (6 REGRESSION GUARD comments) have no equivalent in the network code path.

#### Root Cause 2: Physics Mismatch Between Server and Client

The server (`GameRoom.ts`) runs simplified 2D UV-space physics:
```
player.surfaceU = wrapCoord(player.surfaceU + correctedDx)
player.surfaceV = clamp(player.surfaceV + dy, vMin, vMax)
```

The client prediction (`network-main.ts`) attempts to match this but uses different constants, different wrapping logic, and different sin(phi) corrections. This mismatch causes **rubber-banding** -- the client predicts one position, the server corrects to another, and the player visually snaps.

**Evidence:** `lan-deep-audit-2026-02-11.md` Issue #4 documents that client prediction physics differs from server physics. The server uses epsilon clamping for cube (0.003) while the client uses different values.

#### Root Cause 3: Missing Interpolation for Key Entities

Players and enemies are interpolated in `onRender()`, but **bullets and geoms snap directly to server positions** in `onStateChange()`. At 30Hz patch rate, this creates visible 33ms stutters for bullets while everything else appears smooth.

**Evidence:** `lan-deep-audit-2026-02-11.md` Issue #3. In co-op, bullets move every frame via `bulletPool.update()`. In LAN, bullets only move when the server sends a patch.

#### Root Cause 4: Surface Type Race Condition

The `GameState.surfaceType` defaults to `'sphere'` in the schema constructor. When a host creates a room with `surfaceType: 'cube'`, there is a window where clients connecting immediately read the stale default. The client creates the wrong surface and may not rebuild when the correct type arrives.

**Evidence:** `lan-deep-audit-2026-02-11.md` Issue #2 reproduces this step-by-step.

#### Root Cause 5: UV-Space Collision Detection on Curved Surfaces

The server uses Euclidean distance in UV space for ALL collision detection:
```typescript
const dist = Math.sqrt(du*du + dv*dv);
```

On a sphere, points at U=0.01 and U=0.99 are adjacent (wrapping), but UV distance is 0.98. On any non-flat surface, UV distance does not equal world distance. This causes bullets to miss and enemies to not collide.

**Evidence:** `lan-deep-audit-2026-02-11.md` Issue #10.

### Is WebSocket TCP Latency an Issue?

**For LAN: No.** WebSocket round-trip on a local network is 1-5ms. TCP head-of-line blocking is negligible at <1% packet loss on wired LAN. The user's "laggy and weird" experience is caused by the five root causes above, not by the transport protocol.

**For Internet play: Potentially.** On a 2% packet-loss Wi-Fi connection, TCP can cause 2-4 visible hitches per second due to head-of-line blocking. WebRTC DataChannel with `ordered: false, maxRetransmits: 0` eliminates this entirely.

### Typical Round-Trip Latency

| Network Condition | WebSocket (TCP) | WebRTC DataChannel (UDP-like) | Delta |
|-------------------|-----------------|-------------------------------|-------|
| LAN (wired) | 1-5ms | 1-3ms | Negligible |
| LAN (Wi-Fi) | 3-10ms | 2-5ms | 1-5ms |
| Internet (good) | 30-80ms | 20-60ms | 10-20ms |
| Internet (Wi-Fi, 2% loss) | 80-200ms (HOL blocking) | 40-60ms | 40-140ms |

**Bottom line:** Switching transport protocol is NOT the fix for LAN. The fix is architectural (shared game logic, correct physics, proper interpolation).

### Known Colyseus Issues with Frequent State Updates

Colyseus uses `@colyseus/schema` for incremental binary delta compression. Only changed properties are sent each patch cycle. At 60Hz patch rate (`setPatchRate(16)`), this is efficient for LAN where bandwidth is abundant. However:

- **Default patch rate is 50ms (20Hz).** The project uses `setPatchRate(16)` (60Hz) which is correct for LAN.
- **Schema has a 64-field limit per structure.** `GameState` has 12 top-level fields, well within limits.
- **ArraySchema operations (push/splice) generate larger patches** than property updates. With 50 enemies + 20 bullets changing position each tick, the patch payload can be 2-5KB per cycle.
- **No interpolation is built into Colyseus.** The client receives discrete state snapshots. Smooth rendering requires client-side interpolation (which is partially missing -- see Root Cause 3).

---

## 2. WebSocket vs WebRTC

### Protocol Comparison

```
WebSocket (current):
  Browser --[TCP]-- Server --[TCP]-- Browser

  Reliable, ordered delivery
  Head-of-line blocking on packet loss
  Built into every browser since 2010
  Single connection, low overhead

WebRTC DataChannel:
  Browser --[SCTP/DTLS/UDP]-- Server --[SCTP/DTLS/UDP]-- Browser
    OR
  Browser --[SCTP/DTLS/UDP]-- Browser  (peer-to-peer)

  Configurable: reliable OR unreliable, ordered OR unordered
  No head-of-line blocking in unreliable mode
  Requires ICE negotiation (STUN/TURN for NAT traversal)
  More complex setup, higher connection time
```

### What WebRTC Gives Over WebSocket for Games

| Feature | WebSocket | WebRTC DataChannel |
|---------|-----------|-------------------|
| Transport | TCP only | UDP-like (configurable) |
| Head-of-line blocking | Yes (TCP retransmits block queue) | No (unreliable mode drops lost packets) |
| Connection time | 1 HTTP upgrade (fast) | ICE negotiation, 100-500ms typical |
| Peer-to-peer | No (requires server) | Yes (direct browser-to-browser) |
| NAT traversal | N/A (server has public IP) | Requires STUN; TURN for symmetric NAT |
| LAN without internet | Works (direct IP) | Works (host ICE candidates, no STUN needed) |
| Binary data | Yes (ArrayBuffer) | Yes (ArrayBuffer) |
| Compression | Per-message deflate (optional) | SCTP bundling, custom |
| Browser support | Universal (all browsers since 2010) | Chrome, Firefox, Safari, Edge (since 2017) |
| iOS support | Full | Limited (requires TURN for many scenarios) |
| Typical LAN latency | 1-5ms | 1-3ms |
| Typical internet jitter | 5-15ms std dev | 1-3ms std dev |

### When WebRTC Is Worth It

**Worth it when:**
- Internet play with potentially lossy connections (Wi-Fi, mobile)
- Peer-to-peer is desired (no server infrastructure)
- Sub-3ms jitter matters (competitive FPS)

**NOT worth it when:**
- LAN only (TCP works fine at <1% loss)
- Server infrastructure already exists (Colyseus)
- iOS support is critical (WebRTC has quirks)
- Connection speed matters ("scan QR, play instantly" -- WebRTC adds 100-500ms)

### Latency Improvement Numbers

From real-world measurements across multiple sources:

- **Median latency improvement:** 10-20ms on internet, negligible on LAN
- **Jitter improvement:** 3-5x reduction (most impactful benefit)
- **Worst-case improvement:** TCP can spike to 200ms on 2% loss; WebRTC stays at 40-60ms
- **Connection establishment:** WebSocket ~50ms, WebRTC ~300-500ms (ICE negotiation)

---

## 3. Server Architecture Options

### Architecture A: Authoritative Server (Current -- Colyseus)

```
        +-------------------+
        | Colyseus Server   |
        | - Game logic      |
        | - State authority  |
        | - 60Hz tick       |
        +---+--------+------+
            |        |
         WS/TCP   WS/TCP
            |        |
      +-----+--+ +---+------+
      |Client A| |Client B  |
      |Renderer| |Renderer  |
      +--------+ +----------+
```

**How it works:** Server runs all game logic. Clients send input, receive state. Server is the single source of truth.

**Pros:**
- Anti-cheat: clients cannot manipulate state
- Deterministic: all clients see the same reality
- Simple client code: just render what server says
- Well-suited for competitive games

**Cons:**
- Requires server infrastructure
- Added latency (input -> server -> response)
- Server is single point of failure
- Server CPU scales with entity count

**Best for:** Competitive games, internet play, anti-cheat requirements

#### Architecture B: Client-Authoritative / Hybrid

```
        +-------------------+
        | Validation Server |
        | - Checks limits   |
        | - Anti-cheat      |
        | - No game logic   |
        +---+--------+------+
            |        |
         WS/TCP   WS/TCP
            |        |
      +-----+--+ +---+------+
      |Client A| |Client B  |
      |Own phys| |Own phys  |
      +--------+ +----------+
```

**How it works:** Each client runs its own physics. Server validates that positions/actions are legal but does not simulate. Clients trust each other for position data.

**Pros:**
- Zero input latency (local physics)
- Lower server CPU
- Simpler server code

**Cons:**
- Cheat vulnerability (client can send false positions)
- Desync risk (different clients may diverge)
- Conflict resolution is complex (who hit whom?)

**Best for:** Cooperative games where cheating does not matter, prototype/LAN

#### Architecture C: Peer-to-Peer (No Server)

```
      +--------+       +--------+
      |  Host  |<----->| Peer A |
      |  (P1)  |<----->| Peer B |
      +--------+       +--------+
         ^                  ^
         |   DataChannel    |
         +------------------+
```

**How it works:** One browser becomes the "host" and runs game logic. Other browsers connect directly via WebRTC DataChannel. No separate server process.

**Pros:**
- Zero infrastructure (deploy to GitHub Pages)
- Lowest LAN latency (direct connection)
- No server to maintain or kill
- Perfect for "scan QR code, play instantly"

**Cons:**
- Host advantage (zero latency for host player)
- Host disconnect = game over
- No anti-cheat (host controls everything)
- NAT traversal needed for internet (STUN/TURN)
- Max ~4-6 players (host bandwidth limits)

**Best for:** Small groups (2-4 players), LAN parties, casual play

#### Architecture D: Relay Server (Message Forwarder)

```
        +-------------------+
        | Relay Server      |
        | - No game logic   |
        | - Just forwards   |
        | - messages        |
        +---+--------+------+
            |        |
         WS/TCP   WS/TCP
            |        |
      +-----+--+ +---+------+
      |Client A| |Client B  |
      |Host    | |Peer      |
      +--------+ +----------+
```

**How it works:** Server is a dumb pipe. One client is the "host" (runs game logic). Server just relays messages. Eliminates NAT traversal while keeping host-authoritative model.

**Pros:**
- Simple server (10-20 lines of relay code)
- No NAT issues (all clients connect to server)
- Host can change without reconnecting
- Works everywhere WebSocket works

**Cons:**
- Added hop (client -> server -> client vs. direct P2P)
- Host advantage still exists
- Server is still infrastructure to maintain

**Best for:** Internet play where NAT traversal is problematic, simple deployment

### Which Is Best for Geometry Wars?

| Criterion | Auth. Server | Client-Auth | P2P | Relay |
|-----------|:---:|:---:|:---:|:---:|
| LAN 2-4 players | Good | Good | **Best** | Good |
| Internet play | **Best** | Medium | Medium | Good |
| Anti-cheat | **Best** | Poor | Poor | Poor |
| No infrastructure | No | No | **Yes** | No |
| Connection speed | Fast | Fast | Slow (ICE) | Fast |
| iOS support | **Best** | **Best** | Limited | **Best** |
| Code complexity | Medium | Low | High | Low |
| "QR code, play instantly" | Medium | Medium | **Best** | Medium |

**Recommendation for Geometry Wars:**

1. **For LAN (primary use case):** P2P with host-as-authority. One browser runs the game, others connect directly. No server process needed. This eliminates the "zombie server" problem entirely.

2. **For future internet play:** Keep Colyseus as a fallback / upgrade path. The authoritative server model is correct for competitive internet play.

3. **Dual-mode approach:** P2P for LAN, Colyseus for internet. Different code paths but shared game logic (extracted into a `GameSession` class).

---

## 4. Networking Library Comparison

### Full Comparison Matrix

| Library | Type | Protocol | Weekly DL | Maintained | Auth. Server | P2P | Mobile | Complexity | Game-Specific |
|---------|------|----------|-----------|-----------|:---:|:---:|:---:|:---:|:---:|
| **Colyseus** | Framework | WebSocket/TCP | 14K | Active | Yes | No | Full | Medium | Yes |
| **Nakama** | Framework | WebSocket/TCP | 5K | Active (Go) | Yes | No | Full | High | Yes |
| **Socket.io** | Library | WebSocket/TCP | 5.2M | Active | DIY | No | Full | Low | No |
| **geckos.io** | Library | WebRTC/UDP | 642 | Low | Yes | No | Limited | Medium | Yes |
| **PeerJS** | Library | WebRTC | 34K | Stable | No | Yes | Limited | Low | No |
| **simple-peer** | Library | WebRTC | 175K | Active | No | Yes | Limited | Medium | No |
| **Trystero** | Library | WebRTC | ~500 | Active | No | Yes | Limited | Low | No |
| **PartyKit** | Platform | WebSocket | N/A | Active (CF) | Yes | No | Full | Low | No |
| **nengi.js** | Library | WebSocket | 197 | Slow | Yes | No | Full | High | Yes |
| **Lance.gg** | Framework | WebSocket | 131 | Inactive | Yes | No | Full | High | Yes |
| **NetplayJS** | Library | WebRTC | ~100 | Active | No | Yes | Limited | Low | Yes |
| **PlayPeerJS** | Library | WebRTC | ~50 | New | No | Yes | Limited | Low | Yes |

### Detailed Analysis of Top Contenders

#### Colyseus (Current)

- **Version:** ^0.15.57
- **Architecture:** Authoritative server, rooms, schema-based state sync
- **Serialization:** `@colyseus/schema` -- incremental binary delta compression
- **Strengths:** Mature, good TypeScript support, built-in matchmaking, rooms concept
- **Weaknesses:** WebSocket-only (TCP), no client prediction built-in, heavyweight for LAN
- **Verdict:** Solid for internet play. Overkill for LAN where you control the network.

#### Nakama

- **Language:** Go (server), TypeScript (client)
- **Architecture:** Authoritative server, realtime/reliable messaging, match handler
- **Strengths:** Very high performance (Go), built-in auth, leaderboards, chat, matchmaking
- **Weaknesses:** Steep learning curve, Go server code (different from Node.js ecosystem), heavyweight
- **Verdict:** Best for large-scale games (100+ concurrent). Overkill for 2-4 player LAN parties.

#### Socket.io

- **Type:** General-purpose WebSocket library
- **Architecture:** Event-based, rooms, namespaces
- **Strengths:** 5.2M weekly downloads, massive community, simple API
- **Weaknesses:** No game-specific features (no state sync, no delta compression, no tick loop)
- **Verdict:** Too low-level for game networking. You would rebuild Colyseus's features from scratch.

#### geckos.io

- **Type:** WebRTC DataChannel for client-server games
- **Architecture:** Socket.io-like API over WebRTC instead of WebSocket
- **Strengths:** UDP-like transport, dual channels (reliable + unreliable), built-in signaling
- **Weaknesses:** 642 weekly downloads, related packages marked "Inactive", uncertain future
- **Verdict:** Good concept, risky dependency. If it stalls, you inherit an unmaintained library.

#### PeerJS

- **Type:** WebRTC P2P abstraction
- **Architecture:** Peer-to-peer, free cloud signaling (PeerJS Cloud) or self-hosted
- **Strengths:** Simplest WebRTC API, 34K downloads, stable, free signaling
- **Weaknesses:** P2P only (no built-in authority), signaling cloud dependency
- **Verdict:** Best choice for P2P LAN mode. Simple, proven, well-maintained.

#### PartyKit

- **Type:** Edge computing platform (Cloudflare Workers + Durable Objects)
- **Architecture:** Serverless rooms, WebSocket, auto-scaling, hibernation
- **Strengths:** Zero infrastructure management, global edge deployment, auto-scaling
- **Weaknesses:** Cloud-dependent (no self-hosting), WebSocket only (TCP), cost at scale
- **Verdict:** Interesting for internet play (deploy server globally with zero ops). Not useful for LAN.

#### nengi.js

- **Type:** Game networking engine
- **Architecture:** Entity-component networking, automatic state sync, client prediction
- **Strengths:** Built-in prediction, interpolation, lag compensation. Designed for competitive shooters.
- **Weaknesses:** 197 weekly downloads, stuck on old WebSocket library (cWS.js), limited docs
- **Verdict:** Architecturally best-designed for this game's needs (fast-paced shooter). But too risky as a dependency given low adoption and stale WebSocket dependency.

#### Lance.gg

- **Type:** Full multiplayer game framework
- **Architecture:** Physics sync, interpolation, extrapolation, shadow objects
- **Strengths:** Built-in physics networking, automatic position interpolation
- **Weaknesses:** 131 weekly downloads, effectively inactive, last meaningful update years ago
- **Verdict:** Dead project. Do not use.

---

## 5. How Real Browser Games Do It

### Agar.io

- **Tech:** Node.js + WebSocket (Socket.io / custom)
- **Architecture:** Authoritative server, simple state broadcast
- **Players:** 100+ per server
- **Tick rate:** ~25Hz server, client interpolates
- **Serialization:** Custom binary protocol
- **Why it works:** Simple physics (2D circles), no prediction needed (movement is position-based), low entity interaction complexity

### Slither.io

- **Tech:** WebSocket, custom server
- **Architecture:** Authoritative server
- **Players:** 600 per server (the creator's biggest challenge was server stability at this scale)
- **Serialization:** Custom binary protocol (documented on GitHub)
- **Key insight:** The hardest part was finding affordable servers with enough capacity. Cloud services like AWS were too expensive for bandwidth.

### Krunker.io

- **Tech:** WebSocket, custom engine
- **Architecture:** Authoritative server, 13 global regions
- **Players:** 10M+ users, fast-paced FPS
- **Key features:** Client-side prediction, lag compensation, hit registration
- **Infrastructure:** Distributed servers across 13 regions for low latency
- **Why it matters for GW3D:** Krunker proves a browser FPS can work over WebSocket/TCP. The key is excellent client-side prediction, not UDP transport.

### Surviv.io (Battle Royale)

- **Tech:** Node.js + WebSocket
- **Architecture:** Authoritative server
- **Key insight:** Uses client-side prediction, interpolation, and potentially lag compensation over TCP/WebSocket. TCP worked fine for a competitive battle royale.

### Diep.io

- **Tech:** WebSocket, custom binary protocol
- **Architecture:** Authoritative server, tank combat
- **Key pattern:** All successful .io games use WebSocket (TCP). None use WebRTC.

### Common Pattern Across All .io Games

Every successful browser multiplayer game uses:
1. **WebSocket (TCP)** -- not WebRTC
2. **Authoritative server** -- server runs game logic
3. **Custom binary protocols** -- not JSON, not protobuf
4. **Client-side prediction** -- for responsive controls
5. **Entity interpolation** -- for smooth other-player rendering
6. **Regional servers** -- for internet latency

**The lesson:** TCP/WebSocket is sufficient for browser games, even competitive shooters (Krunker.io). The transport protocol is NOT the bottleneck. Client-side prediction and interpolation quality determine the player experience.

---

## 6. Binary Serialization & Bandwidth

### Serialization Format Comparison

| Format | Encode Speed | Decode Speed | Size | Schema Required | Browser Support | Zero-Copy |
|--------|:---:|:---:|:---:|:---:|:---:|:---:|
| **JSON** | Fast | Fast | Large (text) | No | Native | No |
| **Colyseus Schema** | Fast | Fast | Small (delta) | Yes | Client lib | No |
| **MessagePack** | Fast | Fast | ~30% smaller than JSON | No | npm library | No |
| **FlatBuffers** | Very fast | Instant | Small | Yes (.fbs) | npm library | **Yes** |
| **Protocol Buffers** | Fast | Fast | Small | Yes (.proto) | npm library | No |
| **Custom ArrayBuffer** | Fastest | Fastest | Smallest | Manual | Native | **Yes** |

### Bandwidth Calculations for Geometry Wars

Assume: 4 players, 50 enemies, 20 bullets, 30 geoms, 60Hz update rate

**Per-entity data:**
- Player: u(f32) + v(f32) + aimAngle(f32) + alive(u8) + score(u32) + weapon(u8) = 17 bytes
- Enemy: u(f32) + v(f32) + type(u8) + health(u8) + alive(u8) = 11 bytes
- Bullet: x(f32) + y(f32) + dirX(f32) + dirY(f32) = 16 bytes
- Geom: u(f32) + v(f32) + active(u8) = 9 bytes

**Full state snapshot:**
- 4 players x 17 bytes = 68 bytes
- 50 enemies x 11 bytes = 550 bytes
- 20 bullets x 16 bytes = 320 bytes
- 30 geoms x 9 bytes = 270 bytes
- Header + metadata = ~50 bytes
- **Total: ~1,258 bytes per snapshot**

**With delta compression (Colyseus Schema):**
- Typical frame: ~30% of entities change position
- Delta size: ~400-600 bytes per patch
- At 60Hz: 24-36 KB/s per client
- At 30Hz: 12-18 KB/s per client

**LAN bandwidth:** Even at 60Hz full snapshots (no delta), 1.258 KB * 60 = 75 KB/s per client. With 4 clients: 300 KB/s total. LAN bandwidth is 100+ Mbps. This is not a concern.

**Internet bandwidth:** With delta compression at 30Hz: 12-18 KB/s per client. Well within typical broadband connections.

### WebSocket Message Size Limits

The WebSocket protocol supports payloads up to 2^63 bytes (9.2 exabytes). There is no practical size limit for game state messages. Individual implementations may impose limits (e.g., 128 MiB in Deno), but 1-5 KB game state messages are trivially small.

### Recommendation

**For LAN:** Custom `ArrayBuffer` serialization with full snapshots at 60Hz. Simple, fast, no library dependency. Bandwidth is not a constraint on LAN.

**For Internet:** Colyseus Schema (current) or MessagePack with delta compression at 20-30Hz. The current approach is fine.

---

## 7. Client-Side Prediction & Reconciliation

### The Gabriel Gambetta Model (Industry Standard)

The definitive reference for browser game networking comes from [Gabriel Gambetta's series](https://www.gabrielgambetta.com/client-server-game-architecture.html):

```
Frame N:
  1. Client reads input (WASD, mouse)
  2. Client sends input to server with sequence number #N
  3. Client IMMEDIATELY applies input locally (prediction)
  4. Client stores input #N in pending buffer

Frame N+3 (server response arrives):
  1. Server says "after processing input #N, your position is (x, y)"
  2. Client accepts server position as authoritative
  3. Client REPLAYS inputs #N+1, #N+2 that server hasn't processed yet
  4. If predicted position matches server position: no visible correction
  5. If mismatch: smooth correction (lerp) to avoid snapping
```

### What Geometry Wars Gets Wrong

The current `network-main.ts` implements prediction only for movement (WASD). It does NOT predict:
- Aim angle updates (wait for server round-trip)
- Bomb usage (visual delay)
- Weapon switching (visual delay)
- Respawn position (snaps when server confirms)

Additionally, the prediction physics DIFFER from server physics:
- Client uses simplified wrapping; server uses epsilon-clamped wrapping
- Client does not match server's sin(phi) correction exactly
- This causes rubber-banding even on LAN

### Entity Interpolation (For Other Players)

For entities controlled by other players or the server (enemies, remote players), the correct approach is:

```
Server update at T=1000: Enemy at position A
Server update at T=1033: Enemy at position B

Client renders at T=1015:
  - Interpolate between A and B at ratio (1015-1000)/(1033-1000) = 0.45
  - Show enemy at lerp(A, B, 0.45)
  - This is 15ms "in the past" but visually smooth
```

The current code does this for players and enemies but NOT for bullets and geoms (Root Cause 3).

### Recommended Implementation

```typescript
// Prediction + Reconciliation pattern
interface PendingInput {
  sequence: number;
  input: PlayerInput;
  predictedU: number;
  predictedV: number;
}

const pendingInputs: PendingInput[] = [];
let inputSequence = 0;

function onTick() {
  const input = readInput();
  inputSequence++;

  // 1. Send to server
  sendInput({ ...input, sequence: inputSequence });

  // 2. Predict locally (MUST match server physics exactly)
  const predicted = applyInputLocally(input);

  // 3. Store for reconciliation
  pendingInputs.push({
    sequence: inputSequence,
    input,
    predictedU: predicted.u,
    predictedV: predicted.v,
  });
}

function onServerUpdate(state: ServerState) {
  // 1. Accept server position
  const serverU = state.playerU;
  const serverV = state.playerV;
  const lastProcessed = state.lastInputSequence;

  // 2. Discard inputs server has processed
  while (pendingInputs.length > 0 && pendingInputs[0].sequence <= lastProcessed) {
    pendingInputs.shift();
  }

  // 3. Re-apply unprocessed inputs on top of server state
  let u = serverU;
  let v = serverV;
  for (const pending of pendingInputs) {
    const result = applyInput(u, v, pending.input);
    u = result.u;
    v = result.v;
  }

  // 4. Smooth correction if mismatch
  const currentU = getDisplayedU();
  const correctedU = lerp(currentU, u, 0.3); // Smooth, not snap
}
```

### The Critical Requirement: Physics Must Match

The #1 cause of rubber-banding in prediction systems is mismatched physics. The client's `applyInput()` function MUST produce IDENTICAL results to the server's `handleInput()` for the same input. This means:

1. Extract movement logic into a shared module (e.g., `shared/physics.ts`)
2. Import it in BOTH server (`GameRoom.ts`) and client (`network-main.ts`)
3. Use identical constants (PLAYER_SPEED, V_MIN, V_MAX, sin(phi) correction)
4. Test that `server.move(input) === client.predict(input)` for all inputs

This is the single highest-impact improvement for perceived latency.

---

## 8. Mobile & iOS Considerations

### WebSocket on Mobile

| Platform | WebSocket Support | Notes |
|----------|:---:|-------|
| Chrome Android | Full | Since 2010 |
| Safari iOS | Full | Since iOS 4.2 |
| Firefox Android | Full | Since 2010 |
| Samsung Internet | Full | Chromium-based |

**WebSocket works universally on mobile.** No compatibility concerns.

### WebRTC DataChannel on Mobile

| Platform | DataChannel Support | Notes |
|----------|:---:|-------|
| Chrome Android | Full | Best mobile WebRTC support |
| Safari iOS | **Limited** | Requires TURN server for many scenarios |
| Firefox Android | Full | Good support |
| All iOS browsers | **Limited** | Apple mandates WebKit; all inherit Safari limitations |

**iOS Safari DataChannel Limitations:**
1. Does not expose "Host" ICE candidates by default (security restriction)
2. Many DataChannel scenarios require TURN relay, not just STUN
3. H.264 only codec restriction (irrelevant for DataChannel, but indicates Apple's conservative WebRTC stance)
4. Performance and throughput can vary compared to Chrome

**Impact on "QR code, play on phone":**
- If using WebSocket: works everywhere, no issues
- If using WebRTC P2P: works on Android; iOS requires TURN server for internet, works on LAN (local ICE candidates)

### Battery Impact

| Protocol | Battery Impact | Why |
|----------|:---:|-------|
| WebSocket | Low | Single TCP connection, kernel handles keep-alive |
| WebRTC DataChannel | Medium | DTLS encryption, SCTP processing, ICE keep-alive |
| WebRTC + TURN | High | Data relayed through server = more network I/O |

### Background Tab Handling

**Critical iOS behavior:** When a tab is backgrounded on iOS Safari, WebSocket connections are suspended after ~30 seconds. The OS may kill the connection entirely after 3-5 minutes.

**Mitigation:**
- Send periodic ping/pong to keep connection alive
- Auto-pause game when tab visibility changes (already implemented in `multiplayer-main.ts`)
- Reconnect logic with state catch-up on resume

**This applies equally to WebSocket and WebRTC.** Both are affected by iOS background tab killing.

---

## 9. The "Instant Join" Problem

The game's core UX promise: "Pull out your phone, scan this QR code, and everyone is playing instantly."

### Connection Time Breakdown

**WebSocket path:**
1. DNS resolution: 0ms (IP in QR code) or 50-100ms (hostname)
2. TCP handshake: 1 RTT (~1ms LAN, ~50ms internet)
3. WebSocket upgrade: 1 HTTP request (~2ms LAN, ~100ms internet)
4. Colyseus room join: 1 message (~2ms LAN, ~100ms internet)
5. Initial state sync: 1 full state message (~5ms)
**Total: ~10ms LAN, ~400ms internet**

**WebRTC P2P path:**
1. Signaling (get host's SDP): varies by method
   - PeerJS Cloud: ~250ms
   - Self-hosted signaling: ~100ms
   - QR code with embedded SDP: 0ms (but SDP is ~2KB, large QR code)
2. ICE negotiation: 100-500ms (STUN check, candidate pairing)
3. DTLS handshake: 1-2 RTTs
4. DataChannel open: ~10ms
**Total: ~200ms LAN (with local signaling), ~500-1000ms internet**

### Fastest Connection Path

For "scan QR code, playing in 3 seconds":

1. **QR code contains:** `http://192.168.1.5:3000?mode=network&server=ws://192.168.1.5:2567`
2. Phone opens URL in browser
3. Page loads (Vite bundle: ~500ms with caching, ~2s first load)
4. WebSocket connects: ~10ms on LAN
5. Room join + state sync: ~20ms
6. **Total: ~500ms (cached) to ~2s (first load)**

The bottleneck is NOT networking. It is **page load time** (downloading and parsing the JavaScript bundle). Optimizations:
- Service Worker for instant cache hit on repeat visits
- Code splitting: load networking code first, render code async
- PWA manifest for "Add to Home Screen" with instant launch
- Preload critical assets during QR code scan screen

### Can We Eliminate the Server for LAN?

**Yes, with P2P:**
1. Host opens game at `http://localhost:3000`
2. Host clicks "Host Game" -- game generates a room code (e.g., "ABCD")
3. QR code encodes: `http://192.168.1.5:3000?mode=p2p&host=geowars-ABCD`
4. Phone scans QR code, opens URL
5. JavaScript connects to host via PeerJS DataChannel
6. **No separate server process needed**

This eliminates:
- Server startup time
- Zombie server problems
- Port conflicts
- The `npm run server` step entirely

---

## 10. Recommendations

### Immediate Priority: Fix the Architecture (NOT the Transport)

The LAN problems are NOT caused by WebSocket/TCP. They are caused by:
1. Three separate game implementations with duplicated, divergent logic
2. Physics mismatch between server and client prediction
3. Missing interpolation for bullets and geoms
4. Surface type race condition
5. UV-space collision detection on curved surfaces

**Recommended immediate actions:**

1. **Extract shared game logic** into a `GameSession` class used by all three entry points. This prevents fixes in one mode from not applying to others. (Effort: 4-6 hours, Impact: prevents ALL future regressions)

2. **Extract physics into shared module** (`shared/physics.ts`) imported by both server and client. Ensures prediction matches server exactly. (Effort: 2 hours, Impact: eliminates rubber-banding)

3. **Add bullet/geom interpolation** in network-main.ts `onRender()`. (Effort: 30 min, Impact: eliminates bullet stutter)

4. **Fix surface type race condition** by delaying game start until server state is confirmed. (Effort: 1 hour, Impact: fixes wrong-map bug)

### Medium-Term: Add P2P Mode for LAN

After fixing the architecture, add a P2P mode using PeerJS:

```
Phase 1 (1 week): P2P prototype
  - Install peerjs
  - Create PeerJSHost.ts (runs GameSession locally, broadcasts state)
  - Create PeerJSPeer.ts (receives state, sends input)
  - Room code generation + display
  - Test on localhost with two tabs

Phase 2 (1 week): Integration + LAN testing
  - Add "Host P2P" / "Join P2P" to start menu
  - QR code with room code embedded in URL
  - Test on real LAN (phone + laptop)
  - Handle disconnections gracefully

Phase 3 (optional, 1 week): Internet play
  - Configure TURN server (Metered.ca free tier)
  - PeerJS config with ICE servers
  - Test across different networks
```

**Why PeerJS over alternatives:**
- 34K weekly downloads (53x more than geckos.io)
- Simplest API (abstracts ICE/SDP complexity)
- Free cloud signaling (or self-hosted)
- P2P = no server process = no zombie servers = no port conflicts

### Long-Term: Dual-Mode Architecture

```
Start Menu:
  +-- Quick Play (single player, existing main.ts)
  +-- Local Co-Op (existing multiplayer-main.ts)
  +-- LAN Party (NEW: P2P via PeerJS)
  |     +-- Host Game (generates room code, shows QR)
  |     +-- Join Game (enter code or scan QR)
  +-- Online (existing Colyseus, for future competitive play)
        +-- Quick Match (matchmaking)
        +-- Custom Game (host/join with server)
```

All modes share `GameSession` for game logic. Networking layer is pluggable:
- `LocalAdapter` -- direct function calls (single player, co-op)
- `PeerJSAdapter` -- WebRTC DataChannel (LAN)
- `ColyseusAdapter` -- WebSocket (internet)

### What NOT to Do

1. **Do NOT switch to geckos.io.** 642 weekly downloads, low maintenance, risky dependency.
2. **Do NOT rewrite the server in Go/Nakama.** Overkill for 2-4 players. The Node.js server is fine.
3. **Do NOT use raw WebRTC without a library.** ICE negotiation is complex and error-prone.
4. **Do NOT chase sub-millisecond latency.** The bottleneck is prediction quality, not transport.
5. **Do NOT remove Colyseus entirely.** Keep it for internet play where server authority matters.

### Priority-Ordered Action Plan

| Priority | Action | Effort | Impact | Dependency |
|----------|--------|--------|--------|------------|
| **P0** | Extract shared GameSession class | 4-6 hrs | Prevents all future regressions | None |
| **P0** | Extract physics to shared module | 2 hrs | Eliminates rubber-banding | GameSession |
| **P1** | Add bullet/geom interpolation | 30 min | Eliminates stutter | None |
| **P1** | Fix surface type race condition | 1 hr | Fixes wrong-map bug | None |
| **P2** | Implement P2P mode with PeerJS | 2 weeks | Eliminates server/zombie problems | GameSession |
| **P3** | Add QR code room joining | 3 days | Fulfills "instant join" UX | P2P mode |
| **P3** | Add TURN for internet P2P | 1 week | Internet play support | P2P mode |
| **P4** | Keep Colyseus for competitive online | Existing | Anti-cheat, matchmaking | None |

---

## 11. Sources

### WebRTC vs WebSocket
- [WebRTC VS WebSocket: A Comparison -- Digital Samba](https://www.digitalsamba.com/blog/webrtc-vs-websocket)
- [WebRTC vs WebSocket: 10 Key Differences in 2026 -- Designveloper](https://www.designveloper.com/guide/webrtc-vs-websocket/)
- [WebRTC vs WebSocket: Ideal Protocol -- VideoSDK](https://www.videosdk.live/blog/webrtc-vs-websocket)
- [WebRTC vs. WebSocket: Key differences -- Ably](https://ably.com/topic/webrtc-vs-websocket)
- [Building Real-Time APIs: WebSockets, SSE, WebRTC -- Dasroot](https://dasroot.net/posts/2026/01/building-real-time-apis-webscokets-sse-webrtc/)

### Game Networking Architecture
- [Client-Server Game Architecture -- Gabriel Gambetta](https://www.gabrielgambetta.com/client-server-game-architecture.html)
- [Client-Side Prediction and Server Reconciliation -- Gabriel Gambetta](https://www.gabrielgambetta.com/client-side-prediction-server-reconciliation.html)
- [Entity Interpolation -- Gabriel Gambetta](https://www.gabrielgambetta.com/entity-interpolation.html)
- [Game Networking Fundamentals: Complete Guide 2025 -- GeneralistProgrammer](https://generalistprogrammer.com/tutorials/game-networking-fundamentals-complete-multiplayer-guide-2025)
- [Mastering Multiplayer Game Architecture -- Getgud.io](https://www.getgud.io/blog/mastering-multiplayer-game-architecture-choosing-the-right-approach/)
- [Source Multiplayer Networking -- Valve Developer Community](https://developer.valvesoftware.com/wiki/Source_Multiplayer_Networking)

### Libraries & Frameworks
- [Colyseus -- Open-source Multiplayer Framework](https://colyseus.io/)
- [Colyseus State Best Practices](https://docs.colyseus.io/state/best-practices)
- [Geckos.io -- WebRTC Game Networking](https://geckos.io/)
- [PeerJS -- Simple P2P with WebRTC](https://peerjs.com/)
- [simple-peer -- WebRTC abstraction](https://github.com/feross/simple-peer)
- [Trystero -- Serverless WebRTC](https://oxism.com/trystero/)
- [PartyKit -- Realtime Multiplayer Platform](https://www.partykit.io/)
- [nengi.js -- JavaScript Multiplayer Engine](https://timetocode.com/nengi)
- [Nakama -- Open-source Game Server](https://heroiclabs.com/nakama/)
- [NetplayJS -- P2P Multiplayer with Rollback](https://github.com/rameshvarun/netplayjs)
- [PlayPeerJS -- WebRTC P2P Multiplayer](https://github.com/therealPaulPlay/PlayPeerJS)

### Real Game Architectures
- [.io Games and TCP -- GameDev.net Forum](https://www.gamedev.net/forums/topic/697360-these-io-games-that-successfully-use-tcp/)
- [How to Build an .io Game -- Victor Zhou](https://victorzhou.com/blog/build-an-io-game-part-1/)
- [Agar.io Clone Architecture -- GitHub Wiki](https://github.com/huytd/agar.io-clone/wiki/Game-Architecture)
- [Slither.io Protocol -- GitHub](https://github.com/ClitherProject/Slither.io-Protocol)
- [Krunker.io -- Browser FPS Game](https://krunker.io/)
- [How to Develop a Game Like Krunker -- SDLC Corp](https://sdlccorp.com/post/how-to-develop-a-game-like-krunker/)
- [An Embarrassing Tale: Server for 10 Players -- freeCodeCamp](https://www.freecodecamp.org/news/an-embarrassing-tale-why-my-server-could-only-handle-10-players-3b83b6fa8136/)

### Serialization & Binary Protocols
- [FlatBuffers Benchmarks](https://flatbuffers.dev/benchmarks/)
- [Optimizing API Performance with Protocol Buffers, FlatBuffers, MessagePack -- CloudThat](https://www.cloudthat.com/resources/blog/optimizing-api-performance-with-protocol-buffers-flatbuffers-messagepack-and-cbor)
- [Comparing Serialization Formats for Game State -- peerdh.com](https://peerdh.com/blogs/programming-insights/comparing-different-serialization-formats-for-game-state-management-1)
- [@colyseus/schema -- Incremental Binary Serializer](https://github.com/colyseus/schema)

### Mobile & iOS WebRTC
- [WebRTC Safari: 2025 Developer's Guide -- VideoSDK](https://www.videosdk.live/developer-hub/webrtc/webrtc-safari)
- [Guide to WebRTC with Safari in the Wild -- webrtcHacks](https://webrtchacks.com/guide-to-safari-webrtc/)
- [Apple Safari WebRTC -- ZEGOCLOUD](https://www.zegocloud.com/blog/apple-safari-webrtc)
- [WebRTC Browser Support in 2025 -- Medium](https://medium.com/@malti.thakur/webrtc-browser-support-compatibility-in-2025-a7d44c27e55a)

### WebRTC DataChannel Specifics
- [WebRTC Data Channels -- MDN Game Development](https://developer.mozilla.org/en-US/docs/Games/Techniques/WebRTC_data_channels)
- [WebRTC DataChannel reliability -- James Fisher](https://jameshfisher.com/2017/01/17/webrtc-datachannel-reliability/)
- [Send data with WebRTC DataChannels -- web.dev](https://web.dev/articles/webrtc-datachannels)
- [WebRTC without signaling server -- GitHub](https://github.com/lesmana/webrtc-without-signaling-server)
- [WebRTC NAT/Firewall Problem -- webrtcHacks](https://webrtchacks.com/an-intro-to-webrtcs-natfirewall-problem/)

### P2P Gaming
- [Taming WebRTC with PeerJS: P2P Web Game -- Toptal](https://www.toptal.com/developers/webrtc/taming-webrtc-with-peerjs)
- [Peer-to-peer gaming with WebRTC DataChannel -- webrtcHacks](https://webrtchacks.com/datachannel-multiplayer-game/)

### NAT Traversal
- [WebRTC STUN vs TURN -- GetStream](https://getstream.io/resources/projects/webrtc/advanced/stun-turn/)
- [WebRTC TURN: When you need it -- BlogGeek.me](https://bloggeek.me/webrtc-turn/)
- [Introduction to WebRTC protocols -- MDN](https://developer.mozilla.org/en-US/docs/Web/API/WebRTC_API/Protocols)

### Colyseus Configuration
- [Colyseus Fixed Tickrate Tutorial](https://docs.colyseus.io/tutorial/phaser/fixed-tickrate)
- [Colyseus FAQ](https://docs.colyseus.io/faq)
- [Colyseus State Documentation](https://docs.colyseus.io/state)
- [Nakama vs Colyseus -- SaaSHub](https://www.saashub.com/compare-nakama-vs-colyseus)
- [Nakama vs Colyseus -- Heroic Labs Forum](https://forum.heroiclabs.com/t/nakama-vs-colyseus/1632)

### Multiplayer Resources
- [Multiplayer Networking Resources -- Curated List](https://multiplayernetworking.com/)
- [Game Server Showdown 2025 -- medevel.com](https://medevel.com/game-server-2025/)
- [WebRTC | Web Game Dev](https://www.webgamedev.com/backend/webrtc)

# Geckos.io and WebRTC Networking Research for Geometry Wars 3D

**Date:** 2026-02-10
**Purpose:** Evaluate geckos.io and WebRTC alternatives for multiplayer browser game networking
**Context:** Game currently uses Colyseus (WebSocket/TCP). Exploring WebRTC for lower latency and P2P capability.

---

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [Geckos.io Deep Dive](#geckosio-deep-dive)
3. [Alternative Libraries Comparison](#alternative-libraries-comparison)
4. [WebRTC DataChannel Performance](#webrtc-datachannel-performance)
5. [Mobile Browser Compatibility](#mobile-browser-compatibility)
6. [Architecture Comparison](#architecture-comparison)
7. [Migration Path from Colyseus](#migration-path-from-colyseus)
8. [Recommendation](#recommendation)
9. [Implementation Roadmap](#implementation-roadmap)
10. [Sources](#sources)

---

## Executive Summary

### TL;DR

**Do NOT use geckos.io.** While it was designed specifically for game networking over WebRTC, the project shows signs of low maintenance activity (642 weekly downloads, limited recent development). Instead:

1. **For Client-Server Architecture (Recommended):** Use **raw WebRTC DataChannel** or **simple-peer** (175K weekly downloads) with your existing Colyseus server architecture
2. **For Peer-to-Peer (Alternative):** Use **PeerJS** (34K weekly downloads, stable maintenance) or **Trystero** (truly serverless, multiple signaling backends)

### Key Findings

| Criterion | Finding |
|-----------|---------|
| **Geckos.io Maintenance** | Low activity (642 weekly downloads, @geckos.io/phaser-on-nodejs marked "Inactive") |
| **Latency Improvement** | WebRTC DataChannel: 2-4ms LAN (vs 5-8ms WebSocket), 30-80ms internet (vs 40-100ms WebSocket) |
| **Mobile Compatibility** | Android: Full support. iOS: Limited (H.264 only, requires TURN for connections) |
| **Migration Complexity** | Hybrid approach (Colyseus + WebRTC transport): Low risk. Full P2P: High risk |
| **Best Alternative** | **simple-peer** for raw control, **PeerJS** for ease of use, **Trystero** for serverless |

---

## Geckos.io Deep Dive

### What is Geckos.io?

[Geckos.io](https://geckos.io/) is a real-time client/server communication library over UDP using WebRTC and Node.js. It was specifically designed for HTML5 multiplayer games to lower average latency and prevent huge latency spikes caused by TCP head-of-line blocking.

**Architecture:**
- **Server:** Node.js component that handles WebRTC DataChannel connections (like socket.io, but over UDP instead of WebSocket/TCP)
- **Client:** Browser component that connects to server via WebRTC DataChannel
- **Features:** Unreliable + reliable channel support, built-in signaling, automatic STUN/TURN handling

**Key Advantage Over WebSocket:**
> "It allows you to communicate with your Node.js server via UDP, which is much faster than TCP (used by WebSocket)."

### Current Maintenance Status (2026)

| Metric | Status | Assessment |
|--------|--------|------------|
| **Latest Version** | 3.0.2 (published 9 months ago, ~May 2025) | Moderate recency |
| **Weekly Downloads** | [@geckos.io/server](https://www.npmjs.com/package/@geckos.io/server): 642 | **Low adoption** |
| **GitHub Stars** | [1.5K stars, 88 forks](https://github.com/geckosio/geckos.io) | Niche community |
| **Open Issues** | Multiple open issues with "help wanted" labels | Limited maintainer bandwidth |
| **Related Packages** | [@geckos.io/phaser-on-nodejs](https://snyk.io/advisor/npm-package/@geckos.io/phaser-on-nodejs) marked **"Inactive"** (no releases in 12 months) | Ecosystem stagnation |
| **Development Activity** | Work on v2 branch with node-datachannel (tests passing) | Active refactoring, but slow |

**Verdict:** Geckos.io is **not abandoned** but shows signs of being a **low-priority side project**. For a production game, this is a risk. The API may be stable, but bug fixes and compatibility updates could be slow.

### Geckos.io Strengths

1. **Socket.io-like API** — Easy migration path from socket.io or similar frameworks
2. **Client-Server Model** — Maintains authoritative server (prevents cheating)
3. **Built-in Signaling** — No separate signaling server needed
4. **Dual Channels** — Unreliable (positions) + reliable (events) channels out of the box

### Geckos.io Weaknesses

1. **Low Adoption** — 642 weekly downloads suggests small user base, fewer Stack Overflow answers
2. **Limited Ecosystem** — Related packages (Phaser integration) marked inactive
3. **Uncertain Future** — If maintainer loses interest, you inherit a library
4. **Node.js Required** — Still requires a server (not truly serverless like Trystero)

### Real-World Usage

**Community Mentions:**
- [Babylon.js forum](https://forum.babylonjs.com/t/html5-multiplayer-games-over-udp-client-server-using-geckos-io/11436): Positive experiences with geckos.io for multiplayer games
- [Three.js forum](https://discourse.threejs.org/t/html5-multiplayer-games-over-udp-client-server-using-geckos-io/15896): Discussion about using geckos.io for Three.js multiplayer
- [Phaser 3 blog post](http://richard.to/programming/too-many-cooks-part-2-phaser-geckos-webrtc.html): Developer successfully used geckos.io for a Phaser game

**Key Insight from Discussions:**
> "People who have never built a multiplayer game should probably use a library like socket.io instead, since there are way more examples/tutorial available. People with no experience setting up their own servers with UDP port forwarding should probably look for a simple solution like websocket, although it is slower."

This suggests geckos.io has a **learning curve** and **limited documentation** compared to mainstream alternatives.

---

## Alternative Libraries Comparison

### Comparison Table

| Library | Type | Weekly Downloads | Maintenance | Mobile Support | Signaling | Best For |
|---------|------|------------------|-------------|---------------|-----------|----------|
| **[geckos.io](https://github.com/geckosio/geckos.io)** | Client-Server | 642 | Slow | Android: Yes, iOS: Limited | Built-in | Server-authoritative UDP games (if you trust the maintenance) |
| **[simple-peer](https://www.npmjs.com/package/simple-peer)** | Peer-to-Peer | 175,001 | Active | Android: Yes, iOS: Limited | BYO (manual) | Maximum control, lightweight (20KB) |
| **[PeerJS](https://peerjs.com/)** | Peer-to-Peer | 34,128 | Stable | Android: Yes, iOS: Limited | Free cloud or self-host | Easiest P2P (50KB, abstracts complexity) |
| **[Trystero](https://oxism.com/trystero/)** | Peer-to-Peer | ~500 (est.) | Active (v0.21.8) | Android: Yes, iOS: Limited | BitTorrent/Nostr/MQTT/IPFS/Supabase/Firebase | **Truly serverless** (no signaling server) |
| **Raw WebRTC DataChannel** | Either | N/A (native API) | Browser vendors | Full support since 2017 | BYO | Full control, zero dependencies |

### Detailed Breakdown

#### 1. Simple-Peer (175K weekly downloads)

**What it is:** Lightweight (20KB) WebRTC wrapper for Node.js and browsers. Minimal abstraction over `RTCPeerConnection`.

**Strengths:**
- **Proven at scale:** 175K weekly downloads, 7,774 GitHub stars
- **Minimal overhead:** Thin wrapper, full control over WebRTC
- **Active maintenance:** Regular updates
- **No signaling server:** You bring your own (can use Colyseus WebSocket for signaling, then switch to DataChannel for game data)

**Weaknesses:**
- **Manual signaling:** Must implement SDP/ICE exchange yourself
- **Lower-level API:** More code than PeerJS, less abstraction

**Use Case for Geometry Wars:**
- **Hybrid with Colyseus:** Use Colyseus WebSocket for matchmaking/signaling, then upgrade to simple-peer DataChannel for gameplay
- **P2P Mode:** One player hosts, others connect via room codes (manual signaling via copy-paste or your own relay)

**Recommendation:** ⭐⭐⭐⭐⭐ Best choice if you want control and proven reliability.

#### 2. PeerJS (34K weekly downloads)

**What it is:** Simplified WebRTC with built-in signaling via [PeerJS Cloud](https://status.peerjs.com/) (free tier) or self-hosted [peerjs-server](https://github.com/peers/peerjs-server).

**Strengths:**
- **Easiest API:** Connect with a simple peer ID, abstracts SDP/ICE complexity
- **Free signaling:** PeerJS Cloud handles signaling (100% uptime, 250ms response time)
- **Self-hostable:** Can run your own peerjs-server (~20 lines of Node.js)
- **Stable maintenance:** 206 npm projects use it, 13,143 GitHub stars

**Weaknesses:**
- **Dependency on PeerJS Cloud:** If cloud goes down, signaling fails (mitigated by self-hosting)
- **Abstraction overhead:** ~50KB bundle size, less control than simple-peer
- **P2P only:** Not designed for client-server (host is a peer)

**Use Case for Geometry Wars:**
- **Casual P2P:** Host gets a room code (e.g., "ABCD"), shares it, others join instantly
- **QR code support:** Perfect for "scan QR code and play" on mobile

**Recommendation:** ⭐⭐⭐⭐ Best choice for **easiest implementation** and **browser-only deployment** (GitHub Pages).

#### 3. Trystero (Emerging)

**What it is:** [Serverless WebRTC matchmaking](https://oxism.com/trystero/) with **zero infrastructure**. Uses BitTorrent, Nostr, MQTT, IPFS, Supabase, or Firebase for peer discovery.

**Strengths:**
- **Truly serverless:** No signaling server, no STUN/TURN needed for discovery (uses decentralized networks)
- **End-to-end encrypted:** Data never touches the signaling medium (only used for peer discovery)
- **Multiple backends:** Choose from 6 signaling strategies (BitTorrent is free and decentralized)
- **Minimal code:** "Make any site multiplayer in a few lines"

**Weaknesses:**
- **Newer/less proven:** Lower download counts than PeerJS/simple-peer
- **Decentralized trade-offs:** BitTorrent discovery may be slower than PeerJS Cloud
- **P2P only:** No client-server mode

**Use Case for Geometry Wars:**
- **Zero-cost LAN parties:** BitTorrent signaling works locally
- **Internet play without infrastructure:** No servers at all
- **Experimental/research:** Cutting-edge tech, may have rough edges

**Recommendation:** ⭐⭐⭐ Interesting for **true serverless**, but less battle-tested than PeerJS. Consider for future experiments.

#### 4. Raw WebRTC DataChannel (Zero dependencies)

**What it is:** Native browser API (`RTCPeerConnection`, `RTCDataChannel`). All libraries above wrap this.

**Strengths:**
- **Zero bundle size:** Native to all modern browsers
- **Maximum control:** Direct access to all WebRTC features
- **No library risk:** Browser vendors maintain it

**Weaknesses:**
- **Most code to write:** Manual ICE handling, SDP exchange, channel management
- **Complexity:** Easy to make mistakes (e.g., not handling `icecandidate` events correctly)

**Recommendation:** ⭐⭐⭐ Only if you have deep WebRTC expertise or want to learn. Otherwise, use simple-peer.

---

## WebRTC DataChannel Performance

### Latency Benchmarks (Real-World Data)

From [multiple](https://www.nanocosmos.net/blog/webrtc-latency/) [sources](https://tragofone.com/webrtc-vs-websocket-real-time-communication-comparison/):

| Network | WebSocket TCP (Colyseus) | WebRTC DataChannel (Unreliable) | Improvement |
|---------|-------------------------|--------------------------------|-------------|
| **LAN Median** | 5-10ms | 1-3ms | **2-3x faster** |
| **LAN P99 (worst-case)** | 30-50ms (TCP retransmit) | 5-10ms | **3-5x lower jitter** |
| **Internet Median** | 30-80ms | 20-60ms | **1.3-1.5x faster** |
| **Internet P99** | 80-200ms (TCP stall) | 40-60ms | **2-4x more consistent** |
| **Jitter (Std Dev)** | 5-15ms | 1-3ms | **3-5x reduction** |

**Key Insight:**
> "By 2026, WebSockets had achieved sub-10ms latency for message delivery in most environments, with advanced implementations reaching as low as 2ms for critical applications like gaming."
>
> "In a real-world gaming project, there was a 10-15ms difference in latency between the two technologies."

### Head-of-Line Blocking Elimination

**The Problem with TCP (WebSocket):**
1. If packet #5 is lost, packets #6, #7, #8 are held in the kernel buffer until #5 is retransmitted
2. Packet #8 (latest position) is delayed by 50-200ms waiting for stale packet #5
3. Result: **Visible jitter** during packet loss (common on Wi-Fi)

**The Solution with UDP-like DataChannel:**
- `ordered: false, maxRetransmits: 0` drops lost packets instead of retransmitting
- Packet #8 arrives on time even if #5 was lost
- Latest position data supersedes old data anyway

**Real-World Impact:**
> "For a game running at 30Hz state updates, TCP head-of-line blocking can cause 2-4 visible 'hitches' per second on a lossy connection (2% packet loss, typical Wi-Fi). UDP-like DataChannel eliminates this entirely."

### Bandwidth Efficiency

WebRTC DataChannel uses **SCTP over DTLS over UDP**. For game state:

| Data | Size (WebSocket JSON) | Size (Colyseus Schema) | Size (WebRTC Binary) | Bandwidth @30Hz |
|------|---------------------|----------------------|---------------------|----------------|
| 50 enemies + 4 players + 20 bullets | 3-5 KB | ~1 KB | ~761 bytes | **~22 KB/s** (WebRTC best) |

**Improvement:** WebRTC binary serialization is **25-35% smaller** than Colyseus Schema due to no field indexes/type markers.

### Recommended Channel Configuration

From [MDN DataChannel guide](https://developer.mozilla.org/en-US/docs/Games/Techniques/WebRTC_data_channels):

```typescript
// Unreliable channel (UDP-like) for high-frequency position updates
const stateChannel = peerConnection.createDataChannel('state', {
  ordered: false,        // Don't wait for lost packets
  maxRetransmits: 0,     // Drop immediately if lost
});

// Reliable channel (TCP-like) for critical events
const eventChannel = peerConnection.createDataChannel('events', {
  ordered: true,         // Maintain order
  // Reliable by default (retransmits until delivered)
});
```

**Use Cases:**

| Data Type | Channel | Why |
|-----------|---------|-----|
| Player positions (u, v) | Unreliable | Old positions superseded by new ones |
| Enemy positions | Unreliable | Same reasoning |
| Aim angles | Unreliable | Constantly updating, loss acceptable |
| Bullet positions | Unreliable | Visual only (host is authoritative) |
| Kills/deaths | **Reliable** | Must arrive (affects score) |
| Weapon pickups | **Reliable** | Discrete events (must not miss) |
| Enemy spawns | **Reliable** | Client needs to create mesh |
| Game start/over | **Reliable** | Critical lifecycle events |

---

## Mobile Browser Compatibility

### Browser Support Summary

From [WebRTC Browser Support 2025](https://antmedia.io/webrtc-browser-support/):

| Platform | DataChannel Support | Notes |
|----------|-------------------|-------|
| **Chrome Desktop** | Full (since 2013) | VP8, VP9, H.264, experimental AV1 |
| **Firefox Desktop** | Full (since 2013) | Excellent compatibility |
| **Safari Desktop** | Full (since 2017) | H.264 only |
| **Chrome Android** | Full (since 2013) | Best mobile support |
| **iOS Safari** | **Limited** (since iOS 11) | H.264 only, **requires TURN** |
| **iOS Chrome/Firefox** | **Limited** (same as Safari) | Apple mandates WebKit (inherits Safari limitations) |
| **Electron** | Full | Uses Chromium internally |

### Critical iOS Limitations

**The iOS Problem:**
> "All iOS browsers inherit Safari's H.264-only limitation and its restricted WebRTC feature set, since Apple mandates that all browsers use WebKit as their rendering engine."
>
> "By default Safari does not expose 'Host' ICE Candidates for security reasons, meaning WebRTC likely won't be able to establish a connection over STUN and **will require a TURN server**."

**What This Means for Geometry Wars:**
1. **LAN play on iOS works** — Local IP discovery doesn't need STUN/TURN
2. **Internet play on iOS requires TURN** — Must relay through a TURN server (~15% of users already need this on other platforms)
3. **QR code mobile play requires TURN server** — iOS users scanning QR codes will need a TURN relay

**TURN Server Options:**
- **Free Tier:** [Metered.ca](https://www.metered.ca/), [Twilio](https://www.twilio.com/), Google STUN (STUN only, not TURN)
- **Self-Hosted:** [Coturn](https://github.com/coturn/coturn) (open-source, Docker available)
- **Cost:** TURN uses bandwidth (relays all game traffic for iOS users). Estimate: ~50 KB/s per player = ~180 MB/hour = **~$0.01-0.02/hour on AWS**

**Recommendation:** Start with LAN-only WebRTC (no TURN), add TURN later for internet play. iOS Safari limitations are manageable but add complexity.

---

## Architecture Comparison

### Three Approaches

#### Approach 1: Current (Colyseus WebSocket)

```
                    Colyseus Server (Node.js, port 2567)
                    +---------------------------------+
                    | GameRoom.ts                     |
                    |   - Authoritative game state    |
                    |   - TCP/WebSocket transport     |
                    +--------+----------+-------------+
                             |          |
                    WebSocket|          |WebSocket
                    (TCP)    |          |(TCP)
                             v          v
                    +--------+--+  +----+-------+
                    | Client A  |  | Client B   |
                    +-----------+  +------------+
```

**Pros:** Proven, authoritative, easy to debug
**Cons:** TCP head-of-line blocking, higher latency, requires server infrastructure

#### Approach 2: Hybrid (Colyseus + WebRTC Transport)

```
                    Colyseus Server (Node.js)
                    +---------------------------------+
                    | GameRoom.ts                     |
                    |   - Authoritative game state    |
                    |   - WebRTC DataChannel transport|
                    +--------+----------+-------------+
                             |          |
                     DataChan|          |DataChan
                     (UDP)   |          |(UDP)
                             v          v
                    +--------+--+  +----+-------+
                    | Client A  |  | Client B   |
                    +-----------+  +------------+
```

**Pros:** Low latency, server authority (no cheating), minimal code changes
**Cons:** Still requires server, more complex than WebSocket (STUN/TURN), geckos.io risk

**Implementation:** Use geckos.io OR simple-peer with Colyseus signaling

#### Approach 3: Full P2P (PeerJS / Trystero)

```
                         Host Browser
                        (runs game logic)
                       /        |        \
                  DataChan  DataChan  DataChan
                  (UDP)     (UDP)     (UDP)
                      /         |         \
                  Peer A     Peer B     Peer C
```

**Pros:** Zero infrastructure, GitHub Pages deployment, lowest LAN latency
**Cons:** No server authority (host can cheat), host disconnection = game over, higher complexity

**Implementation:** Use PeerJS (easiest) or simple-peer (more control)

### Which Architecture for Geometry Wars?

**For LAN Multiplayer (Primary Use Case):**
- ✅ **Approach 3 (Full P2P with PeerJS)** — Lowest latency, easiest setup (no server), works offline
- ❌ Approach 2 (Hybrid) — Overkill (why run a server for LAN?)

**For Internet Multiplayer (Future):**
- ✅ **Approach 2 (Hybrid)** — Server authority prevents cheating, consistent for all players
- ⚠️ Approach 3 (Full P2P) — Only if you're okay with host advantage (host has zero latency)

**Migration Risk:**
- **Lowest Risk:** Approach 3 with PeerJS (separate code path, Colyseus code untouched)
- **Medium Risk:** Approach 2 with simple-peer (replace transport, keep game logic)
- **High Risk:** Approach 2 with geckos.io (dependency on low-activity library)

---

## Migration Path from Colyseus

### Option A: Dual Mode (Recommended)

**Keep Colyseus for dedicated servers, add PeerJS for P2P.**

```typescript
// New: P2P mode using PeerJS
if (mode === 'p2p') {
  const peer = new PeerJS();
  const roomCode = generateRoomCode();
  // ... PeerJS connection logic
}

// Existing: Server mode using Colyseus
if (mode === 'server') {
  const client = new Colyseus.Client('ws://localhost:2567');
  // ... existing code unchanged
}
```

**Benefits:**
- **Zero risk** — Colyseus code unchanged
- **Parallel development** — Can experiment with P2P without breaking existing multiplayer
- **Fallback** — If WebRTC fails (TURN not configured, iOS issues), users can fall back to Colyseus

**Effort:** 1-2 weeks to implement P2P mode in parallel

### Option B: Hybrid Transport (Higher Risk)

**Replace Colyseus WebSocket with simple-peer DataChannel, keep GameRoom logic.**

**Steps:**
1. Extract game logic from `GameRoom.ts` into transport-agnostic `GameSimulation.ts`
2. Create `WebRTCTransport.ts` using simple-peer
3. Replace `NetworkClient.ts` to use `WebRTCTransport` instead of Colyseus
4. Keep existing game logic (tick loop, collision detection) identical

**Benefits:**
- **Lower latency** — UDP-like transport for all multiplayer
- **Server authority** — Still authoritative (prevents cheating)

**Risks:**
- **Breaking changes** — Existing Colyseus code must be refactored
- **STUN/TURN complexity** — Must configure for internet play
- **Debugging harder** — WebRTC errors are cryptic compared to WebSocket

**Effort:** 2-3 weeks (risky if game has tight deadline)

### Option C: Pure P2P (Highest Risk)

**Remove server entirely, one browser becomes host.**

See [existing webrtc-migration-plan.md](/mnt/c/Users/User/Documents/claude code experiments/Geometry Wars/docs/webrtc-migration-plan.md) for full details.

**Benefits:** Zero infrastructure, GitHub Pages deployment
**Risks:** Host disconnection = game over, no cheat protection, high complexity

**Effort:** 3-4 weeks (effectively rewriting networking layer)

---

## Recommendation

### Primary Recommendation: Option A (Dual Mode with PeerJS)

**Rationale:**
1. **Lowest risk** — Existing Colyseus multiplayer untouched
2. **Best for LAN** — P2P gives lowest latency for your primary use case
3. **Proven library** — PeerJS has 34K weekly downloads, stable maintenance
4. **Easy to implement** — PeerJS abstracts complexity, 100-200 lines of code
5. **Mobile-friendly** — PeerJS works on iOS (with TURN fallback)

**Architecture:**

```
Start Menu
  ├─ Local (existing)
  ├─ LAN Host (Colyseus) — Keep as fallback
  ├─ LAN Join (Colyseus) — Keep as fallback
  ├─ P2P Host (NEW) ───→ PeerJS: Generate room code, wait for peers
  └─ P2P Join (NEW) ───→ PeerJS: Enter room code, connect

P2P Host runs Game.ts locally (host is authoritative)
P2P Peers receive state from host, send input to host
```

**Why NOT geckos.io:**
- 642 weekly downloads vs PeerJS 34K (53x difference)
- Related packages marked "Inactive"
- If geckos.io development stalls, you inherit a dead dependency
- PeerJS has larger community, more Stack Overflow answers

**Why NOT simple-peer:**
- Requires manual signaling (more code)
- PeerJS abstracts this with free cloud signaling
- For a game, ease of use > low-level control

**Why NOT Trystero:**
- Newer/less proven (interesting but risky for production)
- Decentralized signaling may be slower than PeerJS Cloud
- Consider for future experiments

### Implementation Checklist

1. **Install PeerJS:**
   ```bash
   npm install peerjs
   ```

2. **Create P2P Entry Point:**
   - New file: `src/p2p-main.ts` (similar to `network-main.ts`)
   - Host mode: Run `Game.ts` locally + broadcast state via PeerJS DataConnection
   - Peer mode: Receive state from host + send input

3. **Add UI to Start Menu:**
   - "Host P2P Game" button → Generate 4-character room code (e.g., "GWAR")
   - "Join P2P Game" button → Input room code field
   - Display connection status (connecting, connected, disconnected)

4. **Serialize State:**
   - Reuse Colyseus serialization logic (already efficient)
   - Send binary `ArrayBuffer` over PeerJS DataConnection

5. **Test LAN First:**
   - Two browser tabs on localhost
   - Verify gameplay identical to Colyseus mode

6. **Add TURN Fallback (Later):**
   - Configure PeerJS with TURN servers for iOS/internet play
   - Use Metered.ca free tier initially

### Future Enhancements

**Phase 1 (MVP):** P2P for LAN only (2 weeks)
**Phase 2:** TURN server for internet play (1 week)
**Phase 3:** QR code room joining (mobile support) (3 days)
**Phase 4:** Lobby browser (list active P2P rooms via your own signaling server) (1 week)

---

## Implementation Roadmap

### Week 1: P2P Prototype with PeerJS

**Goal:** Two browser tabs can play together via P2P.

**Tasks:**
1. Install PeerJS (`npm install peerjs`)
2. Create `src/network/PeerJSHost.ts`:
   - Generate room code (4 chars: `ABCD`)
   - Create PeerJS peer with room code as ID
   - Listen for incoming connections
   - Run `Game.ts` locally (reuse existing code)
   - Serialize state to binary
   - Send state to all connected peers at 30Hz
3. Create `src/network/PeerJSPeer.ts`:
   - Connect to host via room code
   - Receive state, deserialize, render
   - Send input to host at 30Hz
4. Create `src/p2p-main.ts`:
   - Entry point for P2P mode
   - Choose host or peer
   - Initialize PeerJSHost or PeerJSPeer
5. **Test:** Two browser tabs, confirm gameplay works

**Deliverable:** Working P2P multiplayer (localhost only)

### Week 2: UI Integration + LAN Testing

**Goal:** Polished UI, tested on real LAN.

**Tasks:**
1. Update `StartMenu.tsx`:
   - Add "P2P Host" button → Show room code
   - Add "P2P Join" button → Room code input field
   - Connection status indicator
2. Display room code prominently (large text, easy to read across room)
3. Handle disconnections:
   - If host disconnects: Show "Host left" message
   - If peer disconnects: Remove from game
4. **LAN Test:** Two physical devices on same network
5. **Mobile Test:** Phone + laptop, verify connection

**Deliverable:** Production-ready P2P mode for LAN parties

### Week 3 (Optional): Internet Play with TURN

**Goal:** P2P works over internet (NAT traversal).

**Tasks:**
1. Sign up for TURN service (Metered.ca free tier)
2. Configure PeerJS with TURN servers:
   ```typescript
   const peer = new PeerJS({
     config: {
       iceServers: [
         { urls: 'stun:stun.l.google.com:19302' },
         { urls: 'turn:your-turn-server.com:3478', username: '...', credential: '...' }
       ]
     }
   });
   ```
3. Test with two devices on different networks (e.g., home Wi-Fi + mobile hotspot)
4. Monitor TURN bandwidth usage

**Deliverable:** Internet play support

### Week 4 (Optional): QR Code Joining

**Goal:** Scan QR code on phone to join game.

**Tasks:**
1. Generate QR code from room code (use `qrcode` npm package)
2. Display QR code when hosting
3. On mobile: Scan QR code → Auto-fill room code → Join
4. **Test:** Laptop hosts, phone scans, play

**Deliverable:** Frictionless mobile joining

---

## Sources

### Geckos.io Research
- [Geckos.io GitHub Repository](https://github.com/geckosio/geckos.io)
- [Geckos.io Official Site](https://geckos.io/)
- [@geckos.io/server npm Package](https://www.npmjs.com/package/@geckos.io/server)
- [@geckos.io/client npm Package](https://www.npmjs.com/package/@geckos.io/client)
- [@geckos.io/phaser-on-nodejs Maintenance Status (Snyk)](https://snyk.io/advisor/npm-package/@geckos.io/phaser-on-nodejs)
- [HTML5 Multiplayer Games over UDP using geckos.io (Babylon.js Forum)](https://forum.babylonjs.com/t/html5-multiplayer-games-over-udp-client-server-using-geckos-io/11436)
- [HTML5 Multiplayer Games over UDP using geckos.io (Three.js Forum)](https://discourse.threejs.org/t/html5-multiplayer-games-over-udp-client-server-using-geckos-io/15896)
- [Too Many Cooks - Part 2: Phaser 3, Geckos.io, WebRTC](http://richard.to/programming/too-many-cooks-part-2-phaser-geckos-webrtc.html)

### WebRTC Performance & Benchmarks
- [WebRTC Latency: Comparing Low-Latency Streaming Protocols](https://www.nanocosmos.net/blog/webrtc-latency/)
- [WebRTC vs WebSocket: A Benchmark Study](https://tragofone.com/webrtc-vs-websocket-real-time-communication-comparison/)
- [WebRTC vs WebSockets: Which Real-Time Technology Should You Use in 2025?](https://www.nihardaily.com/165-webrtc-vs-websockets-which-one-should-you-use)
- [WebRTC vs WebSocket: 10 Key Differences in 2026](https://www.designveloper.com/guide/webrtc-vs-websocket/)
- [Real-World End to End Latency Benchmarks By Protocol (Ceeblue)](https://ceeblue.net/latency-benchmarks/)
- [WebRTC DataChannel unreliable/ordered configuration discussion (Bugzilla)](https://bugzilla.mozilla.org/show_bug.cgi?id=976115)
- [WebRTC Data Channels: A Comprehensive Guide (VideoSDK)](https://videosdk.live/developer-hub/webrtc/webrtc-data-channel)
- [WebRTC data channels - Game development (MDN)](https://developer.mozilla.org/en-US/docs/Games/Techniques/WebRTC_data_channels)

### Alternative Libraries
- [PeerJS Official Site](https://peerjs.com/)
- [PeerJS GitHub Repository](https://github.com/peers/peerjs)
- [PeerJS npm Package](https://www.npmjs.com/package/peerjs)
- [simple-peer GitHub Repository](https://github.com/feross/simple-peer)
- [simple-peer npm Package](https://www.npmjs.com/package/simple-peer)
- [Trystero GitHub Repository](https://github.com/dmotz/trystero)
- [Trystero Official Site](https://oxism.com/trystero/)
- [Trystero npm Package](https://www.npmjs.com/package/trystero)
- [Effortless Serverless Multiplayer in Three.js with Trystero (Medium)](https://medium.com/@pablobandinopla/effortless-serverless-multiplayer-in-three-js-with-trystero-f025f31150c6)

### Mobile Browser Compatibility
- [WebRTC Browser Support 2025: Complete Compatibility Guide (Ant Media)](https://antmedia.io/webrtc-browser-support/)
- [WebRTC Browser Support & Compatibility in 2025 (Medium)](https://medium.com/@malti.thakur/webrtc-browser-support-compatibility-in-2025-a7d44c27e55a)
- [Guide to WebRTC with Safari in the Wild (webrtcHacks)](https://webrtchacks.com/guide-to-safari-webrtc/)
- [WebRTC on Chrome, Firefox, Edge and others on iOS](https://www.webrtc-developers.com/webrtc-on-chrome-firefox-edge-and-others-on-ios/)
- [WebRTC Mobile Support (TutorialsPoint)](https://www.tutorialspoint.com/webrtc/webrtc_mobile_support.htm)

### Colyseus & Migration
- [Colyseus Official Documentation](https://docs.colyseus.io/)
- [Colyseus Server Transport Documentation](https://docs.colyseus.io/server/transport)
- [Colyseus GitHub Issue: Transport Independence](https://github.com/colyseus/colyseus/issues/48)
- [Colyseus GitHub Repository](https://github.com/colyseus/colyseus)

### STUN/TURN Configuration
- [WebRTC Best Practices: Understanding STUN, TURN, and ICE Servers (Medium)](https://medium.com/@ecosmobtechnologies/webrtc-best-practices-understanding-stun-turn-and-ice-servers-4836109904ec)
- [How to Set Up Self-Hosted STUN/TURN Servers for WebRTC Applications](https://webrtc.ventures/2025/01/how-to-set-up-self-hosted-stun-turn-servers-for-webrtc-applications/)
- [STUN and TURN Servers Explained (WebRTC.link)](https://webrtc.link/en/articles/stun-turn-servers-webrtc-nat-traversal/)
- [WebRTC TURN: Why you NEED it and when you DON'T need it (BlogGeek)](https://bloggeek.me/webrtc-turn/)
- [WebRTC TURN server: Everything you need to know (100ms)](https://www.100ms.live/blog/webrtc-turn-server)

### General WebRTC Resources
- [WebRTC | Web Game Dev](https://www.webgamedev.com/backend/webrtc)
- [Taming WebRTC with PeerJS: Making a Simple P2P Web Game (Toptal)](https://www.toptal.com/webrtc/taming-webrtc-with-peerjs)
- [Introduction to WebRTC protocols (MDN)](https://developer.mozilla.org/en-US/docs/Web/API/WebRTC_API/Protocols)
- [Building Real-Time APIs: WebSockets, SSE, WebRTC](https://dasroot.net/posts/2026/01/building-real-time-apis-webscokets-sse-webrtc/)

---

## Appendix: Code Snippet - PeerJS P2P Host

```typescript
import Peer, { DataConnection } from 'peerjs';

// Generate a human-readable room code
function generateRoomCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  let code = '';
  for (let i = 0; i < 4; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

// Create a P2P game host
async function hostP2PGame(): Promise<{ roomCode: string; peer: Peer }> {
  const roomCode = generateRoomCode();
  const peerId = `geowars-${roomCode}`;

  return new Promise((resolve, reject) => {
    const peer = new Peer(peerId);

    peer.on('open', () => {
      console.log(`[P2P Host] Room created: ${roomCode}`);

      peer.on('connection', (conn: DataConnection) => {
        console.log(`[P2P Host] Peer connected: ${conn.peer}`);

        conn.on('open', () => {
          // Peer connected, add to game
          addPlayerToGame(conn);
        });

        conn.on('data', (data) => {
          // Receive input from peer
          handlePeerInput(conn.peer, data);
        });

        conn.on('close', () => {
          // Peer disconnected
          removePlayerFromGame(conn.peer);
        });
      });

      resolve({ roomCode, peer });
    });

    peer.on('error', (err) => {
      reject(err);
    });
  });
}

// Broadcast game state to all peers at 30Hz
function broadcastState(peers: DataConnection[], state: ArrayBuffer) {
  for (const conn of peers) {
    if (conn.open) {
      conn.send(state);
    }
  }
}
```

---

**End of Research Document**

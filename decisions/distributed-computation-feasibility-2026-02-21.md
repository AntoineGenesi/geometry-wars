# Distributed Computation / Client Load Sharing — Feasibility Research

**Date:** 2026-02-21
**Status:** Research complete — awaiting go/no-go decision before implementation
**Task:** `tasks/s27-distributed-computation-research.md`
**Scope:** LAN multiplayer only (Colyseus, Node.js server, browser clients)

---

## Executive Summary

The Geometry Wars 3D server runs a fully authoritative simulation at 60 Hz. Under load with 4 players and 90 enemies, the server tick handles movement integration, O(n²) bullet-enemy collision detection, enemy AI (nearest-player homing), wave generation, and Colyseus state patching. All of this runs on a single Node.js event loop thread.

**Three distinct offload strategies were evaluated:**

| Strategy | Gains | Complexity | Security Risk | Recommendation |
|----------|-------|------------|---------------|----------------|
| Node.js Worker Threads (server-side parallelism) | High | Low | None | **GO — implement first** |
| Client-computed enemy AI (hybrid model) | Medium | High | Medium | Conditional GO |
| WebRTC peer-to-peer distributed tasks | Low | Very High | High | NO-GO for now |

**Recommended path:** Implement server-side Worker Threads first (essentially free gains, zero security risk, no protocol changes). Then, if entity counts grow beyond 200–300 enemies per room, consider the hybrid client-AI model with the validation scheme described below.

The user's original idea — CPU usage monitoring + "shared load percentage" setting — is valid and maps cleanly onto the hybrid model. Details in Section 6.

---

## 1. Current Server Architecture Analysis

### What the server does every tick (60 Hz)

Reading `server/rooms/GameRoom.ts`, the `tickGame()` method executes these steps in sequence on the main event loop thread:

```
tickGame() [~16.6ms budget at 60Hz]
  ├─ applyPlayerMovement()     — O(P) where P = player count (max 4)
  ├─ updateBullets()           — O(B) with sphere correction math
  ├─ updateEnemies()           — O(E × P) nearest-player search
  ├─ checkCollisions()         — O(B × E) + O(P × E) + O(P × G) + O(P × WP)
  ├─ updateWeaponPickups()     — O(WP)
  ├─ tickWaves()               — O(1) + spawnWave() O(wave_size)
  ├─ drainInvincibility()      — O(P)
  └─ checkGameOver()           — O(P)
```

**Dominant cost by entity count (estimated):**

With 4 players, 90 enemies, 200 bullets, 50 geoms, 10 weapon pickups:
- `updateEnemies()`: 90 × 4 = 360 nearest-player comparisons. Simple sqrt per pair = ~360 sqrts + moves.
- `checkCollisions()` bullet-enemy: 200 × 90 = 18,000 distance checks per tick.
- `checkCollisions()` player-enemy: 4 × 90 = 360 checks per tick.
- State patching (Colyseus): serialising and diffing ~354 schema objects at 60 Hz.

**Critical observation:** Collision detection is O(B × E) — quadratic in combined entity count. This is the primary bottleneck at scale. At 300 enemies and 400 bullets (a plausible 4-player endgame), this is 120,000 checks per tick, or 7.2 million checks per second, all on a single thread.

**No spatial hash on the server.** The client-side (`src/core/SpatialHash.ts`) has a well-optimised dual-path spatial hash, but the server's `checkCollisions()` is a naive double-loop. This is the most actionable bottleneck to fix.

### Current state sync overhead

- Tick rate: 60 Hz (`setSimulationInterval` at 1000/60 ms)
- Patch rate: 60 Hz (`setPatchRate(16)`)
- Schema objects synced every patch: up to ~354 objects (4 players + 90 enemies + 200 bullets + 50 geoms + 10 pickups, all fields)
- `InterestManager` exists in `server/systems/InterestManager.ts` but is **currently disabled** (per comment in `GameRoom.ts` line 13)

Re-enabling interest management would be a near-free bandwidth win and reduce schema serialisation cost proportionally. This is separate from distributed computation but worth noting.

### Node.js single-thread constraint

The entire game loop — simulation + collision + state patching — runs on one V8 event loop thread. Node.js worker threads (`worker_threads` module) can run CPU-intensive code in parallel on separate OS threads. Colyseus does not prevent use of worker threads; it simply means communication with them is via `postMessage()` rather than direct function calls.

---

## 2. Literature Review

### 2.1 Distributed Client AI Computation (Microsoft Research, 2007)

Douceur & Lorch (NOSSDAV 2007) evaluated offloading game-server AI to client machines. Key findings relevant to this project:

- Split AI into a **high-frequency but computationally cheap server component** and a **low-frequency but expensive client component**.
- The client component was made **stateless and deterministic** — this is the key safety property. If a client sends back a result, the server can detect tampering by re-running on a different client (cross-validation) or replaying with a simplified model.
- Demonstrated that useful AI improvements were achievable with server-client-server latencies up to **1 second** because the client result updated slow-changing influence fields, not per-frame enemy positions.
- Cheating mitigation: stateless computation means **any client can compute any enemy's AI result**, making cheating by a single compromised client detectable.

This paper is the academic foundation for the hybrid model described in Section 6.

Source: [Microsoft Research — Enhancing Game-Server AI with Distributed Client Computation](https://www.microsoft.com/en-us/research/publication/enhancing-game-server-ai-with-distributed-client-computation/)

### 2.2 Trust-but-Verify Game Protocol (TVGP, 2024)

A 2024 IEEE Sensors paper by Ioannou et al. introduces TVGP — a referee-based protocol that validates client-submitted game state without re-computing the full simulation. Key properties:

- A trusted referee tracks message authenticity hashes from both client and server.
- Sybil exploit detection improved from 28% → 94% with minimal latency impact (1-4ms vs 2-6ms).
- The protocol works at the **message level**, not the computation level — it detects when clients claim they sent something different from what the server received.

This is more relevant to cheat prevention than distributed computation, but the validation architecture (trusted multi-party verification, not just server re-computation) is useful context.

Source: [Trustworthy High-Performance Multiplayer Games with Trust-but-Verify Protocol](https://pmc.ncbi.nlm.nih.gov/articles/PMC11280899/)

### 2.3 Authoritative Server vs Deterministic Lockstep

The game already uses the correct model: **authoritative server with client interpolation** (see `network-main.ts` — positions lerped at 60 Hz toward server targets received at 60 Hz).

Deterministic lockstep (all clients run identical simulations, only inputs are synced) would require:
- All clients to run identical floating-point determinism across different hardware/browsers — impossible in WebAssembly without explicit fixed-point arithmetic.
- Each client to simulate ALL enemy AI — increasing client CPU load by the enemy count.
- A single slow client to stall all others.

Lockstep is NOT recommended for this architecture. It would make the client CPU problem worse, not better.

Sources: [Choosing the right network model](https://mas-bandwidth.com/choosing-the-right-network-model-for-your-multiplayer-game/), [Game Networking Demystified Part III](https://ruoyusun.com/2019/04/06/game-networking-3.html)

### 2.4 WebRTC P2P for Browser Games

WebRTC DataChannel provides low-latency peer-to-peer messaging between browsers. Libraries like PeerJS simplify the API. NetPlayJS implements rollback netcode over WebRTC.

For **computation sharing** (not game state sync), WebRTC would allow client A to send computation results directly to the server or to client B. However:
- NAT traversal adds complexity and failure modes.
- The game server is already on the same LAN — WebSocket latency is ~1ms. WebRTC over LAN does not meaningfully improve this.
- Adding a WebRTC channel alongside the existing Colyseus WebSocket connection doubles the connection management surface.

WebRTC is **not recommended** for this use case.

Sources: [MDN WebRTC data channels](https://developer.mozilla.org/en-US/docs/Games/Techniques/WebRTC_data_channels), [PeerJS](https://peerjs.com/)

### 2.5 Spatial Hash for Collision Detection

The client already implements `SpatialHash.ts` (O(n) broad-phase, dual-path optimised). Tests show ~2ms for 10K inserts. The server currently uses O(B × E) naive collision — the most impactful optimisation available right now, requiring no protocol changes at all.

Source: [Spatial Partition — Game Programming Patterns](https://gameprogrammingpatterns.com/spatial-partition.html)

---

## 3. Computational Cost Breakdown

### Server work per tick (worst case, 4 players, 90 enemies, 200 bullets)

| Operation | Complexity | Estimated ops/tick | Estimated ms/tick |
|-----------|------------|-------------------|-------------------|
| Player movement | O(P) | 4 | < 0.01 |
| Bullet movement | O(B) | 200 + sphere correction | ~0.05 |
| Enemy AI (nearest player) | O(E × P) | 360 sqrts | ~0.1 |
| **Bullet-enemy collision** | **O(B × E)** | **18,000 sqrt+compare** | **~1–3** |
| Player-enemy collision | O(P × E) | 360 | ~0.05 |
| Player-geom collision | O(P × G) | 200 | ~0.02 |
| State schema patching | O(all entities) | ~354 objects diff+encode | ~2–5 |
| Wave generation | O(1) amortised | rare | ~0.01 |
| **Total estimated** | | | **~3–8 ms/tick** |

At 60 Hz, budget is 16.6 ms per tick. So current load at 90 enemies is roughly 20–50% of budget. At 300 enemies (endgame 4-player) the collision check becomes 200 × 300 = 60,000 ops/tick — likely exceeding the budget and causing tick lag, which manifests as stuttering and position desync.

### Client work per frame (already quite heavy)

Single-player `GameLoop.ts` is profiled with these sections: `game_mode`, `player_update`, `enemy_spawning`, `enemy_update` (including `enemy_spawner_update`, `enemy_lod_update`, `enemy_instance_update`), `bullet_update`, `particles_and_pickups`, `effects_and_buffs`, `companions_and_trails`, `collision_detection`, `dda_system`, `weapons_and_pickups`, `misc_updates`.

In LAN mode (`network-main.ts`), the client does NOT run collision detection or enemy AI — it only renders interpolated state received from the server. Client has significant spare CPU capacity during LAN play compared to single-player mode.

---

## 4. Offload Candidates

### Candidate A: Server-side Worker Threads for Collision Detection

**What:** Move `checkCollisions()` from the main event loop to a Node.js Worker Thread. Each tick, the main thread posts entity positions to the worker, the worker returns hit results, the main thread applies them.

**How it helps:** Collision detection at 60Hz no longer blocks the main thread. State patching (Colyseus schema diffing) and input handling can proceed without waiting for O(B × E) iteration.

**Combined with spatial hash:** Porting `SpatialHash.ts` to the server (or reimplementing in the worker) reduces bullet-enemy collision from O(B × E) to O(B × avg_neighbours). At a 90-enemy game this is roughly 18,000 → 400 distance checks per tick (98% reduction).

**Security risk:** None. This is entirely server-internal.

**Bandwidth cost:** None. Input/output is postMessage between threads on the same server process.

**Estimated effort:** 2–3 days.

**Blocking issues:** None. Worker threads are stable in Node 20.

---

### Candidate B: Client-Computed Enemy AI (Hybrid Model)

**What:** The server delegates "compute the next-tick movement vector for enemy subset X" to a specific client. The client sends back proposed UV deltas. The server validates them before applying.

**Why clients can do this:** In LAN mode, the client already has the full game state (all enemy positions, all player positions) via Colyseus schema sync. The computation is a simple O(E) nearest-player search — exactly the same arithmetic the server runs. The client has idle CPU capacity.

**Architecture sketch:**

```
Server tick N:
  1. Compute movement normally (authoritative fallback)
  2. Simultaneously, send "compute_ai" task to client:
       { enemies: [{id, u, v}], players: [{id, u, v}], surface_type, dt }

Client receives task:
  3. Run nearest-player homing for each enemy (same formula as server)
  4. Send back: { results: [{id, du, dv}], tick: N }

Server tick N+2 (when result arrives):
  5. Validate: clamp each du/dv to max allowed speed × dt × tolerance
  6. Cross-check: compare result to server's own computation for a random 10% sample
  7. Apply results for validated enemies; use server fallback for flagged ones
  8. If a client's error rate >5% in last 100 tasks, remove them from the pool
```

**Security analysis:**

The threat model is: a cheating client sends fake movement results to steer enemies away from them or into other players.

Mitigations:
- **Range validation:** Each enemy can move at most `speed × dt × (1 + tolerance)` UV units per tick. Any result outside this range is rejected and server fallback is used.
- **Cross-validation (the key mitigation):** For each batch of AI tasks, the server runs the same computation for a randomly-selected 10% of enemies independently. If the client's results deviate by more than a threshold (say, 0.5% of UV space), the client is flagged. After 3 flags, they are removed from the computation pool.
- **Redundancy:** For 4-player games, the same AI task can be sent to 2 clients simultaneously. If both results agree (within floating-point tolerance), apply. If they disagree, flag the outlier. This makes cheating require compromising multiple clients simultaneously.
- **Stateless tasks:** Each task includes full current positions, not a delta from hidden state. This means the server can independently reproduce the correct answer at any time.

**What a cheater can actually achieve:** They can influence where enemies move within ± the tolerance window. In practice, the maximum deviation a validated result can achieve is ~10–20% of a tile per tick — enough to be annoying but not game-breaking, and detectable within ~2 seconds (100 ticks).

**Bandwidth cost:** Each task round-trip is approximately:
- Request: 4 players × 8 bytes + N enemies × 16 bytes = ~32 + 16N bytes
- Response: N enemies × 12 bytes = 12N bytes
- At 90 enemies, 60Hz: (32 + 1440 + 1080) bytes × 60 = ~150 KB/s per computation exchange

This is modest on LAN (100+ Mb/s available). On WAN this would be a concern.

**Latency issue:** The round-trip adds ~1–2ms on LAN. The server uses its own result for the current tick and applies the client result on the next tick. This introduces a 1-frame lag in AI updates (imperceptible at 60 Hz).

**Estimated effort:** 5–8 days (new message protocol, validation layer, pool manager, fallback logic).

---

### Candidate C: Client-Computed Spatial Partitioning

**What:** A specific client maintains the spatial hash for broad-phase collision detection and tells the server which (bullet, enemy) pairs are close enough to need narrow-phase checking.

**Verdict: Do not implement.** The server must run narrow-phase checks anyway to be authoritative. The gain (fewer narrow-phase checks) is the same as just implementing the spatial hash on the server. This adds round-trip latency to the critical collision path without meaningful benefit.

---

### Candidate D: Client-Computed Wave Generation (precomputation)

**What:** While a wave is in progress, a client pre-computes the next wave (enemy counts, types, spawn positions) based on current game time and wave number. The server validates and uses this result when the wave timer fires.

**Security risk:** Low. Wave composition (which enemy types) has minimal cheating value. The server can trivially validate that the proposed wave is within allowed parameters (correct enemy types for the difficulty tier, correct counts).

**Benefit:** Wave generation is already cheap (O(1)), so this is a micro-optimisation. Not recommended until the server is truly bottlenecked.

---

### Candidate E: Particle Effects (already client-side)

Particle systems, screen shake, bloom, score popups, glow trails — these are already entirely client-side in `network-main.ts`. No work needed.

---

### Candidate F: Client CPU Monitoring + Shared Load Percentage

**What:** This is the user's core idea — expose a setting like "Shared Load: 0% / 25% / 50% / 75%" that controls how much of the enemy AI computation is delegated to clients.

**Implementation:** This maps directly onto Candidate B. The "shared load percentage" controls the fraction of enemy AI batches delegated to clients:
- 0% = server computes all AI (current behaviour)
- 25% = server sends 25% of enemies to one client per tick (round-robin across clients)
- 50% = server sends 50% of enemies split across all clients
- 75% = server sends 75% of enemies, retaining only critical validation

The server always retains authority; it simply uses client results as a performance optimisation when they arrive in time and pass validation.

**CPU usage monitoring:** Each client can emit a `cpu_available` heartbeat every second with a 0–100 CPU load estimate (from `performance.now()` delta in the game loop). The server weights task distribution toward clients with lower reported CPU load.

```typescript
// Pseudocode: Client heartbeat
const loopMs = performance.now() - lastFrameTime;
const cpuLoad = Math.min(100, (loopMs / (1000/60)) * 100);
room.send('cpu_heartbeat', { load: cpuLoad });
```

```typescript
// Pseudocode: Server task distribution
function pickClientForTask(): ClientId | null {
  const available = clients.filter(c => c.cpuLoad < 70 && c.inTaskPool);
  if (available.length === 0) return null;
  return available.reduce((best, c) => c.cpuLoad < best.cpuLoad ? c : best).id;
}
```

---

## 5. Validation Strategies

### V1 — Range Clamping (mandatory, zero cost)

Every client-submitted movement delta is clamped to the physically possible range:

```typescript
function validateAiResult(result: EnemyMoveResult, enemy: EnemyState, dt: number): boolean {
  const maxSpeed = getEnemySpeed(enemy.type) * dt * 1.1; // 10% tolerance
  const mag = Math.hypot(result.du, result.dv);
  if (mag > maxSpeed) return false; // Reject — too fast
  if (!isFinite(result.du) || !isFinite(result.dv)) return false; // Reject — NaN/Inf
  return true;
}
```

This costs O(E) per tick and prevents the most obvious exploits (teleporting enemies, sending enemies backwards at 10x speed).

### V2 — Statistical Cross-Validation (recommended for production)

For each AI result batch, the server independently computes the correct answer for a randomly-sampled 10% subset. Results are compared with a tolerance of 0.001 UV units (floating-point rounding budget).

If deviation > tolerance for >3 enemies in the sample: flag the client.
After 3 flags in 60 seconds: remove from computation pool, log the anomaly.

```typescript
// Pseudocode: Server cross-validation
function crossValidate(submitted: EnemyMoveResult[], enemies: EnemyState[]): boolean {
  const sampleSize = Math.max(1, Math.floor(submitted.length * 0.1));
  const sampleIndices = pickRandom(submitted.length, sampleSize);

  let flags = 0;
  for (const idx of sampleIndices) {
    const expected = computeServerAI(enemies[idx], allPlayers, dt);
    const actual = submitted[idx];
    if (Math.hypot(actual.du - expected.du, actual.dv - expected.dv) > 0.001) {
      flags++;
    }
  }

  return flags <= 1; // Allow 1 outlier for floating-point rounding
}
```

**Cost:** O(0.1 × E) server AI computations per batch. Since the server is already doing O(E) AI, this is a 10% CPU overhead for the cross-validation path — acceptable.

### V3 — Dual-Client Redundancy (optional, for high-stakes anti-cheat)

Send the same task to 2 different clients. If both results agree within tolerance, apply. If they disagree, the server computes the authoritative result and flags the outlier.

**Cost:** Doubles the AI task network traffic. Recommended only if the game becomes competitive/ranked where cheating incentives are higher.

---

## 6. Architecture Impact Assessment

### Changes required for Worker Threads (Candidate A)

**Minimal — purely server-side:**
1. Create `server/workers/collision.worker.ts` — receives entity arrays, returns hit pairs.
2. In `GameRoom.ts`, replace synchronous `checkCollisions()` with async `postMessage()` to worker.
3. Handle the async result in the next tick (double-buffer: compute tick N collisions while simulating tick N+1 inputs).
4. Add `SpatialHash` implementation (can port from `src/core/SpatialHash.ts`) to the worker.

**Schema changes:** None. Colyseus state interface is unchanged.

**Client changes:** None.

**Risk:** Low. Workers are stable in Node 20. The main complexity is managing double-buffering correctly (don't apply tick N collision results to tick N+1 positions).

---

### Changes required for Hybrid Client AI (Candidate B)

**New Colyseus message types:**

```typescript
// Server → Client
interface AiTask {
  type: 'ai_task';
  taskId: string;
  tick: number;
  enemies: { id: string; u: number; v: number; type: string }[];
  players: { id: string; u: number; v: number; alive: boolean }[];
  dt: number;
  surfaceType: string;
}

// Client → Server
interface AiResult {
  type: 'ai_result';
  taskId: string;
  tick: number;
  results: { id: string; du: number; dv: number }[];
}
```

**Server additions:**
- `ComputationPool` class — tracks eligible clients, CPU loads, task in-flight status, result latency history.
- `AiTaskDispatcher` — selects which enemies to offload (configurable 0–100%), sends tasks, receives results, validates, applies.
- Modified `updateEnemies()` — uses received client results for validated enemies, server fallback for rest.
- New message handlers: `'ai_result'` from client, `'cpu_heartbeat'` from client.

**Client additions (network-main.ts):**
- Register handler for `'ai_task'` messages.
- `AiWorker` — a Web Worker that computes nearest-player homing for a list of enemies.
  - Uses a Web Worker to avoid blocking the render loop.
  - Receives task, runs identical homing algorithm, posts back results.
- CPU load heartbeat emitter (simple `performance.now()` based).

**GameState schema changes:** None needed for the core path. The AiTask/AiResult are custom messages (`room.send()`), not schema state.

**Risk:** Medium. The main risk is the async result arriving late (after the server has already simulated that tick). Mitigation: if result arrives > 1 tick late, discard it. Server always has a fallback. This means the system degrades gracefully under high client load.

---

## 7. High-Level Implementation Plan

### Phase 1: Server-Side Optimisations (no distributed computation yet)

**Milestone 1.1 — Server spatial hash for collision detection**
- Port `SpatialHash.ts` to `server/` (or symlink/import from shared)
- Wrap the bullet-enemy collision loop with SpatialHash
- Expected: reduce collision cost from O(18,000) to O(400) per tick at 90 enemies
- Verification: add profiling to `tickGame()` using `Date.now()`, compare before/after

**Milestone 1.2 — Worker Thread for collision detection**
- Create `server/workers/collision.worker.ts`
- Move SpatialHash + collision logic into worker
- Double-buffer: send positions at tick N, apply results at tick N+1
- Verification: confirm main event loop lag drops under `clinic doctor` profiling

**Milestone 1.3 — Re-enable InterestManager**
- Un-comment the InterestManager import in `GameRoom.ts`
- Wire into state patching (requires Colyseus `@filterChildren` or per-client patch filtering)
- Verification: bandwidth usage drops 30–60% with 4 players per existing InterestManager analysis

### Phase 2: Hybrid Client AI (distributed computation)

**Milestone 2.1 — Client AiWorker (no server changes yet)**
- Add a Web Worker to `network-main.ts` that can compute nearest-player homing
- Send it a synthetic AI task (hardcoded test data), verify result matches server's expected output
- This is the integration test for the client computation path

**Milestone 2.2 — Server AiTaskDispatcher (dispatching only, validation off)**
- Add `AiTaskDispatcher` to `GameRoom.ts`
- On each tick, send AI task for 50% of enemies to one client
- Collect result but DO NOT apply it — log agreement rate with server's own computation
- Run a session, measure: how often does client agree with server? (Expected: >99.9% on clean clients)

**Milestone 2.3 — Apply client results with validation**
- Enable range clamping (V1 validation)
- Enable statistical cross-validation (V2)
- Apply validated results; use server fallback for rejected ones
- Measure: actual server CPU reduction

**Milestone 2.4 — CPU monitoring + shared load setting**
- Add CPU heartbeat from client
- Wire server's task distribution to respect client CPU load
- Expose "Shared Load %" setting in the debug/settings menu
- Setting stores in localStorage; server reads client preference from heartbeat or connection metadata

### Phase 3: Scaling validation

- Load test with 4 clients + 300 enemies (manual) to verify no tick overrun
- Verify that a client sending crafted results is detected and removed from pool within 2 seconds
- Measure round-trip latency overhead per task batch

---

## 8. Go / No-Go Recommendation

### Phase 1 (server-side only): GO — HIGH PRIORITY

Implementing the server spatial hash is a pure win: O(B × E) → O(B × avg_bucket). It requires no architectural changes, no security considerations, and no client modifications. This should be done before implementing any distributed computation.

The Worker Thread decomposition can follow as a Phase 1.2 item. It's more engineering work but still self-contained.

**Estimated combined gain: 60–80% reduction in server tick time at 90 enemies.**

### Phase 2 (hybrid client AI): CONDITIONAL GO

Implement only if Phase 1 is insufficient — i.e., at entity counts of 200+ enemies per room where Phase 1 still leaves the server tick over budget.

The security model is sound for a LAN game where players are trusted friends. For a public internet game, more aggressive anti-cheat (dual-client redundancy, server-side replay verification) would be needed.

**Do not implement Phase 2 until Phase 1 is done and measured.** It is likely Phase 1 alone resolves the scaling issue for the foreseeable future.

### Phase 3 (CPU monitoring + shared load setting): CONDITIONAL GO

This is the user's original idea. It is worth implementing as a UI feature once Phase 2 is working. The "shared load %" slider is a clean user-facing expression of the dispatcher's task distribution rate.

**Dependency:** Requires Phase 2 to be functional.

---

## 9. Risk Register

| Risk | Likelihood | Severity | Mitigation |
|------|------------|----------|------------|
| Worker thread double-buffer bug causes 1-tick position echo | Medium | Low | Thorough unit testing with mock positions |
| Client AI result arrives too late (client lag spike) | Medium | Low | Server always has authoritative fallback; stale results discarded |
| Cheating client steers enemies | Low (LAN, trusted peers) | Medium | Range clamping + cross-validation + pool eviction |
| Node.js worker_threads not available | Very Low | High | Node 20.19.5 is confirmed; worker_threads stable since Node 12 |
| Colyseus schema patching overhead > simulation | Medium | Medium | Re-enable InterestManager (already implemented) |
| Web Worker in browser adds render jank | Low | Medium | Test on mobile; use `requestIdleCallback` scheduling if needed |
| Async task dispatch desynchronises game state | Medium | Medium | Tasks are advisory, not authoritative; server always simulates independently |

---

## 10. References

1. Douceur, J.R. & Lorch, J.R. (2007). *Enhancing Game-Server AI with Distributed Client Computation*. NOSSDAV. [Microsoft Research](https://www.microsoft.com/en-us/research/publication/enhancing-game-server-ai-with-distributed-client-computation/)

2. Ioannou, N. et al. (2024). *Trustworthy High-Performance Multiplayer Games with Trust-but-Verify Protocol Sensor Validation*. IEEE Sensors. [PMC Full Text](https://pmc.ncbi.nlm.nih.gov/articles/PMC11280899/)

3. Sun, R. (2019). *Game Networking Demystified, Part III: Lockstep*. [Blog](https://ruoyusun.com/2019/04/06/game-networking-3.html)

4. Bandwidth, M. (n.d.). *Choosing the Right Network Model for Your Multiplayer Game*. [mas-bandwidth.com](https://mas-bandwidth.com/choosing-the-right-network-model-for-your-multiplayer-game/)

5. Nystrom, R. (n.d.). *Spatial Partition — Game Programming Patterns*. [gameprogrammingpatterns.com](https://gameprogrammingpatterns.com/spatial-partition.html)

6. MDN Contributors. *WebRTC Data Channels — Game Development*. [MDN](https://developer.mozilla.org/en-US/docs/Games/Techniques/WebRTC_data_channels)

7. Gambetta, G. (n.d.). *Client-Side Prediction and Server Reconciliation*. [gabrielgambetta.com](https://www.gabrielgambetta.com/client-side-prediction-server-reconciliation.html)

8. Colyseus Documentation. *Scalability*. [docs.colyseus.io](https://docs.colyseus.io/deployment/scalability)

9. Rajput, N. (2024). *Event Loop Bottlenecks: Diagnosing Node Performance Under High Load*. [Medium](https://medium.com/@hadiyolworld007/event-loop-bottlenecks-diagnosing-node-performance-under-high-load-4ebab059848d)

10. Bai, F. et al. (2009). *Offloading AI for Peer-to-Peer Games with Dead Reckoning*. IPTPS. [USENIX](https://www.usenix.org/legacy/event/iptps09/tech/full_papers/bai/bai_html/index.html)

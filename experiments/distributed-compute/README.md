# Distributed Compute Experiment

> **Status:** Prototype / Architecture sketch — NOT integrated into the main game.
> All files here are self-contained. **Zero changes to `src/` or `server/`.**

## What This Is

An experimental architecture for offloading server computation to connected LAN clients.

The server currently runs a naive O(B×E) collision loop (18,000 distance checks/tick at 90 enemies + 200 bullets) entirely on Node.js's single event-loop thread. This experiment shows two strategies to fix that:

- **Phase 1 — Server-side parallelism**: Worker Thread + SpatialHash (pure server-side, zero security risk)
- **Phase 2 — Hybrid client AI**: Delegate enemy AI computation to client browsers (novel, requires trust model)

See `decisions/distributed-computation-feasibility-2026-02-21.md` for the full feasibility analysis.

---

## Folder Structure

```
distributed-compute-experiment/
├── README.md                        ← You are here
├── protocol/
│   └── messages.ts                  ← All message types (server↔client + worker↔main)
├── server/
│   ├── SpatialHash.ts               ← Phase 1.1: O(B+E) collision broad phase
│   ├── CollisionWorker.ts           ← Phase 1.2: Node.js Worker Thread (runs spatial hash)
│   ├── CollisionWorkerBridge.ts     ← Phase 1.2: Main-thread interface to worker
│   ├── ComputationPool.ts           ← Phase 2: Client eligibility + eviction
│   ├── AiTaskDispatcher.ts          ← Phase 2: Task dispatch, validation, result storage
│   └── GameRoom.patched.ts          ← Annotated diff: exactly what changes in GameRoom.ts
├── client/
│   ├── AiWorker.ts                  ← Phase 2: Browser Web Worker (AI computation)
│   └── AiWorkerBridge.ts            ← Phase 2: Client-side bridge + heartbeat
└── tests/
    ├── SpatialHash.test.ts          ← Unit tests for SpatialHash
    └── AiTaskDispatcher.test.ts     ← Unit tests for validation + dispatcher
```

---

## Running the Tests

```bash
cd distributed-compute-experiment

# Install test runner (one-time)
npm init -y
npm install -D vitest typescript @types/node

# Run tests
npx vitest run tests/
```

---

## The Two Approaches

### Phase 1: Server-Side Worker Threads

**No protocol changes. No security risks. Pure performance gain.**

```
Before:  tickGame() runs on main thread
          ├─ applyPlayerMovement()  [0.1ms]
          ├─ updateBullets()        [0.5ms]
          ├─ updateEnemies()        [0.5ms]
          ├─ checkCollisions()      [1-3ms]  ← BLOCKS main thread
          ├─ updateWeaponPickups()  [0.1ms]
          └─ state patching         [2-5ms]  ← Has to WAIT for collision to finish

After:   tickGame() uses double-buffering
          Main thread (non-blocking):
          ├─ apply worker result from tick N-1  [<0.1ms]
          ├─ applyPlayerMovement()              [0.1ms]
          ├─ updateBullets()                    [0.5ms]
          ├─ updateEnemies()                    [0.5ms]
          ├─ state patching                     [2-5ms]  ← No longer blocked!
          └─ send tick N positions to worker    [<0.1ms]

          Worker thread (parallel):
          └─ SpatialHash + collision check      [0.1-0.5ms]  ← runs in parallel
```

**Combined win: SpatialHash reduces collision ops by ~96%, Worker Thread frees the main thread.**

**Files to read:** `server/SpatialHash.ts`, `server/CollisionWorker.ts`, `server/CollisionWorkerBridge.ts`

**Changes needed in GameRoom.ts:** See `server/GameRoom.patched.ts` Phase 1 section.

---

### Phase 2: Hybrid Client AI

**Offloads enemy AI computation to client browsers. Clients have idle CPU in LAN mode.**

```
Current state in LAN mode:
  Server:  Full AI computation (O(E×P) = 360 comparisons/tick at 90 enemies)
  Client:  Idle — only rendering interpolated server state, no AI needed

Proposed state:
  Server:  Dispatches 50% of enemies to a client's browser
  Client:  Web Worker computes nearest-player homing, posts result back
  Server:  Validates result, applies if safe, falls back to server AI if not
```

**Communication protocol:**

```
Server tick N:
  1. Server computes full AI authoritatively (authoritative fallback always ready)
  2. Sends AiTask to elected client: { enemies: [{id, type, u, v}], players: [{...}], dt }

Client receives task (in Web Worker):
  3. Computes nearest-player homing for each enemy (same formula as server)
  4. Sends AiResult back: { results: [{id, du, dv}] }

Server tick N+1 (when result arrives):
  5. V1: Range validation — rejects results faster than enemy speed limit
  6. V2: Cross-validates 10% of results against server's own computation
  7. Applies validated results; uses server fallback for any rejected ones
  8. Records acceptance rate; evicts clients >5% rejection rate
```

**Security model (for a LAN game of friends):**

| Threat | Mitigation | Severity if uncaught |
|--------|------------|---------------------|
| Teleporting enemies | V1 range clamping (hard limit) | Medium |
| Steering enemies away | V2 cross-validation (10% sample) | Low (detectable in ~2s) |
| Flooding server with bad results | Client eviction after 100-task window | Low |
| Compromising 2 clients simultaneously | V3 dual-client redundancy (optional) | Very Low (LAN) |

A cheating client's maximum impact: steer ~10% of enemies by ≤10-20% of a tile per tick.
Detected within 2 seconds. Not game-breaking for a co-op game between friends.

**Files to read:** `server/ComputationPool.ts`, `server/AiTaskDispatcher.ts`, `client/AiWorker.ts`, `client/AiWorkerBridge.ts`

**Changes needed in GameRoom.ts:** See `server/GameRoom.patched.ts` Phase 2 section.

---

## Performance Estimates

Based on `decisions/distributed-computation-feasibility-2026-02-21.md`:

| Scenario | Current tick time | After Phase 1 | After Phase 1+2 |
|----------|------------------|---------------|-----------------|
| 4 players, 90 enemies, 200 bullets | 3–8ms | 1–3ms | 0.5–1.5ms |
| 4 players, 300 enemies, 400 bullets | 15–25ms (over budget!) | 3–8ms | 1–3ms |
| Budget (60Hz) | 16.6ms | 16.6ms | 16.6ms |

---

## What Would Change in Existing Files

Only two files in the main codebase need to change:

### `server/rooms/GameRoom.ts`

All changes are documented with `[ADD]`/`[REMOVE]`/`[CHANGE]` annotations in `server/GameRoom.patched.ts`.

Summary:
- Phase 1.1: ~15 lines (SpatialHash in checkCollisions)
- Phase 1.2: ~30 lines (CollisionWorkerBridge lifecycle + double-buffer)
- Phase 2: ~60 lines (ComputationPool + AiTaskDispatcher integration)

### `src/network-main.ts` (Phase 2 only)

```typescript
// Add after room join:
const aiBridge = new AiWorkerBridge(room);
aiBridge.start();
room.onMessage('ai_task', task => aiBridge.handleTask(task));

// Add in render loop:
aiBridge.recordFrameTime(frameMs);

// Add on disconnect:
aiBridge.stop();
```

**Nothing else changes.** The Colyseus schema (GameState.ts) does not need new fields.
The existing schema state already carries all entity positions the client needs.
Custom messages (`room.send()`) handle the AI task round-trip outside the schema.

---

## Trade-off Summary

| Approach | Gains | Cost | Recommended? |
|----------|-------|------|-------------|
| SpatialHash on server (Phase 1.1) | 96% fewer collision checks | 1 day | **YES — do first** |
| Worker Thread (Phase 1.2) | Unblock main thread | 2 days | YES, after 1.1 |
| Hybrid client AI (Phase 2) | Scale to 300+ enemies | 5 days | Only if Phase 1 insufficient |
| CPU monitoring setting | UX + client opt-in | 1 day | Nice to have |
| Dual-client redundancy (V3) | Stronger anti-cheat | 2 days | No — LAN game |
| WebRTC P2P | — | 5 days | NO — adds complexity, LAN latency already ~1ms |
| Deterministic lockstep | — | Very high | NO — requires floating-point sync across browsers |

---

## Key Invariants (Must Not Break)

1. **Server is always authoritative.** Client results are advisory only. The server applies them as a performance optimisation, not as ground truth.

2. **Graceful degradation.** If all clients are slow, evicted, or disconnected, the game runs exactly as it does today — at 100% server load. No new failure modes.

3. **The AI algorithm must be byte-identical between `AiTaskDispatcher.computeServerAI()` and `client/AiWorker.ts`'s `computeAI()`.** Any divergence causes false positives in V2 cross-validation.

4. **Double-buffer tick alignment.** Collision worker results apply to tick N+1, not tick N. This is intentional (one-tick lag is imperceptible at 60Hz). Don't try to make it synchronous — that defeats the purpose.

5. **The SpatialHash must be cleared at the start of each tick** before re-inserting enemies. Stale entries cause ghost collisions.

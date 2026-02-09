# Distributed Compute Load for Mixed-Capability Multiplayer Clients

## Research Document -- Geometry Wars 3D Dimensions Browser Recreation

**Date:** 2026-02-09
**Scope:** Architecture design for 10K+ entities at 60fps across heterogeneous client hardware
**Status:** Research complete, ready for implementation planning

---

## Executive Summary

This document addresses a fundamental challenge: how to run a multiplayer browser game with 10,000+ entities at 60fps when players connect from vastly different hardware -- a gaming PC, a Chromebook, a phone, and a tablet, all in the same session.

The solution is a **tiered asymmetric architecture** where the server dynamically adjusts what each client receives and computes based on measured capability. Strong clients do more local simulation and receive more data. Weak clients receive pre-filtered, lower-frequency updates and offload physics to the server or nearby strong clients.

**Key findings:**

1. Client capability can be reliably scored using 5 browser APIs (`navigator.hardwareConcurrency`, `navigator.deviceMemory`, WebGL/WebGPU probe, `navigator.connection`, Battery Status API) and a 500ms runtime benchmark.
2. The existing InterestManager + PriorityQueue system provides the ideal foundation for per-client adaptive filtering -- extending it with client-specific AOI radii and update rates is straightforward.
3. Entity simulation can be partitioned: the server always owns authoritative state, but capable clients can speculatively simulate nearby entities and submit results for validation.
4. WebRTC data channels between clients enable a "helper node" pattern where a gaming PC computes physics for a nearby phone player, reducing server load by up to 40%.
5. Binary delta encoding (already partially implemented via Colyseus Schema patches) can reduce bandwidth 3-5x over the current approach by adding quantization and bitpacking.
6. The existing `AdaptiveQuality`, `LODManager`, `EntityLimits`, and `WorkerBridge` systems provide 80% of the client-side infrastructure needed -- the remaining work is server-side coordination.

**Projected performance:**

| Scenario | Without optimization | With full system |
|----------|---------------------|------------------|
| Gaming PC (high tier) | 10K entities, 60fps | 10K entities, 60fps |
| Tablet (medium tier) | 10K entities, 15fps | 2K visible, 45fps |
| Chromebook (low tier) | 10K entities, 5fps | 500 visible, 30fps |
| Phone (minimal tier) | 10K entities, 2fps | 200 visible, 30fps |
| Server bandwidth (4 players) | 47 MB/s | 3.8 MB/s (92% reduction) |

---

## Table of Contents

1. [Problem Statement](#1-problem-statement)
2. [Client Capability Detection](#2-client-capability-detection)
3. [Server-Side Load Distribution](#3-server-side-load-distribution)
4. [Interest Management Enhancement](#4-interest-management-enhancement)
5. [Compute Offloading Patterns](#5-compute-offloading-patterns)
6. [Rendering Adaptation](#6-rendering-adaptation)
7. [Real-World Examples](#7-real-world-examples)
8. [Implementation Roadmap](#8-implementation-roadmap)
9. [Risk Assessment](#9-risk-assessment)
10. [Sources](#10-sources)

---

## 1. Problem Statement

### The Scenario

Four players join a Geometry Wars session on the same torus surface:

```
Player A: Gaming PC (RTX 4080, 32GB, 16 cores, fiber internet)
Player B: iPad Pro (M2 chip, 8GB, good WiFi)
Player C: Chromebook (Intel Celeron, 4GB, school WiFi)
Player D: Android phone (Snapdragon 695, 6GB, 4G cellular)
```

The game world has 10,000 entities: 500 enemies, 2000 bullets, 5000 particles, 1500 geoms, 1000 other effects. All players must have a fair, responsive experience.

### Current Architecture Limitations

```
                    CURRENT ARCHITECTURE
                    =====================

  +-----------+     +------------------+     +-----------+
  | Client A  |<--->|                  |<--->| Client C  |
  | (PC)      |     |  Colyseus Server |     | (Chromebk)|
  +-----------+     |  GameRoom.ts     |     +-----------+
                    |  - 60Hz tick     |
  +-----------+     |  - All physics   |     +-----------+
  | Client B  |<--->|  - All AI        |<--->| Client D  |
  | (iPad)    |     |  - All collision |     | (Phone)   |
  +-----------+     +------------------+     +-----------+

  Problem: Server sends SAME data to ALL clients at SAME rate.
  The Chromebook gets 10K entity updates it cannot process.
  The gaming PC is idle while the server does all physics.
```

Specific bottlenecks in the current codebase:

1. **GameRoom.ts** (line 96): `setSimulationInterval` at 60Hz processes ALL entities every tick regardless of client count or capability. At 10K entities, this is ~600K operations/second on a single Node.js thread.

2. **InterestManager.ts** (line 98): AOI radius is fixed at 0.3 UV units for all clients. The Chromebook's AOI should be smaller than the PC's, but currently they're identical.

3. **GameState.ts**: Colyseus Schema patches are sent at `setPatchRate(50)` (line 99 of GameRoom.ts) -- same rate for all clients regardless of their connection quality.

4. **EntityLimits.ts**: Client-side limits exist (high=500 enemies, low=80) but are only used locally for rendering. The server doesn't know about or respect these limits.

### Requirements

- All players see the same game (consistency)
- No player has an unfair advantage from hardware (fairness)
- Each client runs at its best achievable frame rate (performance)
- Server scales to 10K+ entities without becoming the bottleneck (scalability)
- System degrades gracefully, not catastrophically (resilience)

---

## 2. Client Capability Detection

### Available Browser APIs

The following APIs are available for detecting client capabilities. Browser support is noted (as of 2026).

| API | What It Measures | Support | Reliability |
|-----|-----------------|---------|-------------|
| `navigator.hardwareConcurrency` | Logical CPU cores | All browsers | High |
| `navigator.deviceMemory` | RAM in GB (bucketed) | Chromium only | Medium |
| `navigator.connection.downlink` | Bandwidth in Mbps | Chromium only | Medium |
| `navigator.connection.rtt` | Round-trip time in ms | Chromium only | Medium |
| `navigator.getBattery()` | Battery level + charging | Chromium (secure) | Low |
| WebGL `UNMASKED_RENDERER_WEBGL` | GPU model string | All browsers | High |
| `navigator.gpu.requestAdapter()` | WebGPU support | Chrome/Edge/Safari/FF | High |
| `performance.now()` benchmark | Actual computation speed | All browsers | High |

### Capability Score Algorithm

The existing `GPUCapabilities.ts` already detects WebGPU/WebGL2/WebGL1 and CPU cores. We extend it into a comprehensive capability score.

```
CAPABILITY SCORING ALGORITHM
=============================

                 +-----------+
                 | Raw APIs  |
                 +-----------+
                      |
          +-----------+-----------+
          |           |           |
     +--------+  +--------+  +--------+
     |  GPU   |  |  CPU   |  |Network |
     | Score  |  | Score  |  | Score  |
     +--------+  +--------+  +--------+
     | WebGPU |  | cores  |  | RTT    |
     | WebGL2 |  | memory |  | downlk |
     | texSz  |  | bench  |  | type   |
     | render |  |        |  |        |
     +--------+  +--------+  +--------+
          |           |           |
          v           v           v
     +-----------------------------------+
     |     Composite Capability Score    |
     |       (0-100, 4 tiers)            |
     +-----------------------------------+
     | HIGH:    75-100  (gaming PC)      |
     | MEDIUM:  45-74   (tablet/laptop)  |
     | LOW:     20-44   (chromebook)     |
     | MINIMAL: 0-19    (old phone)      |
     +-----------------------------------+
```

### Proposed Implementation

```typescript
// New file: src/network/ClientCapability.ts

interface ClientCapabilityReport {
  // Raw measurements
  gpu: {
    api: 'webgpu' | 'webgl2' | 'webgl1' | 'none';
    renderer: string;
    maxTextureSize: number;
  };
  cpu: {
    cores: number;
    memoryGB: number;           // navigator.deviceMemory || estimated
    benchmarkScore: number;     // ops/ms from 500ms benchmark
  };
  network: {
    rttMs: number;              // navigator.connection.rtt || measured
    downlinkMbps: number;       // navigator.connection.downlink || estimated
    connectionType: string;     // 'wifi' | '4g' | '3g' | 'ethernet' | 'unknown'
  };
  battery: {
    level: number;              // 0-1 (1.0 if plugged in or unavailable)
    charging: boolean;
  };

  // Computed scores (0-100)
  gpuScore: number;
  cpuScore: number;
  networkScore: number;
  compositeScore: number;

  // Tier assignment
  tier: 'high' | 'medium' | 'low' | 'minimal';

  // Derived limits for server
  maxEntitiesPerTick: number;   // How many entity updates client can process
  maxAoiRadius: number;         // Suggested AOI radius in UV space
  targetFps: number;            // 60 for high, 30 for low/minimal
  canSimulatePhysics: boolean;  // Whether client should do local physics
  workerCount: number;          // How many Web Workers to use
}
```

### Runtime Benchmark

Static API detection alone is insufficient. A 500ms microbenchmark at connection time provides the most reliable measure of actual computation capability:

```typescript
function runCPUBenchmark(durationMs: number = 500): number {
  const start = performance.now();
  let ops = 0;

  // Simulate typical game operations: vector math, collision checks
  while (performance.now() - start < durationMs) {
    for (let i = 0; i < 1000; i++) {
      // Simulate distance calculation (the hot path in collision detection)
      const dx = Math.random() - 0.5;
      const dy = Math.random() - 0.5;
      const dz = Math.random() - 0.5;
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
      ops++;
    }
  }

  return ops / durationMs; // ops per millisecond
}
```

Expected results across devices:

| Device | ops/ms | Score |
|--------|--------|-------|
| Gaming PC (5GHz i9) | 450+ | 95-100 |
| iPad Pro (M2) | 300-400 | 70-85 |
| Chromebook (Celeron) | 80-150 | 25-40 |
| Budget Android | 40-80 | 10-20 |

### Continuous Monitoring

Capability isn't static. A phone's CPU may throttle under heat. WiFi congestion changes. The system must re-evaluate periodically:

```
CONTINUOUS CAPABILITY MONITORING
=================================

  Connection:   Full benchmark (500ms)
       |             |
       v             v
  [Capability Report] --> Server stores per-client
       |
  Every 10 seconds:
       |
  [Performance sample] --> FPS, frame time variance
       |
  If degradation detected (FPS drops >20% below target):
       |
  [Quick re-benchmark (100ms)] --> Update tier if needed
       |
  Server adjusts:
       - AOI radius
       - Update frequency
       - Entity count cap
```

### Integration with Existing Code

The existing `GPUCapabilities.ts` provides `GPUCapabilityReport` with `tier: 'high' | 'medium' | 'low'`. The new system:

1. Wraps `detectGPUCapabilities()` for the GPU component
2. Adds CPU benchmark, network quality, and battery status
3. Produces a 4-tier classification instead of 3-tier
4. Sends the report to the server on connection
5. Updates the server periodically with performance deltas

---

## 3. Server-Side Load Distribution

### Architecture Overview

```
              PROPOSED ARCHITECTURE: ASYMMETRIC SERVER
              =========================================

  +----------------+                          +----------------+
  | Client A (PC)  |                          | Client C (CB)  |
  | Tier: HIGH     |                          | Tier: LOW      |
  |                |                          |                |
  | Simulates:     |                          | Simulates:     |
  | - Own physics  |                          | - Nothing      |
  | - Nearby AI    |                          | - Render only  |
  | - 10K entities |                          | - 200 entities |
  | - 60fps target |                          | - 30fps target |
  +-------+--------+                          +-------+--------+
          |  WebSocket + WebRTC                       |  WebSocket
          |  60Hz updates                             |  10Hz updates
          v                                           v
  +----------------------------------------------------------+
  |                   Colyseus Server                         |
  |                                                           |
  |  GameRoom.ts (enhanced)                                   |
  |  +------------------------------------------------------+ |
  |  | ClientRegistry: per-client capability + limits        | |
  |  | EntityPartitioner: assigns entities to clients        | |
  |  | AdaptiveInterestManager: per-client AOI + rates       | |
  |  | PhysicsAuthority: validates client-submitted physics  | |
  |  | BandwidthBudget: per-client byte/s cap                | |
  |  +------------------------------------------------------+ |
  |                                                           |
  +----------------------------------------------------------+
          |                                           |
          v                                           v
  +-------+--------+                          +-------+--------+
  | Client B (iPad)|                          | Client D (Phon)|
  | Tier: MEDIUM   |                          | Tier: MINIMAL  |
  |                |                          |                |
  | Simulates:     |                          | Simulates:     |
  | - Own physics  |                          | - Nothing      |
  | - 2K entities  |                          | - Render only  |
  | - 45fps target |                          | - 100 entities |
  | - Workers x2   |                          | - 30fps target |
  +----------------+                          +----------------+
```

### Per-Client Entity Budgets

The server maintains a per-client budget derived from the capability score:

```
ENTITY BUDGET TABLE
====================

Tier     | Max entities | Update Hz | AOI radius | Bandwidth cap
---------|-------------|-----------|------------|-------------
HIGH     | 10000       | 60        | 0.5 UV     | 2.0 MB/s
MEDIUM   | 2000        | 30        | 0.3 UV     | 500 KB/s
LOW      | 500         | 15        | 0.2 UV     | 150 KB/s
MINIMAL  | 200         | 10        | 0.15 UV    | 50 KB/s
```

### Entity Partitioning Strategy

When the entity count exceeds a client's budget, entities are prioritized using a weighted scoring system:

```
ENTITY PRIORITY SCORE
======================

Priority = w_dist * (1 - distance/maxDist)   // Closer = higher
         + w_type * typeWeight                // Enemies > geoms > particles
         + w_threat * threatLevel             // Enemies heading toward player
         + w_interact * interactionProb       // Near collision = must sync

Weights:
  w_dist    = 0.4   (proximity is most important)
  w_type    = 0.2   (enemy types matter more)
  w_threat  = 0.3   (immediate threats must sync)
  w_interact = 0.1  (collision-relevant entities)

Type weights:
  Player bullets:     1.0  (always show your own bullets)
  Enemies (hostile):  0.9
  Other player:       0.8
  Weapon pickups:     0.6
  Geoms:              0.3
  Particles:          0.1  (cosmetic, skip for low-tier)
```

### Asymmetric Update Rates

Different entity categories update at different frequencies per client tier:

```
UPDATE FREQUENCY MATRIX (ticks per sync)
=========================================

                    HIGH  MEDIUM  LOW   MINIMAL
Own player          1     1       1     1        (always every tick)
Other players       1     2       3     6
Nearby enemies      1     2       4     6
Distant enemies     3     6       12    NONE
Own bullets         1     1       2     3
Other bullets       2     4       NONE  NONE
Geoms (close)       1     3       6     10
Geoms (far)         6     NONE    NONE  NONE
Weapon pickups      2     4       6     10
Particles           1     NONE    NONE  NONE

NONE = not synced at all (client doesn't receive this entity category)
```

### Server-Side Physics Delegation

For MINIMAL and LOW tier clients, the server handles all physics. For MEDIUM and HIGH tier clients, the server can delegate:

```
PHYSICS AUTHORITY MODEL
========================

  Server tick (always runs at 60Hz):
    1. Receive inputs from all clients
    2. For each entity:
       a. Is a capable client authoritative? -> Accept client's result
       b. Otherwise -> Server computes physics
    3. Validate client-submitted results (anti-cheat)
    4. Broadcast state per client's budget/rate

  Client-side physics (HIGH/MEDIUM only):
    1. Receive authoritative state from server
    2. Predict own player movement (client-side prediction)
    3. Simulate nearby entities locally (speculative)
    4. Submit simulation results to server
    5. Server validates: if result is within tolerance, accept;
       otherwise, override with server result

  Validation tolerance:
    Position: 0.01 UV units (prevents teleportation cheats)
    Velocity: 10% deviation from expected (prevents speed hacks)
    Collision: server re-checks all claimed kills (authoritative scoring)
```

---

## 4. Interest Management Enhancement

### Current System Analysis

The existing `InterestManager` and `PriorityQueue` system is well-designed:

- **PriorityQueue.ts**: Classifies entities into HIGH/MEDIUM/LOW/NONE tiers based on UV distance from player, with configurable thresholds (default: 0.1/0.2/0.3)
- **InterestManager.ts**: Runs per-tick, produces per-player sync sets, tracks metrics and bandwidth savings
- **Surface wrapping**: Correctly handles UV wrapping for all 10 surface types

### Proposed Enhancements

#### 4.1 Per-Client Adaptive AOI

Instead of a fixed AOI radius, make it dynamic per client:

```
ADAPTIVE AOI RADIUS
=====================

Current:  Fixed 0.3 UV for all clients
Proposed: Dynamic per-client based on capability + game state

  Base AOI = tier_base_radius (from capability report)

  Adjustments:
    + 0.05 if player is moving fast (needs to see ahead)
    - 0.03 if entity count in AOI > client budget * 0.8
    + 0.02 if player has homing weapon (needs to see targets)
    - 0.05 if network congestion detected (RTT spike)
    + 0.03 if player is low on lives (heightened awareness)

  Clamped to: [0.1, 0.6] UV units

  Implementation: Extend InterestManagerConfig to accept per-player overrides
```

#### 4.2 Priority-Based Update Batching

Group entity updates into priority batches. Send high-priority batch every tick, lower-priority batches on alternating ticks:

```
BATCHED UPDATE SCHEDULE (per client tick)
==========================================

  Tick N:     [HIGH batch] + [MEDIUM batch]
  Tick N+1:   [HIGH batch] + [LOW batch]
  Tick N+2:   [HIGH batch] + [MEDIUM batch]
  ...

  Batch contents:
    HIGH:   Entities within inner AOI (threat-relevant)
    MEDIUM: Entities in mid AOI (visible, not immediate threat)
    LOW:    Entities in outer AOI (background awareness)

  For MINIMAL tier clients:
    Only HIGH batch, every 3rd tick
```

#### 4.3 Delta Compression

The current Colyseus Schema patches track property-level changes. We can further compress:

```
COMPRESSION PIPELINE
=====================

  Raw state change: { surfaceU: 0.542891, surfaceV: 0.331294 }
                    (16 bytes as two Float64)

  Step 1 - Quantize:
    U and V are [0,1], quantize to Uint16 (65536 levels = 0.0015% precision)
    4 bytes total (2x Uint16)

  Step 2 - Delta encode:
    Send difference from last known value
    Most deltas fit in Int8 (-128 to 127 steps of 1/65536)
    2 bytes for typical frame

  Step 3 - Bitpack:
    Entity ID (12 bits for 4096 entities) + deltaU (8 bits) + deltaV (8 bits)
    = 28 bits per entity update = 3.5 bytes

  Compression ratio: 16 bytes -> 3.5 bytes = 4.6x reduction
```

#### 4.4 Integration with Existing PriorityQueue

The `PriorityQueue.classify()` method already returns `PriorityEntry[]` sorted by distance. The enhancement adds client-specific thresholds:

```typescript
// Extend PriorityQueue constructor to accept per-client overrides
class AdaptivePriorityQueue extends PriorityQueue {
  classifyForClient(
    playerPos: UVPosition,
    entities: ReadonlyArray<{ id: string } & UVPosition>,
    wrapU: boolean,
    wrapV: boolean,
    clientThresholds: PriorityThresholds,  // Per-client thresholds
    clientIntervals: SyncIntervals,         // Per-client sync intervals
    entityBudget: number,                   // Max entities for this client
  ): PriorityEntry[] {
    const entries = this.classify(playerPos, entities, wrapU, wrapV);

    // Reclassify with client-specific thresholds
    for (const entry of entries) {
      entry.priority = classifyPriority(entry.distance, clientThresholds);
    }

    // Enforce budget: if too many entities, demote lowest priority
    if (entries.length > entityBudget) {
      // Already sorted by distance; truncate at budget
      for (let i = entityBudget; i < entries.length; i++) {
        entries[i].priority = SyncPriority.NONE;
      }
    }

    return entries;
  }
}
```

### Bandwidth Projections

Using `InterestManager.estimateBandwidthSavings()` as a baseline, extended with per-client AOI:

```
BANDWIDTH ANALYSIS: 10K ENTITIES, 4 PLAYERS
=============================================

Without any interest management:
  10000 entities * 4 players * 60 ticks/s * 20 bytes/entity
  = 48,000,000 bytes/s = 45.8 MB/s

With current InterestManager (fixed AOI 0.3):
  ~28% of entities per player at mixed rates
  = ~6.4 MB/s

With adaptive per-client interest management:
  HIGH client:  5000 entities avg * 60Hz * 20B  = 6.0 MB/s
  MEDIUM client: 1200 entities avg * 30Hz * 12B = 432 KB/s
  LOW client:    300 entities avg * 15Hz * 8B   = 36 KB/s
  MINIMAL client: 100 entities avg * 10Hz * 6B  = 6 KB/s
  Total: ~6.5 MB/s server egress

With delta compression added:
  Reduce per-entity bytes from 20 to ~4 bytes average
  Total: ~1.3 MB/s server egress

Final: 97% bandwidth reduction from naive approach.
```

---

## 5. Compute Offloading Patterns

### Pattern 1: Server Delegates to Capable Clients

The server is a single Node.js thread. At 10K entities, physics alone can consume 100% of a CPU core. Capable clients can help.

```
DELEGATED PHYSICS PATTERN
===========================

Server maintains a DelegationMap:

  Entity region A (UV 0.0-0.25, 0.0-0.5)  -> Client A (HIGH tier)
  Entity region B (UV 0.25-0.5, 0.0-0.5)  -> Server (no capable client nearby)
  Entity region C (UV 0.5-0.75, 0.5-1.0)  -> Client B (MEDIUM tier)
  Entity region D (UV 0.0-0.5, 0.5-1.0)   -> Server

Flow:
  1. Server partitions UV space into regions
  2. For each region, finds the most capable client nearby
  3. Sends "simulate these entities" message with entity data
  4. Client runs physics on its Web Workers
  5. Client returns results within 16ms deadline
  6. Server validates and broadcasts

Fallback: If client doesn't respond within deadline, server
          computes that region and revokes delegation.
```

### Pattern 2: Helper Node (Client-to-Client Compute Sharing)

A gaming PC can compute physics for a nearby phone player via WebRTC:

```
HELPER NODE PATTERN
====================

  +----------+   WebRTC DataChannel    +----------+
  | Client A |<========================>| Client D |
  | (PC)     |   (direct, low latency) | (Phone)  |
  | HIGH tier|                          | MINIMAL  |
  +----+-----+                          +----+-----+
       |                                     |
       |  WebSocket                          |  WebSocket
       v                                     v
  +--------------------------------------------------+
  |              Colyseus Server                      |
  |  Coordinates helper assignments                   |
  |  Validates all results                            |
  +--------------------------------------------------+

Flow:
  1. Server detects Client D is MINIMAL tier
  2. Server finds Client A is HIGH tier and has spare capacity
  3. Server assigns Client A as "helper" for Client D's nearby entities
  4. Server establishes WebRTC signaling between A and D
  5. Client A sends entity state directly to D via DataChannel
  6. Client A also sends physics results to server for validation
  7. Client D receives pre-computed state, only needs to render

Benefits:
  - Reduces server physics load by ~25-40%
  - Reduces server bandwidth (direct A->D bypasses server)
  - Lower latency for D (direct connection to A)

Risks:
  - Client A could cheat (server still validates)
  - WebRTC connection may fail (fallback to server-only)
  - Client A may disconnect (reassign helper role)
```

### Pattern 3: Existing Web Workers Enhancement

The current `WorkerBridge.ts` and `WorkerPool.ts` support collision detection and AI on Web Workers with SharedArrayBuffer. Enhancement:

```
WORKER SCALING BY TIER
========================

Tier     | Workers | Collision | AI  | Physics | Render prep
---------|---------|-----------|-----|---------|------------
HIGH     | 4-6     | Dedicated | Ded | Ded     | 1-2 workers
MEDIUM   | 2-3     | Shared    | Shd | Main    | 1 worker
LOW      | 1       | Main      | Svr | Svr     | None
MINIMAL  | 0       | Server    | Svr | Svr     | None

"Svr" = computed on server, result sent to client
"Ded" = dedicated worker thread
"Shd" = shared worker (time-sliced between tasks)
"Main" = runs on main thread (small entity count makes this OK)
```

The existing `WorkerBridge` already handles the Worker/fallback pattern:

```typescript
// WorkerBridge.ts line 120: already checks isWorkerAvailable()
this.useWorkers = (config.useWorkers ?? true) && WorkerBridge.isWorkerAvailable();
```

Enhancement: make worker count dynamic based on capability tier:

```typescript
// Enhanced WorkerBridge constructor
constructor(config: WorkerBridgeConfig = {}, tier: ClientTier) {
  const workerCounts = {
    high: { collision: 2, ai: 2, physics: 2 },
    medium: { collision: 1, ai: 1, physics: 0 },
    low: { collision: 0, ai: 0, physics: 0 },
    minimal: { collision: 0, ai: 0, physics: 0 },
  };

  this.workerConfig = workerCounts[tier];
  // ... allocate workers based on tier
}
```

### Pattern 4: Edge Computing (Cloudflare Workers / Durable Objects)

For scaling beyond a single server:

```
EDGE COMPUTING ARCHITECTURE
=============================

  Client (Brazil)                  Client (Japan)
       |                                |
       v                                v
  +----------+                    +----------+
  | CF Edge  |                    | CF Edge  |
  | Sao Paulo|<=== Durable ===>  | Tokyo    |
  | Worker   |     Object        | Worker   |
  +----------+     (state)       +----------+
       |                                |
       v                                v
  +-----------------------------------------+
  | Central Durable Object (US-East)        |
  | Authoritative game state                |
  | Handles conflict resolution             |
  +-----------------------------------------+

Durable Object capabilities:
  - WebSocket server built-in
  - 500-1000 req/s per object
  - Sub-10ms latency to edge
  - Automatic failover
  - Persistent state across requests

For our use case:
  - 1 Durable Object per game room
  - Edge Workers handle per-client serialization
  - Physics runs in Durable Object (server-authoritative)
  - Each edge node caches entity state for local clients
  - Reduces cross-region latency by 50-80ms
```

However, Cloudflare Durable Objects have a throughput limit of ~1000 req/s per object. At 4 players * 60Hz = 240 req/s, this leaves headroom, but not enough for 10K entity physics at 60Hz. The Durable Object would need to batch physics and send updates, not process each entity as a separate request.

**Recommendation:** Edge computing is valuable for reducing latency in geographically distributed games, but for the current scope (LAN/single-server), it adds complexity without proportional benefit. Defer to Phase 5 (see roadmap).

---

## 6. Rendering Adaptation

### Existing Systems

The codebase already has strong rendering adaptation:

1. **AdaptiveQuality.ts**: 5-level quality system (ULTRA/HIGH/MEDIUM/LOW/MINIMAL) with FPS-based auto-adjustment, hysteresis, and cooldown
2. **LODManager.ts**: 3-level LOD (HIGH/MEDIUM/LOW) with distance-based geometry simplification and billboard fallback
3. **EntityLimits.ts**: Per-tier entity caps (high=500 enemies, medium=200, low=80)
4. **GPUCapabilities.ts**: WebGPU/WebGL2/WebGL1 detection with tier classification

### Proposed Enhancements

#### 6.1 Resolution Scaling

Render at reduced resolution and upscale for lower-tier devices:

```
RESOLUTION SCALING TABLE
==========================

Tier     | Render scale | Effective resolution (1080p target)
---------|-------------|------------------------------------
HIGH     | 1.0         | 1920x1080
MEDIUM   | 0.75        | 1440x810
LOW      | 0.5         | 960x540
MINIMAL  | 0.33        | 640x360

Implementation: renderer.setPixelRatio(renderScale * devicePixelRatio)
  + CSS upscaling on the canvas element
```

#### 6.2 Frame Rate Targets

Different tiers target different frame rates:

```
FRAME RATE TARGETS
===================

Tier     | Target FPS | Physics Hz | Render Hz
---------|-----------|------------|----------
HIGH     | 60        | 60         | 60
MEDIUM   | 45        | 60         | 45
LOW      | 30        | 30         | 30
MINIMAL  | 30        | 15         | 30

Physics Hz: How often physics/AI runs locally
Render Hz: How often the frame is drawn
Note: Physics can run at lower Hz if server provides authoritative state
```

#### 6.3 Visual Effect Scaling

Extend the existing `QualitySettings` with additional knobs:

```
VISUAL EFFECT BUDGET PER TIER
===============================

                    ULTRA   HIGH    MEDIUM  LOW     MINIMAL
Max particles       10000   2000    500     100     0
Max trail points    100     50      20      0       0
Bloom enabled       Yes     Yes     Half    No      No
Bloom resolution    1.0     0.5     0.25    -       -
Shadow maps         Yes     Yes     No      No      No
Grid deformation    Full    Simple  None    None    None
Post-processing     Full    Full    Vign.   None    None
Enemy geometry      Full    Full    LOD     Billbd  Billbd
Geom animation      Full    Simple  Static  Static  Hidden
Chain lightning      Full    Simple  Flash   Flash   None
Explosion particles 100     50      10      3       0
Background music    Full    Full    Simple  None    None
Sound effects       Full    Full    Core    Core    None
```

#### 6.4 Deterministic Rendering Reduction

The key insight from Hordes.io: simulate deterministic effects client-side to avoid syncing them at all.

```
DETERMINISTIC CLIENT-SIDE EFFECTS
===================================

These effects can be computed purely from entity state, with no server sync:

1. Particle explosions: seed = entityId + deathTick -> deterministic random
2. Trail effects: computed from position history (already local)
3. Grid deformation: computed from entity positions (already local)
4. Sound triggers: derived from state changes (enemy dies = play sound)
5. Glow/bloom: entirely a post-process effect on existing geometry
6. Score popups: derived from score delta (already synced)

Server does NOT need to sync:
  - Particle positions/velocities
  - Trail geometry
  - Visual effect triggers
  - Audio state

This alone saves 2000-5000 entity updates per tick.
```

---

## 7. Real-World Examples

### 7.1 Fortnite (Epic Games)

Fortnite handles mixed platforms (PC, console, mobile, Switch) with:

- **Input-based matchmaking**: Controller players matched separately from keyboard/mouse
- **Platform lobbies**: Squad joins the highest-capability platform's lobby
- **Client-side prediction**: All physics predicted locally; server reconciles
- **Adaptive streaming**: Lower-resolution textures streamed to weaker devices
- **Draw distance scaling**: Mobile sees fewer trees/objects at distance

**Applicable lesson**: Fortnite does NOT send different game data to different platforms. All clients receive the same state. The difference is in rendering quality and input handling. This is simpler but requires all clients to handle the full entity count.

**Our adaptation**: We cannot afford this approach because a phone browser cannot process 10K entity updates. We need server-side filtering (which Fortnite doesn't need because its clients are native apps with 4-8GB RAM minimum).

### 7.2 Hordes.io (Dek)

Hordes.io is a browser MMORPG built with WebGL (originally Three.js, later custom OGL renderer):

- **Custom binary serialization**: Replaced Socket.io/JSON with custom binary protocol + uWebsockets. Described as allowing "much more data to be sent at a fraction of the cost."
- **Deterministic simulation**: Simulate as much as possible with deterministic logic client-side, reducing what needs to be synced.
- **View distance**: Each client only receives entities within their view radius.
- **Entity simplification**: Distant entities are simplified server-side before sending.

**Applicable lesson**: Binary protocol + deterministic client-side simulation + view-distance filtering is the proven browser game approach. Our existing Colyseus Schema patches provide property-level delta encoding; adding quantization and bitpacking on top would match Hordes.io's approach.

### 7.3 SpatialOS (Improbable)

SpatialOS's distributed simulation architecture is the most relevant to our "helper node" pattern:

- **Single writer principle**: For any entity, exactly one worker has write authority. Prevents conflicts.
- **Dynamic worker allocation**: Workers are brought up/down to reflect workload. Entity assignments change continuously.
- **Authority delegation**: Components of the same entity can be owned by different workers. Physics component owned by physics worker; AI component owned by AI worker.
- **600+ physics workers**: Their larger simulations use hundreds of physics workers to simulate huge areas.

**Applicable lesson**: The single-writer-per-entity principle maps directly to our delegation model. When the PC client simulates entities in its region, it has temporary write authority. The server revokes that authority if the client is too slow or disconnects.

### 7.4 Cloudflare Durable Objects

Recent multiplayer games built on Cloudflare:

- **Durable World**: A 3D multiplayer game using Durable Objects + Unity WebGL. State persists in the Durable Object. Players interpolate between server updates rather than sending 60Hz updates.
- **Doom Multiplayer**: Full Doom running in the browser with Durable Objects backend. Uses WASM for game logic + WebSocket for networking.

**Applicable lesson**: Durable Objects work well for room-based games with moderate player counts. The 500-1000 req/s limit per object means we need to batch updates efficiently.

### 7.5 Industry Patterns Summary

| Pattern | Used by | Complexity | Benefit | Our priority |
|---------|---------|------------|---------|--------------|
| Per-client AOI | Most MMOs, Hordes.io | Low | High | Phase 1 |
| Binary protocol | Hordes.io, most prod games | Medium | High | Phase 1 |
| Client-side prediction | Fortnite, most shooters | Medium | Medium | Phase 2 |
| Deterministic client effects | Hordes.io, RTS games | Low | Medium | Phase 1 |
| Physics delegation | SpatialOS | High | High | Phase 3 |
| WebRTC helper nodes | Research papers | High | Medium | Phase 4 |
| Edge computing | Cloudflare games | Medium | Low (LAN) | Phase 5 |

---

## 8. Implementation Roadmap

### Phase 1: Client Capability + Adaptive Interest Management (2-3 weeks)

**Objective**: Each client receives only what it can handle, at the right rate.

```
PHASE 1 DELIVERABLES
=====================

1. ClientCapability.ts (new)
   - Extend GPUCapabilities.ts with CPU benchmark, network, battery
   - 4-tier classification (high/medium/low/minimal)
   - Send capability report to server on connection

2. GameRoom.ts (modify)
   - Store per-client capability in ClientRegistry
   - Pass client tier to InterestManager

3. InterestManager.ts (modify)
   - Accept per-client AOI radius override
   - Accept per-client entity budget
   - Enforce budget by demoting excess entities to NONE

4. PriorityQueue.ts (modify)
   - Accept per-client thresholds and intervals
   - Add entity type weighting to priority calculation

5. GameState.ts (modify)
   - Use Colyseus StateView for per-client filtering
   - Replace @filter() with StateView API (Colyseus 3.0)

Estimated effort: ~500 lines new code, ~200 lines modified
```

### Phase 2: Asymmetric Update Rates + Delta Compression (2 weeks)

**Objective**: Reduce bandwidth 4-5x while maintaining game feel.

```
PHASE 2 DELIVERABLES
=====================

1. AdaptiveUpdateScheduler.ts (new, server-side)
   - Per-client update frequency per entity category
   - Batched update sends (high + medium on alternating ticks)

2. DeltaCompressor.ts (new, shared)
   - Quantize UV positions to Uint16
   - Delta-encode consecutive updates
   - Bitpack entity updates

3. BandwidthMonitor.ts (new, server-side)
   - Track bytes/s per client
   - Enforce per-client bandwidth caps
   - Dynamically reduce update rate if cap exceeded

4. Deterministic effects (client-side)
   - Seed particle explosions from entityId + tick
   - Remove particle/trail state from server schema
   - Client generates effects from state transitions

Estimated effort: ~800 lines new code, ~300 lines modified
```

### Phase 3: Client-Side Physics Delegation (3 weeks)

**Objective**: Strong clients simulate nearby entities, reducing server load.

```
PHASE 3 DELIVERABLES
=====================

1. PhysicsAuthority.ts (new, server-side)
   - Partition UV space into regions
   - Assign regions to capable clients
   - Validate client-submitted physics results
   - Revoke delegation on timeout or invalid results

2. PhysicsDelegate.ts (new, client-side)
   - Receive delegation assignment from server
   - Run physics for assigned entities on Web Workers
   - Submit results back within 16ms deadline
   - Fall back to server if computation takes too long

3. WorkerBridge.ts (modify)
   - Dynamic worker count based on tier and delegation load
   - Support delegated entity physics alongside local entities

4. Anti-cheat validation (server-side)
   - Position diff checks (max 0.01 UV per tick)
   - Velocity consistency checks
   - Kill/damage validation (server re-checks collisions)

Estimated effort: ~1200 lines new code, ~400 lines modified
```

### Phase 4: WebRTC Helper Nodes (2 weeks)

**Objective**: Gaming PC computes for nearby weak clients via direct connection.

```
PHASE 4 DELIVERABLES
=====================

1. HelperNodeCoordinator.ts (new, server-side)
   - Detect HIGH-tier clients with spare capacity
   - Pair with nearby MINIMAL/LOW-tier clients
   - Manage WebRTC signaling via server

2. HelperNodeClient.ts (new, client-side)
   - WebRTC DataChannel setup (unreliable mode for positions)
   - Send computed entity state directly to paired client
   - Report compute utilization to server

3. HelperNodeReceiver.ts (new, client-side)
   - Receive entity state from helper via DataChannel
   - Merge with server state (helper state = more recent)
   - Fall back to server-only if DataChannel drops

Estimated effort: ~600 lines new code
```

### Phase 5: Edge Computing (Future)

**Objective**: Reduce cross-region latency for geographically distributed players.

```
PHASE 5 DELIVERABLES (Future scope)
=====================================

1. Deploy game server as Cloudflare Durable Object
2. Edge Workers handle per-client serialization
3. Regional state caching at edge nodes
4. Cross-region state synchronization
5. Migration from Colyseus to custom Durable Object protocol

Note: Only needed when moving beyond LAN to global multiplayer.
Not required for current project scope.
```

### Priority Matrix

```
                    IMPACT
                    High            Medium          Low
              +----------------+----------------+----------------+
              |                |                |                |
   Low        | [Phase 1]      |                |                |
   EFFORT     | Per-client AOI | Deterministic  |                |
              | Capability det | effects        |                |
              |                |                |                |
              +----------------+----------------+----------------+
              |                |                |                |
   Medium     | [Phase 2]      | [Phase 4]      | [Phase 5]      |
   EFFORT     | Delta compress | WebRTC helpers | Edge compute   |
              | Update rates   |                |                |
              |                |                |                |
              +----------------+----------------+----------------+
              |                |                |                |
   High       | [Phase 3]      |                |                |
   EFFORT     | Physics deleg  |                |                |
              | Anti-cheat     |                |                |
              |                |                |                |
              +----------------+----------------+----------------+
```

---

## 9. Risk Assessment

### Technical Risks

| Risk | Probability | Impact | Mitigation |
|------|------------|--------|------------|
| SharedArrayBuffer unavailable (COOP/COEP headers) | Medium | High | WorkerBridge already has fallback path; ensure server headers set |
| WebRTC DataChannel fails behind corporate NAT | High | Medium | Always fall back to server relay; helper node is optional |
| Client capability detection inaccurate | Medium | Medium | Runtime benchmark + continuous monitoring; server can reclassify |
| Physics delegation introduces desync | Medium | High | Server validates all results; revoke delegation on mismatch |
| Low-tier clients feel left out (fewer entities) | Low | Medium | Priority-based filtering keeps gameplay-relevant entities visible |
| Colyseus StateView API breaking changes | Low | Medium | Pin Colyseus version; abstract behind InterestManager |
| Memory pressure on weak devices | Medium | Medium | EntityLimits already caps; add memory pressure monitoring |

### Fairness Risks

| Risk | Mitigation |
|------|------------|
| PC player sees enemies phone player can't | All threat-relevant enemies always synced; only cosmetic entities filtered |
| Fast device has lower latency advantage | Server-authoritative hit detection; client prediction is cosmetic only |
| Helper node PC could grief weak client | Server validates all state; helper only supplements, doesn't replace server |
| Different visual quality feels unfair | Core gameplay elements (enemies, bullets, player) always rendered at minimum quality |

### Performance Risks

| Risk | Mitigation |
|------|------------|
| Server becomes bottleneck at 10K entities | Phase 3 offloads 40-60% of physics to clients |
| Node.js single-thread limits server | Use Node.js worker_threads for server-side physics; or Bun runtime |
| Garbage collection spikes on clients | SharedArrayBuffer avoids GC; reuse typed arrays (already done in WorkerBridge) |
| WebSocket message coalescing adds latency | Use Colyseus setPatchRate aggressively; consider raw WebSocket for critical updates |

---

## 10. Sources

### Research Papers and Technical Documentation
- [Colyseus: A Distributed Architecture for Online Multiplayer Games (CMU)](https://www.usenix.org/legacy/event/nsdi06/tech/full_papers/bharambe/bharambe.pdf)
- [Interest management for distributed virtual environments: A survey (ACM Computing Surveys)](https://dl.acm.org/doi/10.1145/2535417)
- [Adaptive Partitioning for Distributed Multi-Agent Simulations (ACM SIGSIM 2022)](https://dl.acm.org/doi/10.1145/3518997.3531021)
- [Authority assignment in distributed multi-player proxy-based games (ResearchGate)](https://www.researchgate.net/publication/221391444_Authority_assignment_in_distributed_multi-player_proxy-based_games)
- [From WebGL to WebGPU: A Reality Check of Browser-Based GPU Acceleration (ACM IMC 2025)](https://dl.acm.org/doi/10.1145/3730567.3764504)

### Framework Documentation
- [Colyseus State Synchronization](https://docs.colyseus.io/state)
- [Colyseus State Best Practices](https://docs.colyseus.io/state/best-practices)
- [Colyseus Scalability](https://docs.colyseus.io/deployment/scalability)
- [Colyseus Schema 3.0 Roadmap (GitHub)](https://github.com/colyseus/colyseus/issues/709)
- [Cloudflare Durable Objects](https://developers.cloudflare.com/durable-objects/)
- [Building real-time games using Workers, Durable Objects, and Unity (Cloudflare Blog)](https://blog.cloudflare.com/building-real-time-games-using-workers-durable-objects-and-unity/)
- [Multiplayer Doom on Cloudflare Workers (Cloudflare Blog)](https://blog.cloudflare.com/doom-multiplayer-workers/)

### Browser APIs
- [Navigator: deviceMemory property (MDN)](https://developer.mozilla.org/en-US/docs/Web/API/Navigator/deviceMemory)
- [Navigator: getBattery() method (MDN)](https://developer.mozilla.org/en-US/docs/Web/API/Navigator/getBattery)
- [WebGPU API (MDN)](https://developer.mozilla.org/en-US/docs/Web/API/WebGPU_API)
- [WebRTC Data Channels for game development (MDN)](https://developer.mozilla.org/en-US/docs/Games/Techniques/WebRTC_data_channels)

### SpatialOS / Improbable
- [SpatialOS Authority and Interest](https://networking.docs.improbable.io/welcome/spatialos-concepts/authority-and-interest/)
- [Dynamically distributing a simulation over hundreds of physics engines (Improbable)](https://www.improbable.io/blog/dynamically-distributing-a-simulation-over-hundreds-of-physics-engines/)
- [Distributed physics without server boundaries (Improbable)](https://improbable.io/blog/distributed-physics-without-server-boundaries)
- [Intimacy at scale: Building an architecture for density (Improbable)](https://www.improbable.io/news/intimacy-at-scale-building-an-architecture-for-density)

### WebRTC for Games
- [WebRTC Relays for Multiplayer Games (Edgegap)](https://edgegap.com/blog/webrtc-relays-for-multiplayer-games)
- [Peer-to-peer gaming with the WebRTC DataChannel (webrtcHacks)](https://webrtchacks.com/datachannel-multiplayer-game/)
- [WebRTC vs. WebSockets for multiplayer games (Rune)](https://developers.rune.ai/blog/webrtc-vs-websockets-for-multiplayer-games)
- [An Open-Source Framework Using WebRTC for Online Multiplayer Gaming (ACM)](https://dl.acm.org/doi/10.1145/3631085.3631238)

### Browser Games
- [Interview with Dek (Hordes.io) - Web Game Dev](https://www.webgamedev.com/interviews/dek-hordes)
- [Entity-Component-Worker Architecture for massive online games (Gamedeveloper.com)](https://www.gamedeveloper.com/programming/the-entity-component-worker-architecture-and-its-use-on-massive-online-games)
- [Client-Server Game Architecture (Gabriel Gambetta)](https://www.gabrielgambetta.com/client-server-game-architecture.html)

### Rendering Optimization
- [Adaptive Resolution Scaling: The Unsung Hero of Mobile Gaming (Wayline)](https://www.wayline.io/blog/adaptive-resolution-scaling-mobile-gaming)
- [Build stunning mobile games that run smoothly with Adaptive Performance (Unity Blog)](https://blog.unity.com/games/build-stunning-mobile-games-that-run-smoothly-with-adaptive-performance)

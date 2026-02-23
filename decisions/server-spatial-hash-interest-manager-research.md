# Server-Side Spatial Hash + InterestManager — Research Report

**Date:** 2026-02-24
**Task:** s28b-server-spatial-hash-interest-manager
**Type:** Research / Architecture Design
**Author:** Claude (autonomous worker)

---

## Executive Summary

The project already has a **fully implemented but disabled** `InterestManager` and `PriorityQueue` system in `server/systems/`. The core blocker is that Colyseus 0.15's `@filterChildren` decorator is experimental, CPU-heavy, and has known issues with re-triggering and entity removal. Three viable delivery approaches exist, ranked by practicality. **Recommendation: use the custom message approach (Option B) — it bypasses Colyseus's broken filter system entirely and is the lowest-risk path to 50-70% bandwidth savings.**

---

## 1. Current Architecture (What We Have)

### Server State Distribution (Today)
- **Tick rate:** 60 Hz simulation, 16ms patch rate (~60 Hz sync)
- **Filtering:** NONE — every entity change broadcast to ALL clients every patch
- **Entity counts (typical):** 60-90 enemies, 50-100 bullets, 20-40 geoms, 3-5 pickups
- **Players per room:** 1-4 (LAN party game)
- **Schema:** `GameState` has `ArraySchema<EnemyState>`, `ArraySchema<BulletState>`, etc.

### Existing InterestManager (Disabled)
Located in `server/systems/InterestManager.ts` (383 lines) and `PriorityQueue.ts` (183 lines):
- UV-space distance with surface wrapping (sphere, torus, cube, etc.)
- AOI radius: 0.3 UV units (covers ~28% of UV space area)
- Priority tiers: HIGH (<0.1, every tick), MEDIUM (0.1-0.2, every 3rd tick), LOW (0.2-0.3, every 6th tick), NONE (>0.3, never)
- `shouldSync(playerId, entityId, entityType)` API — perfect shape for `@filterChildren`
- Tests exist and pass
- **Disabled because:** Colyseus's state patching doesn't consume `shouldSyncEntity()` results (see `GameRoom.ts` lines 13-17, `decisions/lan-deep-audit-2026-02-11.md` #11)

### Client Spatial Hashes (Existing, Unrelated)
- `src/core/SpatialHash.ts` — broad-phase collision detection (3D world-space, dual-path implementation)
- `src/rendering/SpatialHashVisibility.ts` — per-instance enemy dimming by player proximity (visual only)
- Neither is relevant to server-side interest management

---

## 2. Colyseus 0.15 Filtering Mechanisms

### `@filterChildren()` Decorator (Experimental)
```typescript
@filterChildren(function(client, key, entity, root) {
  return isVisible(client.sessionId, entity.id);
})
@type([EnemyState]) enemies = new ArraySchema<EnemyState>();
```

**Problems discovered in research:**
1. **CPU cost:** Callback fires per-client × per-entity on EVERY patch tick. 4 clients × 90 enemies = 360 calls/tick × 60 ticks/sec = 21,600 calls/sec. Colyseus docs explicitly warn "not recommended for fast-paced games."
2. **No auto-retrigger:** Filter only re-runs when the filtered field itself changes. If a player moves and a new enemy enters range, the enemy's filter won't fire unless the enemy also changed. Workaround: `entity['$changes'].touch(0)` — internal, unstable API.
3. **Broken entity removal:** When a filter transitions true→false, clients do NOT receive a clean "entity X removed" notification. Behavior is partially undefined per Colyseus forum discussions.
4. **Arrow function `this` scope breakage** — must use `function()` syntax.
5. **Requires `MapSchema` or explicit key management** for proper add/remove semantics. Currently enemies/bullets use `ArraySchema`.

### `@filter()` Decorator
Field-level, not entity-level. Not useful for entity filtering.

### `patchRate` Tuning
Increasing from 16ms to 50ms (20 Hz) would reduce bandwidth 3x. Simple to implement, affects all clients uniformly.

### Custom Messages (`client.send()`)
Bypass schema entirely. Send entity updates as raw messages to specific clients. Full control, no Colyseus filter overhead.

---

## 3. Implementation Options (Ranked)

### Option A: `@filterChildren` with Existing InterestManager
**Approach:** Switch `ArraySchema` to `MapSchema` for enemies/bullets/geoms/pickups. Add `@filterChildren` decorator backed by `InterestManager.shouldSync()`. Touch dirty entities each tick to force re-evaluation.

**Pros:**
- Uses existing InterestManager code (tested, working)
- Colyseus handles serialization/deserialization

**Cons:**
- 21,600+ filter callbacks/sec (CPU cost likely exceeds bandwidth savings)
- Requires ArraySchema → MapSchema migration (breaks all client code)
- Entity removal behavior undefined
- `$changes.touch()` is internal API
- If Colyseus upgrades to 0.16, both decorators are removed

**Effort:** ~3-5 days (schema migration + client refactor + testing)
**Risk:** HIGH — filter performance may negate gains; entity removal bugs likely
**Verdict:** NOT RECOMMENDED

### Option B: Custom Message-Based Interest Management (RECOMMENDED)
**Approach:** Keep schema for global state (players, wave, settings). Move entity sync (enemies, bullets, geoms, pickups) to custom messages. Server runs InterestManager each tick, sends per-client entity arrays as messages.

```typescript
// Server (in simulation loop):
const syncSets = this.interestManager.update(players, enemies, bullets, geoms, pickups);
for (const [playerId, syncSet] of syncSets) {
  const client = this.clients.getById(playerId);
  if (!client) continue;
  client.send('entity_sync', {
    enemies: this.serializeEnemies(syncSet.enemyIds),
    bullets: this.serializeBullets(syncSet.bulletIds),
    geoms: this.serializeGeoms(syncSet.geomIds),
    pickups: this.serializePickups(syncSet.pickupIds),
  });
}

// Client (in network-main.ts):
room.onMessage('entity_sync', (data) => {
  updateEnemies(data.enemies);
  updateBullets(data.bullets);
  // etc.
});
```

**Pros:**
- Full control over what each client receives
- No Colyseus filter overhead
- Clean entity add/remove semantics (client manages its own entity set)
- InterestManager already written and tested
- No schema migration needed
- Can throttle sync rate per priority tier (HIGH=60Hz, MEDIUM=20Hz, LOW=10Hz)
- Forward-compatible with any Colyseus version

**Cons:**
- Must implement custom serialization (MsgPack, or manual binary)
- Loses Colyseus delta-patching (must send full entity state or implement own deltas)
- Client must handle entity lifecycle (create/update/destroy) manually
- More code to maintain

**Effort:** ~5-8 days
**Risk:** MEDIUM — well-understood pattern, but requires careful client refactoring
**Verdict:** RECOMMENDED — best balance of control, performance, and risk

### Option C: Hybrid — Schema for Nearby + Messages for Distant
**Approach:** Keep all entities in schema (broadcast to all). Additionally, send per-client "visibility mask" messages. Client renders only visible entities, ignoring distant ones even though they're in state.

```typescript
// Server sends visibility set per client each tick
client.send('visibility', { enemyIds: [...visibleIds] });

// Client filters rendering based on visibility set
// (entities still synced, just not rendered)
```

**Pros:**
- Zero schema changes
- Zero serialization changes
- Client-only rendering optimization
- Trivial to implement (~1 day)
- No sync issues (full state always available as fallback)

**Cons:**
- NO bandwidth savings (all entities still synced to all clients)
- Only saves client CPU (skip rendering distant entities)
- Server CPU slightly increased (visibility computation)

**Effort:** ~1 day
**Risk:** LOW
**Verdict:** Good quick win for client CPU, but doesn't address bandwidth (the primary concern)

### Option D: Upgrade to Colyseus 0.16 + StateView
**Approach:** Upgrade Colyseus, use new `StateView` API for per-client entity visibility.

**Pros:**
- Official, supported API
- Clean add/remove semantics

**Cons:**
- Colyseus 0.16 is a major version with breaking changes
- StateView is explicitly documented as "not optimized for large datasets yet"
- Migration effort for all server + client code
- LAN multiplayer is already fragile — major dependency upgrade is high risk

**Effort:** ~10-15 days (including migration + stabilization)
**Risk:** VERY HIGH
**Verdict:** NOT RECOMMENDED now. Revisit when 0.16 matures.

---

## 4. Bandwidth Estimates

### Current Bandwidth (No Filtering)
Assumptions: 90 enemies (6 fields × ~20 bytes), 80 bullets (9 fields × ~36 bytes), 30 geoms (4 fields × ~16 bytes), 4 players. 60 Hz patch rate. Delta-only (assume ~30% of entities change per tick).

Per-client per-tick: `(90×20 + 80×36 + 30×16) × 0.3 ≈ 1,530 bytes/tick`
Per-client per-second: `1,530 × 60 ≈ 91.8 KB/s`
Total for 4 clients: `~367 KB/s outbound`

### With InterestManager (Option B, AOI=0.3)
AOI area ≈ 28% of UV space. With priority throttling:
- HIGH zone (~3% area): 60 Hz → ~2.7 enemies, ~2.4 bullets
- MEDIUM zone (~9% area): 20 Hz → ~8.1 enemies, ~7.2 bullets
- LOW zone (~16% area): 10 Hz → ~14.4 enemies, ~12.8 bullets
- NONE (~72% area): 0 Hz → 0

Effective entities/sec per client: ~25 enemies + ~22 bullets + ~8 geoms ≈ 55 entities (vs ~200 without IM)

**Estimated savings: ~65-72% bandwidth reduction per client**
Per-client: ~25-32 KB/s (down from ~92 KB/s)
Total for 4 clients: ~100-128 KB/s (down from ~367 KB/s)

### patchRate Tuning (Simple Alternative)
Change `setPatchRate(16)` to `setPatchRate(50)`:
Per-client: ~30.6 KB/s (down from ~92 KB/s)
**Savings: ~67% with zero code changes**

> **Key insight:** Simply reducing patch rate from 60Hz to 20Hz gives nearly the same bandwidth savings as full InterestManager, with zero complexity cost. The visual impact is minimal since the client already interpolates at 60 FPS.

---

## 5. Client-Side Computation Offloading

User said: "assume that what we send our way is genuine." This simplifies the trust model.

### Safe to Offload (Low Risk)

| Computation | Current Location | Savings | Risk |
|---|---|---|---|
| DDA calculations | Client-only already | N/A | None — already offloaded |
| Visual effects (bloom, particles) | Client-only already | N/A | None |
| Sound/music | Client-only already | N/A | None |
| Enemy rendering LOD | Client-only already | N/A | None |
| Spatial hash visibility | Client-only already | N/A | None |

### Could Offload (Medium Risk)

| Computation | Current Location | Savings | Risk |
|---|---|---|---|
| Enemy AI movement | Server (simple chase) | ~20% server CPU | Desync if clients disagree. Mitigated by server snapping every N ticks |
| Collision broad-phase | Server | ~10% server CPU | Client reports collisions; server validates. Risk: false positives/negatives |
| Bullet trajectory | Server | ~15% server CPU | DANGEROUS — bullet positions diverge across clients. Hitbox mismatch |

### Should NOT Offload (High Risk)

| Computation | Why Not |
|---|---|
| Score calculation | Core game state, must be authoritative |
| Lives/deaths | Core game state |
| Wave progression | Must be synchronized |
| Geom spawning | Must be consistent across clients |

### Recommendation: Keep Server Authoritative
The server runs simple O(enemies × players) AI at 60Hz. For 90 enemies × 4 players = 360 distance calculations per tick. This is ~0.01ms of CPU time — negligible. **There is no meaningful CPU to save by offloading enemy AI.** The bottleneck is bandwidth, not server CPU.

---

## 6. Curved Surface Challenges

### UV-Space Hashing (Current Approach — InterestManager)
The existing InterestManager uses UV-space distance with surface-aware wrapping. This works because:
- All entities store `surfaceU, surfaceV` (0-1 range)
- Distance in UV space approximates geodesic distance for most surfaces
- Wrapping rules handle topology (sphere U wraps, torus U+V wrap, cube no wrap)

**Limitation:** UV-space distance is not uniform on curved surfaces. On a sphere, UV cells near poles are much smaller in world-space than cells near the equator (Mercator distortion). An AOI of 0.3 UV near the equator covers a much larger world-space area than 0.3 UV near a pole.

**Mitigation options:**
1. **Accept the distortion** — for a game with 1-4 players on simple shapes, the error is small. Players spend most time near the equator/center anyway.
2. **Adaptive AOI** — scale AOI radius by latitude: `aoiRadius / cos(latitude)`. Simple for sphere, complex for other surfaces.
3. **World-space spatial hash** — hash in XYZ instead of UV. More accurate but requires 3D spatial hash on server (which doesn't have world-space positions — entities only have UV).

**Recommendation:** Accept the distortion. The existing UV-based approach in InterestManager is good enough for 1-4 player LAN gameplay. Optimize only if players report "enemies appearing/disappearing unexpectedly near poles."

---

## 7. Priority-Ranked Optimization Recommendations

| Priority | Optimization | Effort | Bandwidth Savings | Risk |
|---|---|---|---|---|
| **1** | **Reduce patchRate to 50ms (20 Hz)** | 1 line change | ~67% | Near-zero |
| **2** | **Use `number` → `float32` in schema** | 1 hour | ~15-20% | Low |
| **3** | **Custom message entity sync (Option B)** | 5-8 days | ~65-72% | Medium |
| **4** | **Client-side rendering filter (Option C)** | 1 day | 0% bandwidth, ~30% client CPU | Low |
| **5** | **Selective tick-rate per entity type** | 2 days | ~20-30% | Low |
| **6** | **Colyseus 0.16 upgrade** | 10-15 days | Depends on StateView | Very High |

### Quick Wins (Do Before Full Implementation)

**Priority 1 — patchRate:** Change `setPatchRate(16)` to `setPatchRate(50)` in GameRoom.ts. Client already interpolates at 60 FPS, so 20 Hz updates are smooth. This alone may be sufficient for 4-player LAN.

**Priority 2 — Schema field types:** Replace `'number'` (64-bit float) with `'float32'` for UV coordinates, aim angle, world positions. Halves per-field patch size.

```typescript
// Before: 8 bytes per field
defineTypes(EnemyState, { surfaceU: 'number', surfaceV: 'number' });

// After: 4 bytes per field
defineTypes(EnemyState, { surfaceU: 'float32', surfaceV: 'float32' });
```

**Priority 5 — Selective tick-rates:** Bullets change every tick (position), but enemy types and geom positions rarely change. Use different patch intervals:
- Bullets: 60 Hz (position changes every tick)
- Enemies: 20 Hz (UV position changes slowly relative to surface)
- Geoms/Pickups: 5 Hz (static until collected)

---

## 8. Implementation Roadmap (If We Proceed)

### Phase 0: Quick Wins (1-2 hours, no risk)
1. Change `setPatchRate(16)` → `setPatchRate(50)` in GameRoom.ts
2. Change schema field types from `'number'` to `'float32'` where appropriate
3. Test with 4 clients — verify smooth interpolation

### Phase 1: Client Rendering Filter (1 day, low risk)
1. Server sends per-client visibility mask via `client.send('visibility', {...})`
2. Client skips rendering entities not in visibility set
3. Client fades entities in/out at AOI boundary (reuse SpatialHashVisibility pattern)
4. InterestManager.update() runs each tick, results sent as messages

### Phase 2: Custom Message Entity Sync (5-8 days, medium risk)
1. Remove enemies/bullets/geoms/pickups from schema (keep in server-side arrays)
2. Server serializes per-client entity sets as custom messages
3. Client network-main.ts handles `entity_sync` messages
4. Implement delta encoding (only send changed fields per entity)
5. Handle entity create/update/destroy lifecycle on client
6. Test extensively with 4 clients on all surfaces

### Phase 3: Priority-Based Throttling (2 days, low risk)
1. Enable PriorityQueue tick-based throttling
2. HIGH entities: every message (60 Hz)
3. MEDIUM entities: every 3rd message (20 Hz)
4. LOW entities: every 6th message (10 Hz)
5. Test: verify no visual popping at tier boundaries

### Prerequisites Before Phase 2+
- LAN multiplayer must be stable (currently "fragile — 10+ failed fixes")
- All critical MP regressions fixed
- Automated LAN test suite (currently manual testing only)
- Schema migration plan for backwards compatibility (version handshake)

---

## 9. Feasibility Assessment

### Implement Now vs. Defer?

**DEFER to future version.** Reasons:

1. **patchRate tuning alone gives ~67% bandwidth savings** — the biggest win, with 1 line of code
2. **LAN multiplayer is already fragile** — adding complexity to an unstable system is high risk
3. **Player count is 1-4** — the bandwidth problem doesn't scale dangerously at this count
4. **User explicitly said "one of the last tasks"** — prioritize stability over optimization
5. **Full implementation (Phase 2) is 5-8 days** — significant effort for a LAN party game

### What TO Do Now
1. Apply quick wins (patchRate + float32) — immediate, near-zero risk
2. Keep InterestManager/PriorityQueue code as-is (already tested, ready when needed)
3. Document this research for future reference

### When to Revisit
- If player count increases beyond 4 (8+ player LAN)
- If entity counts increase significantly (200+ enemies)
- If mobile clients join (bandwidth-constrained)
- If server CPU becomes a bottleneck (currently not)
- When LAN multiplayer is stable and has automated tests

---

## 10. Example Pseudocode: Custom Message Approach (Option B)

### Server Side (GameRoom.ts additions)

```typescript
// In GameRoom class:
private interestManager: InterestManager;
private entitySyncBuffer: Map<string, any[]> = new Map(); // per-client

onCreate(options: any) {
  // ... existing setup ...
  this.interestManager = new InterestManager(options.surfaceType || 'sphere');
}

// Called each simulation tick (60 Hz)
private syncEntitiesWithInterest(): void {
  // Build player positions map
  const playerPositions = new Map<string, UVPosition>();
  this.state.players.forEach((player, id) => {
    if (player.alive) {
      playerPositions.set(id, { u: player.surfaceU, v: player.surfaceV });
    }
  });

  // Build entity arrays (reuse across ticks to avoid alloc)
  const enemies: SyncableEntity[] = [];
  for (const enemy of this.serverEnemies) {
    if (enemy.alive) {
      enemies.push({ id: enemy.id, u: enemy.surfaceU, v: enemy.surfaceV });
    }
  }
  // ... same for bullets, geoms, pickups ...

  // Run interest management
  const syncSets = this.interestManager.update(
    playerPositions, enemies, bullets, geoms, pickups
  );

  // Send per-client entity updates
  for (const client of this.clients) {
    const syncSet = syncSets.get(client.sessionId);
    if (!syncSet) continue;

    const payload = {
      e: this.packEnemies(syncSet.enemyIds),   // enemies
      b: this.packBullets(syncSet.bulletIds),   // bullets
      g: this.packGeoms(syncSet.geomIds),       // geoms
      p: this.packPickups(syncSet.pickupIds),   // pickups
    };

    client.send('es', payload); // 'es' = entity sync
  }
}

// Compact binary-ish packing (minimize message size)
private packEnemies(ids: Set<string>): any[] {
  const result: any[] = [];
  for (const id of ids) {
    const e = this.findEnemy(id);
    if (e) result.push([e.id, e.type, e.surfaceU, e.surfaceV, e.health, e.alive ? 1 : 0]);
  }
  return result;
}
```

### Client Side (network-main.ts additions)

```typescript
// In room setup:
room.onMessage('es', (data: EntitySyncPayload) => {
  // Track which enemies are "known" — if not in this message, they're out of AOI
  const activeEnemyIds = new Set<string>();

  for (const [id, type, u, v, health, alive] of data.e) {
    activeEnemyIds.add(id);
    const existing = enemyTargetUV.get(id);
    if (existing) {
      // Update existing enemy target
      existing.u = u;
      existing.v = v;
    } else {
      // New enemy entered AOI — create mesh
      getOrCreateEnemy(id, type);
      enemyTargetUV.set(id, { u, v });
    }
  }

  // Remove enemies that left AOI (fade out, don't destroy immediately)
  for (const [id, target] of enemyTargetUV) {
    if (!activeEnemyIds.has(id)) {
      fadeOutEnemy(id); // smooth transition, then destroy after fade
    }
  }

  // ... same pattern for bullets, geoms, pickups ...
});
```

---

## Sources

- Colyseus 0.15 docs: filter/filterChildren decorators (experimental, CPU-heavy)
- Colyseus forum: "Is there any way to implement Area of Interest?" (2018, no built-in support)
- Colyseus 0.16 StateView docs (not optimized for large datasets yet)
- Colyseus forum: re-triggering filter on condition changes (broken, requires $changes.touch)
- Mirror Networking: spatial hash interest management (30x faster than distance checks)
- Existing codebase: `server/systems/InterestManager.ts`, `server/systems/PriorityQueue.ts`
- Existing codebase: `server/rooms/GameRoom.ts` lines 13-17 (why IM was disabled)
- Existing codebase: `server/schema/GameState.ts` (current schema structure)

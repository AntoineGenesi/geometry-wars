// @ts-nocheck — This file is a reference document, NOT compiled code.
// It shows annotated diffs with fake import paths. TypeScript is disabled.
/**
 * GameRoom.patched.ts — Annotated diff showing exactly what changes in server/rooms/GameRoom.ts
 *
 * This file is NOT meant to be compiled directly. It is an annotated reference
 * showing EVERY line that changes in the real GameRoom.ts, with [ADD]/[REMOVE]/[CHANGE]
 * markers and explanatory comments.
 *
 * To apply: diff this file against the real GameRoom.ts and port the changes.
 * Alternatively, use `git diff` to see the exact changes from this experiment's branch.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * CHANGE SUMMARY
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Phase 1.1 — Server spatial hash (no worker, synchronous):
 *   - Import SpatialHash
 *   - In checkCollisions(): build SpatialHash from enemies, query per bullet
 *   - Total: ~15 lines changed
 *
 * Phase 1.2 — Worker thread collision:
 *   - Import CollisionWorkerBridge
 *   - Add collisionBridge field
 *   - In onCreate(): await collisionBridge.start()
 *   - In tickGame(): consume worker result, send new task
 *   - In onDispose(): await collisionBridge.stop()
 *   - Total: ~30 lines changed
 *
 * Phase 2 — Hybrid client AI:
 *   - Import ComputationPool, AiTaskDispatcher
 *   - Add pool, dispatcher fields
 *   - Register message handlers: 'ai_result', 'cpu_heartbeat'
 *   - In onJoin(): pool.addClient()
 *   - In onLeave(): pool.removeClient()
 *   - In updateEnemies(): use dispatcher result if available, fallback to server
 *   - In tickGame(): dispatcher.dispatchTasks() / endTick()
 *   - Total: ~60 lines changed
 */

// ─────────────────────────────────────────────────────────────────────────────
// PHASE 1.1 DIFF: Server spatial hash
// ─────────────────────────────────────────────────────────────────────────────

/*
 [ADD] at top of file, after existing imports:
*/
import { SpatialHash } from '../../../distributed-compute-experiment/server/SpatialHash';

/*
 [CHANGE] checkCollisions() method — replace the bullet-enemy double loop:

 BEFORE (O(B×E) — 18,000 checks at 90 enemies + 200 bullets):
```typescript
  private checkCollisions() {
    const bulletsToRemove: number[] = [];
    const enemiesToRemove: number[] = [];

    this.state.bullets.forEach((bullet, bIndex) => {
      this.state.enemies.forEach((enemy, eIndex) => {  // ← nested loop
        if (!enemy.alive) return;
        const du = bullet.x - enemy.surfaceU;
        const dv = bullet.y - enemy.surfaceV;
        const dist = Math.sqrt(du * du + dv * dv);
        if (dist < 0.05) {
          // ... hit logic ...
        }
      });
    });
```

 AFTER (O(B×avg_bucket) — ~400-800 checks at same load, 96% reduction):
```typescript
  private bulletEnemyHash = new SpatialHash(0.1);  // [ADD] class field

  private checkCollisions() {
    const bulletsToRemove: number[] = [];
    const enemiesToRemove: number[] = [];

    // [ADD] Build spatial hash from current enemy positions
    this.bulletEnemyHash.clear();
    this.state.enemies.forEach((enemy) => {
      if (enemy.alive) {
        this.bulletEnemyHash.insert(enemy.id, enemy.surfaceU, enemy.surfaceV);
      }
    });

    // [ADD] Build enemy lookup by ID (for applying hit effects)
    const enemyById = new Map<string, { enemy: EnemyState; index: number }>();
    this.state.enemies.forEach((enemy, index) => {
      enemyById.set(enemy.id, { enemy, index });
    });

    // [CHANGE] Loop: bullets query hash instead of looping all enemies
    this.state.bullets.forEach((bullet, bIndex) => {
      const candidates = this.bulletEnemyHash.queryRadius(bullet.x, bullet.y, 0.05);
      for (const candidate of candidates) {
        const entry = enemyById.get(candidate.id);
        if (!entry || !entry.enemy.alive) continue;

        // Hit! (exact distance already checked in queryRadius)
        const owner = this.state.players.get(bullet.ownerId);
        const weaponCfg = WEAPON_CONFIGS[owner?.weaponType ?? 'standard'] ?? WEAPON_CONFIGS.standard;
        const damage = Math.ceil(weaponCfg.damageMultiplier);
        entry.enemy.health -= damage;

        if (entry.enemy.health <= 0) {
          entry.enemy.alive = false;
          enemiesToRemove.push(entry.index);
          if (owner) {
            owner.score += this.getEnemyScore(entry.enemy.type) * owner.multiplier;
          }
          this.spawnGeom(entry.enemy.surfaceU, entry.enemy.surfaceV);
          if (Math.random() < WEAPON_DROP_CHANCE) {
            this.spawnWeaponPickup(entry.enemy.surfaceU, entry.enemy.surfaceV);
          }
        }
        bulletsToRemove.push(bIndex);
      }
    });

    // ... rest of checkCollisions() (player-enemy, geom, pickup) unchanged ...
  }
```
*/

// ─────────────────────────────────────────────────────────────────────────────
// PHASE 1.2 DIFF: Worker thread collision
// ─────────────────────────────────────────────────────────────────────────────

/*
 [ADD] imports:
*/
import { CollisionWorkerBridge } from '../../../distributed-compute-experiment/server/CollisionWorkerBridge';

/*
 [ADD] class field after existing private fields:
```typescript
  private collisionBridge = new CollisionWorkerBridge();
  private currentTick = 0;  // [ADD] track tick number for double-buffering
```

 [CHANGE] onCreate() — add worker startup:
```typescript
  async onCreate(options: { surfaceType?: string }) {
    // ... existing code ...

    // [ADD] Start collision worker
    await this.collisionBridge.start();
    console.log('[GameRoom] Collision worker started');
  }
```
 Note: Colyseus's onCreate CAN be async — Colyseus awaits it before adding to lobby.

 [CHANGE] tickGame() — double-buffer pattern:
```typescript
  private tickGame() {
    const dt = 1 / TICK_RATE;
    this.state.gameTime += dt;
    this.currentTick++;  // [ADD]

    // [ADD] Consume worker result from previous tick (double-buffer)
    const workerResult = this.collisionBridge.consumeResult();
    if (workerResult) {
      this.applyWorkerCollisionResult(workerResult);  // [ADD] new method
    } else if (this.currentTick > 1) {
      // [ADD] Fallback: synchronous collision (only on tick 1, or if worker slow)
      this.checkCollisionsSynchronous();
    }

    this.applyPlayerMovement(dt);
    this.updateBullets(dt);
    this.updateEnemies(dt);

    // [REMOVE] this.checkCollisions(); ← replaced by worker + applyWorkerCollisionResult

    this.updateWeaponPickups(dt);
    this.tickWaves(dt);
    this.drainInvincibility(dt);
    this.checkGameOver();

    // [ADD] Send this tick's positions to worker for next tick's collision
    const task = this.collisionBridge.buildTask(
      this.currentTick,
      Array.from(this.state.enemies).filter(e => e.alive),
      Array.from(this.state.bullets),
    );
    this.collisionBridge.sendTask(task);
  }
```

 [ADD] new method applyWorkerCollisionResult():
 This applies the CollisionResult from the worker to the game state.
 The logic is identical to the hit-application section of checkCollisions().
```typescript
  private applyWorkerCollisionResult(result: CollisionResult) {
    const bulletMap = new Map<string, { bullet: BulletState; index: number }>();
    this.state.bullets.forEach((b, i) => bulletMap.set(b.id, { bullet: b, index: i }));

    const enemyMap = new Map<string, { enemy: EnemyState; index: number }>();
    this.state.enemies.forEach((e, i) => enemyMap.set(e.id, { enemy: e, index: i }));

    const bulletsToRemove: number[] = [];
    const enemiesToRemove: number[] = [];

    for (const hit of result.bulletEnemyHits) {
      const bulletEntry = bulletMap.get(hit.bulletId);
      const enemyEntry = enemyMap.get(hit.enemyId);
      if (!bulletEntry || !enemyEntry || !enemyEntry.enemy.alive) continue;

      const owner = this.state.players.get(bulletEntry.bullet.ownerId);
      const weaponCfg = WEAPON_CONFIGS[owner?.weaponType ?? 'standard'] ?? WEAPON_CONFIGS.standard;
      enemyEntry.enemy.health -= Math.ceil(weaponCfg.damageMultiplier);

      if (enemyEntry.enemy.health <= 0) {
        enemyEntry.enemy.alive = false;
        enemiesToRemove.push(enemyEntry.index);
        if (owner) owner.score += this.getEnemyScore(enemyEntry.enemy.type) * owner.multiplier;
        this.spawnGeom(enemyEntry.enemy.surfaceU, enemyEntry.enemy.surfaceV);
        if (Math.random() < WEAPON_DROP_CHANCE) {
          this.spawnWeaponPickup(enemyEntry.enemy.surfaceU, enemyEntry.enemy.surfaceV);
        }
      }
      bulletsToRemove.push(bulletEntry.index);
    }

    // ... player-enemy and geom/pickup collision still runs synchronously here ...
    // (Only bullet-enemy is offloaded; player-enemy is cheap O(P×E) = 360 ops)
    this.checkPlayerCollisionsSynchronous(enemiesToRemove);

    for (let i = bulletsToRemove.length - 1; i >= 0; i--) this.state.bullets.splice(bulletsToRemove[i], 1);
    for (let i = enemiesToRemove.length - 1; i >= 0; i--) this.state.enemies.splice(enemiesToRemove[i], 1);
  }
```

 [CHANGE] onDispose() — stop worker:
```typescript
  async onDispose() {
    await this.collisionBridge.stop();
    console.log('[GameRoom] Disposed, collision worker stopped');
  }
```
*/

// ─────────────────────────────────────────────────────────────────────────────
// PHASE 2 DIFF: Hybrid client AI
// ─────────────────────────────────────────────────────────────────────────────

/*
 [ADD] imports:
*/
import { ComputationPool } from '../../../distributed-compute-experiment/server/ComputationPool';
import { AiTaskDispatcher, computeServerAI } from '../../../distributed-compute-experiment/server/AiTaskDispatcher';
import type { AiResult, CpuHeartbeat } from '../../../distributed-compute-experiment/protocol/messages';

/*
 [ADD] class fields:
```typescript
  private computationPool = new ComputationPool();
  private aiDispatcher!: AiTaskDispatcher;
```

 [ADD] in onCreate(), after message handler registration:
```typescript
    // [ADD] Initialize AI dispatcher
    this.aiDispatcher = new AiTaskDispatcher(
      this.computationPool,
      // sendFn: send message to a specific client by sessionId
      (sessionId, type, data) => {
        const client = this.clients.find(c => c.sessionId === sessionId);
        if (client) client.send(type, data);
      },
      // sendAckFn: send acknowledgement to client
      (sessionId, taskId, outcome, rejectionCount) => {
        const client = this.clients.find(c => c.sessionId === sessionId);
        if (client) client.send('cpu_task_ack', { type: 'cpu_task_ack', taskId, outcome, rejectionCount });
      },
    );

    // [ADD] Register computation message handlers
    this.onMessage('ai_result', (client, data: AiResult) => {
      this.aiDispatcher.receiveResult(data, this.currentTick);
    });

    this.onMessage('cpu_heartbeat', (client, data: CpuHeartbeat) => {
      this.computationPool.updateHeartbeat(client.sessionId, data.load, data.taskCapacity);
    });
```

 [CHANGE] onJoin() — register client in pool:
```typescript
  onJoin(client: Client, options: { name?: string }) {
    // ... existing code ...
    this.computationPool.addClient(client.sessionId);  // [ADD]
  }
```

 [CHANGE] onLeave() — remove client from pool:
```typescript
  onLeave(client: Client, consented: boolean) {
    // ... existing code ...
    this.computationPool.removeClient(client.sessionId);  // [ADD]
  }
```

 [CHANGE] tickGame() — add AI dispatch:
```typescript
  private tickGame() {
    // ... existing code ...

    // [ADD] Dispatch AI tasks to clients (before updateEnemies so results can be applied)
    this.aiDispatcher.dispatchTasks(
      this.currentTick,
      Array.from(this.state.enemies).filter(e => e.alive),
      Array.from(this.state.players.values()),
      dt,
    );

    this.updateEnemies(dt);  // [CHANGE: reads from dispatcher inside]

    // ... rest of tickGame ...

    // [ADD] Clear dispatcher state at end of tick
    this.aiDispatcher.endTick(this.currentTick);
  }
```

 [CHANGE] updateEnemies() — use client result if available:
```typescript
  private updateEnemies(dt: number) {
    this.state.enemies.forEach((enemy) => {
      if (!enemy.alive) return;

      // [ADD] Try to use validated client-computed result first
      const clientResult = this.aiDispatcher.getValidatedResult(enemy.id);
      if (clientResult) {
        // Apply client's validated movement delta
        enemy.surfaceU = this.wrapCoord(enemy.surfaceU + clientResult.du);
        const enemyVMin = this.state.surfaceType === 'cube' ? 0.003 : 0.05;
        const enemyVMax = this.state.surfaceType === 'cube' ? 0.997 : 0.95;
        enemy.surfaceV = Math.max(enemyVMin, Math.min(enemyVMax, enemy.surfaceV + clientResult.dv));
        return;  // [ADD] Skip server computation for this enemy
      }

      // [UNCHANGED] Server fallback — runs for enemies not in client result
      // ... existing nearest-player homing code ...
    });
  }
```
*/

// ─────────────────────────────────────────────────────────────────────────────
// CPU MONITORING SETTING (Phase 2 addition to client side)
// ─────────────────────────────────────────────────────────────────────────────

/*
 The "Shared Load %" setting is stored in localStorage and sent to the server
 via the cpu_heartbeat message. The server's ComputationPool respects this via
 setSharedLoad(). See client/AiWorkerBridge.ts for the client-side implementation.

 Server API to adjust shared load (e.g. from a debug console or admin command):
```typescript
  this.computationPool.setSharedLoad(50); // 50% of enemies delegated to clients
```

 Or accept it from the host via a new message:
```typescript
    this.onMessage('set_shared_load', (client, data: { percent: number }) => {
      if (client.sessionId !== this.state.hostId) return;
      const percent = Math.max(0, Math.min(100, data.percent));
      this.computationPool.setSharedLoad(percent);
      console.log(`[GameRoom] Shared load set to ${percent}% by host`);
    });
```
*/

// Dummy export so TypeScript doesn't complain about the file
export {};

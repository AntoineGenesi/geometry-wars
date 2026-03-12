/**
 * StateRecorder — Frame-by-frame game state recording for test harness.
 *
 * Always active in testMode=true. Zero overhead when inactive.
 * Ring buffer keeps last 3000 frames (~50s at 60fps) to avoid memory bloat.
 * Exposes window.__STATE_RECORDER for Puppeteer access.
 */

import type { GameContext } from '../core/GameContext';

// ---------------------------------------------------------------------------
// Serializable types
// ---------------------------------------------------------------------------

export interface FramePlayerState {
  u: number;
  v: number;
  alive: boolean;
  lives: number;
  score: number;
  weapon: string;
}

export interface FrameEnemyState {
  id: string;
  type: string;
  u: number;
  v: number;
  alive: boolean;
  opacity: number;
  distToPlayer: number;
}

export interface FrameBulletState {
  u: number;
  v: number;
  age: number;
}

export interface FramePickupState {
  type: string;
  u: number;
  v: number;
}

export interface FrameCameraState {
  position: { x: number; y: number; z: number };
  up: { x: number; y: number; z: number };
  quaternion: { x: number; y: number; z: number; w: number };
  target: { x: number; y: number; z: number };
  distanceToPlayer: number;
  /** dot(camera_to_player, surface_normal): >0 means above surface, <0 means inside */
  dotWithSurfaceNormal: number;
}

export interface FrameInputState {
  keysDown: string[];
  mouseX: number;
  mouseY: number;
}

export interface FrameRecord {
  frame: number;
  time: number;
  player: FramePlayerState;
  enemies: FrameEnemyState[];
  bullets: FrameBulletState[];
  pickups: FramePickupState[];
  events: GameEvent[];
  fps: number;
  camera?: FrameCameraState;
  inputState?: FrameInputState;
}

export interface GameEvent {
  type: 'death' | 'damage' | 'pickup_collected' | 'weapon_change' | 'enemy_killed' | 'enemy_spawned' | 'bomb_used' | 'level_up';
  frame: number;
  time: number;
  /** Sub-millisecond timestamp from performance.now() at event creation. */
  preciseTime: number;
  details: Record<string, unknown>;
}

export interface StateSummary {
  totalFrames: number;
  totalDeaths: number;
  totalEnemiesKilled: number;
  totalPickupsCollected: number;
  totalWeaponChanges: number;
  totalBombsUsed: number;
  avgFps: number;
  minFps: number;
  maxEnemiesAlive: number;
  maxScore: number;
  duration: number;
}

export interface FrameDiff {
  frameA: number;
  frameB: number;
  playerMoved: boolean;
  playerDied: boolean;
  playerRevived: boolean;
  enemiesDelta: number;
  scoreGained: number;
  eventsInRange: GameEvent[];
}

export interface FullRecording {
  frames: FrameRecord[];
  events: GameEvent[];
  summary: StateSummary;
}

// ---------------------------------------------------------------------------
// StateRecorder
// ---------------------------------------------------------------------------

const RING_BUFFER_SIZE = 3000;

export class StateRecorder {
  private readonly ctx: GameContext;

  // Ring buffer
  private readonly buffer: Array<FrameRecord | null> = new Array(RING_BUFFER_SIZE).fill(null);
  private head = 0;       // next write index
  private totalFrames = 0;

  // All events (unbounded but small — typically <1000 per session)
  private readonly events: GameEvent[] = [];

  // Change detection state
  private prevLives = -1;
  private prevWeapon = '';
  private prevBombs = -1;
  private prevScore = 0;
  private prevEnemyCount = 0;
  private prevAlive = true;

  // FPS tracking
  private lastFpsTime = 0;
  private fpsFrameCount = 0;
  private currentFps = 60;

  constructor(ctx: GameContext) {
    this.ctx = ctx;
  }

  // -------------------------------------------------------------------------
  // Per-frame update (called from onFixedUpdate in main.ts)
  // -------------------------------------------------------------------------

  update(): void {
    const { player, enemySpawner, bulletPool, pickupSpawner, weaponManager, game } = this.ctx;
    const frame = this.totalFrames;
    const time = game.clock.totalTime;
    const dt = game.clock.fixedDeltaTime;

    // FPS estimate (1 / fixedDeltaTime)
    if (dt > 0) this.currentFps = Math.round(1 / dt);

    // --- Detect events ---
    const frameEvents: GameEvent[] = [];
    const currentWeapon = weaponManager.getCurrentWeapon();
    const currentLives = player.lives;
    const currentBombs = player.bombs;
    const currentAlive = player.alive;
    const currentScore = player.score;
    const currentEnemyCount = enemySpawner.getActiveCount();

    // Death
    if (this.prevAlive && !currentAlive) {
      const ev: GameEvent = { type: 'death', frame, time, preciseTime: performance.now(), details: {
        u: player.surfaceU, v: player.surfaceV, livesRemaining: currentLives,
      }};
      frameEvents.push(ev);
      this.events.push(ev);
    }

    // Revive (alive after death)
    if (!this.prevAlive && currentAlive && frame > 0) {
      // Not tracked separately but reflected in next frame's player.alive
    }

    // Weapon change
    if (this.prevWeapon !== '' && this.prevWeapon !== currentWeapon) {
      const ev: GameEvent = { type: 'weapon_change', frame, time, preciseTime: performance.now(), details: {
        from: this.prevWeapon, to: currentWeapon,
      }};
      frameEvents.push(ev);
      this.events.push(ev);
    }

    // Bomb used (bomb count decreases)
    if (this.prevBombs > 0 && currentBombs < this.prevBombs) {
      const ev: GameEvent = { type: 'bomb_used', frame, time, preciseTime: performance.now(), details: {
        bombsRemaining: currentBombs,
      }};
      frameEvents.push(ev);
      this.events.push(ev);
    }

    // Enemy killed (enemy count dropped — approximate, may include clear)
    if (currentEnemyCount < this.prevEnemyCount) {
      const killed = this.prevEnemyCount - currentEnemyCount;
      const ev: GameEvent = { type: 'enemy_killed', frame, time, preciseTime: performance.now(), details: {
        count: killed, scoreGained: currentScore - this.prevScore,
      }};
      frameEvents.push(ev);
      this.events.push(ev);
    }

    // Enemy spawned
    if (currentEnemyCount > this.prevEnemyCount) {
      const spawned = currentEnemyCount - this.prevEnemyCount;
      const ev: GameEvent = { type: 'enemy_spawned', frame, time, preciseTime: performance.now(), details: { count: spawned }};
      frameEvents.push(ev);
      this.events.push(ev);
    }

    // Update previous state
    this.prevAlive = currentAlive;
    this.prevWeapon = currentWeapon;
    this.prevLives = currentLives;
    this.prevBombs = currentBombs;
    this.prevScore = currentScore;
    this.prevEnemyCount = currentEnemyCount;

    // --- Capture enemies ---
    const enemies: FrameEnemyState[] = [];
    const playerPos = player.mesh ? player.mesh.position : null;
    for (const enemy of enemySpawner.getEnemies()) {
      if (!enemy.active) continue;
      const ePos = enemy.mesh ? enemy.mesh.position : enemy.position;
      const dist = playerPos ? playerPos.distanceTo(ePos) : -1;
      let id = (enemy as any).__testId as string | undefined;
      if (!id) { id = `e_${enemies.length}`; }
      let opacity = 1.0;
      const instanceIndex = (enemy as any)._instanceIndex as number | undefined;
      const instanceType = (enemy as any)._instanceType as string | undefined;
      if (instanceIndex !== undefined && instanceType && this.ctx.enemyInstanceManager) {
        const batch = (this.ctx.enemyInstanceManager as any).batches?.get(instanceType);
        if (batch?.opacityAttribute) opacity = batch.opacityAttribute.getX(instanceIndex);
      }
      enemies.push({
        id,
        type: enemy.baseTypeName || enemy.constructor.name,
        u: enemy.surfacePosition.u,
        v: enemy.surfacePosition.v,
        alive: enemy.alive,
        opacity,
        distToPlayer: dist,
      });
    }

    // --- Capture bullets (sampled — just UV + age) ---
    const bullets: FrameBulletState[] = [];
    bulletPool.forEachActive((_idx, _pos, data) => {
      bullets.push({ u: data.surfaceU, v: data.surfaceV, age: data.age });
    });

    // --- Capture pickups ---
    const pickups: FramePickupState[] = [];
    for (const wp of pickupSpawner.weaponPickups) {
      if (wp.active) pickups.push({ type: `weapon_${(wp as any).type ?? 'unknown'}`, u: wp.surfaceU ?? 0, v: wp.surfaceV ?? 0 });
    }
    for (const bp of pickupSpawner.buffPickups) {
      if (bp.active) pickups.push({ type: `buff_${(bp as any).buffType ?? 'unknown'}`, u: bp.surfaceU ?? 0, v: bp.surfaceV ?? 0 });
    }

    // --- Capture camera state ---
    let cameraState: FrameCameraState | undefined;
    try {
      const cam = this.ctx.game.camera;
      const cc = this.ctx.cameraController;
      const playerPos = this.ctx.player.mesh?.position;
      const camPos = cam.position;
      let distToPlayer = -1;
      let dotWithNormal = 0;
      if (playerPos) {
        distToPlayer = camPos.distanceTo(playerPos);
        // dot(cam→player direction, approximate surface normal at player)
        const toPlayer = playerPos.clone().sub(camPos).normalize();
        const sp = this.ctx.surface.getPoint(this.ctx.player.surfaceU, this.ctx.player.surfaceV);
        const normalWorld = sp.normal.clone().applyQuaternion(this.ctx.surface.worldRotation);
        dotWithNormal = toPlayer.dot(normalWorld);
      }
      // camera target: what the camera looks at (player mesh position, approximately)
      const target = playerPos ? { x: playerPos.x, y: playerPos.y, z: playerPos.z } : { x: 0, y: 0, z: 0 };
      const q = (cam as any).quaternion;
      cameraState = {
        position: { x: camPos.x, y: camPos.y, z: camPos.z },
        up: { x: cam.up.x, y: cam.up.y, z: cam.up.z },
        quaternion: q ? { x: q.x, y: q.y, z: q.z, w: q.w } : { x: 0, y: 0, z: 0, w: 1 },
        target,
        distanceToPlayer: distToPlayer,
        dotWithSurfaceNormal: dotWithNormal,
      };
    } catch { /* best-effort — camera capture never breaks recording */ }

    // --- Capture input state (pressed keys from DOM) ---
    let inputState: FrameInputState | undefined;
    try {
      const pressedKeys = (window as any).__pressedKeys as Set<string> | undefined;
      inputState = {
        keysDown: pressedKeys ? [...pressedKeys] : [],
        mouseX: (window as any).__mouseX ?? 0,
        mouseY: (window as any).__mouseY ?? 0,
      };
    } catch { /* best-effort */ }

    // --- Write to ring buffer ---
    const record: FrameRecord = {
      frame,
      time,
      player: {
        u: player.surfaceU, v: player.surfaceV,
        alive: currentAlive, lives: currentLives,
        score: currentScore, weapon: currentWeapon,
      },
      enemies,
      bullets,
      pickups,
      events: frameEvents,
      fps: this.currentFps,
      camera: cameraState,
      inputState,
    };

    this.buffer[this.head % RING_BUFFER_SIZE] = record;
    this.head = (this.head + 1) % RING_BUFFER_SIZE;
    this.totalFrames++;

    // Expose on window
    (window as any).__STATE_RECORDER = this;
  }

  // -------------------------------------------------------------------------
  // Public API (JSON-serializable for Puppeteer)
  // -------------------------------------------------------------------------

  /** Get recorded frames. If startFrame/endFrame omitted, returns all buffered frames. */
  getHistory(startFrame?: number, endFrame?: number): FrameRecord[] {
    const result: FrameRecord[] = [];
    for (let i = 0; i < RING_BUFFER_SIZE; i++) {
      const r = this.buffer[i];
      if (!r) continue;
      if (startFrame !== undefined && r.frame < startFrame) continue;
      if (endFrame !== undefined && r.frame > endFrame) continue;
      result.push(r);
    }
    result.sort((a, b) => a.frame - b.frame);
    return result;
  }

  /** Get events, optionally filtered by type and/or minimum frame. */
  getEvents(type?: string, sinceFrame?: number): GameEvent[] {
    return this.events.filter(e => {
      if (type && e.type !== type) return false;
      if (sinceFrame !== undefined && e.frame < sinceFrame) return false;
      return true;
    });
  }

  /**
   * Get events whose preciseTime falls within [startTime, endTime].
   * @param startTime performance.now()-based timestamp (inclusive)
   * @param endTime   performance.now()-based timestamp (inclusive)
   */
  getEventsBetween(startTime: number, endTime: number): GameEvent[] {
    return this.events.filter(e => e.preciseTime >= startTime && e.preciseTime <= endTime);
  }

  /**
   * Get events that have UV position data within a given UV-space radius.
   * Checks `details.u` / `details.v` (death/damage events) and
   * `details.playerPos` / `details.enemyPos` (collision events).
   * @param u      Target U coordinate in [0,1]
   * @param v      Target V coordinate in [0,1]
   * @param radius Max UV distance from (u, v) to include
   */
  getEventsNear(u: number, v: number, radius: number): GameEvent[] {
    return this.events.filter(e => {
      const evDetails = e.details;

      // Direct u/v on event (death events)
      const eu = evDetails.u as number | undefined;
      const ev = evDetails.v as number | undefined;
      if (eu !== undefined && ev !== undefined) {
        const du = eu - u; const dv = ev - v;
        if (Math.sqrt(du * du + dv * dv) <= radius) return true;
      }

      // playerPos from collision events
      const pp = evDetails.playerPos as { u: number; v: number } | undefined;
      if (pp) {
        const du = pp.u - u; const dv = pp.v - v;
        if (Math.sqrt(du * du + dv * dv) <= radius) return true;
      }

      // enemyPos from collision events
      const ep = evDetails.enemyPos as { u: number; v: number } | undefined;
      if (ep) {
        const du = ep.u - u; const dv = ep.v - v;
        if (Math.sqrt(du * du + dv * dv) <= radius) return true;
      }

      // bulletPos from bullet-enemy hit events
      const bp = evDetails.bulletPos as { u: number; v: number } | undefined;
      if (bp) {
        const du = bp.u - u; const dv = bp.v - v;
        if (Math.sqrt(du * du + dv * dv) <= radius) return true;
      }

      return false;
    });
  }

  /** Compute diff between two frames (by frame number). */
  getDiff(frameA: number, frameB: number): FrameDiff | null {
    const recA = this.getHistory(frameA, frameA)[0];
    const recB = this.getHistory(frameB, frameB)[0];
    if (!recA || !recB) return null;
    return {
      frameA, frameB,
      playerMoved: Math.abs(recA.player.u - recB.player.u) > 0.001 || Math.abs(recA.player.v - recB.player.v) > 0.001,
      playerDied: recA.player.alive && !recB.player.alive,
      playerRevived: !recA.player.alive && recB.player.alive,
      enemiesDelta: recB.enemies.length - recA.enemies.length,
      scoreGained: recB.player.score - recA.player.score,
      eventsInRange: this.getEvents(undefined, frameA).filter(e => e.frame <= frameB),
    };
  }

  /** High-level stats across recorded history. */
  getSummary(): StateSummary {
    const all = this.getHistory();
    if (all.length === 0) {
      return { totalFrames: 0, totalDeaths: 0, totalEnemiesKilled: 0, totalPickupsCollected: 0, totalWeaponChanges: 0, totalBombsUsed: 0, avgFps: 0, minFps: 0, maxEnemiesAlive: 0, maxScore: 0, duration: 0 };
    }
    let totalFps = 0, minFps = Infinity, maxEnemies = 0, maxScore = 0;
    for (const r of all) {
      totalFps += r.fps;
      if (r.fps < minFps) minFps = r.fps;
      if (r.enemies.length > maxEnemies) maxEnemies = r.enemies.length;
      if (r.player.score > maxScore) maxScore = r.player.score;
    }
    return {
      totalFrames: this.totalFrames,
      totalDeaths: this.events.filter(e => e.type === 'death').length,
      totalEnemiesKilled: this.events.filter(e => e.type === 'enemy_killed').reduce((s, e) => s + ((e.details.count as number) || 1), 0),
      totalPickupsCollected: this.events.filter(e => e.type === 'pickup_collected').length,
      totalWeaponChanges: this.events.filter(e => e.type === 'weapon_change').length,
      totalBombsUsed: this.events.filter(e => e.type === 'bomb_used').length,
      avgFps: Math.round(totalFps / all.length),
      minFps: minFps === Infinity ? 0 : minFps,
      maxEnemiesAlive: maxEnemies,
      maxScore,
      duration: all[all.length - 1].time - all[0].time,
    };
  }

  /**
   * Return the complete recording as a single serializable object.
   * Used by Puppeteer: page.evaluate(() => window.__STATE_RECORDER.getFullRecording())
   */
  getFullRecording(): FullRecording {
    return {
      frames: this.getHistory(),
      events: [...this.events],
      summary: this.getSummary(),
    };
  }

  /** Clear recording. */
  clear(): void {
    this.buffer.fill(null);
    this.head = 0;
    this.totalFrames = 0;
    this.events.length = 0;
    this.prevLives = -1;
    this.prevWeapon = '';
    this.prevBombs = -1;
    this.prevScore = 0;
    this.prevEnemyCount = 0;
    this.prevAlive = true;
  }

}


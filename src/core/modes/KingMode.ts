import * as THREE from 'three';
import type { BaseEnemy } from '../../entities/enemies/BaseEnemy';
import type { IGameMode, GameModeContext, ModeHUDData } from './IGameMode';
import type { EnemyType } from '../../entities/enemies/EnemySpawner';
import { generateScaledEndlessWave } from '../DifficultyScaling';
import { ZoneSurfaceMaterial } from '../../rendering/ZoneSurfaceMaterial';

/**
 * King of the Hill mode — scoring overhaul.
 *
 * Primary score = total SECONDS spent inside the safe zone (centisecond precision).
 * Kill PTS are tracked separately and displayed alongside zone time, but do NOT
 * determine the winner.
 *
 * Zone SHRINKS over time, creating escalating drama. Pre-planned enemy waves
 * fire at key radius thresholds, funneling enemies toward the shrinking zone.
 */
export class KingMode implements IGameMode {
  readonly name = 'King';
  readonly description = 'Survive inside the safe zone. Zone time = your score.';
  readonly icon = '👑';

  // ---------------------------------------------------------------------------
  // Zone geometry state
  // ---------------------------------------------------------------------------
  private zoneU: number = 0.5;
  private zoneV: number = 0.5;
  private zoneRadiusUV: number = 0.12;       // UV-space radius (shrinks over time)
  private zoneTimer: number = 15;            // seconds until zone moves
  private readonly zoneDuration = 15;

  /** Rate at which the zone shrinks per second in UV-space units */
  private readonly zoneShrinkRate = 0.0006;
  /** Hard minimum zone radius — prevents zone from disappearing */
  private readonly zoneMinRadiusUV = 0.04;
  /** UV radius starts wider than min so we can scale the world ring accordingly */
  private readonly zoneStartRadiusUV = 0.12;

  // ---------------------------------------------------------------------------
  // Visual
  // ---------------------------------------------------------------------------
  /** Mesh overlay using the surface geometry — paints the zone directly on the surface. */
  private zoneMesh: THREE.Mesh | null = null;
  /** World-space zone center (updated each frame, pre-allocated). */
  private readonly _zoneCenterWorld = new THREE.Vector3();
  /**
   * Zone center in the same coordinate space as player.mesh.position
   * (local surface space with worldRotation applied, no scale).
   * Used for the inZone proximity check — avoids worldToSurface UV round-trip
   * errors on surfaces like cube, mobius, cube-tunnel, mobius-bevel.
   */
  private readonly _zoneCenterPlayerSpace = new THREE.Vector3();
  /** World-space zone radius at game start (used to scale the shrinking radius). */
  private zoneWorldRadiusBase: number = 2.5;
  /** Elapsed time for zone shader animations. */
  private zoneTime: number = 0;

  // ---------------------------------------------------------------------------
  // Scoring
  // ---------------------------------------------------------------------------
  private inZone = false;

  /** Primary KotH score: seconds player spent inside the zone */
  private zoneTimeSeconds: number = 0;

  /** Kill PTS tracked separately — displayed but does NOT determine winner */
  private killPoints: number = 0;

  /** Bonus multiplier for zone kills (kept for fun, but not the primary metric) */
  private readonly zoneScoreMultiplier = 2.5;

  // ---------------------------------------------------------------------------
  // Pre-planned dramatic wave events (fire at zone radius thresholds)
  // ---------------------------------------------------------------------------
  private readonly shrinkEvents: Array<{
    /** Zone UV radius at which this event fires */
    threshold: number;
    /** Wave of enemies to spawn */
    wave: Array<{ type: EnemyType; count: number }>;
    /** Whether this event has already fired */
    spawned: boolean;
  }> = [
    {
      // Early dramatic reveal — guaranteed FractalSnake before high difficulty
      threshold: 0.10,
      wave: [
        { type: 'fractal_snake', count: 1 },
      ],
      spawned: false,
    },
    {
      // Mid-shrink — pressure wave of faster, erratic enemies
      threshold: 0.09,
      wave: [
        { type: 'spinner', count: 4 },
        { type: 'weaver', count: 3 },
        { type: 'rocket', count: 2 },
      ],
      spawned: false,
    },
    {
      // Heavy assault — gravitational hazards + swarms to disrupt player position
      threshold: 0.07,
      wave: [
        { type: 'gravity_well', count: 2 },
        { type: 'swarm', count: 3 },
        { type: 'stealth_stalker', count: 2 },
        { type: 'titan_grunt', count: 2 },
      ],
      spawned: false,
    },
    {
      // Final boss rush when zone is nearly minimum — maximum drama
      threshold: 0.05,
      wave: [
        { type: 'boss_sapphire', count: 1 },
        { type: 'splitter', count: 3 },
        { type: 'cluster', count: 2 },
        { type: 'fractal', count: 2 },
      ],
      spawned: false,
    },
  ];

  // ---------------------------------------------------------------------------
  // Time-based wave spawning (independent of zone shrink thresholds)
  // ---------------------------------------------------------------------------

  /** Seconds until the next timed wave fires. First wave at 8s. */
  private kothWaveTimer: number = 8;
  /** How many timed waves have fired so far (used for variety cycling). */
  private kothWaveNumber: number = 0;
  /** Total elapsed game time (drives difficulty ramp). */
  private kothElapsed: number = 0;
  /**
   * Staggered showcase spawns: fire a fractal_snake at 10s, 18s, 26s, 34s.
   * Combined with variant cycling in EnemySpawner, this guarantees the user
   * sees all 4 head variants within the first 35 seconds of KotH gameplay.
   */
  private fractalSnakeShowcaseTimers: number[] = [10, 18, 26, 34];

  // ---------------------------------------------------------------------------
  // IGameMode interface
  // ---------------------------------------------------------------------------

  onStart(context: GameModeContext): void {
    this.moveZone(context);
    this.createZoneVisual(context);
  }

  onFixedUpdate(dt: number, context: GameModeContext): void {
    // In network mode, spawn warning rings are never cleaned up (enemySpawner.update is not
    // called client-side). Skip warnings for all wave spawns to prevent accumulation.
    const skipWarning = context.isNetworkMode ?? false;

    // 0. Tick elapsed time and zone animation timer
    this.zoneTime += dt;
    this.kothElapsed += dt;
    this.kothWaveTimer -= dt;
    if (this.kothWaveTimer <= 0) {
      this.spawnTimedKothWave(context, skipWarning);
    }

    // Staggered showcase: spawn one fractal_snake at each showcase timer threshold.
    // EnemySpawner cycles variants, so snakes at 10s/18s/26s/34s each show a different head.
    for (let i = this.fractalSnakeShowcaseTimers.length - 1; i >= 0; i--) {
      if (this.kothElapsed >= this.fractalSnakeShowcaseTimers[i]) {
        context.enemySpawner.spawnWave([{ type: 'fractal_snake', count: 1 }], skipWarning);
        this.fractalSnakeShowcaseTimers.splice(i, 1);
      }
    }

    // 1. Shrink zone
    this.zoneRadiusUV = Math.max(
      this.zoneMinRadiusUV,
      this.zoneRadiusUV - this.zoneShrinkRate * dt,
    );

    // 2. Zone move timer
    this.zoneTimer -= dt;
    if (this.zoneTimer <= 0) {
      this.moveZone(context);
      this.zoneTimer = this.zoneDuration;
    }

    // 3. Check if player is in zone using world-space distance.
    // Rationale: UV-space checks fail on surfaces where worldToSurface(getPoint(u,v)) ≠ (u,v)
    // (cube, mobius, cube-tunnel, mobius-bevel have UV parameterization discontinuities).
    // Using getPoint() → worldRotation gives a coordinate space consistent with
    // player.mesh.position, which is set by playerWalker walking on the surface mesh.
    const zonePoint = context.surface.getPoint(this.zoneU, this.zoneV);
    const scaleFactor = context.surface.group.scale.x;
    // Zone center in world space: getPoint() returns unscaled (rotation only), multiply by
    // scaleFactor to match player.mesh.position which comes from matrixWorld (includes scale).
    this._zoneCenterPlayerSpace.copy(zonePoint.position)
      .applyQuaternion(context.surface.worldRotation)
      .multiplyScalar(scaleFactor);
    // Zone radius in world space: zoneWorldRadiusBase already includes scaleFactor (set in onStart).
    const localZoneRadius = this.zoneWorldRadiusBase
      * (this.zoneRadiusUV / this.zoneStartRadiusUV);
    const px = context.player.mesh.position;
    const dx = px.x - this._zoneCenterPlayerSpace.x;
    const dy = px.y - this._zoneCenterPlayerSpace.y;
    const dz = px.z - this._zoneCenterPlayerSpace.z;
    this.inZone = (dx * dx + dy * dy + dz * dz) <= localZoneRadius * localZoneRadius;

    // 4. Accumulate zone time (primary score)
    if (this.inZone) {
      this.zoneTimeSeconds += dt;
    }

    // 5. Fire pre-planned dramatic waves at shrink thresholds
    for (const event of this.shrinkEvents) {
      if (!event.spawned && this.zoneRadiusUV <= event.threshold) {
        event.spawned = true;
        this.triggerShrinkWave(context, event.wave, skipWarning);
      }
    }

    // 6. Update zone visual
    this.updateZoneVisual(context);
  }

  onRender(_dt: number, _context: GameModeContext): void {
    // Visual updates already done in onFixedUpdate
  }

  /**
   * Called when an enemy is killed.
   * Tracks kill PTS separately (not the primary score).
   * Returns a bonus multiplier for kills made inside the zone.
   */
  onEnemyKilled(enemy: BaseEnemy, _context: GameModeContext): number {
    // Track kill PTS for display — these don't determine the winner
    this.killPoints += enemy.scoreValue ?? 0;
    return this.inZone ? this.zoneScoreMultiplier : 1.0;
  }

  /**
   * Primary KotH score = zone time in centiseconds (integer).
   * e.g. 45.32 seconds of zone time → 4532
   */
  getScore(_context: GameModeContext): number {
    return Math.round(this.zoneTimeSeconds * 100);
  }

  /**
   * Label for the game over screen score display.
   */
  getScoreLabel(): string {
    return 'ZONE TIME';
  }

  isGameOver(context: GameModeContext): boolean {
    return context.player.lives <= 0;
  }

  getHUDOverlay(_context: GameModeContext): ModeHUDData | null {
    const zoneSeconds = this.zoneTimeSeconds;
    const mins = Math.floor(zoneSeconds / 60);
    const secs = Math.floor(zoneSeconds % 60);
    const tenths = Math.floor((zoneSeconds % 1) * 10);
    const timeStr = mins > 0
      ? `${mins}:${String(secs).padStart(2, '0')}.${tenths}`
      : `${secs}.${tenths}s`;

    // Radius shrink progress (0 = full, 1 = minimum)
    const shrinkProgress = 1 - (this.zoneRadiusUV - this.zoneMinRadiusUV) /
      (this.zoneStartRadiusUV - this.zoneMinRadiusUV);
    const shrinkPct = Math.round(Math.min(1, shrinkProgress) * 100);

    // Primary (LARGE) = Zone time (seconds in zone) with in-zone status indicator
    const indicator = this.inZone ? '⬛' : '⬜';
    const primary = `${indicator} ${timeStr}`;

    // Secondary (small) = Kill points
    const secondary = `PTS: ${this.killPoints.toLocaleString()}  |  Zone: ${100 - shrinkPct}%`;

    const zoneTimeLimit = Math.ceil(this.zoneTimer);
    const warning = this.zoneRadiusUV <= this.zoneMinRadiusUV + 0.005
      ? '⚠ ZONE AT MINIMUM SIZE'
      : this.zoneTimer < 4
      ? `Zone moves in ${zoneTimeLimit}s`
      : undefined;

    return {
      primary,
      primaryColor: this.inZone ? '#00ffff' : '#88aaaa',
      secondary,
      warning,
      warningColor: '#ff4444',
    };
  }

  dispose(context: GameModeContext): void {
    if (this.zoneMesh) {
      context.surface.group.remove(this.zoneMesh);
      // DO NOT dispose geometry — it is shared with surface.mesh.
      // Only dispose our material.
      (this.zoneMesh.material as THREE.Material).dispose();
      this.zoneMesh = null;
    }
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private moveZone(context: GameModeContext): void {
    this.zoneU = Math.random();
    this.zoneV = Math.random();

    if (context.surface.wrapsU) {
      this.zoneU = this.zoneU % 1.0;
    } else {
      this.zoneU = Math.max(0.1, Math.min(0.9, this.zoneU));
    }
    if (context.surface.wrapsV) {
      this.zoneV = this.zoneV % 1.0;
    } else {
      this.zoneV = Math.max(0.1, Math.min(0.9, this.zoneV));
    }
  }

  private createZoneVisual(context: GameModeContext): void {
    const geo = context.surface.mesh.geometry;
    if (!geo.boundingSphere) geo.computeBoundingSphere();
    if (geo.boundingSphere) {
      // Base world radius = 25% of surface radius scaled by map size factor.
      // This is the radius at zoneStartRadiusUV; we scale proportionally as zone shrinks.
      const scaleFactor = context.surface.group.scale.x;
      this.zoneWorldRadiusBase = Math.max(0.5, geo.boundingSphere.radius * 0.25 * scaleFactor);
    }

    // Create an overlay mesh that shares the surface geometry.
    // It sits inside surface.group so it rotates with the surface automatically.
    // Geometry is NOT cloned — sharing is intentional (zero extra memory, deforms correctly).
    const material = new ZoneSurfaceMaterial();
    this.zoneMesh = new THREE.Mesh(context.surface.mesh.geometry, material);
    // renderOrder 2: above surface (0) and grid (1), below entities
    this.zoneMesh.renderOrder = 2;
    context.surface.group.add(this.zoneMesh);
  }

  private updateZoneVisual(context: GameModeContext): void {
    if (!this.zoneMesh) return;
    const mat = this.zoneMesh.material as ZoneSurfaceMaterial;

    // Zone center in world space.
    // surface.getPoint() applies worldRotation to the local-space surface point.
    // Multiply by scaleFactor so the result matches the scaled group transform.
    const scaleFactor = context.surface.group.scale.x;
    const point = context.surface.getPoint(this.zoneU, this.zoneV);
    this._zoneCenterWorld.copy(point.position).multiplyScalar(scaleFactor);

    // Current world-space zone radius, proportional to UV radius
    const radiusRatio = this.zoneRadiusUV / this.zoneStartRadiusUV;
    const zoneWorldRadius = this.zoneWorldRadiusBase * radiusRatio;

    // Shrink progress: 0 = full size, 1 = at minimum (drives danger color)
    const shrinkProgress = 1 - (this.zoneRadiusUV - this.zoneMinRadiusUV) /
      (this.zoneStartRadiusUV - this.zoneMinRadiusUV);

    mat.updateZone(
      this._zoneCenterWorld,
      zoneWorldRadius,
      this.zoneTime,
      Math.min(1, Math.max(0, shrinkProgress)),
      this.inZone,
    );
  }

  /**
   * Spawn a timed escalating wave using the difficulty-scaling system.
   * Called every 5–10s throughout the match, creating continuous pressure
   * that increases in intensity over time.
   */
  private spawnTimedKothWave(context: GameModeContext, skipWarning: boolean): void {
    this.kothWaveNumber++;

    // Difficulty ramps from 0 → 5 over 5 minutes (aggressive for KotH)
    const difficultyLevel = Math.min(5.0, this.kothElapsed / 60.0);
    const activeCount = context.enemySpawner.getActiveCount();
    const wave = generateScaledEndlessWave(this.kothWaveNumber, difficultyLevel, activeCount);
    context.enemySpawner.spawnWave(wave as any, skipWarning);

    // Every 3rd wave, add a fractal_snake to keep them appearing throughout the match
    if (this.kothWaveNumber % 3 === 0) {
      context.enemySpawner.spawnWave([{ type: 'fractal_snake', count: 1 }], skipWarning);
    }

    // Interval shrinks from 10s → 5s as waves accumulate (max every 5s)
    const interval = Math.max(5.0, 10.0 - Math.floor(this.kothWaveNumber / 4));
    this.kothWaveTimer = interval;
  }

  /**
   * Trigger a pre-planned enemy wave at a shrink threshold.
   * Spawns enemies around the zone perimeter to funnel toward it.
   */
  private triggerShrinkWave(
    context: GameModeContext,
    wave: Array<{ type: EnemyType; count: number }>,
    skipWarning: boolean = false,
  ): void {
    const spawner = context.enemySpawner;
    if (!spawner?.spawnWave) return;

    spawner.spawnWave(
      wave.map((entry) => ({
        type: entry.type,
        count: entry.count,
      })),
      skipWarning,
    );
  }

}

import * as THREE from 'three';
import type { BaseEnemy } from '../../entities/enemies/BaseEnemy';
import type { IGameMode, GameModeContext, ModeHUDData } from './IGameMode';
import type { EnemyType } from '../../entities/enemies/EnemySpawner';
import { generateScaledEndlessWave } from '../DifficultyScaling';

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
  private zoneRadiusWorld: number = 2.5;     // World-space ring radius for visibility
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
  private zoneMesh: THREE.Mesh | null = null;
  private zoneColor = new THREE.Color(0x00ffff);

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
  /** Countdown for the guaranteed early fractal_snake spawn (~12 seconds in). */
  private fractalSnakeStartTimer: number = 12;

  // Pre-allocated temp vectors
  private static readonly _tempVec3 = new THREE.Vector3();

  // ---------------------------------------------------------------------------
  // IGameMode interface
  // ---------------------------------------------------------------------------

  onStart(context: GameModeContext): void {
    this.moveZone(context);
    this.createZoneVisual(context);
  }

  onFixedUpdate(dt: number, context: GameModeContext): void {
    // 0. Tick elapsed time and fire timed waves
    this.kothElapsed += dt;
    this.kothWaveTimer -= dt;
    if (this.kothWaveTimer <= 0) {
      this.spawnTimedKothWave(context);
    }

    // Guaranteed early FractalSnake spawn at ~12 seconds — user must see it
    if (this.fractalSnakeStartTimer > 0) {
      this.fractalSnakeStartTimer -= dt;
      if (this.fractalSnakeStartTimer <= 0) {
        context.enemySpawner.spawnWave([{ type: 'fractal_snake', count: 1 }]);
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

    // 3. Check if player is in zone
    const playerU = context.player.surfaceU;
    const playerV = context.player.surfaceV;
    const distU = this.wrappedDistance(playerU, this.zoneU, context.surface.wrapsU);
    const distV = this.wrappedDistance(playerV, this.zoneV, context.surface.wrapsV);
    this.inZone = (distU * distU + distV * distV) <= this.zoneRadiusUV * this.zoneRadiusUV;

    // 4. Accumulate zone time (primary score)
    if (this.inZone) {
      this.zoneTimeSeconds += dt;
    }

    // 5. Fire pre-planned dramatic waves at shrink thresholds
    for (const event of this.shrinkEvents) {
      if (!event.spawned && this.zoneRadiusUV <= event.threshold) {
        event.spawned = true;
        this.triggerShrinkWave(context, event.wave);
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
    const cs = Math.floor((zoneSeconds % 1) * 100);
    const timeStr = mins > 0
      ? `${mins}:${String(secs).padStart(2, '0')}.${String(cs).padStart(2, '0')}`
      : `${secs}.${String(cs).padStart(2, '0')}s`;

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
      context.scene.remove(this.zoneMesh);
      this.zoneMesh.geometry.dispose();
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
      // Apply map size scale factor so ring is sized relative to actual visible surface
      const scaleFactor = context.surface.group.scale.x;
      this.zoneRadiusWorld = Math.max(0.5, geo.boundingSphere.radius * 0.25 * scaleFactor);
    }
    const geometry = new THREE.RingGeometry(this.zoneRadiusWorld * 0.75, this.zoneRadiusWorld, 48);
    const material = new THREE.MeshBasicMaterial({
      color: this.zoneColor,
      transparent: true,
      opacity: 0.5,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: false,
    });
    this.zoneMesh = new THREE.Mesh(geometry, material);
    this.zoneMesh.renderOrder = 10;
    context.scene.add(this.zoneMesh);
  }

  private updateZoneVisual(context: GameModeContext): void {
    if (!this.zoneMesh) return;

    // Get surface point at zone location.
    // getPoint() returns local-space (unscaled) coords. Apply group scale so the
    // zone sits on the actual visible surface regardless of map size (small=0.75,
    // medium=1.0, large=1.5, epic=2.0). Matches makeSurfaceTransformFn pattern.
    const scaleFactor = context.surface.group.scale.x;
    const point = context.surface.getPoint(this.zoneU, this.zoneV);
    this.zoneMesh.position.copy(point.position).multiplyScalar(scaleFactor);

    // Orient to surface
    const up = KingMode._tempVec3.copy(point.normal);
    this.zoneMesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), up);

    // Scale ring to reflect current zone radius (shrinks visually with UV radius)
    const radiusRatio = this.zoneRadiusUV / this.zoneStartRadiusUV;
    const pulse = 1.0 + 0.15 * Math.sin(Date.now() * 0.003);
    this.zoneMesh.scale.setScalar(radiusRatio * pulse);

    // Color: cyan → red as zone shrinks
    const shrinkProgress = 1 - (this.zoneRadiusUV - this.zoneMinRadiusUV) /
      (this.zoneStartRadiusUV - this.zoneMinRadiusUV);
    const tAlarm = this.zoneTimer < 3 ? (Math.sin(Date.now() * 0.01) * 0.5 + 0.5) : 0;
    const tShrink = Math.min(1, Math.max(0, shrinkProgress));
    (this.zoneMesh.material as THREE.MeshBasicMaterial).color.lerpColors(
      this.zoneColor,
      new THREE.Color(0xff2200),
      Math.max(tAlarm, tShrink * 0.6),
    );

    const opacity = this.inZone ? 0.6 : 0.4;
    (this.zoneMesh.material as THREE.MeshBasicMaterial).opacity = opacity;
  }

  /**
   * Spawn a timed escalating wave using the difficulty-scaling system.
   * Called every 5–10s throughout the match, creating continuous pressure
   * that increases in intensity over time.
   */
  private spawnTimedKothWave(context: GameModeContext): void {
    this.kothWaveNumber++;

    // Difficulty ramps from 0 → 5 over 5 minutes (aggressive for KotH)
    const difficultyLevel = Math.min(5.0, this.kothElapsed / 60.0);
    const activeCount = context.enemySpawner.getActiveCount();
    const wave = generateScaledEndlessWave(this.kothWaveNumber, difficultyLevel, activeCount);
    context.enemySpawner.spawnWave(wave as any);

    // Every 3rd wave, add a fractal_snake to keep them appearing throughout the match
    if (this.kothWaveNumber % 3 === 0) {
      context.enemySpawner.spawnWave([{ type: 'fractal_snake', count: 1 }]);
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
  ): void {
    const spawner = context.enemySpawner;
    if (!spawner?.spawnWave) return;

    spawner.spawnWave(
      wave.map((entry) => ({
        type: entry.type,
        count: entry.count,
      })),
    );
  }

  /**
   * Calculate wrapped UV distance respecting surface topology.
   */
  private wrappedDistance(a: number, b: number, wraps: boolean): number {
    if (!wraps) return Math.abs(a - b);
    const d = Math.abs(a - b);
    return Math.min(d, 1.0 - d);
  }
}

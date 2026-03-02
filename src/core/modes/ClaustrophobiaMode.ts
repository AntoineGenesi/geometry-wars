import * as THREE from 'three';
import type { BaseEnemy } from '../../entities/enemies/BaseEnemy';
import type { IGameMode, GameModeContext, ModeHUDData } from './IGameMode';

/**
 * Claustrophobia mode.
 * Play area shrinks over time (UV bounds contract toward center).
 * Enemies and player killed if outside boundary.
 */
export class ClaustrophobiaMode implements IGameMode {
  readonly name = 'Claustrophobia';
  readonly description = 'Play area shrinks over time. Stay inside or die!';
  readonly icon = '🔴';

  // Boundary state
  private boundaryRadius: number = 0.5; // UV space, centered at (0.5, 0.5)
  private readonly initialRadius = 0.5;
  private readonly finalRadius = 0.05;
  private readonly shrinkDuration = 180; // 3 minutes to shrink completely
  private elapsedTime = 0;

  // Scoring: primary = zone time (seconds inside boundary), secondary = kill points
  private zoneTimeSeconds = 0;

  // Visual
  private boundaryMesh: THREE.Line | null = null;
  private readonly boundaryColor = new THREE.Color(0xff0000);

  // Pre-allocated temp vectors
  private static readonly _tempVec3 = new THREE.Vector3();

  onStart(context: GameModeContext): void {
    this.createBoundaryVisual(context);
  }

  onFixedUpdate(dt: number, context: GameModeContext): void {
    // Shrink boundary over time
    this.elapsedTime += dt;
    const progress = Math.min(1.0, this.elapsedTime / this.shrinkDuration);
    this.boundaryRadius = this.initialRadius - progress * (this.initialRadius - this.finalRadius);

    // Check if player is outside boundary
    const playerU = context.player.surfaceU;
    const playerV = context.player.surfaceV;
    const { wrapsU, wrapsV } = context.surface;
    if (!this.isInsideBoundary(playerU, playerV, wrapsU, wrapsV)) {
      // Kill player instantly
      context.player.die();
    } else {
      // Player is alive inside boundary — accumulate zone time
      this.zoneTimeSeconds += dt;
    }

    // Kill enemies outside boundary
    const enemies = context.enemySpawner.getEnemies();
    for (const enemy of enemies) {
      const u = enemy.surfacePosition.u;
      const v = enemy.surfacePosition.v;
      if (!this.isInsideBoundary(u, v, wrapsU, wrapsV)) {
        enemy.takeDamage(enemy.health); // Instant kill
      }
    }

    // Update boundary visual
    this.updateBoundaryVisual(context);
  }

  onRender(_dt: number, _context: GameModeContext): void {
    // Visual updates already done in onFixedUpdate
  }

  onEnemyKilled(_enemy: BaseEnemy, _context: GameModeContext): number {
    return 1.0; // Normal score (kill points remain secondary)
  }

  /**
   * Primary Claustrophobia score = zone time in centiseconds.
   * Matches the same scale as KingMode.getScore() so GameOverScreen displays correctly.
   */
  getScore(_context: GameModeContext): number {
    return Math.round(this.zoneTimeSeconds * 100);
  }

  getScoreLabel(): string {
    return 'ZONE TIME';
  }

  isGameOver(context: GameModeContext): boolean {
    return context.player.lives <= 0;
  }

  getHUDOverlay(context: GameModeContext): ModeHUDData | null {
    const percent = Math.round((this.boundaryRadius / this.initialRadius) * 100);
    const warning = this.boundaryRadius < 0.15 ? 'DANGER ZONE!' : undefined;

    // Primary: zone time (seconds inside boundary)
    const zt = this.zoneTimeSeconds;
    const mins = Math.floor(zt / 60);
    const secs = Math.floor(zt % 60);
    const cs = Math.floor((zt % 1) * 100);
    const timeStr = mins > 0
      ? `${mins}:${String(secs).padStart(2, '0')}.${String(cs).padStart(2, '0')}`
      : `${secs}.${String(cs).padStart(2, '0')}s`;

    // Secondary: kill points + boundary size
    const killPts = context.player.score;
    const secondary = `PTS: ${killPts.toLocaleString()}  |  Area: ${percent}%`;

    return {
      primary: `🔴 ${timeStr}`,
      primaryColor: '#ff4444',
      secondary,
      warning,
      warningColor: '#ff0000',
    };
  }

  dispose(context: GameModeContext): void {
    if (this.boundaryMesh) {
      context.scene.remove(this.boundaryMesh);
      this.boundaryMesh.geometry.dispose();
      (this.boundaryMesh.material as THREE.Material).dispose();
      this.boundaryMesh = null;
    }
  }

  // -----------------------------------------------------------------------
  // Private helpers
  // -----------------------------------------------------------------------

  private isInsideBoundary(u: number, v: number, wrapsU: boolean, wrapsV: boolean): boolean {
    // Circular boundary centered at (0.5, 0.5), respecting surface UV topology
    const du = this.wrappedDistance(u, 0.5, wrapsU);
    const dv = this.wrappedDistance(v, 0.5, wrapsV);
    return (du * du + dv * dv) <= this.boundaryRadius * this.boundaryRadius;
  }

  private wrappedDistance(a: number, b: number, wraps: boolean): number {
    if (!wraps) return Math.abs(a - b);
    const d = Math.abs(a - b);
    return Math.min(d, 1.0 - d);
  }

  private createBoundaryVisual(context: GameModeContext): void {
    // Create a ring at the boundary
    const scaleFactor = context.surface.group.scale.x;
    const segments = 64;
    const points: THREE.Vector3[] = [];
    for (let i = 0; i <= segments; i++) {
      const angle = (i / segments) * Math.PI * 2;
      const u = 0.5 + Math.cos(angle) * this.boundaryRadius;
      const v = 0.5 + Math.sin(angle) * this.boundaryRadius;
      const point = context.surface.getPoint(u, v);
      points.push(point.position.clone().multiplyScalar(scaleFactor));
    }

    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    const material = new THREE.LineBasicMaterial({
      color: this.boundaryColor,
      linewidth: 2,
      transparent: true,
      opacity: 0.8,
    });
    this.boundaryMesh = new THREE.Line(geometry, material);
    context.scene.add(this.boundaryMesh);
  }

  private updateBoundaryVisual(context: GameModeContext): void {
    if (!this.boundaryMesh) return;

    // Rebuild boundary ring at new radius, scaled to world space
    const scaleFactor = context.surface.group.scale.x;
    const segments = 64;
    const points: THREE.Vector3[] = [];
    for (let i = 0; i <= segments; i++) {
      const angle = (i / segments) * Math.PI * 2;
      const u = 0.5 + Math.cos(angle) * this.boundaryRadius;
      const v = 0.5 + Math.sin(angle) * this.boundaryRadius;
      const point = context.surface.getPoint(u, v);
      points.push(point.position.clone().multiplyScalar(scaleFactor));
    }

    this.boundaryMesh.geometry.dispose();
    this.boundaryMesh.geometry = new THREE.BufferGeometry().setFromPoints(points);

    // Pulse animation when small
    if (this.boundaryRadius < 0.15) {
      const flash = Math.sin(Date.now() * 0.01) * 0.5 + 0.5;
      (this.boundaryMesh.material as THREE.LineBasicMaterial).opacity = 0.5 + flash * 0.5;
    }
  }
}

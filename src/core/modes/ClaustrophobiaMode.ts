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
    if (!this.isInsideBoundary(playerU, playerV)) {
      // Kill player instantly
      context.player.die();
    }

    // Kill enemies outside boundary
    const enemies = context.enemySpawner.getEnemies();
    for (const enemy of enemies) {
      const u = enemy.surfacePosition.u;
      const v = enemy.surfacePosition.v;
      if (!this.isInsideBoundary(u, v)) {
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
    return 1.0; // Normal score
  }

  getScore(context: GameModeContext): number {
    return context.player.score;
  }

  isGameOver(context: GameModeContext): boolean {
    return context.player.lives <= 0;
  }

  getHUDOverlay(_context: GameModeContext): ModeHUDData | null {
    const percent = Math.round((this.boundaryRadius / this.initialRadius) * 100);
    const warning = this.boundaryRadius < 0.15 ? 'DANGER ZONE!' : undefined;

    return {
      primary: `Play Area: ${percent}%`,
      primaryColor: '#ff0000',
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

  private isInsideBoundary(u: number, v: number): boolean {
    // Simple circular boundary centered at (0.5, 0.5)
    const du = u - 0.5;
    const dv = v - 0.5;
    const distSq = du * du + dv * dv;
    return distSq <= this.boundaryRadius * this.boundaryRadius;
  }

  private createBoundaryVisual(context: GameModeContext): void {
    // Create a ring at the boundary
    const segments = 64;
    const points: THREE.Vector3[] = [];
    for (let i = 0; i <= segments; i++) {
      const angle = (i / segments) * Math.PI * 2;
      const u = 0.5 + Math.cos(angle) * this.boundaryRadius;
      const v = 0.5 + Math.sin(angle) * this.boundaryRadius;
      const point = context.surface.getPoint(u, v);
      points.push(point.position.clone());
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

    // Rebuild boundary ring at new radius
    const segments = 64;
    const points: THREE.Vector3[] = [];
    for (let i = 0; i <= segments; i++) {
      const angle = (i / segments) * Math.PI * 2;
      const u = 0.5 + Math.cos(angle) * this.boundaryRadius;
      const v = 0.5 + Math.sin(angle) * this.boundaryRadius;
      const point = context.surface.getPoint(u, v);
      points.push(point.position.clone());
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

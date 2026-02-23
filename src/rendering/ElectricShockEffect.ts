import * as THREE from 'three';

const DURATION = 0.8;

/**
 * ElectricShockEffect — short-lived lightning lines drawn from a head position to targets.
 *
 * Used when the FractalSnake head dies to visualise the shock propagating through followers.
 * Lines flicker (random opacity) and auto-remove after 0.8 seconds.
 *
 * Usage:
 *   const effect = new ElectricShockEffect(scene);
 *   effect.trigger(headWorldPos, followerWorldPositions);
 *   // in game update loop:
 *   effect.update(dt);
 */
export class ElectricShockEffect {
  private readonly _scene: THREE.Scene;
  private _lines: THREE.Line[] = [];
  private _materials: THREE.LineBasicMaterial[] = [];
  private _timeLeft: number = 0;
  private _active: boolean = false;

  constructor(scene: THREE.Scene) {
    this._scene = scene;
  }

  /**
   * Spawn lightning lines from headPos to each target (and daisy-chain between consecutive targets).
   * Calling trigger again while active replaces the current effect.
   */
  trigger(
    headPos: THREE.Vector3,
    targetPositions: THREE.Vector3[],
    color: THREE.Color = new THREE.Color(0x44ffff),
  ): void {
    this._removeLines();

    if (targetPositions.length === 0) return;

    // Build segments: head→target[0], target[0]→target[1], ..., target[n-1]→target[n]
    const allPairs: Array<[THREE.Vector3, THREE.Vector3]> = [];
    allPairs.push([headPos, targetPositions[0]]);
    for (let i = 0; i + 1 < targetPositions.length; i++) {
      allPairs.push([targetPositions[i], targetPositions[i + 1]]);
    }

    for (const [A, B] of allPairs) {
      // Add 1 midpoint with random jitter — "lightning" zig-zag
      const mid = A.clone().lerp(B, 0.5).add(
        new THREE.Vector3(
          (Math.random() - 0.5) * 0.3,
          (Math.random() - 0.5) * 0.3,
          (Math.random() - 0.5) * 0.3,
        ),
      );

      const positions = new Float32Array([
        A.x, A.y, A.z,
        mid.x, mid.y, mid.z,
        B.x, B.y, B.z,
      ]);

      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));

      const mat = new THREE.LineBasicMaterial({
        color,
        transparent: true,
        opacity: 1.0,
      });

      const line = new THREE.Line(geo, mat);
      this._scene.add(line);
      this._lines.push(line);
      this._materials.push(mat);
    }

    this._timeLeft = DURATION;
    this._active = true;
  }

  /** Call once per frame with elapsed seconds. Removes lines when duration expires. */
  update(dt: number): void {
    if (!this._active) return;

    this._timeLeft -= dt;

    if (this._timeLeft <= 0) {
      this._removeLines();
      this._active = false;
      return;
    }

    // Flicker: randomise opacity every frame for electric look
    for (const mat of this._materials) {
      mat.opacity = 0.4 + Math.random() * 0.6;
    }
  }

  get active(): boolean {
    return this._active;
  }

  private _removeLines(): void {
    for (const line of this._lines) {
      this._scene.remove(line);
      line.geometry.dispose();
    }
    for (const mat of this._materials) {
      mat.dispose();
    }
    this._lines = [];
    this._materials = [];
  }

  /** Clean up all resources and remove from scene. */
  dispose(): void {
    this._removeLines();
    this._active = false;
  }
}

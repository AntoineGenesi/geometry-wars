import * as THREE from 'three';

export class ScreenShake {
  readonly offset: THREE.Vector3;

  private shakes: Array<{
    intensity: number;
    duration: number;
    elapsed: number;
  }>;

  constructor() {
    this.offset = new THREE.Vector3();
    this.shakes = [];
  }

  shake(intensity: number, duration: number): void {
    this.shakes.push({
      intensity,
      duration,
      elapsed: 0,
    });
  }

  update(dt: number): void {
    this.offset.set(0, 0, 0);

    // Update all active shakes
    for (let i = this.shakes.length - 1; i >= 0; i--) {
      const shake = this.shakes[i];
      shake.elapsed += dt;

      if (shake.elapsed >= shake.duration) {
        // Remove expired shake
        this.shakes.splice(i, 1);
        continue;
      }

      // Calculate decay factor (exponential)
      const progress = shake.elapsed / shake.duration;
      const decay = Math.pow(1 - progress, 2);

      // Random jitter for this shake
      const currentIntensity = shake.intensity * decay;
      const jitterX = (Math.random() - 0.5) * 2 * currentIntensity;
      const jitterY = (Math.random() - 0.5) * 2 * currentIntensity;
      const jitterZ = (Math.random() - 0.5) * 2 * currentIntensity;

      // Accumulate shake offsets
      this.offset.x += jitterX;
      this.offset.y += jitterY;
      this.offset.z += jitterZ;
    }
  }
}

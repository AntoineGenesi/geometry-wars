import * as THREE from 'three';

export class ScreenShake {
  readonly offset: THREE.Vector3;

  // Cap concurrent shakes so rapid kills don't stack into continuous jitter
  private static readonly MAX_CONCURRENT_SHAKES = 4;
  private static readonly MAX_CONCURRENT_KILL_SHAKES = 2;
  private static readonly MAX_CONCURRENT_SPECIAL_SHAKES = 2;
  private static readonly KILL_SHAKE_MAX_INTENSITY = 0.08;
  private static readonly KILL_SHAKE_MIN_INTERVAL = 0.06;
  private static readonly SPECIAL_SHAKE_MAX_INTENSITY = 0.18;
  private static readonly SPECIAL_SHAKE_MAX_DURATION = 0.22;
  private static readonly SPECIAL_SHAKE_MIN_INTERVAL = 0.08;

  private shakes: Array<{
    intensity: number;
    duration: number;
    elapsed: number;
    kind: 'event' | 'kill' | 'special';
  }>;
  private time = 0;
  private lastKillShakeTime = -Infinity;
  private lastSpecialShakeTime = -Infinity;
  private acceptedKillShakes = 0;
  private suppressedKillShakes = 0;
  private acceptedSpecialShakes = 0;
  private suppressedSpecialShakes = 0;

  constructor() {
    this.offset = new THREE.Vector3();
    this.shakes = [];
  }

  shake(intensity: number, duration: number): void {
    if (this.shakes.length >= ScreenShake.MAX_CONCURRENT_SHAKES) return;
    this.shakes.push({
      intensity,
      duration,
      elapsed: 0,
      kind: 'event',
    });
  }

  shakeKill(intensity: number, duration: number): void {
    const activeKillShakes = this.shakes.reduce(
      (count, shake) => count + (shake.kind === 'kill' ? 1 : 0),
      0,
    );
    if (
      this.shakes.length >= ScreenShake.MAX_CONCURRENT_SHAKES
      || activeKillShakes >= ScreenShake.MAX_CONCURRENT_KILL_SHAKES
      || this.time - this.lastKillShakeTime < ScreenShake.KILL_SHAKE_MIN_INTERVAL
    ) {
      this.suppressedKillShakes++;
      return;
    }

    this.lastKillShakeTime = this.time;
    this.acceptedKillShakes++;
    this.shakes.push({
      intensity: Math.min(intensity, ScreenShake.KILL_SHAKE_MAX_INTENSITY),
      duration: Math.min(duration, 0.12),
      elapsed: 0,
      kind: 'kill',
    });
  }

  shakeSpecial(intensity: number, duration: number): void {
    const activeSpecialShakes = this.shakes.reduce(
      (count, shake) => count + (shake.kind === 'special' ? 1 : 0),
      0,
    );
    if (
      this.shakes.length >= ScreenShake.MAX_CONCURRENT_SHAKES
      || activeSpecialShakes >= ScreenShake.MAX_CONCURRENT_SPECIAL_SHAKES
      || this.time - this.lastSpecialShakeTime < ScreenShake.SPECIAL_SHAKE_MIN_INTERVAL
    ) {
      this.suppressedSpecialShakes++;
      return;
    }

    this.lastSpecialShakeTime = this.time;
    this.acceptedSpecialShakes++;
    this.shakes.push({
      intensity: Math.min(intensity, ScreenShake.SPECIAL_SHAKE_MAX_INTENSITY),
      duration: Math.min(duration, ScreenShake.SPECIAL_SHAKE_MAX_DURATION),
      elapsed: 0,
      kind: 'special',
    });
  }

  update(dt: number): void {
    this.time += dt;
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

  getDebugState(): {
    activeCount: number;
    activeKillCount: number;
    activeSpecialCount: number;
    acceptedKillShakes: number;
    suppressedKillShakes: number;
    acceptedSpecialShakes: number;
    suppressedSpecialShakes: number;
    offsetLength: number;
  } {
    return {
      activeCount: this.shakes.length,
      activeKillCount: this.shakes.filter((shake) => shake.kind === 'kill').length,
      activeSpecialCount: this.shakes.filter((shake) => shake.kind === 'special').length,
      acceptedKillShakes: this.acceptedKillShakes,
      suppressedKillShakes: this.suppressedKillShakes,
      acceptedSpecialShakes: this.acceptedSpecialShakes,
      suppressedSpecialShakes: this.suppressedSpecialShakes,
      offsetLength: this.offset.length(),
    };
  }
}

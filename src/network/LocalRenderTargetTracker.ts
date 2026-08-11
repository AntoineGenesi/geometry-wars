import * as THREE from 'three';

export const DEFAULT_LOCAL_RENDER_EXTRAPOLATE_MS = 80;
export const DEFAULT_LOCAL_RENDER_STALE_FADE_MS = 120;

const FRAME_BEND_FULL_EXTRAPOLATE_DOT = 0.995;
const FRAME_BEND_NO_EXTRAPOLATE_DOT = 0.965;

export interface LocalRenderTargetTelemetry {
  valid: boolean;
  sampleCount: number;
  resetCount: number;
  serverSampleDelta: number;
  serverSampleIntervalMs: number;
  sampleAgeMs: number;
  extrapolatedMs: number;
  staleScale: number;
  frameBendScale: number;
  prevSampleValid: boolean;
}

/**
 * Smooths the local MP player's server-authoritative render target.
 *
 * Straight motion still extrapolates between server patches to avoid a 30 Hz
 * stair-step. High-curvature frame changes, such as the sphere-tunnel entrance
 * bevel, fade extrapolation out so the visible player and camera target do not
 * lead off the authoritative surface and snap back on the next patch.
 */
export class LocalRenderTargetTracker {
  private readonly prevServerPos = new THREE.Vector3();
  private readonly latestServerPos = new THREE.Vector3();
  private readonly velocity = new THREE.Vector3();
  private readonly prevNormal = new THREE.Vector3(0, 1, 0);
  private readonly latestNormal = new THREE.Vector3(0, 1, 0);

  private prevServerTimeMs = 0;
  private latestServerTimeMs = 0;
  private valid = false;
  private prevSampleValid = false;
  private sampleCount = 0;
  private resetCount = 0;
  private serverSampleDelta = 0;
  private serverSampleIntervalMs = 0;
  private sampleAgeMs = -1;
  private extrapolatedMs = 0;
  private staleScale = 1;
  private frameBendScale = 1;

  constructor(
    private readonly extrapolateMs = DEFAULT_LOCAL_RENDER_EXTRAPOLATE_MS,
    private readonly staleFadeMs = DEFAULT_LOCAL_RENDER_STALE_FADE_MS,
  ) {}

  clear(): void {
    this.valid = false;
    this.prevSampleValid = false;
    this.velocity.set(0, 0, 0);
    this.sampleAgeMs = -1;
    this.extrapolatedMs = 0;
    this.staleScale = 1;
    this.frameBendScale = 1;
  }

  resetTo(pos: THREE.Vector3, nowMs: number, normal?: THREE.Vector3, countReset = true): void {
    this.prevServerPos.copy(pos);
    this.latestServerPos.copy(pos);
    this.velocity.set(0, 0, 0);
    this.prevServerTimeMs = nowMs;
    this.latestServerTimeMs = nowMs;
    this.valid = true;
    this.prevSampleValid = true;
    this.serverSampleDelta = 0;
    this.serverSampleIntervalMs = 0;
    this.frameBendScale = 1;
    if (normal && normal.lengthSq() > 0.000001) {
      this.latestNormal.copy(normal).normalize();
      this.prevNormal.copy(this.latestNormal);
    }
    if (countReset) this.resetCount++;
  }

  sample(pos: THREE.Vector3, nowMs: number, normal?: THREE.Vector3): void {
    if (!this.valid) {
      this.resetTo(pos, nowMs, normal, false);
      this.sampleCount++;
      return;
    }

    this.prevServerPos.copy(this.latestServerPos);
    this.prevServerTimeMs = this.latestServerTimeMs;
    this.latestServerPos.copy(pos);
    this.latestServerTimeMs = nowMs;
    this.prevSampleValid = true;
    this.sampleCount++;

    if (normal && normal.lengthSq() > 0.000001) {
      this.prevNormal.copy(this.latestNormal);
      this.latestNormal.copy(normal).normalize();
      this.frameBendScale = LocalRenderTargetTracker.frameBendScaleForDot(
        this.prevNormal.dot(this.latestNormal),
      );
    } else {
      this.frameBendScale = 1;
    }

    this.serverSampleDelta = this.latestServerPos.distanceTo(this.prevServerPos);
    this.serverSampleIntervalMs = Math.max(1, this.latestServerTimeMs - this.prevServerTimeMs);
    this.velocity.copy(this.latestServerPos)
      .sub(this.prevServerPos)
      .multiplyScalar(1000 / this.serverSampleIntervalMs);
  }

  getTarget(nowMs: number, out: THREE.Vector3): boolean {
    if (!this.valid) return false;

    this.sampleAgeMs = Math.max(0, nowMs - this.latestServerTimeMs);
    const rawExtrapolatedMs = Math.min(this.sampleAgeMs, this.extrapolateMs);
    this.extrapolatedMs = rawExtrapolatedMs * this.frameBendScale;
    this.staleScale = this.sampleAgeMs <= this.extrapolateMs
      ? 1
      : Math.max(0, 1 - (this.sampleAgeMs - this.extrapolateMs) / this.staleFadeMs);

    out.copy(this.latestServerPos)
      .addScaledVector(this.velocity, (this.extrapolatedMs / 1000) * this.staleScale);
    return true;
  }

  getTelemetry(): LocalRenderTargetTelemetry {
    return {
      valid: this.valid,
      sampleCount: this.sampleCount,
      resetCount: this.resetCount,
      serverSampleDelta: this.serverSampleDelta,
      serverSampleIntervalMs: this.serverSampleIntervalMs,
      sampleAgeMs: this.sampleAgeMs,
      extrapolatedMs: this.extrapolatedMs,
      staleScale: this.staleScale,
      frameBendScale: this.frameBendScale,
      prevSampleValid: this.prevSampleValid,
    };
  }

  static frameBendScaleForDot(dot: number): number {
    if (!Number.isFinite(dot)) return 1;
    const clampedDot = Math.max(-1, Math.min(1, dot));
    if (clampedDot <= FRAME_BEND_NO_EXTRAPOLATE_DOT) return 0;
    if (clampedDot >= FRAME_BEND_FULL_EXTRAPOLATE_DOT) return 1;
    return (clampedDot - FRAME_BEND_NO_EXTRAPOLATE_DOT)
      / (FRAME_BEND_FULL_EXTRAPOLATE_DOT - FRAME_BEND_NO_EXTRAPOLATE_DOT);
  }
}

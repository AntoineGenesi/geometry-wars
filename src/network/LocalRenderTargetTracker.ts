import * as THREE from 'three';

export const DEFAULT_LOCAL_RENDER_EXTRAPOLATE_MS = 80;
export const DEFAULT_LOCAL_RENDER_STALE_FADE_MS = 120;

const FRAME_BEND_FULL_EXTRAPOLATE_DOT = 0.995;
const FRAME_BEND_NO_EXTRAPOLATE_DOT = 0.965;
const FRAME_CURVE_FULL_EXTRAPOLATE_PER_UNIT = 0.02;
const FRAME_CURVE_NO_EXTRAPOLATE_PER_UNIT = 0.145;
const CURVED_FRAME_LEAD_CAP_SCALE = 0.9;
const CURVED_FRAME_MAX_LEAD = 0.04;
const CURVED_FRAME_LEAD_CAP_HOLD_MS = 160;
const LOCAL_RENDER_LEAD_CAP_SAMPLE_DELTA = 0.3;

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
  frameCurveScale: number;
  prevSampleValid: boolean;
}

/**
 * Smooths the local MP player's server-authoritative render target.
 *
 * Straight motion still extrapolates between server patches to avoid a 30 Hz
 * stair-step. High-curvature frame changes, such as the sphere-tunnel entrance
 * bevel, fade extrapolation out so the visible player and camera target do not
 * lead off the authoritative surface and snap back on the next patch. Sustained
 * odd-surface curvature is also damped by comparing normal rotation per unit of
 * server movement. Normal player-sized server steps are capped to a small
 * world-space lead so close zoom keeps the local player centered instead of
 * putting the camera ahead of the latest authoritative frame.
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
  private frameCurveScale = 1;
  private curvedFrameLeadCapUntilMs = 0;

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
    this.frameCurveScale = 1;
    this.curvedFrameLeadCapUntilMs = 0;
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
    this.frameCurveScale = 1;
    this.curvedFrameLeadCapUntilMs = 0;
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

    this.serverSampleDelta = this.latestServerPos.distanceTo(this.prevServerPos);
    this.serverSampleIntervalMs = Math.max(1, this.latestServerTimeMs - this.prevServerTimeMs);

    if (normal && normal.lengthSq() > 0.000001) {
      this.prevNormal.copy(this.latestNormal);
      this.latestNormal.copy(normal).normalize();
      const normalDot = this.prevNormal.dot(this.latestNormal);
      this.frameBendScale = LocalRenderTargetTracker.frameBendScaleForDot(normalDot);
      this.frameCurveScale = LocalRenderTargetTracker.frameCurveScaleForNormalDelta(
        normalDot,
        this.serverSampleDelta,
      );
      if (Math.min(this.frameBendScale, this.frameCurveScale) < CURVED_FRAME_LEAD_CAP_SCALE) {
        this.curvedFrameLeadCapUntilMs = this.latestServerTimeMs + CURVED_FRAME_LEAD_CAP_HOLD_MS;
      }
    } else {
      this.frameBendScale = 1;
      this.frameCurveScale = 1;
    }

    this.velocity.copy(this.latestServerPos)
      .sub(this.prevServerPos)
      .multiplyScalar(1000 / this.serverSampleIntervalMs);
  }

  getTarget(nowMs: number, out: THREE.Vector3): boolean {
    if (!this.valid) return false;

    this.sampleAgeMs = Math.max(0, nowMs - this.latestServerTimeMs);
    const rawExtrapolatedMs = Math.min(this.sampleAgeMs, this.extrapolateMs);
    const frameScale = Math.min(this.frameBendScale, this.frameCurveScale);
    let extrapolatedSeconds = (rawExtrapolatedMs / 1000) * frameScale;
    this.staleScale = this.sampleAgeMs <= this.extrapolateMs
      ? 1
      : Math.max(0, 1 - (this.sampleAgeMs - this.extrapolateMs) / this.staleFadeMs);
    extrapolatedSeconds *= this.staleScale;

    const capPlayerSizedLead = this.serverSampleDelta > 0
      && this.serverSampleDelta <= LOCAL_RENDER_LEAD_CAP_SAMPLE_DELTA;
    if (
      capPlayerSizedLead
      || frameScale < CURVED_FRAME_LEAD_CAP_SCALE
      || nowMs <= this.curvedFrameLeadCapUntilMs
    ) {
      const speed = this.velocity.length();
      if (speed > 0.000001) {
        extrapolatedSeconds = Math.min(extrapolatedSeconds, CURVED_FRAME_MAX_LEAD / speed);
      }
    }
    this.extrapolatedMs = extrapolatedSeconds * 1000;

    out.copy(this.latestServerPos)
      .addScaledVector(this.velocity, extrapolatedSeconds);
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
      frameCurveScale: this.frameCurveScale,
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

  static frameCurveScaleForNormalDelta(dot: number, sampleDelta: number): number {
    if (!Number.isFinite(dot) || !Number.isFinite(sampleDelta) || sampleDelta <= 0.000001) {
      return 1;
    }
    const clampedDot = Math.max(-1, Math.min(1, dot));
    const normalAngle = Math.acos(clampedDot);
    const normalAnglePerUnit = normalAngle / sampleDelta;
    if (normalAnglePerUnit <= FRAME_CURVE_FULL_EXTRAPOLATE_PER_UNIT) return 1;
    if (normalAnglePerUnit >= FRAME_CURVE_NO_EXTRAPOLATE_PER_UNIT) return 0;
    return 1 - (
      (normalAnglePerUnit - FRAME_CURVE_FULL_EXTRAPOLATE_PER_UNIT)
      / (FRAME_CURVE_NO_EXTRAPOLATE_PER_UNIT - FRAME_CURVE_FULL_EXTRAPOLATE_PER_UNIT)
    );
  }
}

import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { LocalRenderTargetTracker } from './LocalRenderTargetTracker';

describe('LocalRenderTargetTracker', () => {
  it('keeps straight MP render extrapolation between server samples', () => {
    const tracker = new LocalRenderTargetTracker(80, 120);
    const out = new THREE.Vector3();
    const normal = new THREE.Vector3(0, 1, 0);

    tracker.sample(new THREE.Vector3(0, 0, 0), 0, normal);
    tracker.sample(new THREE.Vector3(1, 0, 0), 33, normal);

    expect(tracker.getTarget(66, out)).toBe(true);
    expect(out.x).toBeCloseTo(2, 5);
    expect(out.y).toBeCloseTo(0, 5);
    expect(out.z).toBeCloseTo(0, 5);
    expect(tracker.getTelemetry().frameBendScale).toBe(1);
  });

  it('reduces local player/camera target extrapolation across sharp frame bends', () => {
    const tracker = new LocalRenderTargetTracker(80, 120);
    const out = new THREE.Vector3();
    const straightNormal = new THREE.Vector3(0, 1, 0);
    const bentNormal = new THREE.Vector3(0, Math.cos(THREE.MathUtils.degToRad(20)), Math.sin(THREE.MathUtils.degToRad(20)));

    tracker.sample(new THREE.Vector3(0, 0, 0), 0, straightNormal);
    tracker.sample(new THREE.Vector3(1, 0, 0), 33, bentNormal);

    expect(tracker.getTarget(66, out)).toBe(true);
    expect(out.x).toBeCloseTo(1, 5);
    expect(out.y).toBeCloseTo(0, 5);
    expect(out.z).toBeCloseTo(0, 5);
    expect(tracker.getTelemetry().frameBendScale).toBe(0);
  });

  it('fades extrapolation proportionally for moderate bends instead of snapping globally', () => {
    const tracker = new LocalRenderTargetTracker(80, 120);
    const out = new THREE.Vector3();
    const straightNormal = new THREE.Vector3(0, 1, 0);
    const moderateNormal = new THREE.Vector3(0, Math.cos(THREE.MathUtils.degToRad(8)), Math.sin(THREE.MathUtils.degToRad(8)));

    tracker.sample(new THREE.Vector3(0, 0, 0), 0, straightNormal);
    tracker.sample(new THREE.Vector3(1, 0, 0), 33, moderateNormal);

    expect(tracker.getTarget(66, out)).toBe(true);
    expect(out.x).toBeGreaterThan(1);
    expect(out.x).toBeLessThan(2);
    expect(tracker.getTelemetry().frameBendScale).toBeGreaterThan(0);
    expect(tracker.getTelemetry().frameBendScale).toBeLessThan(1);
  });
});

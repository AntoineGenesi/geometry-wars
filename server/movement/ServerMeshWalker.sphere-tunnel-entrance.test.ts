import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { ServerSurfaceManager } from './ServerSurfaceManager';
import type { ServerMeshLocation } from './ServerMeshLocation';
import { LocalRenderTargetTracker } from '../../src/network/LocalRenderTargetTracker';

const PLAYER_ID = 'local-player';
const SERVER_DT = 1 / 20;
const LOCAL_PLAYER_RENDER_OFFSET = 0.15;
const RENDER_EXTRAPOLATE_MS = 80;

function locationPosition(location: ServerMeshLocation): THREE.Vector3 {
  return new THREE.Vector3(location.wx, location.wy, location.wz);
}

function locationNormal(location: ServerMeshLocation): THREE.Vector3 {
  return new THREE.Vector3(location.nx, location.ny, location.nz).normalize();
}

function getOldExtrapolatedTarget(
  latestSample: THREE.Vector3,
  previousSample: THREE.Vector3,
  sampleIntervalMs: number,
): THREE.Vector3 {
  const velocity = latestSample.clone()
    .sub(previousSample)
    .multiplyScalar(1000 / Math.max(1, sampleIntervalMs));
  return latestSample.clone().addScaledVector(velocity, RENDER_EXTRAPOLATE_MS / 1000);
}

describe('ServerMeshWalker sphere-tunnel entrance render classification', () => {
  it('keeps the authoritative MP walker continuous while damping render extrapolation on entrance bends', () => {
    const manager = new ServerSurfaceManager();
    manager.initSurface('sphere-tunnel', 1);
    const walker = manager.createWalker(PLAYER_ID, 0, 0.56);
    expect(walker).not.toBeNull();

    const tracker = new LocalRenderTargetTracker(80, 120);
    const renderTarget = new THREE.Vector3();
    const serverPos = new THREE.Vector3();
    const serverNormal = new THREE.Vector3();
    let previousServerPos: THREE.Vector3 | null = null;
    let previousRenderSample: THREE.Vector3 | null = null;
    let previousOldTarget: THREE.Vector3 | null = null;
    let previousNewTarget: THREE.Vector3 | null = null;
    let previousSampleMs = 0;
    let maxServerStep = 0;
    let maxRenderLead = 0;
    let maxDampedOldRenderLead = 0;
    let maxDampedNewRenderLead = 0;
    let maxDampedOldTargetDelta = 0;
    let maxDampedNewTargetDelta = 0;
    let maxOldVsNewTargetDelta = 0;
    let minFrameBendScale = 1;
    let dampedEntranceSamples = 0;
    let tunnelSamples = 0;

    for (let i = 0; i < 80; i++) {
      walker!.moveInWorldDirection(-1, -0.4, 0, SERVER_DT);

      const location = walker!.getLocation();
      serverPos.copy(locationPosition(location));
      serverNormal.copy(locationNormal(location));
      const xzRadius = Math.hypot(serverPos.x, serverPos.z);
      if (xzRadius <= 3.6 && serverPos.y > 0) tunnelSamples++;

      if (previousServerPos) {
        maxServerStep = Math.max(maxServerStep, serverPos.distanceTo(previousServerPos));
      }
      previousServerPos = serverPos.clone();

      const renderSample = serverPos.clone().addScaledVector(serverNormal, LOCAL_PLAYER_RENDER_OFFSET);
      const sampleMs = i * SERVER_DT * 1000;
      tracker.sample(renderSample, sampleMs, serverNormal);
      tracker.getTarget(sampleMs + 80, renderTarget);

      const telemetry = tracker.getTelemetry();
      minFrameBendScale = Math.min(minFrameBendScale, telemetry.frameBendScale);
      maxRenderLead = Math.max(maxRenderLead, renderTarget.distanceTo(renderSample));

      if (previousRenderSample) {
        const oldTarget = getOldExtrapolatedTarget(
          renderSample,
          previousRenderSample,
          sampleMs - previousSampleMs,
        );
        if (telemetry.frameBendScale < 0.999) {
          dampedEntranceSamples++;
          const oldLead = oldTarget.distanceTo(renderSample);
          const newLead = renderTarget.distanceTo(renderSample);
          maxDampedOldRenderLead = Math.max(maxDampedOldRenderLead, oldLead);
          maxDampedNewRenderLead = Math.max(maxDampedNewRenderLead, newLead);
          maxOldVsNewTargetDelta = Math.max(
            maxOldVsNewTargetDelta,
            oldTarget.distanceTo(renderTarget),
          );

          if (previousOldTarget && previousNewTarget) {
            maxDampedOldTargetDelta = Math.max(
              maxDampedOldTargetDelta,
              oldTarget.distanceTo(previousOldTarget),
            );
            maxDampedNewTargetDelta = Math.max(
              maxDampedNewTargetDelta,
              renderTarget.distanceTo(previousNewTarget),
            );
          }
        }
        previousOldTarget = oldTarget;
      }

      previousRenderSample = renderSample.clone();
      previousNewTarget = renderTarget.clone();
      previousSampleMs = sampleMs;
    }

    expect(tunnelSamples).toBeGreaterThan(0);
    expect(maxServerStep).toBeLessThan(0.25);
    expect(minFrameBendScale).toBeLessThan(1);
    expect(maxRenderLead).toBeLessThan(0.3);
    expect(dampedEntranceSamples).toBeGreaterThan(10);
    expect(maxDampedOldRenderLead).toBeGreaterThan(0.27);
    expect(maxDampedNewRenderLead).toBeLessThan(0.26);
    expect(maxOldVsNewTargetDelta).toBeGreaterThan(0.025);
    expect(maxDampedOldTargetDelta).toBeGreaterThan(0.19);
    expect(maxDampedNewTargetDelta).toBeLessThan(0.18);
  });
});

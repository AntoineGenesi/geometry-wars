import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  CameraController,
  DEFAULT_CAMERA_FOLLOW_LERP_FACTOR,
  MOBILE_CAMERA_FOLLOW_LERP_FACTOR,
} from './CameraController';

const _noopEvent = (_e: string, _h: any, _opts?: any) => {};

if (typeof globalThis.document === 'undefined') {
  (globalThis as any).document = {
    addEventListener: _noopEvent,
    removeEventListener: _noopEvent,
  };
}

const frame = {
  position: new THREE.Vector3(0, 0, 0),
  normal: new THREE.Vector3(0, 1, 0),
  tangentFrame: {
    tangent: new THREE.Vector3(1, 0, 0),
    bitangent: new THREE.Vector3(0, 0, 1),
  },
};

function createController(distance: number): {
  camera: THREE.PerspectiveCamera;
  controller: CameraController;
} {
  const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 200);
  camera.position.set(0, 0, 0);
  camera.up.set(0, 1, 0);

  const controller = new CameraController(camera);
  controller.setCameraDistance(distance);

  return { camera, controller };
}

function stepFromNeutral(controller: CameraController): void {
  controller.updateFromFrame(
    frame.position,
    frame.normal,
    frame.tangentFrame,
    1 / 60,
  );
}

describe('CameraController mobile follow smoothing', () => {
  it('keeps the desktop/default follow factor at 0.12', () => {
    const { camera, controller } = createController(15);

    expect(controller.getFollowLerpFactor()).toBe(DEFAULT_CAMERA_FOLLOW_LERP_FACTOR);

    stepFromNeutral(controller);

    expect(camera.position.y).toBeCloseTo(15 * DEFAULT_CAMERA_FOLLOW_LERP_FACTOR, 6);
  });

  it('allows mobile to use a tighter follow factor without changing distance semantics', () => {
    const desktop = createController(6);
    const mobile = createController(6);
    mobile.controller.setFollowLerpFactor(MOBILE_CAMERA_FOLLOW_LERP_FACTOR);

    stepFromNeutral(desktop.controller);
    stepFromNeutral(mobile.controller);

    expect(desktop.controller.getFollowLerpFactor()).toBe(DEFAULT_CAMERA_FOLLOW_LERP_FACTOR);
    expect(mobile.controller.getFollowLerpFactor()).toBe(MOBILE_CAMERA_FOLLOW_LERP_FACTOR);
    expect(desktop.camera.position.y).toBeCloseTo(6 * DEFAULT_CAMERA_FOLLOW_LERP_FACTOR, 6);
    expect(mobile.camera.position.y).toBeCloseTo(6 * MOBILE_CAMERA_FOLLOW_LERP_FACTOR, 6);
    expect(mobile.camera.position.y).toBeGreaterThan(desktop.camera.position.y);
  });

  it('opts in only from the real SP and MP mobile bootstrap branches', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const srcRoot = resolve(here, '..');
    const mainSource = readFileSync(resolve(srcRoot, 'main.ts'), 'utf8');
    const networkSource = readFileSync(resolve(srcRoot, 'network-main.ts'), 'utf8');
    const mobileBranchOptIn =
      /if \(mobile\) \{\s*cameraController\.setCameraDistance\(5\);\s*cameraController\.setFollowLerpFactor\(MOBILE_CAMERA_FOLLOW_LERP_FACTOR\);\s*\}/;

    expect(mainSource).toMatch(mobileBranchOptIn);
    expect(networkSource).toMatch(mobileBranchOptIn);
  });
});

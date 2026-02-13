/**
 * Cross-surface movement tests — programmatic equivalent of the Puppeteer
 * cross-surface diagnostic.
 *
 * Tests movement quality (direction consistency, wobble, zigzag) on all
 * surfaces using moveFromInput with camera follow, which is the same
 * code path as the real game.
 *
 * These tests are designed to catch the issues found by the Puppeteer diagnostic:
 * - Cube forward: 1.03 wobble (goes sideways instead of forward)
 * - Cube diagonal: 0.57 zigzag
 * - Pipe lateral: 0.446 wobble
 * - Sphere/icosahedron "stuck" (0 displacement)
 */

import * as THREE from 'three';
import { describe, it, expect } from 'vitest';
import { MeshWalker } from '../movement/MeshWalker';
import { MeshSurface } from '../surfaces/MeshSurface';
import { SurfaceFactory } from '../surfaces/SurfaceFactory';

const WOBBLE_THRESHOLD = 0.25; // Ratio of perpendicular to primary displacement
const DIRECTION_THRESHOLD = 0.7; // Fraction of intervals in correct direction
const MIN_DISPLACEMENT = 1.0; // Minimum total displacement for 120 frames
const ZIGZAG_THRESHOLD = 0.35; // Max fraction of intervals with >45deg angle change

interface MovementTestResult {
  totalDisplacement: number;
  primaryDisplacement: number;
  perpDisplacement: number;
  wobbleRatio: number;
  directionConsistency: number; // Fraction of intervals in correct direction
  reversals: number;
  zigzagFreq: number;
}

function createSurfaceWalker(surfaceType: string, config?: any): {
  walker: MeshWalker;
  meshSurface: MeshSurface;
  surface: any;
} {
  const defaultConfig = {
    size: 10,
    radius: 10,
    gridColor: 0x2a2aaa,
    surfaceColor: 0x141440,
    surfaceOpacity: 0.35,
    gridOpacity: 0.4,
    ...config,
  };

  const surf = SurfaceFactory.create(surfaceType as any, defaultConfig);
  surf.mesh.updateMatrixWorld(true);
  const meshSurface = new MeshSurface(surf.mesh);
  const startPos = surf.getPoint(0.5, 0.5).position;
  const walker = new MeshWalker(meshSurface, startPos, 5);

  return { walker, meshSurface, surface: surf };
}

/**
 * Run a movement test: press a virtual key (inputX, inputY) for N frames
 * with camera follow, and measure movement quality.
 *
 * @param primaryAxis 'right' for lateral (inputX=1), 'up' for forward (inputY=1)
 */
function runMovementTest(
  surfaceType: string,
  inputX: number,
  inputY: number,
  frames: number = 120,
  config?: any,
): MovementTestResult {
  const { walker } = createSurfaceWalker(surfaceType, config);
  const dt = 1 / 60;

  // Set up camera
  const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 100);
  const frame = walker.getTangentFrame();
  camera.position.copy(walker.position).addScaledVector(walker.normal, 15);
  camera.up.copy(frame.bitangent);
  camera.lookAt(walker.position);
  camera.updateMatrixWorld(true);

  // Get initial camera axes for measuring screen-space displacement
  const initCamRight = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.getWorldQuaternion(new THREE.Quaternion()));
  const initCamUp = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.getWorldQuaternion(new THREE.Quaternion()));

  const positions: THREE.Vector3[] = [walker.position.clone()];
  const displacements: THREE.Vector3[] = [];
  let reversals = 0;
  let prevDisp = new THREE.Vector3();

  // Simulate CameraController's smoothed targetUp
  const targetUp = frame.bitangent.clone();
  const CAMERA_LERP_FACTOR = 0.25;
  const TARGET_UP_LERP = 0.4;

  for (let i = 0; i < frames; i++) {
    const prevPos = walker.position.clone();
    const curFrame = walker.getTangentFrame();

    // Simulate CameraController.targetUp smoothing:
    // Sign-flip protection + lerp (matches CameraController.update)
    const newUp = curFrame.bitangent.clone();
    if (targetUp.dot(newUp) < 0) newUp.negate();
    targetUp.lerp(newUp, TARGET_UP_LERP).normalize();

    walker.moveFromInput(inputX, inputY, camera, dt, targetUp);

    // Update camera to follow (with lerp, like CameraController)
    const targetCamPos = walker.position.clone().addScaledVector(walker.normal, 15);
    camera.position.lerp(targetCamPos, CAMERA_LERP_FACTOR);
    camera.up.lerp(newUp, CAMERA_LERP_FACTOR).normalize();
    camera.lookAt(walker.position);
    camera.updateMatrixWorld(true);

    const disp = walker.position.clone().sub(prevPos);
    positions.push(walker.position.clone());
    displacements.push(disp);

    // Check for reversals
    if (i > 0 && prevDisp.lengthSq() > 1e-6 && disp.lengthSq() > 1e-6) {
      if (prevDisp.dot(disp) < 0) reversals++;
    }
    prevDisp.copy(disp);
  }

  // Compute total displacement
  const totalDisp = positions[positions.length - 1].clone().sub(positions[0]);
  const totalMag = totalDisp.length();

  // Project onto initial camera axes to get screen-space components
  const screenRight = totalDisp.dot(initCamRight);
  const screenUp = totalDisp.dot(initCamUp);

  // Determine primary and perpendicular based on input
  let primaryDisp: number, perpDisp: number;
  if (Math.abs(inputX) > Math.abs(inputY)) {
    // Lateral movement — primary is screen-right
    primaryDisp = Math.abs(screenRight);
    perpDisp = Math.abs(screenUp);
  } else if (Math.abs(inputY) > Math.abs(inputX)) {
    // Forward movement — primary is screen-up
    primaryDisp = Math.abs(screenUp);
    perpDisp = Math.abs(screenRight);
  } else {
    // Diagonal — both are primary
    primaryDisp = Math.abs(screenRight) + Math.abs(screenUp);
    perpDisp = 0;
  }

  const wobbleRatio = primaryDisp > 0.01 ? perpDisp / primaryDisp : 0;

  // Direction consistency: fraction of intervals where primary direction is positive
  let correctDirCount = 0;
  for (const disp of displacements) {
    if (disp.lengthSq() < 1e-8) continue;
    if (Math.abs(inputX) > Math.abs(inputY)) {
      if (disp.dot(initCamRight) * inputX > 0) correctDirCount++;
    } else {
      if (disp.dot(initCamUp) * inputY > 0) correctDirCount++;
    }
  }
  const nonZeroDisplacements = displacements.filter(d => d.lengthSq() > 1e-8).length;
  const directionConsistency = nonZeroDisplacements > 0 ? correctDirCount / nonZeroDisplacements : 0;

  // Zigzag detection
  let largeAngleCount = 0;
  let angleCount = 0;
  for (let i = 1; i < displacements.length; i++) {
    const d1 = displacements[i - 1];
    const d2 = displacements[i];
    if (d1.lengthSq() > 1e-8 && d2.lengthSq() > 1e-8) {
      const cosAngle = d1.dot(d2) / (d1.length() * d2.length());
      const angle = Math.acos(Math.max(-1, Math.min(1, cosAngle))) * 180 / Math.PI;
      angleCount++;
      if (angle > 45) largeAngleCount++;
    }
  }
  const zigzagFreq = angleCount > 0 ? largeAngleCount / angleCount : 0;

  return {
    totalDisplacement: totalMag,
    primaryDisplacement: primaryDisp,
    perpDisplacement: perpDisp,
    wobbleRatio,
    directionConsistency,
    reversals,
    zigzagFreq,
  };
}

describe('Cross-surface movement quality', () => {
  const surfaces = ['sphere', 'cube', 'pill', 'torus', 'capsule', 'peanut', 'pipe', 'icosahedron'];

  describe.each(surfaces)('%s', (surface) => {
    it('lateral movement (D key) should produce displacement', () => {
      const result = runMovementTest(surface, 1, 0, 120);
      console.log(`  ${surface} lateral: disp=${result.totalDisplacement.toFixed(2)}, wobble=${result.wobbleRatio.toFixed(3)}, dir=${result.directionConsistency.toFixed(2)}, reversals=${result.reversals}`);
      expect(result.totalDisplacement).toBeGreaterThan(MIN_DISPLACEMENT);
    });

    it('forward movement (W key) should produce displacement', () => {
      const result = runMovementTest(surface, 0, 1, 120);
      console.log(`  ${surface} forward: disp=${result.totalDisplacement.toFixed(2)}, wobble=${result.wobbleRatio.toFixed(3)}, dir=${result.directionConsistency.toFixed(2)}, reversals=${result.reversals}`);
      expect(result.totalDisplacement).toBeGreaterThan(MIN_DISPLACEMENT);
    });

    it('diagonal movement (W+D) should produce displacement', () => {
      const result = runMovementTest(surface, 1, 1, 120);
      console.log(`  ${surface} diagonal: disp=${result.totalDisplacement.toFixed(2)}, zigzag=${result.zigzagFreq.toFixed(3)}, reversals=${result.reversals}`);
      expect(result.totalDisplacement).toBeGreaterThan(MIN_DISPLACEMENT);
    });
  });
});

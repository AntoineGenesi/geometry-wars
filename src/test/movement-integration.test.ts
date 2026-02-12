/**
 * Integration test for player movement.
 *
 * Simulates the FULL game loop (keyboard → GameLoop → MeshWalker → CameraController)
 * and verifies that WASD keys produce the correct movement direction relative to
 * the camera's screen-space axes.
 *
 * Previous unit tests only called moveFromInput() directly — they missed
 * integration bugs between the keyboard input pipeline, camera following,
 * and the camera-relative axis projection.
 */

import * as THREE from 'three';
import { describe, it, expect } from 'vitest';
import { MeshWalker } from '../movement/MeshWalker';
import { MeshSurface } from '../surfaces/MeshSurface';
import { SurfaceFactory } from '../surfaces/SurfaceFactory';

// --- Helpers ---

/** Create a MeshWalker on a surface at UV (0.5, 0.5) */
function createWalkerOnSurface(
  surfaceType: string = 'sphere',
  speed = 3,
): {
  walker: MeshWalker;
  surface: MeshSurface;
} {
  const surf = SurfaceFactory.create(surfaceType as any);
  surf.mesh.updateMatrixWorld(true);
  const meshSurface = new MeshSurface(surf.mesh);
  const startPos = surf.getPoint(0.5, 0.5).position;
  const walker = new MeshWalker(meshSurface, startPos, speed);
  return { walker, surface: meshSurface };
}

/** Simulate CameraController.update — same logic as CameraController.ts */
function updateCamera(
  camera: THREE.PerspectiveCamera,
  walker: MeshWalker,
  lerpFactor = 0.12,
  distance = 15,
): void {
  const frame = walker.getTangentFrame();
  const offset = walker.normal.clone().multiplyScalar(distance);
  const targetPos = walker.position.clone().add(offset);
  const camUp = frame.bitangent.clone();

  camera.position.lerp(targetPos, lerpFactor);
  camera.lookAt(walker.position);
  camera.up.lerp(camUp, lerpFactor).normalize();
}

/**
 * Extract the camera's screen-space right and up vectors in world space.
 * These represent what the user sees as "right" and "up" on screen.
 */
function getCameraScreenAxes(camera: THREE.PerspectiveCamera): {
  screenRight: THREE.Vector3;
  screenUp: THREE.Vector3;
} {
  camera.updateMatrixWorld(true);
  const screenRight = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
  const screenUp = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
  return { screenRight, screenUp };
}

/** Simulate one game loop frame with the given input */
function gameLoopFrame(
  walker: MeshWalker,
  camera: THREE.PerspectiveCamera,
  moveX: number,
  moveY: number,
  dt: number,
): void {
  // Same as GameLoop.ts line 128-129
  if (Math.abs(moveX) > 0.01 || Math.abs(moveY) > 0.01) {
    walker.moveFromInput(moveX, -moveY, camera, dt);
  }
  // Same as GameLoop.ts line 144
  updateCamera(camera, walker);
}

/**
 * Run the full simulation: warmup camera, then press a key,
 * and return the world-space displacement and its screen-space projections.
 */
function simulateKeyPress(
  moveX: number,
  moveY: number,
  surfaceType = 'sphere',
  warmupFrames = 120,
  pressFrames = 30,
  dt = 1 / 60,
): {
  /** Dot product of world displacement with screen-right axis */
  screenRightComponent: number;
  /** Dot product of world displacement with screen-up axis */
  screenUpComponent: number;
  /** Raw world-space displacement */
  worldDisplacement: THREE.Vector3;
  /** The camera's screen-right axis at time of measurement */
  screenRight: THREE.Vector3;
  /** The camera's screen-up axis at time of measurement */
  screenUp: THREE.Vector3;
} {
  const { walker } = createWalkerOnSurface(surfaceType);

  // Start camera at Game.ts default position
  const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 1000);
  camera.position.set(0, 15, 25);
  camera.lookAt(0, 0, 0);

  // Warmup: converge camera to correct position (no movement input)
  for (let i = 0; i < warmupFrames; i++) {
    gameLoopFrame(walker, camera, 0, 0, dt);
  }

  // Record initial state
  const startWorldPos = walker.position.clone();
  const { screenRight, screenUp } = getCameraScreenAxes(camera);

  // Press key for several frames
  for (let i = 0; i < pressFrames; i++) {
    gameLoopFrame(walker, camera, moveX, moveY, dt);
  }

  // Compute displacement
  const worldDisplacement = walker.position.clone().sub(startWorldPos);

  // Project onto screen axes (ignore normal component)
  const screenRightComponent = worldDisplacement.dot(screenRight);
  const screenUpComponent = worldDisplacement.dot(screenUp);

  return {
    screenRightComponent,
    screenUpComponent,
    worldDisplacement,
    screenRight,
    screenUp,
  };
}

// --- Tests ---

describe('Movement Integration — Full Game Loop Simulation', () => {
  describe('WASD screen-space direction (camera converged)', () => {
    it('D key (moveX=+1) should move player RIGHT on screen', () => {
      const result = simulateKeyPress(1, 0);

      // World displacement should have positive component along screen-right
      expect(result.screenRightComponent).toBeGreaterThan(0.1);
      // Lateral component should dominate vertical
      expect(Math.abs(result.screenRightComponent)).toBeGreaterThan(
        Math.abs(result.screenUpComponent) * 0.5,
      );
    });

    it('A key (moveX=-1) should move player LEFT on screen', () => {
      const result = simulateKeyPress(-1, 0);

      // World displacement should have negative component along screen-right
      expect(result.screenRightComponent).toBeLessThan(-0.1);
    });

    it('W key (moveY=-1) should move player UP on screen', () => {
      // InputManager: W → moveY=-1 → GameLoop passes -(-1)=+1 to moveFromInput
      const result = simulateKeyPress(0, -1);

      // World displacement should have positive component along screen-up
      expect(result.screenUpComponent).toBeGreaterThan(0.1);
      // Vertical component should dominate lateral
      expect(Math.abs(result.screenUpComponent)).toBeGreaterThan(
        Math.abs(result.screenRightComponent) * 0.5,
      );
    });

    it('S key (moveY=+1) should move player DOWN on screen', () => {
      // InputManager: S → moveY=+1 → GameLoop passes -(+1)=-1 to moveFromInput
      const result = simulateKeyPress(0, 1);

      // World displacement should have negative component along screen-up
      expect(result.screenUpComponent).toBeLessThan(-0.1);
    });
  });

  describe('Direction symmetry', () => {
    it('D and A should produce symmetric screen displacements', () => {
      const dResult = simulateKeyPress(1, 0);
      const aResult = simulateKeyPress(-1, 0);

      // D moves right (+), A moves left (-) — magnitudes should be similar
      const dMag = Math.abs(dResult.screenRightComponent);
      const aMag = Math.abs(aResult.screenRightComponent);
      const asymmetry = Math.abs(dMag - aMag) / Math.max(dMag, aMag);
      expect(asymmetry).toBeLessThan(0.3); // Less than 30% asymmetry
    });

    it('W and S should produce symmetric screen displacements', () => {
      const wResult = simulateKeyPress(0, -1);
      const sResult = simulateKeyPress(0, 1);

      const wMag = Math.abs(wResult.screenUpComponent);
      const sMag = Math.abs(sResult.screenUpComponent);
      const asymmetry = Math.abs(wMag - sMag) / Math.max(wMag, sMag);
      expect(asymmetry).toBeLessThan(0.3);
    });
  });

  describe('D and W produce perpendicular movement', () => {
    it('D (right) and W (up) world displacements should be roughly perpendicular', () => {
      const dResult = simulateKeyPress(1, 0);
      const wResult = simulateKeyPress(0, -1);

      const dDir = dResult.worldDisplacement.clone().normalize();
      const wDir = wResult.worldDisplacement.clone().normalize();
      const dot = dDir.dot(wDir);

      // Should be close to 0 (perpendicular), allowing curvature effects
      expect(Math.abs(dot)).toBeLessThan(0.3);
    });
  });

  describe('Continuous movement stability (jitter check)', () => {
    it('W key should produce consistent forward movement over 60 frames', () => {
      const { walker } = createWalkerOnSurface();
      const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 1000);
      camera.position.set(0, 15, 25);
      camera.lookAt(0, 0, 0);
      const dt = 1 / 60;

      // Warmup
      for (let i = 0; i < 120; i++) {
        gameLoopFrame(walker, camera, 0, 0, dt);
      }

      // Track per-frame displacements projected onto screen-up
      const upComponents: number[] = [];

      for (let i = 0; i < 60; i++) {
        const { screenUp } = getCameraScreenAxes(camera);
        const before = walker.position.clone();

        // W: moveX=0, moveY=-1
        gameLoopFrame(walker, camera, 0, -1, dt);

        const displacement = walker.position.clone().sub(before);
        upComponents.push(displacement.dot(screenUp));
      }

      // All frames should have positive screen-up component (moving forward/up)
      const positiveFrames = upComponents.filter((c) => c > 0).length;
      expect(positiveFrames).toBeGreaterThan(50); // At least 83%

      // Check for jitter: sign flips indicate oscillation
      let signFlips = 0;
      for (let i = 1; i < upComponents.length; i++) {
        if (Math.sign(upComponents[i]) !== Math.sign(upComponents[i - 1])) {
          signFlips++;
        }
      }
      expect(signFlips).toBeLessThan(10); // Less than 17% sign flips
    });

    it('D key should produce consistent rightward movement over 60 frames', () => {
      const { walker } = createWalkerOnSurface();
      const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 1000);
      camera.position.set(0, 15, 25);
      camera.lookAt(0, 0, 0);
      const dt = 1 / 60;

      // Warmup
      for (let i = 0; i < 120; i++) {
        gameLoopFrame(walker, camera, 0, 0, dt);
      }

      const rightComponents: number[] = [];

      for (let i = 0; i < 60; i++) {
        const { screenRight } = getCameraScreenAxes(camera);
        const before = walker.position.clone();

        // D: moveX=+1, moveY=0
        gameLoopFrame(walker, camera, 1, 0, dt);

        const displacement = walker.position.clone().sub(before);
        rightComponents.push(displacement.dot(screenRight));
      }

      const positiveFrames = rightComponents.filter((c) => c > 0).length;
      expect(positiveFrames).toBeGreaterThan(50);

      let signFlips = 0;
      for (let i = 1; i < rightComponents.length; i++) {
        if (
          Math.sign(rightComponents[i]) !== Math.sign(rightComponents[i - 1])
        ) {
          signFlips++;
        }
      }
      expect(signFlips).toBeLessThan(10);
    });
  });

  describe('Camera convergence period', () => {
    it('D key should produce rightward movement even during camera convergence', () => {
      const { walker } = createWalkerOnSurface();
      const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 1000);
      camera.position.set(0, 15, 25);
      camera.lookAt(0, 0, 0);
      const dt = 1 / 60;

      // NO warmup — start immediately with D pressed
      const rightComponents: number[] = [];

      for (let i = 0; i < 120; i++) {
        const { screenRight } = getCameraScreenAxes(camera);
        const before = walker.position.clone();
        gameLoopFrame(walker, camera, 1, 0, dt);
        const displacement = walker.position.clone().sub(before);
        rightComponents.push(displacement.dot(screenRight));
      }

      // After frame 60 (1 second), movement should be consistently rightward
      const lateFrames = rightComponents.slice(60);
      const rightwardFrames = lateFrames.filter((c) => c > 0).length;
      expect(rightwardFrames).toBeGreaterThan(40); // At least 67%
    });
  });

  describe('Multiple surfaces', () => {
    const surfaceTypes = ['sphere', 'torus', 'capsule'] as const;

    for (const surfaceType of surfaceTypes) {
      it(`D key should move RIGHT on ${surfaceType}`, () => {
        const result = simulateKeyPress(1, 0, surfaceType);
        expect(result.screenRightComponent).toBeGreaterThan(0.05);
      });

      it(`W key should move UP on ${surfaceType}`, () => {
        const result = simulateKeyPress(0, -1, surfaceType);
        expect(result.screenUpComponent).toBeGreaterThan(0.05);
      });
    }
  });

  describe('Aim direction matches movement direction', () => {
    it('aim right should produce rightward aim vector matching D movement', () => {
      const { walker } = createWalkerOnSurface();
      const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 1000);
      camera.position.set(0, 15, 25);
      camera.lookAt(0, 0, 0);
      const dt = 1 / 60;

      // Warmup
      for (let i = 0; i < 120; i++) {
        updateCamera(camera, walker);
      }

      // Get aim direction for aiming right (aimX=1, aimY=0)
      const aimDir = walker.getAimDirection(1, 0, camera);

      // Get movement direction for D key
      const startPos = walker.position.clone();
      walker.moveFromInput(1, 0, camera, dt);
      const moveDir = walker.position.clone().sub(startPos).normalize();

      // Aim right and move right should point in roughly the same direction
      const dot = aimDir.dot(moveDir);
      expect(dot).toBeGreaterThan(0.5);
    });
  });
});

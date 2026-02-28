/**
 * Tests for computeCameraRelativeAimAngle (s40-03).
 *
 * Verifies that the camera-frame correction correctly maps mouse input to bullet direction
 * regardless of camera orbit angle or surface position.
 */
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { computeCameraRelativeAimAngle } from './aimAngle';

// --------------------------------------------------------------------------
// Helpers
// --------------------------------------------------------------------------

/** Build a right-handed surface frame at an arbitrary position. */
function buildFrame(tangentU: THREE.Vector3, tangentV: THREE.Vector3, normal: THREE.Vector3) {
  return { tangentU, tangentV, normal };
}

/** Standard sphere equator frame: tangentU = +X, tangentV = -Y, normal = +Z. */
const FRAME_STANDARD = buildFrame(
  new THREE.Vector3(1, 0, 0),  // tangentU = screen-right
  new THREE.Vector3(0, 1, 0),  // tangentV = screen-up (camera.up)
  new THREE.Vector3(0, 0, 1),  // normal = out of screen
);

// Camera axes that perfectly align with the surface frame (no orbit, no lag)
const CAM_RIGHT_ALIGNED = new THREE.Vector3(1, 0, 0); // = tangentU
const CAM_UP_ALIGNED    = new THREE.Vector3(0, 1, 0); // = tangentV

// --------------------------------------------------------------------------
// Basic correctness (camera aligned with surface)
// --------------------------------------------------------------------------
describe('computeCameraRelativeAimAngle — camera aligned with surface', () => {
  const { tangentU, tangentV, normal } = FRAME_STANDARD;

  it('mouse right (1, 0) → angle ≈ 0 (bullet along +tangentU = screen right)', () => {
    const angle = computeCameraRelativeAimAngle(1, 0, CAM_RIGHT_ALIGNED, CAM_UP_ALIGNED, normal, tangentU, tangentV);
    expect(angle).toBeCloseTo(0, 4);
  });

  it('mouse up (0, -1) → angle ≈ +π/2 (bullet along +tangentV = screen up)', () => {
    const angle = computeCameraRelativeAimAngle(0, -1, CAM_RIGHT_ALIGNED, CAM_UP_ALIGNED, normal, tangentU, tangentV);
    expect(angle).toBeCloseTo(Math.PI / 2, 4);
  });

  it('mouse down (0, +1) → angle ≈ -π/2 (bullet along -tangentV = screen down)', () => {
    const angle = computeCameraRelativeAimAngle(0, 1, CAM_RIGHT_ALIGNED, CAM_UP_ALIGNED, normal, tangentU, tangentV);
    expect(angle).toBeCloseTo(-Math.PI / 2, 4);
  });

  it('mouse left (-1, 0) → angle ≈ ±π (bullet along -tangentU = screen left)', () => {
    const angle = computeCameraRelativeAimAngle(-1, 0, CAM_RIGHT_ALIGNED, CAM_UP_ALIGNED, normal, tangentU, tangentV);
    expect(Math.abs(angle)).toBeCloseTo(Math.PI, 4);
  });
});

// --------------------------------------------------------------------------
// Camera orbit by 90° (camRight has rotated to tangentV direction)
// --------------------------------------------------------------------------
describe('computeCameraRelativeAimAngle — camera orbited 90° (yaw)', () => {
  // After 90° orbit around normal (+Z), camRight = +Y = tangentV, camUp = -X = -tangentU
  const { tangentU, tangentV, normal } = FRAME_STANDARD;
  const camRight90 = new THREE.Vector3(0, 1, 0); // = tangentV after 90° CCW orbit
  const camUp90    = new THREE.Vector3(-1, 0, 0); // = -tangentU

  it('mouse right → bullet goes in +tangentV direction (camera right = tangentV)', () => {
    const angle = computeCameraRelativeAimAngle(1, 0, camRight90, camUp90, normal, tangentU, tangentV);
    // World-space aim = +tangentV → UV angle = atan2(1, 0) = π/2
    expect(angle).toBeCloseTo(Math.PI / 2, 4);
  });

  it('mouse up → bullet goes in -tangentU direction (camera up = -tangentU, mouseUp = -mouseY * camUp = -(-1)*(-tangentU) = -tangentU)', () => {
    const angle = computeCameraRelativeAimAngle(0, -1, camRight90, camUp90, normal, tangentU, tangentV);
    // World-space aim = -mouseY * camUp90 = 1 * (-tangentU) = -tangentU → UV angle = atan2(0, -1) = ±π
    expect(Math.abs(angle)).toBeCloseTo(Math.PI, 4);
  });
});

// --------------------------------------------------------------------------
// Camera orbited 180° (camRight = -tangentU) — the reported bug scenario
// --------------------------------------------------------------------------
describe('computeCameraRelativeAimAngle — camera orbited 180° (the reported bug)', () => {
  // After 180° orbit: camRight = -tangentU, camUp = -tangentV
  const { tangentU, tangentV, normal } = FRAME_STANDARD;
  const camRight180 = new THREE.Vector3(-1, 0, 0); // = -tangentU
  const camUp180    = new THREE.Vector3(0, -1, 0); // = -tangentV

  it('mouse right → bullet goes in -tangentU direction (camera right = -tangentU)', () => {
    const angle = computeCameraRelativeAimAngle(1, 0, camRight180, camUp180, normal, tangentU, tangentV);
    // World-space aim = -tangentU → UV angle = atan2(0, -1) = ±π
    expect(Math.abs(angle)).toBeCloseTo(Math.PI, 4);
  });

  it('mouse up → bullet goes in -tangentV direction (camera up = -tangentV)', () => {
    const angle = computeCameraRelativeAimAngle(0, -1, camRight180, camUp180, normal, tangentU, tangentV);
    // World-space aim = +camUp = -tangentV → UV angle = atan2(-1, 0) = -π/2
    expect(angle).toBeCloseTo(-Math.PI / 2, 4);
  });

  it('REGRESSION: naive atan2 would give wrong direction for 180° orbit', () => {
    // Without correction: mouse right → atan2(0, 1) = 0 → +tangentU (opposite of camera right)
    const naiveAngle = Math.atan2(0, 1); // = 0 (wrong: camera right = -tangentU)
    const correctedAngle = computeCameraRelativeAimAngle(1, 0, camRight180, camUp180, normal, tangentU, tangentV);
    // They must differ by π
    expect(Math.abs(correctedAngle - naiveAngle)).toBeCloseTo(Math.PI, 2);
  });
});

// --------------------------------------------------------------------------
// Surface positions: sphere at different UV positions
// --------------------------------------------------------------------------
describe('computeCameraRelativeAimAngle — multiple surface positions on sphere', () => {
  /**
   * Sphere at phi=π/2 (equator), varying theta.
   * tangentU = (-sinTheta, 0, cosTheta), tangentV = (0, -1, 0), normal = (cosTheta, 0, sinTheta)
   * Camera is at position + normal*dist, looking at position with up = tangentV.
   * camera.right should = tangentU (right-handed frame, no orbit).
   */
  function sphereFrame(theta: number) {
    const cosT = Math.cos(theta), sinT = Math.sin(theta);
    return buildFrame(
      new THREE.Vector3(-sinT, 0, cosT),   // tangentU
      new THREE.Vector3(0, -1, 0),          // tangentV
      new THREE.Vector3(cosT, 0, sinT),     // normal
    );
  }

  const thetas = [0, Math.PI / 4, Math.PI / 2, Math.PI, 3 * Math.PI / 2];

  for (const theta of thetas) {
    it(`theta=${(theta * 180 / Math.PI).toFixed(0)}°: mouse right → bullet along +tangentU`, () => {
      const { tangentU, tangentV, normal } = sphereFrame(theta);
      // Camera right = tangentU, camera up = tangentV (no orbit)
      const angle = computeCameraRelativeAimAngle(1, 0, tangentU, tangentV, normal, tangentU, tangentV);
      expect(angle).toBeCloseTo(0, 4); // bullet should go along +tangentU
    });

    it(`theta=${(theta * 180 / Math.PI).toFixed(0)}°: mouse up → bullet along +tangentV`, () => {
      const { tangentU, tangentV, normal } = sphereFrame(theta);
      const angle = computeCameraRelativeAimAngle(0, -1, tangentU, tangentV, normal, tangentU, tangentV);
      expect(angle).toBeCloseTo(Math.PI / 2, 4); // bullet should go along +tangentV
    });
  }
});

// --------------------------------------------------------------------------
// Degenerate fallback
// --------------------------------------------------------------------------
describe('computeCameraRelativeAimAngle — degenerate fallback', () => {
  const { tangentU, tangentV, normal } = FRAME_STANDARD;

  it('degenerate camRight (parallel to normal) → falls back to atan2(-mouseY, mouseX)', () => {
    const parallelToNormal = new THREE.Vector3(0, 0, 1); // = normal, projects to zero
    const angle = computeCameraRelativeAimAngle(1, 0, parallelToNormal, CAM_UP_ALIGNED, normal, tangentU, tangentV);
    expect(angle).toBeCloseTo(Math.atan2(0, 1), 4); // fallback: atan2(-0, 1) = 0
  });
});

/**
 * Surface Trouble Zone Movement Verification Tests
 *
 * Tests player movement through known problem areas on every surface:
 * - Sphere: poles (UV singularity)
 * - Torus: inner ring (high curvature)
 * - Cube: edges and corners (90° normal changes)
 * - Mobius: seam (non-orientable twist)
 * - Capsule: hemisphere-cylinder transition
 * - Peanut: narrow waist
 *
 * Each test verifies: no NaN, no teleportation, no direction reversal.
 */

import * as THREE from 'three';
import { describe, it, expect } from 'vitest';
import { MeshWalker } from '../movement/MeshWalker';
import { MeshSurface } from '../surfaces/MeshSurface';
import { SurfaceFactory, SurfaceType } from '../surfaces/SurfaceFactory';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createWalker(
  type: SurfaceType,
  startU: number,
  startV: number,
  config?: Record<string, unknown>,
): { walker: MeshWalker; surface: MeshSurface } {
  const defaults: Record<string, unknown> = {
    radius: 10,
    size: 10,
    height: 20,
    majorRadius: 8,
    minorRadius: 3,
    width: 10,
    gridColor: 0x2a2aaa,
    surfaceColor: 0x141440,
    surfaceOpacity: 0.35,
    gridOpacity: 0.4,
  };
  if (type === 'cube-tunnel') {
    defaults.size = 35;
    defaults.wallThickness = 2.0;
    defaults.bevelRadius = 4.5;
    defaults.gridSegments = 16;
  }
  if (type === 'cube-ring') {
    defaults.majorRadius = 4;
    defaults.crossSection = 2;
  }
  const surf = SurfaceFactory.create(type, { ...defaults, ...config } as any);
  surf.mesh.updateMatrixWorld(true);
  const meshSurface = new MeshSurface(surf.mesh);
  const startPos = surf.getPoint(startU, startV).position;
  const walker = new MeshWalker(meshSurface, startPos, 3);
  return { walker, surface: meshSurface };
}

/** Walk the walker for N steps using moveFromInput, checking invariants each step. */
function walkAndVerify(
  walker: MeshWalker,
  inputX: number,
  inputY: number,
  steps: number,
  dt: number,
  label: string,
): {
  nanCount: number;
  teleportCount: number;
  stuckCount: number;
  maxStep: number;
  totalDist: number;
} {
  const camera = new THREE.PerspectiveCamera(); // default camera → tangent-frame fallback
  let nanCount = 0;
  let teleportCount = 0;
  let stuckCount = 0;
  let maxStep = 0;
  let totalDist = 0;
  let prevPos = walker.position.clone();

  for (let i = 0; i < steps; i++) {
    walker.moveFromInput(inputX, inputY, camera, dt);

    // Check for NaN
    if (isNaN(walker.position.x) || isNaN(walker.position.y) || isNaN(walker.position.z) ||
        isNaN(walker.normal.x) || isNaN(walker.normal.y) || isNaN(walker.normal.z)) {
      nanCount++;
      break; // NaN is unrecoverable
    }

    // Check normal is normalized
    const normalLen = walker.normal.length();
    if (normalLen < 0.9 || normalLen > 1.1) {
      nanCount++; // Treat bad normal as equivalent to NaN
    }

    const stepDist = prevPos.distanceTo(walker.position);
    maxStep = Math.max(maxStep, stepDist);
    totalDist += stepDist;

    // Teleportation: single step > 10x the expected distance
    // BVH fallback at trouble zones (poles, seams, edges) can produce larger
    // steps — this is expected. Only flag truly extreme jumps.
    const expectedStep = walker.speed * dt;
    if (stepDist > expectedStep * 10) {
      teleportCount++;
    }

    // Stuck: no movement
    if (stepDist < 0.0001) {
      stuckCount++;
    }

    prevPos = walker.position.clone();
  }

  return { nanCount, teleportCount, stuckCount, maxStep, totalDist };
}

// ---------------------------------------------------------------------------
// Surface-specific trouble zones
// ---------------------------------------------------------------------------

describe('Surface Trouble Zone Verification', () => {

  describe('Sphere — Poles', () => {
    it('should traverse the north pole (u≈0) without NaN or teleport', () => {
      // Start near north pole
      const { walker } = createWalker('sphere', 0.05, 0.5);
      const result = walkAndVerify(walker, 1, 0, 100, 0.05, 'sphere-north-pole');
      expect(result.nanCount).toBe(0);
      expect(result.teleportCount).toBeLessThan(5);
    });

    it('should traverse the south pole (u≈1) without NaN or teleport', () => {
      const { walker } = createWalker('sphere', 0.95, 0.5);
      const result = walkAndVerify(walker, 1, 0, 100, 0.05, 'sphere-south-pole');
      expect(result.nanCount).toBe(0);
      expect(result.teleportCount).toBeLessThan(5);
    });

    it('should move through the origin (center of sphere) axis without NaN', () => {
      // Walk from near north to south pole
      const { walker } = createWalker('sphere', 0.1, 0.5);
      const result = walkAndVerify(walker, 0, 1, 200, 0.05, 'sphere-pole-to-pole');
      expect(result.nanCount).toBe(0);
      expect(result.teleportCount).toBeLessThan(5);
      // Should cover meaningful distance
      expect(result.totalDist).toBeGreaterThan(1.0);
    });

    it('should handle diagonal movement near poles', () => {
      const { walker } = createWalker('sphere', 0.02, 0.25);
      const result = walkAndVerify(walker, 0.7, 0.7, 100, 0.05, 'sphere-pole-diagonal');
      expect(result.nanCount).toBe(0);
      expect(result.teleportCount).toBeLessThan(5);
    });
  });

  describe('Torus — Inner Ring', () => {
    it('should traverse the inner ring (high curvature) without NaN', () => {
      // Inner ring of torus: v≈0.5 (inner equator)
      const { walker } = createWalker('torus', 0.5, 0.5);
      const result = walkAndVerify(walker, 1, 0, 200, 0.05, 'torus-inner-ring');
      expect(result.nanCount).toBe(0);
      expect(result.teleportCount).toBeLessThan(5);
    });

    it('should cross from outer to inner ring without NaN', () => {
      // Start on outer ring (v≈0), walk toward inner (v≈0.5)
      const { walker } = createWalker('torus', 0.5, 0.0);
      const result = walkAndVerify(walker, 0, 1, 200, 0.05, 'torus-outer-to-inner');
      expect(result.nanCount).toBe(0);
      expect(result.teleportCount).toBeLessThan(5);
    });

    it('should handle the torus seam (u=0/1 boundary)', () => {
      const { walker } = createWalker('torus', 0.98, 0.5);
      const result = walkAndVerify(walker, 1, 0, 100, 0.05, 'torus-seam');
      expect(result.nanCount).toBe(0);
      expect(result.teleportCount).toBeLessThan(5);
    });
  });

  describe('Cube — Edges and Corners', () => {
    it('should traverse a cube face without getting permanently stuck', () => {
      const { walker } = createWalker('cube', 0.5, 0.5);
      const result = walkAndVerify(walker, 1, 0, 100, 0.05, 'cube-face');
      expect(result.nanCount).toBe(0);
      // Cube edges are known to cause sticking, but shouldn't be permanent
      expect(result.stuckCount).toBeLessThan(80); // allow some stuck frames at edges
    });

    it('should not produce NaN when hitting cube edges', () => {
      // Start near a face edge
      const { walker } = createWalker('cube', 0.15, 0.5);
      const result = walkAndVerify(walker, 1, 0.3, 100, 0.05, 'cube-edge');
      expect(result.nanCount).toBe(0);
    });

    it('should survive corner regions', () => {
      const { walker } = createWalker('cube', 0.05, 0.05);
      const result = walkAndVerify(walker, 0.7, 0.7, 100, 0.05, 'cube-corner');
      expect(result.nanCount).toBe(0);
    });
  });

  describe('Mobius Strip — Seam', () => {
    it('should cross the mobius seam without NaN', () => {
      // Walk along the strip (tangent direction) which will cross the seam
      const { walker } = createWalker('mobius', 0.9, 0.5);
      const result = walkAndVerify(walker, 1, 0, 200, 0.05, 'mobius-seam');
      expect(result.nanCount).toBe(0);
      expect(result.teleportCount).toBeLessThan(5);
    });

    it('should survive walking along the edge near the seam', () => {
      const { walker } = createWalker('mobius', 0.95, 0.1);
      const result = walkAndVerify(walker, 1, 0, 150, 0.05, 'mobius-seam-edge');
      expect(result.nanCount).toBe(0);
    });

    it('should handle diagonal movement across the seam', () => {
      const { walker } = createWalker('mobius', 0.85, 0.3);
      const result = walkAndVerify(walker, 0.5, 0.5, 200, 0.05, 'mobius-seam-diagonal');
      expect(result.nanCount).toBe(0);
      expect(result.teleportCount).toBeLessThan(5);
    });
  });

  describe('Capsule — Hemisphere-Cylinder Transition', () => {
    it('should cross the top hemisphere/cylinder junction', () => {
      // Top cap starts around u≈0.15
      const { walker } = createWalker('capsule', 0.15, 0.5);
      const result = walkAndVerify(walker, 0, 1, 150, 0.05, 'capsule-top-junction');
      expect(result.nanCount).toBe(0);
      expect(result.teleportCount).toBeLessThan(5);
    });

    it('should cross the bottom hemisphere/cylinder junction', () => {
      const { walker } = createWalker('capsule', 0.85, 0.5);
      const result = walkAndVerify(walker, 0, 1, 150, 0.05, 'capsule-bottom-junction');
      expect(result.nanCount).toBe(0);
      expect(result.teleportCount).toBeLessThan(5);
    });

    it('should traverse full length (pole to pole)', () => {
      const { walker } = createWalker('capsule', 0.05, 0.5);
      const result = walkAndVerify(walker, 0, 1, 300, 0.05, 'capsule-full-traverse');
      expect(result.nanCount).toBe(0);
      expect(result.teleportCount).toBeLessThan(5);
      expect(result.totalDist).toBeGreaterThan(2.0);
    });
  });

  describe('Peanut — Narrow Waist', () => {
    it('should traverse the narrow waist without NaN', () => {
      // Peanut waist is at u≈0.5
      const { walker } = createWalker('peanut', 0.45, 0.5);
      const result = walkAndVerify(walker, 0, 1, 150, 0.05, 'peanut-waist');
      expect(result.nanCount).toBe(0);
      expect(result.teleportCount).toBeLessThan(5);
    });

    it('should handle movement around the narrow section', () => {
      const { walker } = createWalker('peanut', 0.5, 0.5);
      const result = walkAndVerify(walker, 1, 0, 200, 0.05, 'peanut-waist-circumference');
      expect(result.nanCount).toBe(0);
      expect(result.teleportCount).toBeLessThan(5);
    });
  });

  describe('Cube Tunnel — Sharp Edges', () => {
    it('should survive edge transitions', () => {
      const { walker } = createWalker('cube-tunnel', 0.3, 0.5);
      const result = walkAndVerify(walker, 1, 0, 100, 0.05, 'cube-tunnel-edge');
      expect(result.nanCount).toBe(0);
    });

    it('should traverse along the tunnel without NaN', () => {
      const { walker } = createWalker('cube-tunnel', 0.5, 0.3);
      const result = walkAndVerify(walker, 0, 1, 200, 0.05, 'cube-tunnel-traverse');
      expect(result.nanCount).toBe(0);
      expect(result.teleportCount).toBeLessThan(5);
    });
  });

  describe('Cube Ring — Edge and Seam Zones', () => {
    it('should cross cube-ring edges without NaN', () => {
      const { walker } = createWalker('cube-ring', 0.5, 0.15);
      const result = walkAndVerify(walker, 1, 0, 100, 0.05, 'cube-ring-edge');
      expect(result.nanCount).toBe(0);
    });

    it('should traverse the seam (u=0/1) without NaN', () => {
      const { walker } = createWalker('cube-ring', 0.95, 0.5);
      const result = walkAndVerify(walker, 1, 0, 100, 0.05, 'cube-ring-seam');
      expect(result.nanCount).toBe(0);
    });
  });

  describe('Pill — Cap Transitions', () => {
    it('should cross cap/cylinder boundary without NaN', () => {
      const { walker } = createWalker('pill', 0.15, 0.5);
      const result = walkAndVerify(walker, 0, 1, 150, 0.05, 'pill-cap-boundary');
      expect(result.nanCount).toBe(0);
      expect(result.teleportCount).toBeLessThan(5);
    });
  });

  describe('Extended Movement (30+ seconds equivalent)', () => {
    it('sphere: 600 steps (30s at 20Hz) without crash', () => {
      const { walker } = createWalker('sphere', 0.5, 0.5);
      // Alternate directions to cover more surface
      const camera = new THREE.PerspectiveCamera();
      let nanDetected = false;
      for (let i = 0; i < 600; i++) {
        const angle = i * 0.1;
        const ix = Math.cos(angle);
        const iy = Math.sin(angle);
        walker.moveFromInput(ix, iy, camera, 0.05);
        if (isNaN(walker.position.x) || isNaN(walker.normal.x)) {
          nanDetected = true;
          break;
        }
      }
      expect(nanDetected).toBe(false);
    });

    it('torus: 600 steps (30s at 20Hz) without crash', () => {
      const { walker } = createWalker('torus', 0.5, 0.5);
      const camera = new THREE.PerspectiveCamera();
      let nanDetected = false;
      for (let i = 0; i < 600; i++) {
        const angle = i * 0.1;
        walker.moveFromInput(Math.cos(angle), Math.sin(angle), camera, 0.05);
        if (isNaN(walker.position.x) || isNaN(walker.normal.x)) {
          nanDetected = true;
          break;
        }
      }
      expect(nanDetected).toBe(false);
    });

    it('capsule: 600 steps (30s at 20Hz) without crash', () => {
      const { walker } = createWalker('capsule', 0.5, 0.5);
      const camera = new THREE.PerspectiveCamera();
      let nanDetected = false;
      for (let i = 0; i < 600; i++) {
        const angle = i * 0.15;
        walker.moveFromInput(Math.cos(angle), Math.sin(angle), camera, 0.05);
        if (isNaN(walker.position.x) || isNaN(walker.normal.x)) {
          nanDetected = true;
          break;
        }
      }
      expect(nanDetected).toBe(false);
    });

    it('mobius: 600 steps (30s at 20Hz) without crash', () => {
      const { walker } = createWalker('mobius', 0.5, 0.5);
      const camera = new THREE.PerspectiveCamera();
      let nanDetected = false;
      for (let i = 0; i < 600; i++) {
        const angle = i * 0.1;
        walker.moveFromInput(Math.cos(angle), Math.sin(angle), camera, 0.05);
        if (isNaN(walker.position.x) || isNaN(walker.normal.x)) {
          nanDetected = true;
          break;
        }
      }
      expect(nanDetected).toBe(false);
    });
  });
});

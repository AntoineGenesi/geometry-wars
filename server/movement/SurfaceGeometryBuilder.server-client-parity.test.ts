/**
 * s44q-04 REGRESSION TEST: Server-Client Surface Dimension Parity
 *
 * ROOT CAUSE: SurfaceGeometryBuilder used hardcoded Surface class defaults
 * (e.g. torus majorR=6, minorR=2) while the client uses createStandardSurfaceConfig
 * which generates scale-dependent dimensions (e.g. torus majorR=8, minorR=3 at scale=10).
 * This mismatch caused the server physics mesh to be smaller than the client visual mesh,
 * making players appear INSIDE surfaces in multiplayer.
 *
 * This test verifies that server geometry dimensions match what the client renders.
 * If ANY of these tests fail, players will appear inside surfaces in MP.
 *
 * REGRESSION GUARD: Do not change these expected values without also verifying
 * createStandardSurfaceConfig in src/rendering/SharedGameSetup.ts.
 */

import * as THREE from 'three';
import { describe, test, expect } from 'vitest';
import { buildSurfaceGeometry } from './SurfaceGeometryBuilder';

/**
 * Client dimensions from createStandardSurfaceConfig(surfaceType, 10, null)
 * in src/rendering/SharedGameSetup.ts. These are the SOURCE OF TRUTH.
 */
const CLIENT_SCALE = 10;

// Helper: measure max distance from origin in XZ plane (radial extent)
function maxRadialXZ(mesh: THREE.Mesh): number {
  const pos = mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
  let max = 0;
  for (let i = 0; i < pos.count; i++) {
    const d = Math.sqrt(pos.getX(i) ** 2 + pos.getZ(i) ** 2);
    max = Math.max(max, d);
  }
  return max;
}

// Helper: measure max distance from origin (3D extent)
function maxRadius3D(mesh: THREE.Mesh): number {
  const pos = mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
  let max = 0;
  for (let i = 0; i < pos.count; i++) {
    const d = Math.sqrt(pos.getX(i) ** 2 + pos.getY(i) ** 2 + pos.getZ(i) ** 2);
    max = Math.max(max, d);
  }
  return max;
}

// Helper: measure Y extent (height)
function yExtent(mesh: THREE.Mesh): { min: number; max: number } {
  const pos = mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
  let min = Infinity, max = -Infinity;
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    min = Math.min(min, y);
    max = Math.max(max, y);
  }
  return { min, max };
}

describe('s44q-04 REGRESSION: Server-Client Surface Dimension Parity', () => {
  // REGRESSION GUARD: Torus was the most-broken surface (7 failed fix attempts).
  // Client: majorR=8, minorR=3. Server MUST match.
  // Old server had majorR=6, minorR=2 → player appeared inside doughnut.
  test('torus: max radial extent matches client majorR(8) + minorR(3) = 11', () => {
    const mesh = buildSurfaceGeometry('torus', 1.0);
    const maxR = maxRadialXZ(mesh);
    // Client torus: majorR=scale*0.8=8, minorR=scale*0.3=3 → outer edge at 11
    expect(maxR).toBeGreaterThan(10.5);
    expect(maxR).toBeLessThan(11.5);
  });

  test('torus: tube radius ~3 (not old value of 2)', () => {
    const mesh = buildSurfaceGeometry('torus', 1.0);
    const maxR = maxRadialXZ(mesh);
    // Inner edge should be at majorR - minorR = 8 - 3 = 5
    const pos = mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
    let minR = Infinity;
    for (let i = 0; i < pos.count; i++) {
      const d = Math.sqrt(pos.getX(i) ** 2 + pos.getZ(i) ** 2);
      if (d > 0.1) minR = Math.min(minR, d); // skip degenerate vertices
    }
    const tubeRadius = (maxR - minR) / 2;
    expect(tubeRadius).toBeGreaterThan(2.5);
    expect(tubeRadius).toBeLessThan(3.5);
  });

  // Sphere: radius=10 (client uses config.radius = scale = 10)
  test('sphere: radius matches client scale=10', () => {
    const mesh = buildSurfaceGeometry('sphere', 1.0);
    const maxR = maxRadius3D(mesh);
    expect(maxR).toBeGreaterThan(9.9);
    expect(maxR).toBeLessThan(10.1);
  });

  // Pill: client config radius=scale=10, height=scale*2=20
  // CapsuleGeometry(radius, cylinderHeight, ...)
  test('pill: radius=10, total height=40 (r=10, cylinder=20)', () => {
    const mesh = buildSurfaceGeometry('pill', 1.0);
    const maxR = maxRadialXZ(mesh);
    expect(maxR).toBeGreaterThan(9.5);
    expect(maxR).toBeLessThan(10.5);
    const ext = yExtent(mesh);
    // CapsuleGeometry(10, 20) → total height = 20 + 2*10 = 40
    const totalHeight = ext.max - ext.min;
    expect(totalHeight).toBeGreaterThan(38);
    expect(totalHeight).toBeLessThan(42);
  });

  // Capsule: client config radius=scale=10, height=scale*1.2=12
  test('capsule: radius=10, cylinder height=12', () => {
    const mesh = buildSurfaceGeometry('capsule', 1.0);
    const maxR = maxRadialXZ(mesh);
    expect(maxR).toBeGreaterThan(9.5);
    expect(maxR).toBeLessThan(10.5);
  });

  // Cube: client config size=scale=10, bevelRadius=0.6
  test('cube: half-extent ~5 (size=10)', () => {
    const mesh = buildSurfaceGeometry('cube', 1.0);
    const maxR = maxRadialXZ(mesh);
    // Cube half-size = 5, max radial in XZ ≈ 5*sqrt(2) ≈ 7.07, but corners are beveled
    expect(maxR).toBeGreaterThan(4.5);
    expect(maxR).toBeLessThan(8.0);
  });

  // Sphere-tunnel: client config R=scale=10, tubeRadius=scale*0.3=3
  test('sphere-tunnel: radius ~10', () => {
    const mesh = buildSurfaceGeometry('sphere-tunnel', 1.0);
    const maxR = maxRadius3D(mesh);
    expect(maxR).toBeGreaterThan(9.5);
    expect(maxR).toBeLessThan(11.0);
  });

  // Cube-ring: client config majorRadius=scale*0.4=4, crossSection=scale*0.2=2 → halfSide=1.0
  test('cube-ring: max radial extent = majorR(4) + halfSide(1) = 5', () => {
    const mesh = buildSurfaceGeometry('cube-ring', 1.0);
    const maxR = maxRadialXZ(mesh);
    expect(maxR).toBeGreaterThan(4.5);
    expect(maxR).toBeLessThan(5.5);
  });

  // Pipe: client config radius=scale=10, height=scale*2=20, bevelRadius=0.6
  // Outer cylinder radius = 10, inner = 10 - 2*0.6 = 8.8, height = 20
  test('pipe: outer radius=10, height=20', () => {
    const mesh = buildSurfaceGeometry('pipe', 1.0);
    const maxR = maxRadialXZ(mesh);
    expect(maxR).toBeGreaterThan(9.5);
    expect(maxR).toBeLessThan(10.5);
    const ext = yExtent(mesh);
    const totalHeight = ext.max - ext.min;
    expect(totalHeight).toBeGreaterThan(19.0);
    expect(totalHeight).toBeLessThan(21.0);
  });

  // Mobius-bevel: client config majorRadius=scale*0.8=8, tubeRadius=2 (class default)
  // Outer extent = majorRadius + tubeRadius = 8 + 2 = 10
  test('mobius-bevel: outer extent = majorR(8) + tubeR(2) = 10', () => {
    const mesh = buildSurfaceGeometry('mobius-bevel', 1.0);
    const maxR = maxRadius3D(mesh);
    expect(maxR).toBeGreaterThan(9.5);
    expect(maxR).toBeLessThan(10.5);
  });

  // Scale factor test: all surfaces should scale proportionally
  test('torus with scaleFactor=1.5: outer edge at ~16.5', () => {
    const mesh = buildSurfaceGeometry('torus', 1.5);
    const maxR = maxRadialXZ(mesh);
    // (8+3)*1.5 = 16.5
    expect(maxR).toBeGreaterThan(15.5);
    expect(maxR).toBeLessThan(17.5);
  });
});

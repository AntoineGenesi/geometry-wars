#!/usr/bin/env node
/**
 * LoadedMeshSurface Unit Tests
 *
 * Tests the UV-based surface wrapper for arbitrary loaded meshes.
 */

import * as THREE from 'three';
import { LoadedMeshSurface } from '../../dist/surfaces/LoadedMeshSurface.js';

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    passed++;
    console.log(`  ✓ ${message}`);
  } else {
    failed++;
    console.error(`  ✗ ${message}`);
  }
}

/**
 * Create a simple test mesh (sphere) in LoadedMesh format.
 */
function createTestMesh(radius = 8) {
  const geometry = new THREE.SphereGeometry(radius, 32, 32);
  geometry.computeVertexNormals();

  const material = new THREE.MeshBasicMaterial({
    color: 0x110033,
    transparent: true,
    opacity: 0.15,
  });

  const mesh = new THREE.Mesh(geometry, material);

  return {
    mesh,
    originalSize: new THREE.Vector3(radius * 2, radius * 2, radius * 2),
    scaleFactor: 1.0,
    triangleCount: geometry.index ? geometry.index.count / 3 : geometry.attributes.position.count / 3,
  };
}

// ---------------------------------------------------------------------------
// Test 1: Basic Construction
// ---------------------------------------------------------------------------

console.log('\n[Test 1: Basic Construction]');
try {
  const loadedMesh = createTestMesh(8);
  const surface = new LoadedMeshSurface(loadedMesh);

  assert(surface !== null, 'Surface created successfully');
  assert(surface.loadedMesh === loadedMesh, 'Loaded mesh reference stored');
  assert(surface.mesh !== null, 'Visual mesh created');
  assert(surface.gridMesh !== null, 'Grid mesh created');
  assert(surface.surfaceRadius > 0, 'Surface radius computed');
} catch (err) {
  assert(false, `Construction failed: ${err.message}`);
}

// ---------------------------------------------------------------------------
// Test 2: getPoint() - Basic UV Queries
// ---------------------------------------------------------------------------

console.log('\n[Test 2: getPoint() — Basic UV Queries]');
try {
  const loadedMesh = createTestMesh(8);
  const surface = new LoadedMeshSurface(loadedMesh);

  // Test center point
  const center = surface.getPoint(0.5, 0.5);
  assert(center.position instanceof THREE.Vector3, 'getPoint returns position');
  assert(center.normal instanceof THREE.Vector3, 'getPoint returns normal');
  assert(center.tangentU instanceof THREE.Vector3, 'getPoint returns tangentU');
  assert(center.tangentV instanceof THREE.Vector3, 'getPoint returns tangentV');

  // Verify position is on the sphere (distance from origin ≈ radius)
  const distFromOrigin = center.position.length();
  assert(Math.abs(distFromOrigin - 8) < 0.5, `Position on surface (dist=${distFromOrigin.toFixed(2)}, expected ~8)`);

  // Verify normal points outward
  const normalDotPos = center.normal.dot(center.position.clone().normalize());
  assert(normalDotPos > 0.9, `Normal points outward (dot=${normalDotPos.toFixed(2)})`);

  // Test multiple UV positions
  const testPoints = [
    { u: 0, v: 0.5 },      // Equator, longitude 0
    { u: 0.25, v: 0.5 },   // Equator, longitude 90°
    { u: 0.5, v: 0.5 },    // Equator, longitude 180°
    { u: 0.75, v: 0.5 },   // Equator, longitude 270°
    { u: 0.5, v: 0 },      // North pole
    { u: 0.5, v: 1 },      // South pole
  ];

  let validPoints = 0;
  for (const { u, v } of testPoints) {
    const point = surface.getPoint(u, v);
    const dist = point.position.length();
    if (Math.abs(dist - 8) < 0.5) {
      validPoints++;
    }
  }
  assert(validPoints === testPoints.length, `All ${testPoints.length} test points on surface (${validPoints} valid)`);

} catch (err) {
  assert(false, `getPoint test failed: ${err.message}`);
}

// ---------------------------------------------------------------------------
// Test 3: worldToSurface() - Inverse Mapping
// ---------------------------------------------------------------------------

console.log('\n[Test 3: worldToSurface() — Inverse Mapping]');
try {
  const loadedMesh = createTestMesh(8);
  const surface = new LoadedMeshSurface(loadedMesh);

  // Test round-trip: UV → world → UV
  const testUV = { u: 0.3, v: 0.7 };
  const point = surface.getPoint(testUV.u, testUV.v);
  const recoveredUV = surface.worldToSurface(point.position);

  const uDiff = Math.abs(recoveredUV.u - testUV.u);
  const vDiff = Math.abs(recoveredUV.v - testUV.v);

  // Allow small error due to floating point and projection
  assert(uDiff < 0.05, `U coordinate round-trip (diff=${uDiff.toFixed(4)})`);
  assert(vDiff < 0.05, `V coordinate round-trip (diff=${vDiff.toFixed(4)})`);

  // Test wrapping at u=0/u=1 boundary
  const point0 = surface.getPoint(0, 0.5);
  const point1 = surface.getPoint(1, 0.5);
  const dist = point0.position.distanceTo(point1.position);
  assert(dist < 0.5, `U=0 and U=1 map to same location (dist=${dist.toFixed(3)})`);

} catch (err) {
  assert(false, `worldToSurface test failed: ${err.message}`);
}

// ---------------------------------------------------------------------------
// Test 4: moveOnSurface() - UV Movement
// ---------------------------------------------------------------------------

console.log('\n[Test 4: moveOnSurface() — UV Movement]');
try {
  const loadedMesh = createTestMesh(8);
  const surface = new LoadedMeshSurface(loadedMesh);

  // Start at center
  const startUV = { u: 0.5, v: 0.5 };
  const startPoint = surface.getPoint(startUV.u, startUV.v);

  // Move in U direction
  const movedU = surface.moveOnSurface(startUV.u, startUV.v, 0.1, 0);
  assert(Math.abs(movedU.u - startUV.u) > 0.01, 'U coordinate changed after du movement');
  assert(Math.abs(movedU.v - startUV.v) < 0.05, 'V coordinate stayed roughly same after du movement');

  // Move in V direction
  const movedV = surface.moveOnSurface(startUV.u, startUV.v, 0, 0.1);
  assert(Math.abs(movedV.v - startUV.v) > 0.01, 'V coordinate changed after dv movement');

  // Verify moved points are still on surface
  const movedPoint1 = surface.getPoint(movedU.u, movedU.v);
  const movedPoint2 = surface.getPoint(movedV.u, movedV.v);
  const dist1 = movedPoint1.position.length();
  const dist2 = movedPoint2.position.length();
  assert(Math.abs(dist1 - 8) < 0.5, `Moved point 1 still on surface (dist=${dist1.toFixed(2)})`);
  assert(Math.abs(dist2 - 8) < 0.5, `Moved point 2 still on surface (dist=${dist2.toFixed(2)})`);

  // Test multiple moves
  let currentUV = { u: 0.5, v: 0.5 };
  for (let i = 0; i < 10; i++) {
    currentUV = surface.moveOnSurface(currentUV.u, currentUV.v, 0.01, 0.01);
  }
  const finalPoint = surface.getPoint(currentUV.u, currentUV.v);
  const finalDist = finalPoint.position.length();
  assert(Math.abs(finalDist - 8) < 0.5, `After 10 moves, still on surface (dist=${finalDist.toFixed(2)})`);

} catch (err) {
  assert(false, `moveOnSurface test failed: ${err.message}`);
}

// ---------------------------------------------------------------------------
// Test 5: No NaN Values
// ---------------------------------------------------------------------------

console.log('\n[Test 5: No NaN Values]');
try {
  const loadedMesh = createTestMesh(8);
  const surface = new LoadedMeshSurface(loadedMesh);

  function hasNaN(vec) {
    return isNaN(vec.x) || isNaN(vec.y) || isNaN(vec.z);
  }

  let nanCount = 0;
  const testCount = 100;

  for (let i = 0; i < testCount; i++) {
    const u = Math.random();
    const v = Math.random();
    const point = surface.getPoint(u, v);

    if (hasNaN(point.position) || hasNaN(point.normal) || hasNaN(point.tangentU) || hasNaN(point.tangentV)) {
      nanCount++;
    }
  }

  assert(nanCount === 0, `No NaN values in ${testCount} random queries (${nanCount} NaNs found)`);

} catch (err) {
  assert(false, `NaN test failed: ${err.message}`);
}

// ---------------------------------------------------------------------------
// Test 6: UV Wrapping Behavior
// ---------------------------------------------------------------------------

console.log('\n[Test 6: UV Wrapping Behavior]');
try {
  const loadedMesh = createTestMesh(8);
  const surface = new LoadedMeshSurface(loadedMesh);

  // Test U wrapping
  const wrapped1 = surface.wrapUV(1.5, 0.5);
  assert(wrapped1.u >= 0 && wrapped1.u < 1, `U wraps to [0,1): u=${wrapped1.u}`);

  const wrapped2 = surface.wrapUV(-0.3, 0.5);
  assert(wrapped2.u >= 0 && wrapped2.u < 1, `Negative U wraps to [0,1): u=${wrapped2.u}`);

  // Test V clamping
  const clamped1 = surface.wrapUV(0.5, 1.5);
  assert(clamped1.v < 1, `V clamps below 1: v=${clamped1.v}`);

  const clamped2 = surface.wrapUV(0.5, -0.1);
  assert(clamped2.v > 0, `Negative V clamps above 0: v=${clamped2.v}`);

  assert(surface.wrapsU === true, 'Surface reports U as wrapping');
  assert(surface.wrapsV === false, 'Surface reports V as non-wrapping');

} catch (err) {
  assert(false, `UV wrapping test failed: ${err.message}`);
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

console.log('\n' + '='.repeat(60));
console.log(`SUMMARY: ${passed} passed, ${failed} failed`);
console.log('='.repeat(60));

process.exit(failed > 0 ? 1 : 0);

/**
 * Bullet Pole Investigation — Node.js test script
 *
 * Tests the geodesic bullet movement on a sphere surface near poles.
 * Runs independently of Vitest (which doesn't work in worktrees).
 *
 * Usage: node tests/bullet-pole-investigation.mjs
 */

// We need to use the compiled JS or transpile. Since this is ESM, we'll import from
// the transpiled files or use a simple manual simulation.

import * as THREE from 'three';

// ============================================================================
// MANUAL IMPLEMENTATION: recreate key math from the game's geodesic system
// to test without needing to build the TypeScript first.
// ============================================================================

const PRECISION = 1e-4;
const posKey = (x, y, z) => {
  const rx = Math.round(x / PRECISION) * PRECISION;
  const ry = Math.round(y / PRECISION) * PRECISION;
  const rz = Math.round(z / PRECISION) * PRECISION;
  return `${rx},${ry},${rz}`;
};

// Build a custom sphere (matching SphereSurface._buildSphereGeometry)
function buildCustomSphere(radius = 8, segments = 40, rings = 40) {
  const MIN_SIN_PHI = 0.01;
  const vertices = [];
  const normals = [];
  const indices = [];

  // Top apex
  vertices.push(0, radius, 0);
  normals.push(0, 1, 0);

  // Rings
  for (let j = 0; j <= rings; j++) {
    const phi = (j / rings) * Math.PI;
    const rawSinPhi = Math.sin(phi);
    const cosPhi = Math.cos(phi);
    const effectiveSinPhi = Math.abs(rawSinPhi) < MIN_SIN_PHI
      ? MIN_SIN_PHI * (rawSinPhi >= 0 ? 1 : -1)
      : rawSinPhi;

    for (let i = 0; i <= segments; i++) {
      const theta = (i / segments) * Math.PI * 2;
      const cosTheta = Math.cos(theta);
      const sinTheta = Math.sin(theta);
      vertices.push(
        radius * effectiveSinPhi * cosTheta,
        radius * cosPhi,
        radius * effectiveSinPhi * sinTheta,
      );
      const nx = effectiveSinPhi * cosTheta;
      const ny = cosPhi;
      const nz = effectiveSinPhi * sinTheta;
      const nLen = Math.sqrt(nx*nx + ny*ny + nz*nz);
      normals.push(nx/nLen, ny/nLen, nz/nLen);
    }
  }

  // Bottom apex
  vertices.push(0, -radius, 0);
  normals.push(0, -1, 0);

  const topApex = 0;
  const ringStart = (j) => 1 + j * (segments + 1);
  const bottomApex = 1 + (rings + 1) * (segments + 1);

  // Top fan
  for (let i = 0; i < segments; i++) {
    const a = ringStart(0) + i;
    const b = ringStart(0) + i + 1;
    indices.push(topApex, b, a);
  }

  // Quad strips
  for (let j = 0; j < rings; j++) {
    for (let i = 0; i < segments; i++) {
      const a = ringStart(j) + i;
      const b = a + 1;
      const c = ringStart(j + 1) + i;
      const d = c + 1;
      indices.push(a, b, c, b, d, c);
    }
  }

  // Bottom fan
  for (let i = 0; i < segments; i++) {
    const a = ringStart(rings) + i;
    const b = ringStart(rings) + i + 1;
    indices.push(a, b, bottomApex);
  }

  return { vertices, normals, indices, topApex, bottomApex };
}

// ============================================================================
// SIMPLE SIMULATION: test bullet trajectory on a sphere
// Using basic sphere geometry math (not the full geodesic system)
// ============================================================================

/**
 * Move a point on a sphere along a great circle.
 * A great circle is defined by the initial position and tangent direction.
 * @param pos - current position on sphere (radius = pos.length())
 * @param dir - current tangent direction (should be perpendicular to pos)
 * @param dist - distance to move
 * @returns {pos: new position, dir: new tangent direction}
 */
function moveOnSphere(pos, dir, dist) {
  const radius = pos.length();
  // On a sphere, a geodesic is a great circle.
  // Parameterized as: P(t) = cos(t/R) * P0 + sin(t/R) * R * dir
  // where t is arc length and dir is unit tangent at P0
  const R = radius;
  const t = dist;
  const cosT = Math.cos(t / R);
  const sinT = Math.sin(t / R);

  const newPos = new THREE.Vector3(
    cosT * pos.x + sinT * R * dir.x,
    cosT * pos.y + sinT * R * dir.y,
    cosT * pos.z + sinT * R * dir.z,
  );

  // New tangent: d/dt P(t) = -sin(t/R) * P0/R + cos(t/R) * dir
  const newDir = new THREE.Vector3(
    -Math.sin(t/R) * pos.x / R + cosT * dir.x,
    -Math.sin(t/R) * pos.y / R + cosT * dir.y,
    -Math.sin(t/R) * pos.z / R + cosT * dir.z,
  );
  newDir.normalize();

  return { pos: newPos, dir: newDir };
}

/**
 * Run a simulation: fire a bullet from position, direction, track it for N steps.
 * Compare with theoretical great circle path.
 */
function testBulletTrajectory(label, startPos, startDir, numSteps, dtPerStep, speed) {
  console.log(`\n--- ${label} ---`);
  console.log(`  Start: (${startPos.x.toFixed(3)}, ${startPos.y.toFixed(3)}, ${startPos.z.toFixed(3)})`);
  console.log(`  Dir:   (${startDir.x.toFixed(3)}, ${startDir.y.toFixed(3)}, ${startDir.z.toFixed(3)})`);

  const dist = speed * dtPerStep;
  let pos = startPos.clone();
  let dir = startDir.clone();
  let maxYDeviationFromExpected = 0;
  let maxAngleError = 0;

  // Theoretical: track position on great circle
  let tPos = startPos.clone();
  let tDir = startDir.clone();

  for (let i = 0; i < numSteps; i++) {
    // Simulate bullet (project move, then project back to sphere)
    // This is what the game does: world-space step + BVH projection
    const newPos = new THREE.Vector3(
      pos.x + dir.x * dist,
      pos.y + dir.y * dist,
      pos.z + dir.z * dist,
    );

    // Project back onto sphere
    const radius = startPos.length();
    newPos.normalize().multiplyScalar(radius);

    // Update direction: project onto tangent plane at new position
    const normal = newPos.clone().normalize();
    const dot = dir.dot(normal);
    dir.addScaledVector(normal, -dot);
    dir.normalize();

    pos = newPos;

    // Theoretical great circle
    const tResult = moveOnSphere(tPos, tDir, dist);
    tPos = tResult.pos;
    tDir = tResult.dir;

    // Compare
    const posError = pos.distanceTo(tPos);
    const angleError = Math.acos(Math.min(1, Math.max(-1, dir.dot(tDir)))) * 180 / Math.PI;
    if (angleError > maxAngleError) maxAngleError = angleError;
  }

  console.log(`  After ${numSteps} steps:`);
  console.log(`  Final pos: (${pos.x.toFixed(3)}, ${pos.y.toFixed(3)}, ${pos.z.toFixed(3)})`);
  console.log(`  Final dir: (${dir.x.toFixed(3)}, ${dir.y.toFixed(3)}, ${dir.z.toFixed(3)})`);
  console.log(`  Max angle error vs theoretical: ${maxAngleError.toFixed(3)}°`);
  console.log(`  Y component of direction: ${dir.y.toFixed(6)} (should be near 0 for equatorial motion)`);

  if (maxAngleError > 5) {
    console.log(`  ⚠️  LARGE ANGLE ERROR - bullets may be curving`);
  } else {
    console.log(`  ✓  Trajectory looks correct`);
  }

  return { pos, dir, maxAngleError };
}

// ============================================================================
// MAIN TESTS
// ============================================================================

console.log('=== Bullet Pole Investigation ===\n');
console.log('Testing theoretical bullet behavior on sphere (analytical simulation)');
console.log('This tests if the MATH is correct, not the implementation.');

const RADIUS = 8;
const SPEED = 4.0;
const DT = 1 / 60;
const STEPS = 200; // ~3.3 seconds of movement

// Test 1: Equatorial shot (player at equator, shooting eastward)
// Should stay on equator (y ≈ 0)
{
  const startPos = new THREE.Vector3(RADIUS, 0, 0); // On equator at +X
  const startDir = new THREE.Vector3(0, 0, 1);  // Shooting toward +Z (along equator)
  startDir.sub(startPos.clone().normalize().multiplyScalar(startDir.dot(startPos.clone().normalize())));
  startDir.normalize();
  testBulletTrajectory(
    'Equatorial shot (should stay on equator)',
    startPos, startDir, STEPS, DT, SPEED
  );
}

// Test 2: Northward shot (player at equator, shooting toward north pole)
// Should reach north pole and continue on the other side
{
  const startPos = new THREE.Vector3(RADIUS, 0, 0); // On equator at +X
  const startDir = new THREE.Vector3(0, 1, 0); // Shooting "north" (toward +Y)
  startDir.sub(startPos.clone().normalize().multiplyScalar(startDir.dot(startPos.clone().normalize())));
  startDir.normalize();
  const result = testBulletTrajectory(
    'Northward shot from equator (should cross north pole)',
    startPos, startDir, STEPS, DT, SPEED
  );

  // Check if bullet crossed the north pole
  const totalDist = SPEED * DT * STEPS;
  const expectedArc = totalDist / RADIUS; // radians
  console.log(`  Expected to travel ${totalDist.toFixed(2)} units = ${(expectedArc * 180 / Math.PI).toFixed(1)}°`);
  if (expectedArc > Math.PI / 2) {
    console.log('  Should have crossed north pole');
    const expectedFinalY = RADIUS * Math.cos(expectedArc);
    console.log(`  Expected final Y: ${expectedFinalY.toFixed(3)}, actual: ${result.pos.y.toFixed(3)}`);
  }
}

// Test 3: Near-pole shot (player near north pole, shooting "forward")
{
  const PHI = 0.1; // Near north pole (phi = angle from north pole)
  const THETA = 0;
  const startPos = new THREE.Vector3(
    RADIUS * Math.sin(PHI) * Math.cos(THETA),
    RADIUS * Math.cos(PHI),
    RADIUS * Math.sin(PHI) * Math.sin(THETA),
  );
  // Shoot "south" in XZ plane
  const startDir = new THREE.Vector3(0, -1, 0.2);
  startDir.sub(startPos.clone().normalize().multiplyScalar(startDir.dot(startPos.clone().normalize())));
  startDir.normalize();
  testBulletTrajectory(
    'Near-north-pole shot (near pole behavior)',
    startPos, startDir, STEPS, DT, SPEED
  );
}

// ============================================================================
// TEST 4: Check if the game's simple sphere projection (BVH fallback) is correct
// ============================================================================

console.log('\n\n=== Testing if projection-based movement produces correct geodesics ===');
console.log('(This is what happens when there is no geodesic face position)');

function testProjectionMovement(startPos, startDir, steps, dt, speed) {
  const dist = speed * dt;
  const radius = startPos.length();
  let pos = startPos.clone();
  let dir = startDir.clone();

  // Project direction to be tangent to sphere
  const n0 = pos.clone().normalize();
  dir.sub(n0.multiplyScalar(dir.dot(n0)));
  dir.normalize();

  for (let i = 0; i < steps; i++) {
    // World-space step
    const newPos = new THREE.Vector3(
      pos.x + dir.x * dist,
      pos.y + dir.y * dist,
      pos.z + dir.z * dist,
    );

    // Project back to sphere surface
    newPos.normalize().multiplyScalar(radius);

    // Update direction: remove normal component
    const n = newPos.clone().normalize();
    const dotN = dir.dot(n);
    dir.sub(n.multiplyScalar(dotN));
    dir.normalize();

    pos = newPos;
  }

  return { pos, dir };
}

// Check: does projection movement keep the bullet on a great circle?
{
  const startPos = new THREE.Vector3(RADIUS, 0, 0);
  const startDir = new THREE.Vector3(0, 0, 1);
  // Project to be tangent
  const n = startPos.clone().normalize();
  startDir.sub(n.multiplyScalar(startDir.dot(n)));
  startDir.normalize();

  const result = testProjectionMovement(startPos, startDir, STEPS, DT, SPEED);
  const tResult = moveOnSphere(startPos, startDir, SPEED * DT * STEPS);

  console.log('\nProjection movement vs theoretical for equatorial shot:');
  console.log(`  Projection final: (${result.pos.x.toFixed(3)}, ${result.pos.y.toFixed(3)}, ${result.pos.z.toFixed(3)})`);
  console.log(`  Theoretical final: (${tResult.pos.x.toFixed(3)}, ${tResult.pos.y.toFixed(3)}, ${tResult.pos.z.toFixed(3)})`);
  const posError = result.pos.distanceTo(tResult.pos);
  console.log(`  Position error: ${posError.toFixed(4)}`);
}

// Now test with northward shot (should cross pole)
{
  const startPos = new THREE.Vector3(RADIUS, 0, 0);
  const rawDir = new THREE.Vector3(0, 1, 0.1);
  const n = startPos.clone().normalize();
  rawDir.sub(n.multiplyScalar(rawDir.dot(n)));
  rawDir.normalize();

  const result = testProjectionMovement(startPos, rawDir, STEPS, DT, SPEED);
  const tResult = moveOnSphere(startPos, rawDir, SPEED * DT * STEPS);

  console.log('\nProjection movement vs theoretical for northward shot:');
  console.log(`  Projection final: (${result.pos.x.toFixed(3)}, ${result.pos.y.toFixed(3)}, ${result.pos.z.toFixed(3)})`);
  console.log(`  Theoretical final: (${tResult.pos.x.toFixed(3)}, ${tResult.pos.y.toFixed(3)}, ${tResult.pos.z.toFixed(3)})`);
  const posError = result.pos.distanceTo(tResult.pos);
  console.log(`  Position error: ${posError.toFixed(4)}`);
  const totalDist = SPEED * DT * STEPS;
  console.log(`  Expected to travel ${(totalDist / RADIUS * 180 / Math.PI).toFixed(1)}°`);
}

console.log('\n=== Investigation Complete ===');
console.log('\nConclusion:');
console.log('The analytical simulation above shows what the CORRECT bullet behavior should be.');
console.log('If the in-game bullets behave differently, the geodesic walker has a bug.');
console.log('\nKey metrics to check in the actual game:');
console.log('1. Equatorial shot should NOT change Y direction (should stay at Y≈0)');
console.log('2. Northward shot should cross the north pole and continue south');
console.log('3. Near-pole shots should not curve excessively');

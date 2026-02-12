/**
 * Cube Geometry Regression Tests (Session 13)
 *
 * These tests establish a baseline for known cube geometry issues:
 * - U-wrap boundary teleportation
 * - V-boundary NaN coordinates
 * - Non-linear UV paths on flat faces
 * - Discontinuities at flat→bevel transitions
 * - Round-trip inversion failures
 * - Corner handling issues
 * - Diagonal movement artifacts
 *
 * BASELINE EXPECTATION: All tests should FAIL with current implementation.
 * After Phase 2 fixes, these tests should PASS.
 */

import { describe, it, expect } from 'vitest'
import { SurfaceFactory } from '../surfaces/SurfaceFactory'
import * as THREE from 'three'

describe('Cube Geometry (Session 13)', () => {

  // Test 1: U-wrap continuity
  // BEFORE FIX: Expected to detect teleportation at u=0 boundary
  it('should not teleport when crossing u=0 wrap seam', () => {
    const cube = SurfaceFactory.create('cube')
    const v = 0.5 // middle belt region

    // Walk from u=0.98 to u=0.02 in small steps
    const positions: THREE.Vector3[] = []
    for (let u = 0.98; u <= 1.02; u += 0.005) {
      const uWrapped = ((u % 1) + 1) % 1
      const point = cube.getPoint(uWrapped, v)
      positions.push(point.position.clone())
    }

    // Check no position jump >0.5 units between consecutive steps
    let maxJump = 0
    let jumpLocation = ''
    for (let i = 1; i < positions.length; i++) {
      const dist = positions[i].distanceTo(positions[i - 1])
      if (dist > maxJump) {
        maxJump = dist
        const u = 0.98 + i * 0.005
        jumpLocation = `u=${u.toFixed(3)}`
      }
      expect(dist).toBeLessThan(0.5) // BEFORE FIX: fails with teleport
    }

    // If test fails, log diagnostic info
    if (maxJump >= 0.5) {
      console.error(`Test 1 FAILED: Max position jump was ${maxJump.toFixed(3)} units at ${jumpLocation}`)
    }
  })

  // Test 2: V-boundary behavior
  // BEFORE FIX: Expected to produce NaN at extreme v values
  it('should not produce NaN at v boundaries', () => {
    const cube = SurfaceFactory.create('cube')

    // Test near v=0 (bottom face)
    const nearBottomPoints = [
      cube.getPoint(0.0, 0.001),
      cube.getPoint(0.25, 0.001),
      cube.getPoint(0.5, 0.001),
      cube.getPoint(0.75, 0.001),
    ]

    for (const point of nearBottomPoints) {
      expect(point.position.x).not.toBeNaN()
      expect(point.position.y).not.toBeNaN()
      expect(point.position.z).not.toBeNaN()
      expect(point.normal.x).not.toBeNaN()
      expect(point.normal.y).not.toBeNaN()
      expect(point.normal.z).not.toBeNaN()
    }

    // Test near v=1 (top face)
    const nearTopPoints = [
      cube.getPoint(0.0, 0.999),
      cube.getPoint(0.25, 0.999),
      cube.getPoint(0.5, 0.999),
      cube.getPoint(0.75, 0.999),
    ]

    for (const point of nearTopPoints) {
      expect(point.position.x).not.toBeNaN()
      expect(point.position.y).not.toBeNaN()
      expect(point.position.z).not.toBeNaN()
      expect(point.normal.x).not.toBeNaN()
      expect(point.normal.y).not.toBeNaN()
      expect(point.normal.z).not.toBeNaN()
    }
  })

  // Test 3: Straight UV paths produce straight world paths on flat faces
  // BEFORE FIX: Radial parameterization causes curved paths on flat faces
  it('should produce straight world paths for straight UV paths on flat faces', () => {
    const cube = SurfaceFactory.create('cube')
    const v = 0.05 // bottom flat face

    // Sample a horizontal UV line
    const positions: THREE.Vector3[] = []
    for (let u = 0.1; u <= 0.2; u += 0.01) {
      positions.push(cube.getPoint(u, v).position.clone())
    }

    // Check that positions form approximately a straight line
    // Use cross product to measure deviation from straight line
    let maxDeviation = 0
    for (let i = 1; i < positions.length - 1; i++) {
      const v1 = new THREE.Vector3().subVectors(positions[i], positions[0])
      const v2 = new THREE.Vector3().subVectors(positions[i + 1], positions[0])
      const cross = new THREE.Vector3().crossVectors(v1, v2)
      const deviation = cross.length() / v2.length()
      maxDeviation = Math.max(maxDeviation, deviation)
    }

    // For a perfectly straight line, cross product should be near zero
    // Allow small tolerance for numerical precision
    expect(maxDeviation).toBeLessThan(0.1) // BEFORE FIX: deviation is high due to radial parameterization

    if (maxDeviation >= 0.1) {
      console.error(`Test 3 FAILED: Max path deviation was ${maxDeviation.toFixed(4)} (radial parameterization)`)
    }
  })

  // Test 4: Edge continuity (flat→bevel transition)
  // BEFORE FIX: Position/normal discontinuity at transition boundaries
  it('should have smooth position and normal at flat→bevel edge', () => {
    const cube = SurfaceFactory.create('cube')
    const u = 0.125 // middle of a flat face

    // The transition happens around v values determined by flatFraction
    // Sample across the expected transition region
    const samples = 20
    const positions: THREE.Vector3[] = []
    const normals: THREE.Vector3[] = []

    for (let i = 0; i < samples; i++) {
      const v = 0.15 + (i / samples) * 0.1 // Sample across likely transition zone
      const point = cube.getPoint(u, v)
      positions.push(point.position.clone())
      normals.push(point.normal.clone())
    }

    // Check for position jumps
    let maxPosJump = 0
    for (let i = 1; i < positions.length; i++) {
      const dist = positions[i].distanceTo(positions[i - 1])
      maxPosJump = Math.max(maxPosJump, dist)
    }

    // Check for normal jumps (angle change)
    let maxNormalAngle = 0
    for (let i = 1; i < normals.length; i++) {
      const angle = Math.acos(Math.max(-1, Math.min(1, normals[i].dot(normals[i - 1]))))
      maxNormalAngle = Math.max(maxNormalAngle, angle)
    }

    expect(maxPosJump).toBeLessThan(0.5) // BEFORE FIX: position discontinuity
    expect(maxNormalAngle).toBeLessThan(Math.PI / 4) // BEFORE FIX: normal flip

    if (maxPosJump >= 0.5 || maxNormalAngle >= Math.PI / 4) {
      console.error(`Test 4 FAILED: maxPosJump=${maxPosJump.toFixed(3)}, maxNormalAngle=${(maxNormalAngle * 180 / Math.PI).toFixed(1)}°`)
    }
  })

  // Test 5: Round-trip inversion
  // BEFORE FIX: worldToSurface(getPoint(u,v)) does not return original (u,v)
  it('should satisfy round-trip: worldToSurface(getPoint(u,v)) ≈ (u,v)', () => {
    const cube = SurfaceFactory.create('cube')

    // Test various regions
    const testCases = [
      { u: 0.125, v: 0.05, label: 'bottom flat face' },
      { u: 0.125, v: 0.2, label: 'bottom bevel' },
      { u: 0.125, v: 0.5, label: 'middle belt' },
      { u: 0.125, v: 0.8, label: 'top bevel' },
      { u: 0.125, v: 0.95, label: 'top flat face' },
      { u: 0.0, v: 0.5, label: 'u=0 seam' },
      { u: 0.25, v: 0.5, label: 'corner region' },
    ]

    const failures: string[] = []

    for (const tc of testCases) {
      const point = cube.getPoint(tc.u, tc.v)
      const recovered = cube.worldToSurface(point.position)

      // Handle u-wrap: 0 and 1 are equivalent
      let uError = Math.abs(recovered.u - tc.u)
      if (uError > 0.5) {
        uError = Math.min(uError, 1 - uError)
      }

      const vError = Math.abs(recovered.v - tc.v)
      const maxError = Math.max(uError, vError)

      if (maxError >= 0.01) {
        failures.push(`${tc.label}: (${tc.u}, ${tc.v}) → (${recovered.u.toFixed(3)}, ${recovered.v.toFixed(3)}) [error=${maxError.toFixed(4)}]`)
      }

      expect(maxError).toBeLessThan(0.01) // BEFORE FIX: many-to-one mapping
    }

    if (failures.length > 0) {
      console.error(`Test 5 FAILED: Round-trip errors:\n${failures.join('\n')}`)
    }
  })

  // Test 6: Corner handling
  // BEFORE FIX: NaN or undefined at degenerate corner points
  it('should produce valid point at corner (u=0, v=0)', () => {
    const cube = SurfaceFactory.create('cube')

    const cornerPoints = [
      { u: 0.0, v: 0.0, label: 'bottom corner 0' },
      { u: 0.25, v: 0.0, label: 'bottom corner 1' },
      { u: 0.5, v: 0.0, label: 'bottom corner 2' },
      { u: 0.75, v: 0.0, label: 'bottom corner 3' },
      { u: 0.0, v: 1.0, label: 'top corner 0' },
      { u: 0.25, v: 1.0, label: 'top corner 1' },
      { u: 0.5, v: 1.0, label: 'top corner 2' },
      { u: 0.75, v: 1.0, label: 'top corner 3' },
    ]

    for (const cp of cornerPoints) {
      const point = cube.getPoint(cp.u, cp.v)

      expect(point.position.x).not.toBeNaN()
      expect(point.position.y).not.toBeNaN()
      expect(point.position.z).not.toBeNaN()
      expect(point.normal.x).not.toBeNaN()
      expect(point.normal.y).not.toBeNaN()
      expect(point.normal.z).not.toBeNaN()
      expect(point.normal.length()).toBeGreaterThan(0.9) // Should be unit length

      if (isNaN(point.position.x) || isNaN(point.position.y) || isNaN(point.position.z)) {
        console.error(`Test 6 FAILED: ${cp.label} produced NaN position`)
      }
    }
  })

  // Test 7: Diagonal movement across face
  // BEFORE FIX: Position jumps during diagonal UV traversal
  it('should not jump during diagonal movement across face', () => {
    const cube = SurfaceFactory.create('cube')

    // Diagonal path across middle belt from (0.1, 0.4) to (0.2, 0.6)
    const positions: THREE.Vector3[] = []
    const steps = 20

    for (let i = 0; i <= steps; i++) {
      const t = i / steps
      const u = 0.1 + t * 0.1
      const v = 0.4 + t * 0.2
      positions.push(cube.getPoint(u, v).position.clone())
    }

    // Check for position jumps
    let maxJump = 0
    let jumpIndex = -1
    for (let i = 1; i < positions.length; i++) {
      const dist = positions[i].distanceTo(positions[i - 1])
      if (dist > maxJump) {
        maxJump = dist
        jumpIndex = i
      }
    }

    expect(maxJump).toBeLessThan(0.3) // BEFORE FIX: position jumps during diagonal movement

    if (maxJump >= 0.3) {
      const t = jumpIndex / steps
      const u = 0.1 + t * 0.1
      const v = 0.4 + t * 0.2
      console.error(`Test 7 FAILED: Max jump was ${maxJump.toFixed(3)} at step ${jumpIndex} (u=${u.toFixed(3)}, v=${v.toFixed(3)})`)
    }
  })

  // Additional comprehensive test: moveOnSurface consistency
  // BEFORE FIX: moveOnSurface may produce inconsistent results
  it('moveOnSurface should produce consistent UV deltas', () => {
    const cube = SurfaceFactory.create('cube')

    // Test moveOnSurface at various locations
    const testLocations = [
      { u: 0.125, v: 0.5, du: 0.01, dv: 0.0, label: 'horizontal on face' },
      { u: 0.125, v: 0.5, du: 0.0, dv: 0.01, label: 'vertical on face' },
      { u: 0.0, v: 0.5, du: 0.01, dv: 0.0, label: 'horizontal at u=0' },
      { u: 0.99, v: 0.5, du: 0.02, dv: 0.0, label: 'cross u=0 boundary' },
    ]

    for (const loc of testLocations) {
      const result = cube.moveOnSurface(loc.u, loc.v, loc.du, loc.dv)

      // Result should be valid
      expect(result.u).not.toBeNaN()
      expect(result.v).not.toBeNaN()
      expect(result.u).toBeGreaterThanOrEqual(0)
      expect(result.u).toBeLessThan(1)
      expect(result.v).toBeGreaterThan(0)
      expect(result.v).toBeLessThan(1)

      // Check that movement direction makes sense
      if (loc.du !== 0) {
        // Horizontal movement should change u
        let uChanged = Math.abs(result.u - loc.u) > 0.0001
        // Handle wrap case
        if (!uChanged) {
          const wrappedDiff = Math.min(
            Math.abs(result.u - loc.u),
            Math.abs(result.u - loc.u + 1),
            Math.abs(result.u - loc.u - 1)
          )
          uChanged = wrappedDiff > 0.0001
        }
        expect(uChanged).toBe(true)
      }

      if (loc.dv !== 0) {
        // Vertical movement should change v
        expect(Math.abs(result.v - loc.v)).toBeGreaterThan(0.0001)
      }
    }
  })

  // Test: UV space coverage
  // Ensures that the surface parameterization covers the full [0,1]×[0,1] domain
  it('should cover full UV domain without large gaps', () => {
    const cube = SurfaceFactory.create('cube')

    // Sample grid across UV space
    const resolution = 10
    const points: Array<{ u: number; v: number; pos: THREE.Vector3 }> = []

    for (let j = 0; j <= resolution; j++) {
      for (let i = 0; i <= resolution; i++) {
        const u = i / resolution
        const v = j / resolution
        const point = cube.getPoint(u, v)
        points.push({ u, v, pos: point.position.clone() })
      }
    }

    // Check that all points are valid (no NaN)
    for (const pt of points) {
      expect(pt.pos.x).not.toBeNaN()
      expect(pt.pos.y).not.toBeNaN()
      expect(pt.pos.z).not.toBeNaN()
    }

    // Check that adjacent points are not too far apart (no large gaps)
    const stride = resolution + 1
    let maxGapU = 0
    let maxGapV = 0

    for (let j = 0; j < resolution; j++) {
      for (let i = 0; i < resolution; i++) {
        const idx = j * stride + i
        const rightIdx = idx + 1
        const downIdx = idx + stride

        const dist1 = points[idx].pos.distanceTo(points[rightIdx].pos)
        const dist2 = points[idx].pos.distanceTo(points[downIdx].pos)

        maxGapU = Math.max(maxGapU, dist1)
        maxGapV = Math.max(maxGapV, dist2)
      }
    }

    // Gaps should be reasonable for a cube of default size (~18 units)
    expect(maxGapU).toBeLessThan(5.0)
    expect(maxGapV).toBeLessThan(5.0)

    if (maxGapU >= 5.0 || maxGapV >= 5.0) {
      console.error(`UV coverage test: maxGapU=${maxGapU.toFixed(2)}, maxGapV=${maxGapV.toFixed(2)}`)
    }
  })
})

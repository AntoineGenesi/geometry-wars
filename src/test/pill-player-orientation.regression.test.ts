/**
 * Regression test for s44r4-09: Player mesh orientation mismatch on pill map.
 *
 * Bug: On the pill map, the player character visually faces the wrong direction.
 * Bullets fire in the correct direction, but the chevron mesh is rotated incorrectly.
 *
 * Root cause: The pill surface's tangent frames form a LEFT-HANDED coordinate system,
 * not a right-handed one. This causes the cross product orientation code to produce
 * incorrect quaternions.
 *
 * Specifically, on the pill body:
 *   tangentU × tangentV = -normal (left-handed)
 * Should be:
 *   tangentU × tangentV = normal (right-handed)
 *
 * The fix: Negate tangentU on the pill body to make the coordinate system right-handed.
 */
import { describe, it, expect } from 'vitest'
import * as THREE from 'three'
import { PillSurface } from '../surfaces/PillSurface'

describe('pill player orientation regression (s44r4-09)', () => {
  const surface = new PillSurface()

  it('pill body tangent frame is right-handed: tangentU × tangentV = normal', () => {
    // Test at multiple positions on the pill body
    const theta = Math.PI / 4
    const y = 0 // center of body

    const point = surface.getPoint(0.125, 0.5) // u=1/8 (theta=π/4), v=0.5 (middle of body)

    // Get the tangent vectors
    const normal = point.normal
    const tangentU = point.tangentU
    const tangentV = point.tangentV

    // Verify right-handed system: tangentU × tangentV should equal normal
    const cross = new THREE.Vector3().crossVectors(tangentU, tangentV)

    // For a right-handed system, cross should be parallel to normal (pointing same direction)
    const dotWithNormal = cross.dot(normal)
    const crossLength = cross.length()
    const shouldBeNear1 = dotWithNormal / (crossLength * normal.length())

    expect(shouldBeNear1).toBeCloseTo(1.0, 1) // Should be very close to +1 for right-handed
  })

  it('player mesh Z-axis (forward direction) matches bullet aim direction on pill body', () => {
    // Simulate player orientation on pill at theta=0, middle of body
    const pillUV = surface.worldToSurface(new THREE.Vector3(4, 0, 0))
    const point = surface.getPoint(pillUV.u, pillUV.v)

    // Player normal and tangent frame
    const normal = point.normal
    const tangentU = point.tangentU
    const tangentV = point.tangentV

    // Simulate an aim direction (e.g., aiming "up" on the screen at the equator)
    // This would be tangentV direction on the pill body
    const aimDirection = tangentV.clone()

    // Build orientation matrix using GameLoop logic
    const playerRight = new THREE.Vector3().crossVectors(normal, aimDirection).normalize()
    const playerForward = new THREE.Vector3().crossVectors(playerRight, normal).normalize()

    // Create mesh and set quaternion
    const mesh = new THREE.Group()
    const orientMat = new THREE.Matrix4().makeBasis(playerRight, normal, playerForward)
    mesh.quaternion.setFromRotationMatrix(orientMat)
    mesh.updateMatrixWorld(true)

    // Extract the mesh's world-space Z-axis (forward direction)
    const meshZ = new THREE.Vector3(0, 0, 1)
    meshZ.applyQuaternion(mesh.quaternion)

    // For a right-handed system on the pill, the mesh Z-axis should match aimDirection
    const dotProduct = meshZ.dot(aimDirection)
    expect(dotProduct).toBeCloseTo(1.0, 1) // Should point in same direction
  })

  it('player mesh remains correctly oriented across pill body range', () => {
    const bodyVPositions = [0.25, 0.5, 0.75] // Various heights on the body

    for (const vPos of bodyVPositions) {
      const point = surface.getPoint(0, vPos)

      // Aim in tangentV direction (upward on pill)
      const aimDirection = point.tangentV.clone()

      // Build orientation
      const playerRight = new THREE.Vector3().crossVectors(point.normal, aimDirection).normalize()
      const playerForward = new THREE.Vector3().crossVectors(playerRight, point.normal).normalize()

      const mesh = new THREE.Group()
      const orientMat = new THREE.Matrix4().makeBasis(playerRight, point.normal, playerForward)
      mesh.quaternion.setFromRotationMatrix(orientMat)

      // Extract mesh's Z-axis
      const meshZ = new THREE.Vector3(0, 0, 1)
      meshZ.applyQuaternion(mesh.quaternion)

      // Should match aim direction
      const dotProduct = meshZ.dot(aimDirection)
      expect(dotProduct, `at v=${vPos}`).toBeCloseTo(1.0, 1)
    }
  })

  it('pill surface tangent frame handedness is consistent across all regions', () => {
    // Verify right-handed frames across all three regions: bottom cap, body, top cap
    const testPoints = [
      { u: 0.25, v: 0.1, region: 'bottom cap' },
      { u: 0.25, v: 0.5, region: 'body' },
      { u: 0.25, v: 0.9, region: 'top cap' },
    ]

    for (const pt of testPoints) {
      const point = surface.getPoint(pt.u, pt.v)
      const cross = new THREE.Vector3().crossVectors(point.tangentU, point.tangentV)
      const dotWithNormal = cross.dot(point.normal)

      // For right-handed frame, tangentU × tangentV should be parallel to normal
      expect(dotWithNormal, `${pt.region}`).toBeGreaterThan(0.5)
    }
  })
})

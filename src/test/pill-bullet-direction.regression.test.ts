/**
 * Regression test for s44r-07: Pill map bullet direction inverted on cylindrical surface.
 *
 * Root cause: In MP (network-main.ts), aimAngle is computed using sphere-approx UV
 * (_aimPlayer.surfaceU/V from server _worldPosToApproxUV) instead of accurate pill UV
 * from surface.worldToSurface(). At top/bottom 38% of pill body, sphere_v falls into
 * cap region giving wrong tangentV → wrong aimAngle → bullets fire in wrong direction.
 *
 * Fix: use surface.worldToSurface(mesh.position) for pill, same as torus fix (s44l-16).
 * Applied at src/network-main.ts lines ~5150-5152 and ~3681-3683.
 *
 * Why no direct unit test: The fix is in network-main.ts which requires a full LAN MP
 * session to test end-to-end. These tests document the root cause and verify that
 * worldToSurface gives correct tangent frames for the fix approach.
 */
import { describe, it, expect } from 'vitest'
import * as THREE from 'three'
import { PillSurface } from '../surfaces/PillSurface'
import { computeCameraRelativeAimAngle } from '../utils/aimAngle'

describe('pill bullet direction regression (s44r-07)', () => {
  const surface = new PillSurface()
  const radius = 4
  const halfHeight = 8
  const height = 16
  const capArc = (Math.PI / 2) * radius
  const totalVLength = height + 2 * capArc
  const capFrac = capArc / totalVLength

  // Server's sphere-approx UV (_worldPosToApproxUV fallback for non-torus surfaces)
  function sphereApproxUV(wx: number, wy: number, wz: number): { u: number; v: number } {
    const r = Math.sqrt(wx * wx + wy * wy + wz * wz)
    if (r < 0.001) return { u: 0.5, v: 0.5 }
    const v = Math.acos(Math.max(-1, Math.min(1, wy / r))) / Math.PI
    const u = ((Math.atan2(wz, wx) / (2 * Math.PI)) + 1) % 1
    return { u, v }
  }

  it('(root cause) sphere-approx UV for top-of-body position maps to cap region — tangentV becomes wrong', () => {
    // Player at top of pill body (theta=0, y=halfHeight)
    const theta = 0
    const worldPos = new THREE.Vector3(radius * Math.cos(theta), halfHeight, radius * Math.sin(theta))

    const sphereUV = sphereApproxUV(worldPos.x, worldPos.y, worldPos.z)

    // sphere_v ≈ 0.148 < capFrac ≈ 0.22 → maps to BOTTOM CAP in getPoint()
    // This is the bug: top-of-body maps to the bottom cap in sphere-approx
    expect(sphereUV.v).toBeLessThan(capFrac)

    // getPoint with wrong UV gives tangentV in cap region (not the correct (0,1,0))
    const sp = surface.getPoint(sphereUV.u, sphereUV.v)
    // tangentV.y < 1 because cap tangentV has horizontal components
    expect(sp.tangentV.y).toBeLessThan(0.99)
  })

  it('(correct approach) worldToSurface for top-of-body position gives body region UV → tangentV=(0,1,0)', () => {
    // Player at top of pill body (theta=0, y=halfHeight)
    const theta = 0
    const worldPos = new THREE.Vector3(radius * Math.cos(theta), halfHeight, radius * Math.sin(theta))

    const pillUV = surface.worldToSurface(worldPos)

    // pill UV maps correctly to body region
    expect(pillUV.v).toBeGreaterThanOrEqual(capFrac)
    expect(pillUV.v).toBeLessThanOrEqual(1 - capFrac)

    const sp = surface.getPoint(pillUV.u, pillUV.v)
    // Body tangentV = (0,1,0) — vertical along cylinder
    expect(sp.tangentV.y).toBeGreaterThan(0.99)
    expect(Math.abs(sp.tangentV.x)).toBeLessThan(0.1)
    expect(Math.abs(sp.tangentV.z)).toBeLessThan(0.1)
  })

  it('(fix verifies) worldToSurface + getPoint produces correct aimAngle for combined aim at top of body', () => {
    // Player at theta=PI/4, y=halfHeight (top of body, at 45° around cylinder)
    const theta = Math.PI / 4
    const worldPos = new THREE.Vector3(radius * Math.cos(theta), halfHeight, radius * Math.sin(theta))

    // Camera: outside cylinder looking at player, up = (0,1,0)
    // At theta=PI/4, normal=(0.707,0,0.707), camera right = (0.707,0,-0.707), up = (0,1,0)
    const normal = new THREE.Vector3(Math.cos(theta), 0, Math.sin(theta))
    const camRight = new THREE.Vector3(Math.sin(theta), 0, -Math.cos(theta)) // camera right at this theta
    const camUp = new THREE.Vector3(0, 1, 0)

    // Aim: 45° diagonal (right and up on screen)
    const mouseX = 1 / Math.SQRT2
    const mouseY = -1 / Math.SQRT2 // negative = up

    // Using worldToSurface for accurate pill UV
    const pillUV = surface.worldToSurface(worldPos)
    const sp = surface.getPoint(pillUV.u, pillUV.v)
    const aimAngle = computeCameraRelativeAimAngle(mouseX, mouseY, camRight, camUp, normal, sp.tangentU, sp.tangentV)

    // Reconstruct bullet world direction from aimAngle + correct tangent frame
    const bulletDir = sp.tangentU.clone()
      .multiplyScalar(Math.cos(aimAngle))
      .addScaledVector(sp.tangentV, Math.sin(aimAngle))
      .normalize()

    // Compute expected aim direction (camera axes projected onto surface plane)
    const aimDirExpected = camRight.clone()
      .multiplyScalar(mouseX)
      .addScaledVector(camUp, -mouseY)
    aimDirExpected.addScaledVector(normal, -aimDirExpected.dot(normal))
    aimDirExpected.normalize()

    // Bullet direction should match aim direction within 5°
    const dotProduct = bulletDir.dot(aimDirExpected)
    expect(dotProduct).toBeGreaterThan(Math.cos(5 * Math.PI / 180)) // within 5°
  })

  it('(fix verifies) worldToSurface gives correct tangentV across entire pill body range', () => {
    // Test multiple positions along the pill body at theta=0
    const theta = 0
    const yPositions = [-7, -4, 0, 4, 7] // body spans [-halfHeight, halfHeight] = [-8, 8]

    for (const y of yPositions) {
      const worldPos = new THREE.Vector3(radius * Math.cos(theta), y, radius * Math.sin(theta))
      const pillUV = surface.worldToSurface(worldPos)
      const sp = surface.getPoint(pillUV.u, pillUV.v)

      // On the body, tangentV should always be (0,1,0)
      expect(sp.tangentV.y).toBeGreaterThan(0.99) // `y=${y}`
      expect(Math.abs(sp.tangentV.x)).toBeLessThan(0.1) // `y=${y}`
      expect(Math.abs(sp.tangentV.z)).toBeLessThan(0.1) // `y=${y}`
    }
  })
})

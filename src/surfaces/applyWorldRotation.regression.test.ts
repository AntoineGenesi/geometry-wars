/**
 * Regression tests for s44r-04-04: applyWorldRotation missing in 4 surfaces.
 *
 * Without the fix: getPoint() returns local-space positions — worldRotation is ignored.
 * With the fix: getPoint() returns world-space positions — rotating worldRotation changes output.
 *
 * Test: apply a 90-degree rotation to worldRotation, then verify getPoint() returns
 * a different position. If worldRotation was ignored, posA === posB (test fails without fix).
 */
import { describe, it, expect } from 'vitest'
import * as THREE from 'three'
import { CapsuleSurface } from './CapsuleSurface'
import { CubeRingSurface } from './CubeRingSurface'
import { PipeSurface } from './PipeSurface'
import { SphereWithTunnelSurface } from './SphereWithTunnelSurface'

describe('applyWorldRotation regression (s44r-04-04)', () => {
  it('CapsuleSurface.getPoint() respects worldRotation', () => {
    const surf = new CapsuleSurface()
    const posA = surf.getPoint(0.5, 0.5).position.clone()
    // Apply a 90-degree rotation around Y axis
    surf.worldRotation.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2)
    const posB = surf.getPoint(0.5, 0.5).position.clone()
    // With the fix: positions differ after rotation. Without fix: posA === posB.
    expect(posA.distanceTo(posB)).toBeGreaterThan(0.01)
  })

  it('CubeRingSurface.getPoint() respects worldRotation', () => {
    const surf = new CubeRingSurface()
    const posA = surf.getPoint(0.5, 0.1).position.clone()
    surf.worldRotation.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2)
    const posB = surf.getPoint(0.5, 0.1).position.clone()
    expect(posA.distanceTo(posB)).toBeGreaterThan(0.01)
  })

  it('PipeSurface.getPoint() respects worldRotation', () => {
    const surf = new PipeSurface()
    const posA = surf.getPoint(0.5, 0.5).position.clone()
    surf.worldRotation.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2)
    const posB = surf.getPoint(0.5, 0.5).position.clone()
    expect(posA.distanceTo(posB)).toBeGreaterThan(0.01)
  })

  it('SphereWithTunnelSurface.getPoint() respects worldRotation', () => {
    const surf = new SphereWithTunnelSurface()
    const posA = surf.getPoint(0.5, 0.3).position.clone()
    surf.worldRotation.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2)
    const posB = surf.getPoint(0.5, 0.3).position.clone()
    expect(posA.distanceTo(posB)).toBeGreaterThan(0.01)
  })
})

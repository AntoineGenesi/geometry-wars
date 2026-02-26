import { describe, it, expect } from 'vitest'
import { CubeWithTunnelSurface } from './CubeWithTunnelSurface'

describe('CubeWithTunnelSurface Size Reduction (S37)', () => {
  it('default size should be 20 (reduced from 24 for claustrophobic gameplay)', () => {
    const surface = new CubeWithTunnelSurface()

    // The size should be 20 after the downsize
    // We access it through getPointLocal to verify the dimensions
    const pointAtCenter = surface.getPointLocal(0.5, 0.5)
    expect(pointAtCenter).toBeDefined()
    expect(pointAtCenter.position).toBeDefined()

    // Verify the surface is smaller by checking the surfaceRadius
    // At size 20: halfSize = 10, surfaceRadius = 10 + (2.4 * 0.5) = 11.2
    // At size 24: halfSize = 12, surfaceRadius = 12 + (2.88 * 0.5) = 13.44
    const surface20 = new CubeWithTunnelSurface({ size: 20 })
    const surface24 = new CubeWithTunnelSurface({ size: 24 })

    // The default (without config) should match size: 20
    const defaultSurface = new CubeWithTunnelSurface()

    // Verify they produce similar geometry to size: 20
    const point20 = surface20.getPointLocal(0.25, 0.25)
    const pointDefault = defaultSurface.getPointLocal(0.25, 0.25)

    // Points should be very close (allowing for floating point error)
    expect(Math.abs(point20.position.x - pointDefault.position.x)).toBeLessThan(0.001)
    expect(Math.abs(point20.position.y - pointDefault.position.y)).toBeLessThan(0.001)
    expect(Math.abs(point20.position.z - pointDefault.position.z)).toBeLessThan(0.001)
  })

  it('cube tunnel at size 20 should be noticeably smaller than at size 24', () => {
    const surface20 = new CubeWithTunnelSurface({ size: 20 })
    const surface24 = new CubeWithTunnelSurface({ size: 24 })

    // Compare corner points
    const corner20 = surface20.getPointLocal(0.25, 0.5)
    const corner24 = surface24.getPointLocal(0.25, 0.5)

    // The distance from origin should be proportionally smaller
    const dist20 = Math.sqrt(
      corner20.position.x ** 2 +
      corner20.position.y ** 2 +
      corner20.position.z ** 2
    )

    const dist24 = Math.sqrt(
      corner24.position.x ** 2 +
      corner24.position.y ** 2 +
      corner24.position.z ** 2
    )

    // Size 20 should be ~83% of size 24 (20/24)
    const ratio = dist20 / dist24
    expect(ratio).toBeGreaterThan(0.80)
    expect(ratio).toBeLessThan(0.85)
  })

  it('can still create cube tunnel with custom size', () => {
    const customSurface = new CubeWithTunnelSurface({ size: 30 })
    const point = customSurface.getPointLocal(0.25, 0.25)

    expect(point).toBeDefined()
    expect(point.position).toBeDefined()
    expect(point.normal).toBeDefined()
  })
})

/**
 * Regression test: player can enter sphere-tunnel from outer sphere.
 *
 * Bug: commit 45df7f14 introduced _walkableMesh (outer-sphere-only), creating a
 * boundary edge at the tunnel entrance. FaceWalker._reflectAtBoundary() bounces
 * the player back, so they get stuck in the bevel and cannot enter the tunnel.
 *
 * Fix: remove _walkableMesh override → use full torus mesh → no boundary → tunnel entry works.
 *
 * NOTE: vitest cannot run in git worktrees. Run from the main project dir:
 *   npm test -- src/surfaces/SphereWithTunnelSurface.tunnel-entry.test.ts
 */

import * as THREE from 'three'
import { describe, it, expect } from 'vitest'
import { SphereWithTunnelSurface } from './SphereWithTunnelSurface'
import { MeshSurface } from './MeshSurface'
import { MeshWalker } from '../movement/MeshWalker'

describe('SphereWithTunnelSurface tunnel entry', () => {
  it('walkableMesh is the full torus mesh (not outer-sphere-only)', () => {
    const surface = new SphereWithTunnelSurface({ radius: 8, tunnelRadius: 2, bevelRadius: 0.8 })
    surface.group.updateMatrixWorld(true)

    // Before fix: walkableMesh was a DIFFERENT object from surface.mesh (outer-sphere-only)
    // After fix: walkableMesh === surface.mesh (full torus)
    expect(surface.walkableMesh).toBe(surface.mesh)
  })

  it('player can walk from outer sphere into the tunnel', () => {
    const surface = new SphereWithTunnelSurface({ radius: 8, tunnelRadius: 2, bevelRadius: 0.8 })
    surface.group.updateMatrixWorld(true)

    const meshSurface = new MeshSurface(surface.walkableMesh)

    // Start at equator, on the surface
    const startPos = new THREE.Vector3(8, 0, 0)
    const walker = new MeshWalker(meshSurface, startPos, 5.0)

    // Move toward north pole: at equator (normal = +X), the +Y world direction
    // is tangent to the sphere and points toward the north pole hole.
    // Walk 100 steps × dt=0.1s × speed=5 = 50 world units of movement.
    // Equator to north pole = (π/2) × R ≈ 12.6 world units along the sphere arc.
    // With bevel + tunnel, 50 units is more than enough to enter the tunnel.
    const moveDir = new THREE.Vector3(0, 1, 0) // toward north pole

    for (let i = 0; i < 100; i++) {
      // Re-project moveDir onto current tangent plane each step
      const n = walker.normal
      const d = moveDir.clone().addScaledVector(n, -moveDir.dot(n))
      const len = d.length()
      if (len > 0.001) {
        walker.move(d.multiplyScalar(1 / len), 0.1)
      }
    }

    // Inside the tunnel, XZ radius should be ≤ tunnelRadius (2.0).
    // If stuck at bevel boundary, XZ radius stays ~3 (bevel region) with Y frozen.
    const xzRadius = Math.sqrt(walker.position.x ** 2 + walker.position.z ** 2)
    expect(xzRadius).toBeLessThanOrEqual(2.5)

    // Also verify the player has moved significantly in Y (into the tunnel)
    expect(walker.position.y).toBeGreaterThan(4)
  })

  it('player can walk back out of tunnel onto outer sphere', () => {
    const surface = new SphereWithTunnelSurface({ radius: 8, tunnelRadius: 2, bevelRadius: 0.8 })
    surface.group.updateMatrixWorld(true)

    const meshSurface = new MeshSurface(surface.walkableMesh)

    // Start inside the tunnel near the north entrance
    // Tunnel inner face: (2, 5, 0) should be close to the tunnel wall
    const startPos = new THREE.Vector3(2, 5, 0)
    const walker = new MeshWalker(meshSurface, startPos, 5.0)

    // Move outward: the normal at tunnel wall points toward Y axis (-X direction at x=2)
    // Moving in the +X direction on the tunnel surface means going up toward the entrance
    // In the tunnel, the move direction along the tunnel is ±Y
    const moveDir = new THREE.Vector3(0, 1, 0) // up toward north entrance

    for (let i = 0; i < 60; i++) {
      const n = walker.normal
      const d = moveDir.clone().addScaledVector(n, -moveDir.dot(n))
      const len = d.length()
      if (len > 0.001) {
        walker.move(d.multiplyScalar(1 / len), 0.1)
      }
    }

    // After walking from inside tunnel toward entrance and then onto outer sphere,
    // the player should be on the sphere exterior (XZ radius approaches sphere radius ~8)
    const xzRadius = Math.sqrt(walker.position.x ** 2 + walker.position.z ** 2)
    expect(xzRadius).toBeGreaterThan(2.0) // Has left the tunnel cylinder
  })
})

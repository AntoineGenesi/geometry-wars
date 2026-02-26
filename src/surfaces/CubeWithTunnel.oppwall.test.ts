/**
 * S37 Regression Test: Cube-tunnel opposite-wall enemy visibility
 *
 * BUG: Enemies on the inner tunnel wall were lit up as if they were right next
 * to the player on the outer wall. Root cause: the proximity UV override in
 * RenderLoop fires when evRaw < PROXIMITY_NEAR_UV=0.08. On cube-tunnel (size=67),
 * the lip separating outer/inner walls spans only ~0.037 V units, so an outer-wall
 * player at V=0.44 and an inner-wall enemy at V=0.51 have evRaw=0.07 — triggering
 * full brightness despite being on opposite sides of the tunnel wall.
 *
 * FIX: CubeWithTunnelSurface.areOnOppositeWallSides() detects this boundary crossing.
 * RenderLoop skips the proximity override when this returns true.
 */

import { describe, it, expect } from 'vitest'
import { CubeWithTunnelSurface } from './CubeWithTunnelSurface'

// Match the gameplay config from SharedGameSetup (S37 size reduction)
const GAMEPLAY_CONFIG = { size: 67, wallThickness: 3.3, bevelRadius: 8.3 }

// Mirror RenderLoop constants for simulation
const PROXIMITY_NEAR_UV = 0.08
const PROXIMITY_FADE_UV = 0.15
const SURFACE_NEAR_UV = 0.15
const SURFACE_FAR_UV = 0.45
const SURFACE_DIM_OPACITY = 0.08

/**
 * Simulates RenderLoop's per-enemy visibility computation with the S37 fix applied.
 * Returns the final visibility value [0,1].
 */
function simulateVisibility(
  surface: CubeWithTunnelSurface,
  playerU: number, playerV: number,
  enemyU: number, enemyV: number,
  depthOpacity: number
): number {
  const euRaw = Math.abs(enemyU - playerU)
  const evRaw = Math.abs(enemyV - playerV)
  const eu = Math.min(euRaw, 1.0 - euRaw)
  const ev = surface.wrapsV ? Math.min(evRaw, 1.0 - evRaw) : evRaw
  const uvDist = Math.sqrt(eu * eu + ev * ev)

  // (a) Surface dimming
  let visibility = depthOpacity
  let surfaceVis: number
  if (uvDist <= SURFACE_NEAR_UV) {
    surfaceVis = 1.0
  } else if (uvDist >= SURFACE_FAR_UV) {
    surfaceVis = SURFACE_DIM_OPACITY
  } else {
    const uvT = (uvDist - SURFACE_NEAR_UV) / (SURFACE_FAR_UV - SURFACE_NEAR_UV)
    const uvSt = uvT * uvT * (3.0 - 2.0 * uvT)
    surfaceVis = 1.0 - uvSt * (1.0 - SURFACE_DIM_OPACITY)
  }
  visibility = Math.min(visibility, surfaceVis)

  // (b) Proximity override — suppressed for opposite-wall pairs (S37 fix)
  const oppositeWalls = surface.areOnOppositeWallSides(playerV, enemyV)
  if (!oppositeWalls) {
    if (uvDist <= PROXIMITY_NEAR_UV) {
      visibility = Math.max(visibility, 1.0)
    } else if (uvDist <= PROXIMITY_FADE_UV) {
      const t = (uvDist - PROXIMITY_NEAR_UV) / (PROXIMITY_FADE_UV - PROXIMITY_NEAR_UV)
      visibility = Math.max(visibility, 1.0 - t)
    }
  }

  return visibility
}

/** Same as simulateVisibility but WITHOUT the opposite-wall guard (reproduces the bug). */
function simulateVisibilityBuggy(
  surface: CubeWithTunnelSurface,
  playerU: number, playerV: number,
  enemyU: number, enemyV: number,
  depthOpacity: number
): number {
  const euRaw = Math.abs(enemyU - playerU)
  const evRaw = Math.abs(enemyV - playerV)
  const eu = Math.min(euRaw, 1.0 - euRaw)
  const ev = surface.wrapsV ? Math.min(evRaw, 1.0 - evRaw) : evRaw
  const uvDist = Math.sqrt(eu * eu + ev * ev)

  let visibility = depthOpacity
  let surfaceVis: number
  if (uvDist <= SURFACE_NEAR_UV) {
    surfaceVis = 1.0
  } else if (uvDist >= SURFACE_FAR_UV) {
    surfaceVis = SURFACE_DIM_OPACITY
  } else {
    const uvT = (uvDist - SURFACE_NEAR_UV) / (SURFACE_FAR_UV - SURFACE_NEAR_UV)
    const uvSt = uvT * uvT * (3.0 - 2.0 * uvT)
    surfaceVis = 1.0 - uvSt * (1.0 - SURFACE_DIM_OPACITY)
  }
  visibility = Math.min(visibility, surfaceVis)

  // NO opposite-wall guard — reproduces the bug
  if (uvDist <= PROXIMITY_NEAR_UV) {
    visibility = Math.max(visibility, 1.0)
  } else if (uvDist <= PROXIMITY_FADE_UV) {
    const t = (uvDist - PROXIMITY_NEAR_UV) / (PROXIMITY_FADE_UV - PROXIMITY_NEAR_UV)
    visibility = Math.max(visibility, 1.0 - t)
  }

  return visibility
}

describe('CubeWithTunnelSurface.areOnOppositeWallSides (S37)', () => {
  const surface = new CubeWithTunnelSurface(GAMEPLAY_CONFIG)

  // For size=67: outerWallFrac≈0.462, lipFrac≈0.038
  // Outer wall:   V ∈ [0,     0.462)
  // Top lip:      V ∈ [0.462, 0.500)
  // Inner wall:   V ∈ [0.500, 0.924)
  // Bottom lip:   V ∈ [0.924, 1.000)

  it('outer wall → inner wall: should be opposite (bug scenario)', () => {
    // Player near top of outer wall, enemy near top of inner wall — the S37 bug
    expect(surface.areOnOppositeWallSides(0.44, 0.51)).toBe(true)
    // Player at outer wall midpoint, enemy at inner wall midpoint
    expect(surface.areOnOppositeWallSides(0.23, 0.72)).toBe(true)
  })

  it('inner wall → outer wall: symmetric (swapped player/enemy)', () => {
    expect(surface.areOnOppositeWallSides(0.51, 0.44)).toBe(true)
    expect(surface.areOnOppositeWallSides(0.72, 0.23)).toBe(true)
  })

  it('outer wall → outer wall: same side (not opposite)', () => {
    expect(surface.areOnOppositeWallSides(0.1, 0.3)).toBe(false)
    expect(surface.areOnOppositeWallSides(0.4, 0.1)).toBe(false)
  })

  it('inner wall → inner wall: same side (not opposite)', () => {
    expect(surface.areOnOppositeWallSides(0.55, 0.75)).toBe(false)
    expect(surface.areOnOppositeWallSides(0.90, 0.55)).toBe(false)
  })

  it('outer wall → top lip: not opposite (lip is transition, not inner wall)', () => {
    expect(surface.areOnOppositeWallSides(0.3, 0.47)).toBe(false)
  })

  it('outer wall → bottom lip: not opposite', () => {
    // For size=67: inner wall ends at ~0.962, bottom lip spans [0.962, 1.0)
    // V=0.97 is in the bottom lip region (NOT inner wall)
    expect(surface.areOnOppositeWallSides(0.3, 0.97)).toBe(false)
  })

  it('outer wall → inner wall near the bottom: still opposite', () => {
    // V=0.95 < 0.962 → still inner wall for size=67. Should be opposite.
    expect(surface.areOnOppositeWallSides(0.3, 0.95)).toBe(true)
  })

  it('wraps correctly for V values outside [0,1)', () => {
    // V=1.44 normalizes to V=0.44 (outer wall), V=1.51 normalizes to V=0.51 (inner wall)
    expect(surface.areOnOppositeWallSides(1.44, 1.51)).toBe(true)
    expect(surface.areOnOppositeWallSides(-0.56, -0.49)).toBe(true)
  })
})

describe('S37 bug: proximity override should not fire for opposite-wall enemies', () => {
  const surface = new CubeWithTunnelSurface(GAMEPLAY_CONFIG)

  it('FAILS without fix: enemy on inner wall lit to 1.0 despite being behind wall', () => {
    // Player at outer wall top (V=0.44), enemy at inner wall top (V=0.51)
    // UV distance = 0.07 < PROXIMITY_NEAR_UV=0.08 → bug: visibility boosted to 1.0
    // Enemy has 1 surface intersection → depthOpacity=0.12 (should be dim)
    const buggyVisibility = simulateVisibilityBuggy(surface, 0.125, 0.44, 0.125, 0.51, 0.12)
    // The buggy code incorrectly boosts visibility to 1.0
    expect(buggyVisibility).toBe(1.0)
  })

  it('PASSES with fix: enemy on inner wall stays dim (proximity override suppressed)', () => {
    // Same scenario — but with areOnOppositeWallSides guard active
    const fixedVisibility = simulateVisibility(surface, 0.125, 0.44, 0.125, 0.51, 0.12)
    // The fix keeps visibility dim — proximity override was suppressed
    // uvDist=0.07 < SURFACE_NEAR_UV=0.15 → surfaceVis=1.0, but depthOpacity=0.12 limits it
    // visibility = min(0.12, 1.0) = 0.12 (depth occlusion prevails)
    expect(fixedVisibility).toBeCloseTo(0.12, 2)
    expect(fixedVisibility).toBeLessThan(0.5)
  })

  it('proximity override still fires for same-wall nearby enemies', () => {
    // Player and enemy both on outer wall, UV distance 0.07 → should still be bright
    const sameWallVisibility = simulateVisibility(surface, 0.125, 0.23, 0.125, 0.30, 0.12)
    // V distance = 0.07 < 0.08 → proximity override fires → full visibility
    expect(sameWallVisibility).toBeCloseTo(1.0, 2)
  })

  it('enemy far on inner wall stays properly dim regardless', () => {
    // Player at outer wall midpoint (V=0.23), enemy at inner wall midpoint (V=0.72)
    // UV distance = min(0.49, 0.51) = 0.49 > SURFACE_FAR_UV=0.45 → fully dim
    const farEnemyVisibility = simulateVisibility(surface, 0.125, 0.23, 0.625, 0.72, 0.12)
    expect(farEnemyVisibility).toBeCloseTo(SURFACE_DIM_OPACITY, 2)
  })
})

import { describe, it, expect } from 'vitest'
import * as THREE from 'three'
import { computeFadeAlpha, OcclusionSurfaceMaterial } from './OcclusionSurfaceMaterial'

// ---------------------------------------------------------------------------
// computeFadeAlpha — pure fade-math function
// ---------------------------------------------------------------------------
//
// Test setup: camera at (0,0,10), player at (0,0,0).
// Ray: origin=(0,0,10), direction=(0,0,-1), totalDist=10.
//
// A fragment at (0,0,5) is midway between camera and player (tNorm=0.5)
// and exactly on the ray (lateralDist=0) → maximum fade.

describe('computeFadeAlpha', () => {
  const cam = new THREE.Vector3(0, 0, 10)
  const player = new THREE.Vector3(0, 0, 0)
  const currentAlpha = 0.9
  const minAlpha = 0.08
  const corridorRadius = 2.0

  it('fades fragment on the ray to minAlpha (lateralDist=0, tNorm=0.5)', () => {
    const frag = new THREE.Vector3(0, 0, 5)
    expect(computeFadeAlpha(frag, cam, player, currentAlpha, minAlpha, corridorRadius)).toBeCloseTo(
      minAlpha,
      5,
    )
  })

  it('returns currentAlpha for fragment behind camera (tNorm < 0)', () => {
    const frag = new THREE.Vector3(0, 0, 15) // tNorm = -0.5
    expect(computeFadeAlpha(frag, cam, player, currentAlpha, minAlpha, corridorRadius)).toBe(
      currentAlpha,
    )
  })

  it('returns currentAlpha for fragment past player (tNorm > 1)', () => {
    const frag = new THREE.Vector3(0, 0, -5) // tNorm = 1.5
    expect(computeFadeAlpha(frag, cam, player, currentAlpha, minAlpha, corridorRadius)).toBe(
      currentAlpha,
    )
  })

  it('returns currentAlpha for fragment exactly at camera (tNorm = 0)', () => {
    const frag = new THREE.Vector3(0, 0, 10) // tNorm = 0
    expect(computeFadeAlpha(frag, cam, player, currentAlpha, minAlpha, corridorRadius)).toBe(
      currentAlpha,
    )
  })

  it('returns currentAlpha for fragment exactly at player (tNorm = 1)', () => {
    const frag = new THREE.Vector3(0, 0, 0) // tNorm = 1
    expect(computeFadeAlpha(frag, cam, player, currentAlpha, minAlpha, corridorRadius)).toBe(
      currentAlpha,
    )
  })

  it('returns currentAlpha when lateralDist >= corridorRadius', () => {
    const frag = new THREE.Vector3(3, 0, 5) // lateralDist=3, corridorRadius=2
    expect(computeFadeAlpha(frag, cam, player, currentAlpha, minAlpha, corridorRadius)).toBe(
      currentAlpha,
    )
  })

  it('produces intermediate alpha for lateralDist between 0 and corridorRadius', () => {
    const frag = new THREE.Vector3(1, 0, 5) // lateralDist=1, corridorRadius=2
    const result = computeFadeAlpha(frag, cam, player, currentAlpha, minAlpha, corridorRadius)
    expect(result).toBeGreaterThan(minAlpha)
    expect(result).toBeLessThan(currentAlpha)
  })

  it('fades less as lateral distance increases (monotone)', () => {
    const alpha0 = computeFadeAlpha(
      new THREE.Vector3(0, 0, 5),
      cam, player, currentAlpha, minAlpha, corridorRadius,
    )
    const alpha1 = computeFadeAlpha(
      new THREE.Vector3(1, 0, 5),
      cam, player, currentAlpha, minAlpha, corridorRadius,
    )
    const alpha2 = computeFadeAlpha(
      new THREE.Vector3(2, 0, 5),
      cam, player, currentAlpha, minAlpha, corridorRadius,
    )
    // alpha0 most faded (smallest), alpha2 = currentAlpha (no fade)
    expect(alpha0).toBeLessThan(alpha1)
    expect(alpha1).toBeLessThan(alpha2)
    expect(alpha2).toBe(currentAlpha)
  })

  it('handles zero-length ray (camera equals player) by returning currentAlpha', () => {
    const frag = new THREE.Vector3(0, 0, 5)
    expect(computeFadeAlpha(frag, cam, cam, currentAlpha, minAlpha, corridorRadius)).toBe(
      currentAlpha,
    )
  })

  it('works with a non-axis-aligned ray', () => {
    // Camera at (0,0,0), player at (10,10,0) — diagonal ray
    const c = new THREE.Vector3(0, 0, 0)
    const p = new THREE.Vector3(10, 10, 0)
    // Fragment exactly on the midpoint of the ray
    const midpoint = new THREE.Vector3(5, 5, 0)
    const result = computeFadeAlpha(midpoint, c, p, currentAlpha, minAlpha, corridorRadius)
    expect(result).toBeCloseTo(minAlpha, 5)
  })

  it('correctly handles fragment at edge of corridor (smoothstep boundary)', () => {
    // At lateralDist = corridorRadius exactly: smoothstep(0,2,2)=1 → fadeFactor=0
    const frag = new THREE.Vector3(2, 0, 5) // lateralDist=2.0
    const result = computeFadeAlpha(frag, cam, player, currentAlpha, minAlpha, corridorRadius)
    expect(result).toBeCloseTo(currentAlpha, 5)
  })
})

// ---------------------------------------------------------------------------
// OcclusionSurfaceMaterial — class API
// ---------------------------------------------------------------------------

describe('OcclusionSurfaceMaterial', () => {
  it('extends THREE.MeshBasicMaterial', () => {
    const mat = new OcclusionSurfaceMaterial()
    expect(mat).toBeInstanceOf(THREE.MeshBasicMaterial)
    mat.dispose()
  })

  it('creates with default minAlpha=0.08 and corridorRadius=2.0', () => {
    const mat = new OcclusionSurfaceMaterial()
    expect(mat['_uniforms'].uMinAlpha.value).toBe(0.08)
    expect(mat['_uniforms'].uCorridorRadius.value).toBe(2.0)
    mat.dispose()
  })

  it('accepts custom minAlpha and corridorRadius', () => {
    const mat = new OcclusionSurfaceMaterial({ minAlpha: 0.15, corridorRadius: 3.5 })
    expect(mat['_uniforms'].uMinAlpha.value).toBe(0.15)
    expect(mat['_uniforms'].uCorridorRadius.value).toBe(3.5)
    mat.dispose()
  })

  it('passes base MeshBasicMaterial params through (color, opacity, transparent)', () => {
    const mat = new OcclusionSurfaceMaterial({
      color: 0x141440,
      opacity: 0.92,
      transparent: true,
    })
    expect(mat.color.getHex()).toBe(0x141440)
    expect(mat.opacity).toBe(0.92)
    expect(mat.transparent).toBe(true)
    mat.dispose()
  })

  it('starts with occlusion disabled', () => {
    const mat = new OcclusionSurfaceMaterial()
    expect(mat['_uniforms'].uOcclusionEnabled.value).toBe(false)
    mat.dispose()
  })

  it('setOcclusionParams enables/disables occlusion', () => {
    const mat = new OcclusionSurfaceMaterial()
    const cam = new THREE.Vector3(0, 0, 10)
    const player = new THREE.Vector3(0, 0, 0)

    mat.setOcclusionParams(cam, player, true)
    expect(mat['_uniforms'].uOcclusionEnabled.value).toBe(true)

    mat.setOcclusionParams(cam, player, false)
    expect(mat['_uniforms'].uOcclusionEnabled.value).toBe(false)

    mat.dispose()
  })

  it('setOcclusionParams copies camera and player positions without allocating', () => {
    const mat = new OcclusionSurfaceMaterial()
    const cam = new THREE.Vector3(1, 2, 3)
    const player = new THREE.Vector3(4, 5, 6)

    // Keep references to the internal vectors before calling setOcclusionParams
    const internalCam = mat['_cameraPos']
    const internalPlayer = mat['_playerPos']

    mat.setOcclusionParams(cam, player, true)

    // Same object references (no new allocation)
    expect(mat['_cameraPos']).toBe(internalCam)
    expect(mat['_playerPos']).toBe(internalPlayer)

    // Values are copied correctly
    expect(internalCam.x).toBe(1)
    expect(internalCam.y).toBe(2)
    expect(internalCam.z).toBe(3)
    expect(internalPlayer.x).toBe(4)
    expect(internalPlayer.y).toBe(5)
    expect(internalPlayer.z).toBe(6)

    mat.dispose()
  })

  it('has a customProgramCacheKey to prevent shader cache collision', () => {
    const mat = new OcclusionSurfaceMaterial()
    expect(typeof mat.customProgramCacheKey).toBe('function')
    const key = (mat.customProgramCacheKey as () => string)()
    expect(key).toBe('occlusion-surface-material-v1')
    mat.dispose()
  })

  it('has onBeforeCompile hook defined', () => {
    const mat = new OcclusionSurfaceMaterial()
    expect(typeof mat.onBeforeCompile).toBe('function')
    mat.dispose()
  })
})

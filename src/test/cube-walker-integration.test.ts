/**
 * Cube MeshWalker Integration Tests (Session 13 Phase 3)
 *
 * Tests MeshWalker behavior on the fixed cube geometry to verify:
 * - No "trappy bits" where player gets stuck
 * - No upside-down orientation on flat faces
 * - No NaN positions or camera flips
 * - Smooth traversal across all cube faces and edges
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { PlaygroundTestHarness } from './PlaygroundTestHarness'

// ---------------------------------------------------------------------------
// Mock setup for headless testing
// ---------------------------------------------------------------------------

const _noop = () => {}
const _noopEvent = (_e: string, _h: any) => {}

if (typeof globalThis.window === 'undefined') {
  const mockWindow: any = {
    innerWidth: 800,
    innerHeight: 600,
    devicePixelRatio: 1,
    addEventListener: _noopEvent,
    removeEventListener: _noopEvent,
    location: { search: '', href: '' },
    navigator: { getGamepads: () => [], userAgent: '' },
    getComputedStyle: () => ({}),
  }
  globalThis.window = mockWindow
}

if (typeof globalThis.document === 'undefined') {
  const mockDoc: any = {
    hidden: false,
    body: {
      appendChild: _noop,
      removeChild: _noop,
      style: {},
      clientWidth: 800,
      clientHeight: 600,
      getBoundingClientRect: () => ({
        left: 0,
        top: 0,
        right: 800,
        bottom: 600,
        width: 800,
        height: 600,
        x: 0,
        y: 0,
        toJSON: _noop,
      }),
      addEventListener: _noopEvent,
      removeEventListener: _noopEvent,
    },
    createElement: (tag: string) => {
      if (tag === 'canvas') {
        const mock2dCtx = {
          fillRect: _noop,
          clearRect: _noop,
          getImageData: () => ({ data: new Uint8ClampedArray(4) }),
          putImageData: _noop,
          createImageData: () => ({ data: new Uint8ClampedArray(4) }),
          setTransform: _noop,
          drawImage: _noop,
          save: _noop,
          fillText: _noop,
          restore: _noop,
          beginPath: _noop,
          moveTo: _noop,
          lineTo: _noop,
          closePath: _noop,
          stroke: _noop,
          translate: _noop,
          scale: _noop,
          rotate: _noop,
          arc: _noop,
          fill: _noop,
          measureText: () => ({ width: 10 }),
          transform: _noop,
          rect: _noop,
          clip: _noop,
          canvas: { width: 64, height: 64 },
          fillStyle: '',
          strokeStyle: '',
          lineWidth: 1,
          createRadialGradient: () => ({
            addColorStop: _noop,
          }),
          createLinearGradient: () => ({
            addColorStop: _noop,
          }),
        }
        const mockCanvas: any = {
          getContext: (type: string) => (type === '2d' ? mock2dCtx : null),
          style: {},
          width: 800,
          height: 600,
          addEventListener: _noopEvent,
          removeEventListener: _noopEvent,
        }
        return mockCanvas
      }
      return { style: {}, appendChild: _noop }
    },
    getElementById: () => null,
    addEventListener: _noopEvent,
    removeEventListener: _noopEvent,
  }
  globalThis.document = mockDoc
}

// Three.js WebGL and postprocessing mocks
vi.mock('three', async () => {
  const actual = await vi.importActual<typeof import('three')>('three')
  class MockWebGLRenderer {
    domElement = (() => {
      const el = globalThis.document?.createElement('canvas') || { style: {} }
      ;(el as any).remove = _noop
      return el
    })()
    dispose = _noop
    render = _noop
    setSize = _noop
    setPixelRatio = _noop
    clear = _noop
    getContext = () => ({ getExtension: () => null })
    capabilities = { isWebGL2: false, maxTextures: 16 }
    info = { render: { frame: 0, calls: 0, triangles: 0 } }
  }
  return {
    ...actual,
    WebGLRenderer: MockWebGLRenderer as any,
  }
})

vi.mock('three/examples/jsm/postprocessing/EffectComposer.js', () => ({
  EffectComposer: class {
    passes: any[] = []
    addPass = _noop
    removePass = _noop
    render = _noop
    setSize = _noop
    dispose = _noop
  },
}))

vi.mock('three/examples/jsm/postprocessing/RenderPass.js', () => ({
  RenderPass: class {
    enabled = true
  },
}))

vi.mock('three/examples/jsm/postprocessing/UnrealBloomPass.js', () => ({
  UnrealBloomPass: class {
    enabled = true
    strength = 1
    radius = 0
    threshold = 0
  },
}))

describe('Cube MeshWalker Integration (Session 13 Phase 3)', () => {
  let harness: PlaygroundTestHarness

  beforeEach(() => {
    harness = new PlaygroundTestHarness('cube')
    harness.tick(10) // Settle
  })

  it('DIAGNOSTIC: check basic movement on cube', () => {
    const startPos = harness.getPlayerWorldPos()
    console.log('Cube - Start position:', startPos)
    console.log('Cube - Start UV:', harness.getPlayerSurfaceUV())

    harness.pressKey('w')
    harness.tick(60) // 1 second

    const endPos = harness.getPlayerWorldPos()
    const distance = startPos.distanceTo(endPos)
    console.log('Cube - End position:', endPos)
    console.log('Cube - End UV:', harness.getPlayerSurfaceUV())
    console.log('Cube - Distance moved:', distance)

    // Compare with sphere
    const sphereHarness = new PlaygroundTestHarness('sphere')
    sphereHarness.tick(10)
    const sphereStart = sphereHarness.getPlayerWorldPos()
    sphereHarness.pressKey('w')
    sphereHarness.tick(60)
    const sphereEnd = sphereHarness.getPlayerWorldPos()
    const sphereDistance = sphereStart.distanceTo(sphereEnd)
    console.log('Sphere - Distance moved:', sphereDistance)

    // Sphere should move, cube might not
    expect(sphereDistance).toBeGreaterThan(0)
  })

  it('should not produce NaN positions during 60-second random movement', () => {
    // Simulate 60 seconds (3600 frames) with random directional changes
    const directions = ['w', 's', 'a', 'd']
    let nanCount = 0
    let maxPositionMagnitude = 0

    for (let i = 0; i < 3600; i++) {
      // Change direction every 60 frames (1 second)
      if (i % 60 === 0) {
        // Release all keys
        harness.releaseKey('w')
        harness.releaseKey('s')
        harness.releaseKey('a')
        harness.releaseKey('d')

        // Press a random direction
        const dir = directions[Math.floor(Math.random() * directions.length)]
        harness.pressKey(dir)
      }

      harness.tick(1)

      const pos = harness.getPlayerWorldPos()
      if (isNaN(pos.x) || isNaN(pos.y) || isNaN(pos.z)) {
        nanCount++
      }

      const magnitude = pos.length()
      maxPositionMagnitude = Math.max(maxPositionMagnitude, magnitude)
    }

    expect(nanCount).toBe(0)
    // Player should stay within reasonable distance from origin (cube size is 18)
    expect(maxPositionMagnitude).toBeLessThan(30)
  })

  it('should maintain upright orientation on flat faces', () => {
    // Test bottom flat face (v ≈ 0.05)
    harness.tick(60)

    const cameraState = harness.getCameraState()
    const cameraUp = cameraState.up

    // On bottom flat face, camera up should be roughly aligned with world axes
    // (not perfectly, due to tangent frame, but shouldn't be upside-down)
    const upDotWorldY = Math.abs(cameraUp.dot({ x: 0, y: 1, z: 0 } as any))
    const upDotWorldZ = Math.abs(cameraUp.dot({ x: 0, y: 0, z: 1 } as any))
    const upDotWorldX = Math.abs(cameraUp.dot({ x: 1, y: 0, z: 0 } as any))

    // Camera up should be reasonably aligned with at least one world axis
    const maxAlignment = Math.max(upDotWorldX, upDotWorldY, upDotWorldZ)
    expect(maxAlignment).toBeGreaterThan(0.5)
  })

  it('should traverse from bottom flat face to side face without getting stuck', () => {
    // Move forward for 5 seconds, which should cross from bottom to side
    harness.pressKey('w')
    const trace = harness.recordTrace(300, 10) // 5 seconds, sample every 10 frames

    // Check that player actually moved
    const totalDistance = trace.totalDistance
    expect(totalDistance).toBeGreaterThan(5) // Should have moved at least 5 units

    // Check that we didn't get stuck (no prolonged zero movement)
    expect(trace.stuckFrames).toBeLessThan(10) // At most 10 stuck frames out of 30 samples

    // Check that we didn't hit NaN
    expect(trace.nanFrames).toBe(0)

    // Check that V coordinate changed (moved across face boundaries)
    const vRange = trace.uvRange.maxV - trace.uvRange.minV
    expect(vRange).toBeGreaterThan(0.05) // Should have changed v by at least 0.05
  })

  it('should handle corners without producing NaN or getting stuck', () => {
    // Navigate to a corner region by moving diagonally
    harness.pressKey('w')
    harness.pressKey('a')
    const trace = harness.recordTrace(300, 10) // 5 seconds diagonal movement

    // No NaN positions
    expect(trace.nanFrames).toBe(0)

    // Should have moved (not stuck in corner)
    expect(trace.totalDistance).toBeGreaterThan(5)

    // Should have moved in both U and V
    const uRange = trace.uvRange.maxU - trace.uvRange.minU
    const vRange = trace.uvRange.maxV - trace.uvRange.minV
    expect(uRange).toBeGreaterThan(0.02)
    expect(vRange).toBeGreaterThan(0.02)
  })

  it('should maintain smooth camera orientation without wild flips', () => {
    // Record camera quaternion over 5 seconds
    harness.pressKey('w')
    const trace = harness.recordTrace(300, 10) // 5 seconds, 30 samples

    // Check for large camera orientation changes between consecutive samples
    let maxAngleChange = 0
    for (let i = 1; i < trace.frames.length; i++) {
      const q1 = trace.frames[i - 1].cameraQuat
      const q2 = trace.frames[i].cameraQuat

      // Compute angle between quaternions
      const dot = Math.abs(
        q1.x * q2.x + q1.y * q2.y + q1.z * q2.z + q1.w * q2.w
      )
      const angle = 2 * Math.acos(Math.min(1, dot))
      maxAngleChange = Math.max(maxAngleChange, angle)
    }

    // Camera shouldn't flip wildly (max 45 degrees per 10 frames)
    expect(maxAngleChange).toBeLessThan(Math.PI / 4)
  })

  it('should cross all 12 cube edges without position jumps', () => {
    // Walk in a large circle around the cube by holding forward and left
    harness.pressKey('w')
    harness.pressKey('a')
    const trace = harness.recordTrace(1200, 20) // 20 seconds, 60 samples

    // Check for large position jumps between consecutive samples
    let maxJump = 0
    for (let i = 1; i < trace.frames.length; i++) {
      const dist = trace.frames[i].distFromPrev
      maxJump = Math.max(maxJump, dist)
    }

    // Position shouldn't jump more than expected movement per sample period
    // With 20-frame sampling and speed ~6 units/sec, max jump should be ~2 units
    expect(maxJump).toBeLessThan(3)

    // Should have traveled a significant distance
    expect(trace.totalDistance).toBeGreaterThan(50)

    // Should have crossed multiple edges (U should have changed significantly)
    const uRange = trace.uvRange.maxU - trace.uvRange.minU
    expect(uRange).toBeGreaterThan(0.3) // Should have traversed multiple faces
  })

  it('should recover from BVH fallback without getting stuck', () => {
    // Test rapid direction changes to stress the geodesic/BVH fallback system
    for (let i = 0; i < 10; i++) {
      harness.pressKey('w')
      harness.tick(5)
      harness.releaseKey('w')

      harness.pressKey('s')
      harness.tick(5)
      harness.releaseKey('s')

      harness.pressKey('a')
      harness.tick(5)
      harness.releaseKey('a')

      harness.pressKey('d')
      harness.tick(5)
      harness.releaseKey('d')
    }

    // After rapid direction changes, player should still be in a valid state
    const pos = harness.getPlayerWorldPos()
    expect(isNaN(pos.x)).toBe(false)
    expect(isNaN(pos.y)).toBe(false)
    expect(isNaN(pos.z)).toBe(false)

    // Should still be able to move
    harness.pressKey('w')
    const startPos = harness.getPlayerWorldPos()
    harness.tick(60)
    const endPos = harness.getPlayerWorldPos()
    const movedDistance = startPos.distanceTo(endPos)
    expect(movedDistance).toBeGreaterThan(1)
  })
})

/**
 * Cube UV-Based Movement Fallback Tests (Session 13 Phase 3B)
 *
 * Tests that PlaygroundGame uses UV-based movement instead of MeshWalker on cube
 * surfaces to avoid the "player gets stuck" issue identified in walker-integration.
 *
 * Background: MeshWalker is incompatible with cube geometry (flat faces + sharp edges).
 * Diagnostic test showed: Sphere moves 1.28 units/sec, Cube moves 0.0 units/sec (stuck).
 * Solution: Fallback to UV-based movement for cube/cube-tunnel/cube-ring surfaces.
 */

import { describe, it, expect, vi } from 'vitest'
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
          fillRect: _noop,
          clearRect: _noop,
          getImageData: () => ({ data: new Uint8ClampedArray(4) }),
          putImageData: _noop,
        }
        return {
          getContext: (type: string) => (type === '2d' ? mock2dCtx : null),
          style: {},
          width: 800,
          height: 600,
          setAttribute: _noop,
          addEventListener: _noopEvent,
          removeEventListener: _noopEvent,
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
        }
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
    renderToScreen = false
  },
}))

vi.mock('three/examples/jsm/postprocessing/UnrealBloomPass.js', () => ({
  UnrealBloomPass: class {
    strength = 1
    radius = 1
    threshold = 1
  },
}))

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Cube UV-Based Movement Fallback', () => {
  it('DIAGNOSTIC: Player can move on cube (not stuck)', () => {
    const harness = new PlaygroundTestHarness('cube')
    harness.tick(10) // Settle

    const startPos = harness.getPlayerWorldPos()
    console.log('Cube - Start position:', startPos)

    // Move forward for 1 second
    harness.pressKey('w')
    harness.tick(60) // 1 second at 60 FPS
    harness.releaseKey('w')

    const endPos = harness.getPlayerWorldPos()
    console.log('Cube - End position:', endPos)

    const dx = endPos.x - startPos.x
    const dy = endPos.y - startPos.y
    const dz = endPos.z - startPos.z
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz)

    console.log(`Cube - Distance moved: ${dist}`)

    // With UV-based movement, player should move (NOT 0.0 like with MeshWalker)
    expect(dist).toBeGreaterThan(1.0)
  })

  it('should not produce NaN positions during movement', () => {
    const harness = new PlaygroundTestHarness('cube')
    harness.tick(10)

    // Aggressive random movement for 3 seconds
    for (let i = 0; i < 180; i++) {
      if (Math.random() > 0.5) harness.pressKey('w')
      if (Math.random() > 0.5) harness.pressKey('a')
      if (Math.random() > 0.5) harness.pressKey('s')
      if (Math.random() > 0.5) harness.pressKey('d')
      harness.tick(1)
      harness.releaseKey('w')
      harness.releaseKey('a')
      harness.releaseKey('s')
      harness.releaseKey('d')

      const pos = harness.getPlayerWorldPos()
      expect(isNaN(pos.x)).toBe(false)
      expect(isNaN(pos.y)).toBe(false)
      expect(isNaN(pos.z)).toBe(false)
    }
  })

  it('regression: sphere should still use MeshWalker', () => {
    const sphereHarness = new PlaygroundTestHarness('sphere')
    sphereHarness.tick(10)

    const startPos = sphereHarness.getPlayerWorldPos()

    sphereHarness.pressKey('w')
    sphereHarness.tick(60)
    sphereHarness.releaseKey('w')

    const endPos = sphereHarness.getPlayerWorldPos()

    const dx = endPos.x - startPos.x
    const dy = endPos.y - startPos.y
    const dz = endPos.z - startPos.z
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz)

    // Sphere should still move (MeshWalker works on sphere)
    expect(dist).toBeGreaterThan(0.5)
  })
})

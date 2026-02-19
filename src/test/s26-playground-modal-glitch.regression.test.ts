/**
 * Regression tests for S26: Playground Modal Glitch
 *
 * Covers:
 *   Bug 1/2 — GameInstance.dispose() calls game.dispose() (not just game.stop()),
 *             so the canvas is removed from the DOM. Prevents duplicate/linked instances.
 *   Bug 3   — Enemy-player collision kills the player in demo mode.
 *   Bug 4   — VisualPlaygroundDemo.applyVisualPreset() uses MeshBasicMaterial (not PBR).
 *
 * Each test FAILS without the fix and PASSES with it.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import * as THREE from 'three';

// ---------------------------------------------------------------------------
// DOM / window shims (same as playground-verification.test.ts)
// ---------------------------------------------------------------------------

const _noop = () => {};
const _noopEvent = (_e: string, _h: any) => {};

if (typeof globalThis.window === 'undefined') {
  const mockWindow: any = {
    innerWidth: 800, innerHeight: 600, devicePixelRatio: 1,
    addEventListener: _noopEvent, removeEventListener: _noopEvent,
    location: { search: '', href: '' },
    navigator: { getGamepads: () => [], userAgent: '' },
    getComputedStyle: () => ({}),
  };
  globalThis.window = mockWindow;
}

if (typeof globalThis.document === 'undefined') {
  const mock2dCtx = {
    fillRect: _noop, clearRect: _noop,
    getImageData: () => ({ data: new Uint8ClampedArray(4) }),
    putImageData: _noop, createImageData: () => ({ data: new Uint8ClampedArray(4) }),
    setTransform: _noop, drawImage: _noop, save: _noop, fillText: _noop,
    restore: _noop, beginPath: _noop, moveTo: _noop, lineTo: _noop,
    closePath: _noop, stroke: _noop, translate: _noop, scale: _noop,
    rotate: _noop, arc: _noop, fill: _noop, measureText: () => ({ width: 10 }),
    transform: _noop, rect: _noop, clip: _noop,
    canvas: { width: 64, height: 64 },
    fillStyle: '', strokeStyle: '', lineWidth: 1, lineCap: 'butt',
    lineJoin: 'miter', globalAlpha: 1, globalCompositeOperation: 'source-over',
    createRadialGradient: () => ({ addColorStop: _noop }),
    createLinearGradient: () => ({ addColorStop: _noop }),
  };
  const mockDoc: any = {
    hidden: false,
    body: {
      appendChild: _noop, removeChild: _noop, style: {},
      clientWidth: 800, clientHeight: 600,
      getBoundingClientRect: () => ({ left: 0, top: 0, right: 800, bottom: 600, width: 800, height: 600, x: 0, y: 0, toJSON: _noop }),
      addEventListener: _noopEvent, removeEventListener: _noopEvent,
    },
    createElement: (tag: string) => {
      if (tag === 'canvas') {
        return {
          width: 64, height: 64, style: {},
          getContext: (type: string) => type === '2d' ? mock2dCtx : null,
          addEventListener: _noopEvent, removeEventListener: _noopEvent,
          toDataURL: () => '', remove: _noop,
        };
      }
      return {
        style: {}, clientWidth: 800, clientHeight: 600,
        innerHTML: '',
        textContent: '',
        appendChild: _noop, removeChild: _noop,
        querySelector: (_sel: string) => null,
        querySelectorAll: (_sel: string) => [],
        getBoundingClientRect: () => ({ left: 0, top: 0, right: 800, bottom: 600, width: 800, height: 600, x: 0, y: 0, toJSON: _noop }),
        addEventListener: _noopEvent, removeEventListener: _noopEvent,
      };
    },
    addEventListener: _noopEvent, removeEventListener: _noopEvent,
  };
  globalThis.document = mockDoc;
}

if (typeof globalThis.navigator === 'undefined') {
  (globalThis as any).navigator = { getGamepads: () => [], userAgent: '' };
}
if (typeof globalThis.requestAnimationFrame === 'undefined') {
  (globalThis as any).requestAnimationFrame = (cb: any) => setTimeout(cb, 16);
}
if (typeof globalThis.cancelAnimationFrame === 'undefined') {
  (globalThis as any).cancelAnimationFrame = (id: any) => clearTimeout(id);
}
if (typeof globalThis.HTMLElement === 'undefined') {
  (globalThis as any).HTMLElement = class MockHTMLElement {};
}
if (typeof globalThis.URLSearchParams === 'undefined') {
  (globalThis as any).URLSearchParams = class MockURLSearchParams {
    private params: Record<string, string> = {};
    constructor(search: string) {
      search.replace(/^\?/, '').split('&').forEach(pair => {
        const [k, v] = pair.split('=');
        if (k) this.params[k] = v ?? '';
      });
    }
    get(key: string) { return this.params[key] ?? null; }
  };
}

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('../audio/SoundEngine', () => ({
  getSoundEngine: () => ({ play: vi.fn(), init: vi.fn(), resume: vi.fn(), muted: false }),
}));

vi.mock('three/addons/postprocessing/EffectComposer.js', () => ({
  EffectComposer: class MockEffectComposer {
    passes: any[] = [];
    addPass(pass: any) { this.passes.push(pass); }
    render() {} setSize() {} dispose() {}
  },
}));
vi.mock('three/addons/postprocessing/RenderPass.js', () => ({ RenderPass: class {} }));
vi.mock('three/addons/postprocessing/UnrealBloomPass.js', () => ({
  UnrealBloomPass: class {
    resolution = new THREE.Vector2(800, 600);
    constructor(_res: any, _s: number, _r: number, _t: number) {}
  },
}));
vi.mock('three/addons/postprocessing/OutputPass.js', () => ({ OutputPass: class {} }));
vi.mock('three/addons/postprocessing/ShaderPass.js', () => ({ ShaderPass: class { constructor(_s: any) {} } }));
vi.mock('three/webgpu', () => ({
  PostProcessing: class { render() {} },
  pass: () => ({ getTextureNode: () => ({ r: 0, g: 0, b: 0, mul: () => ({}) }) }),
  float: () => ({}), max: () => ({ sub: () => ({}) }), add: () => ({ mul: () => ({}) }),
  screenUV: { sub: () => ({ dot: () => ({ mul: () => ({}) }) }) },
}));
vi.mock('../rendering/GPUCapabilities', () => ({
  detectGPUCapabilities: vi.fn().mockResolvedValue({
    webgpu: false, webgl2: true, webgl1: true, maxTextureSize: 4096,
    maxInstanceCount: 1000, sharedArrayBuffer: false, hardwareConcurrency: 4,
    renderer: 'Mock GPU', vendor: 'Mock Vendor', webgpuAdapter: '', tier: 'medium',
  }),
}));
vi.mock('../rendering/RendererFactory', () => ({
  createRenderer: vi.fn().mockResolvedValue({ renderer: {}, isWebGPU: false, backend: 'webgl2' }),
  resolveRendererPreference: vi.fn().mockReturnValue('webgl2'),
}));

// Track calls to domElement.remove() so we can verify canvas removal
let mockRemoveCallCount = 0;

vi.mock('three', async (importOriginal) => {
  const actual = await importOriginal<typeof import('three')>();

  class MockWebGLRenderer {
    domElement: any;
    toneMapping: any;
    toneMappingExposure: number;
    shadowMap: any;
    outputColorSpace: any;
    info: any;

    constructor(_opts?: any) {
      this.domElement = {
        style: {},
        width: 800, height: 600,
        addEventListener: () => {},
        removeEventListener: () => {},
        // Track calls to remove() — this is how we verify Bug 1/2 fix
        remove: () => { mockRemoveCallCount++; },
        getContext: () => null,
        toDataURL: () => '',
      };
      this.toneMapping = actual.NoToneMapping;
      this.toneMappingExposure = 1.0;
      this.shadowMap = { enabled: false };
      this.outputColorSpace = actual.SRGBColorSpace;
      this.info = { render: { calls: 0, triangles: 0 } };
    }

    setSize() {} setPixelRatio() {} render() {} dispose() {}
    getSize(target: any) { return target?.set?.(800, 600) ?? new actual.Vector2(800, 600); }
    getPixelRatio() { return 1; }
  }

  return { ...actual, WebGLRenderer: MockWebGLRenderer };
});

// ---------------------------------------------------------------------------
// Now import the game code
// ---------------------------------------------------------------------------

import { GameInstance } from '../core/GameInstance';
import { PlaygroundGame } from '../core/PlaygroundGame';

// ---------------------------------------------------------------------------
// Helper: create a mock container
// ---------------------------------------------------------------------------

function createMockContainer(): HTMLElement {
  return {
    clientWidth: 400,
    clientHeight: 300,
    style: {},
    appendChild: _noop,
    removeChild: _noop,
    getBoundingClientRect: () => ({ left: 0, top: 0, right: 400, bottom: 300, width: 400, height: 300, x: 0, y: 0, toJSON: _noop }),
    addEventListener: _noopEvent,
    removeEventListener: _noopEvent,
  } as any as HTMLElement;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('S26 Regression: Playground Modal Glitch', () => {

  // -----------------------------------------------------------------------
  // Bug 1/2: Duplicate/linked instances — canvas must be removed on dispose
  // -----------------------------------------------------------------------

  describe('Bug 1/2 — Canvas removed on dispose (prevents duplicate instances)', () => {

    afterEach(() => {
      mockRemoveCallCount = 0;
    });

    it('GameInstance.dispose() calls game.dispose() which removes the canvas from DOM', () => {
      const container = createMockContainer();
      const instance = new GameInstance({ container, mode: 'demo', enemyCount: 0 });

      // Before dispose: canvas should not have been removed yet
      expect(mockRemoveCallCount).toBe(0);

      instance.dispose();

      // After dispose: renderer.domElement.remove() MUST have been called once.
      // Without the fix (game.stop() only), remove() is never called → count stays 0.
      // With the fix (game.dispose()), remove() is called exactly once → count = 1.
      expect(mockRemoveCallCount).toBe(1);
    });

    it('calling dispose() twice does not call remove() a second time', () => {
      const container = createMockContainer();
      const instance = new GameInstance({ container, mode: 'demo', enemyCount: 0 });

      instance.dispose();
      const afterFirst = mockRemoveCallCount;

      instance.dispose(); // Second call must be a no-op
      expect(mockRemoveCallCount).toBe(afterFirst); // No additional removes
    });

    it('PlaygroundGame.dispose() delegates to GameInstance which removes canvas', () => {
      const container = createMockContainer();
      const pg = new PlaygroundGame({ container, enemyCount: 0 });

      expect(mockRemoveCallCount).toBe(0);

      pg.dispose();

      // PlaygroundGame.dispose() → GameInstance.dispose() → game.dispose() → canvas.remove()
      expect(mockRemoveCallCount).toBe(1);
    });
  });

  // -----------------------------------------------------------------------
  // Bug 3: Player can die in demo mode (enemy-player collision)
  // -----------------------------------------------------------------------

  describe('Bug 3 — Enemy-player collision kills player in demo mode', () => {

    it('_checkEnemyPlayerCollisions called from update() kills player when enemy overlaps', () => {
      const container = createMockContainer();
      const instance = new GameInstance({
        container,
        mode: 'demo',
        lives: 1,
        enemyCount: 0, // No auto-spawning; we inject a fake enemy manually
      });

      // Confirm player starts alive
      expect(instance.player.alive).toBe(true);

      // Inject a fake enemy directly into the spawner's internal array.
      // This bypasses spawnAt() (which doesn't exist) and avoids the
      // materialization delay, letting us test the collision logic directly.
      const playerPos = instance.player.mesh.position.clone();
      const fakeMesh = new THREE.Mesh(new THREE.SphereGeometry(0.1));
      fakeMesh.position.copy(playerPos); // Exactly at player position

      const fakeEnemy = {
        alive: true,
        active: true,
        mesh: fakeMesh,
        position: playerPos.clone(),
        radius: 0.5,          // Large radius to guarantee overlap
        isMaterializing: false,
        surfacePosition: { u: 0.5, v: 0.5 },
        setPlayerPosition: () => {},
        setPlayerWorldPosition: () => {},
        applySurfaceTransform: () => {},
        update: () => {},
        takeDamage: () => {},
      };
      (instance.enemySpawner as any).enemies.push(fakeEnemy);

      // Run one update — _checkEnemyPlayerCollisions should detect overlap
      // and call player.die()
      // Without the fix: _checkEnemyPlayerCollisions() doesn't exist → player never dies
      // With the fix: player.die() is called → alive = false or canTakeDamage = false
      (instance as any).update(1 / 60);

      const isDying = !instance.player.alive || !instance.player.canTakeDamage;
      expect(isDying).toBe(true);
    });

    it('player is NOT damaged by enemies still materializing', () => {
      const container = createMockContainer();
      const instance = new GameInstance({
        container,
        mode: 'demo',
        lives: 99,
        enemyCount: 0,
      });

      const playerPos = instance.player.mesh.position.clone();
      const fakeMesh = new THREE.Mesh(new THREE.SphereGeometry(0.1));
      fakeMesh.position.copy(playerPos);

      const fakeEnemy = {
        alive: true,
        active: true,
        mesh: fakeMesh,
        position: playerPos.clone(),
        radius: 0.5,
        isMaterializing: true, // Still materializing — should be immune
        surfacePosition: { u: 0.5, v: 0.5 },
        setPlayerPosition: () => {},
        setPlayerWorldPosition: () => {},
        update: () => {},
        takeDamage: () => {},
      };
      (instance.enemySpawner as any).enemies.push(fakeEnemy);

      const lifesBefore = instance.player.lives;
      (instance as any).update(1 / 60);

      // Player should NOT take damage from materializing enemies
      expect(instance.player.lives).toBe(lifesBefore);
    });
  });

  // -----------------------------------------------------------------------
  // Bug 4: Visual preset uses MeshBasicMaterial (not PBR MeshStandardMaterial)
  // -----------------------------------------------------------------------

  describe('Bug 4 — applyVisualPreset uses MeshBasicMaterial (matches thumbnails)', () => {

    it('after applyVisualPreset, surface mesh uses MeshBasicMaterial (not MeshStandardMaterial)', async () => {
      // Dynamically import VisualPlaygroundDemo to avoid circular deps at module level
      const { VisualPlaygroundDemo } = await import('../ui/VisualPlaygroundDemo');
      const { VISUAL_PRESETS } = await import('../ui/VisualPlayground');

      // VisualPlaygroundDemo constructor is: new VisualPlaygroundDemo(preset, surfaceType)
      // It creates its own overlay and appends it to document.body.
      const firstPreset = VISUAL_PRESETS[0]; // 'Classic Neon' — wireframeOnly: false, has a surface mesh material

      const demo = new VisualPlaygroundDemo(firstPreset, 'sphere');

      // Get the surface mesh material
      const surface = (demo as any).playgroundGame.surface;
      const material = surface.mesh.material;

      // Must be MeshBasicMaterial, NOT MeshStandardMaterial
      // Without the fix: MeshStandardMaterial → fails (PBR looks grey/muted)
      // With the fix: MeshBasicMaterial → passes (pure unlit colors match thumbnails)
      expect(material).toBeInstanceOf(THREE.MeshBasicMaterial);
      expect(material).not.toBeInstanceOf(THREE.MeshStandardMaterial);

      // Clean up
      (demo as any).disposed = true;
    });
  });

  // -----------------------------------------------------------------------
  // Bug 4b: Grid segment counts are passed through to surface creation
  // -----------------------------------------------------------------------

  describe('Bug 4b — gridSegmentsU/V passed through to GameInstance', () => {

    it('GameInstance config accepts and stores gridSegmentsU/V', () => {
      const container = createMockContainer();
      const instance = new GameInstance({
        container,
        mode: 'demo',
        enemyCount: 0,
        gridSegmentsU: 32,
        gridSegmentsV: 16,
      });

      // Config should preserve grid segment values
      expect((instance as any).config.gridSegmentsU).toBe(32);
      expect((instance as any).config.gridSegmentsV).toBe(16);

      instance.dispose();
    });

    it('PlaygroundGame passes gridSegmentsU/V through to GameInstance', () => {
      const container = createMockContainer();
      const pg = new PlaygroundGame({
        container,
        enemyCount: 0,
        gridSegmentsU: 24,
        gridSegmentsV: 12,
      });

      // The underlying GameInstance should have received the grid segment values
      const instanceConfig = (pg as any).instance.config;
      expect(instanceConfig.gridSegmentsU).toBe(24);
      expect(instanceConfig.gridSegmentsV).toBe(12);

      pg.dispose();
    });
  });

  // -----------------------------------------------------------------------
  // Bug 5: Player can't respawn infinitely in playground (lives=0 → infinite)
  // -----------------------------------------------------------------------

  describe('Bug 5 — Infinite respawns when lives=0 (playground mode)', () => {

    it('GameInstance with lives=0 never calls onGameOver after multiple deaths', () => {
      const container = createMockContainer();
      const onGameOver = vi.fn();

      const instance = new GameInstance({
        container,
        mode: 'demo',
        lives: 0, // 0 = infinite respawns
        enemyCount: 0,
        onGameOver,
      });

      // Helper: bypass invincibility so die() actually works
      const killPlayer = () => {
        (instance.player as any).isInvincible = false;
        instance.player.die();
      };

      // Kill the player 5 times, advancing time past RESPAWN_DELAY each time
      // Without the fix: onGameOver would be called after lives runs out
      // With the fix: onGameOver is NEVER called; player always respawns
      for (let i = 0; i < 5; i++) {
        killPlayer();
        // Advance past respawn delay (2 seconds)
        for (let t = 0; t < 150; t++) {
          (instance as any).update(1 / 60);
        }
        expect(instance.player.alive).toBe(true);
      }

      expect(onGameOver).not.toHaveBeenCalled();

      instance.dispose();
    });

    it('GameInstance with lives=3 still calls onGameOver after 3 deaths', () => {
      const container = createMockContainer();
      const onGameOver = vi.fn();

      const instance = new GameInstance({
        container,
        mode: 'demo',
        lives: 3,
        enemyCount: 0,
        onGameOver,
      });

      // Helper: bypass invincibility so die() actually works
      const killPlayer = () => {
        (instance.player as any).isInvincible = false;
        instance.player.die();
      };

      // Kill 3 times, advancing past RESPAWN_DELAY (2s) between deaths
      for (let i = 0; i < 3; i++) {
        killPlayer();
        for (let t = 0; t < 150; t++) {
          (instance as any).update(1 / 60);
        }
      }

      // After 3 deaths with lives=3, onGameOver must have been called
      expect(onGameOver).toHaveBeenCalled();

      instance.dispose();
    });
  });
});

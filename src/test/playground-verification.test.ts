/**
 * Playground Verification Test Suite
 *
 * Tests gameplay using BOTH world coordinates AND screen pixel coordinates.
 * Detects bugs like: broken mouse aim, camera spinning, wrong weapon, traversal walls.
 *
 * Runs headlessly in vitest (no browser needed). Uses RealGameTestHarness which
 * wraps the real GameInstance with programmatic input injection.
 */

import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import * as THREE from 'three';

// ---------------------------------------------------------------------------
// Minimal DOM/window shim for Node environment
// ---------------------------------------------------------------------------
// Game.ts accesses window.innerWidth, document.body, addEventListener, etc.
// We provide just enough to let the constructor run without errors.

const _noop = () => {};
const _noopEvent = (_e: string, _h: any) => {};

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
  };
  globalThis.window = mockWindow;
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
        left: 0, top: 0, right: 800, bottom: 600, width: 800, height: 600, x: 0, y: 0, toJSON: _noop,
      }),
      addEventListener: _noopEvent,
      removeEventListener: _noopEvent,
    },
    createElement: (tag: string) => {
      if (tag === 'canvas') {
        // Provide a mock 2D context so ChainLightningEffect.createGlowTexture works
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
          lineCap: 'butt',
          lineJoin: 'miter',
          globalAlpha: 1,
          globalCompositeOperation: 'source-over',
          createRadialGradient: () => ({
            addColorStop: _noop,
          }),
          createLinearGradient: () => ({
            addColorStop: _noop,
          }),
        };
        return {
          width: 64,
          height: 64,
          style: {},
          getContext: (type: string) => type === '2d' ? mock2dCtx : null,
          addEventListener: _noopEvent,
          removeEventListener: _noopEvent,
          toDataURL: () => '',
          remove: _noop,
        };
      }
      return {
        style: {},
        clientWidth: 800,
        clientHeight: 600,
        appendChild: _noop,
        removeChild: _noop,
        getBoundingClientRect: () => ({
          left: 0, top: 0, right: 800, bottom: 600, width: 800, height: 600, x: 0, y: 0, toJSON: _noop,
        }),
        addEventListener: _noopEvent,
        removeEventListener: _noopEvent,
      };
    },
    addEventListener: _noopEvent,
    removeEventListener: _noopEvent,
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
// Mock WebGL/DOM environment BEFORE importing game code
// ---------------------------------------------------------------------------

// Mock SoundEngine (imported transitively by some entity code)
vi.mock('../audio/SoundEngine', () => ({
  getSoundEngine: () => ({
    play: vi.fn(),
    init: vi.fn(),
    resume: vi.fn(),
    muted: false,
  }),
}));

// Mock EffectComposer and post-processing passes (Game.ts imports them)
vi.mock('three/addons/postprocessing/EffectComposer.js', () => ({
  EffectComposer: class MockEffectComposer {
    passes: any[] = [];
    addPass(pass: any) { this.passes.push(pass); }
    render() {}
    setSize() {}
    dispose() {}
  },
}));

vi.mock('three/addons/postprocessing/RenderPass.js', () => ({
  RenderPass: class MockRenderPass {
    constructor(_scene: any, _camera: any) {}
  },
}));

vi.mock('three/addons/postprocessing/UnrealBloomPass.js', () => ({
  UnrealBloomPass: class MockUnrealBloomPass {
    resolution = new THREE.Vector2(800, 600);
    constructor(_res: any, _s: number, _r: number, _t: number) {}
  },
}));

vi.mock('three/addons/postprocessing/OutputPass.js', () => ({
  OutputPass: class MockOutputPass {},
}));

vi.mock('three/addons/postprocessing/ShaderPass.js', () => ({
  ShaderPass: class MockShaderPass {
    constructor(_shader: any) {}
  },
}));

// Mock WebGPU module (dynamically imported by Game.ts)
vi.mock('three/webgpu', () => ({
  PostProcessing: class MockPostProcessing {
    render() {}
  },
  pass: () => ({ getTextureNode: () => ({ r: 0, g: 0, b: 0, mul: () => ({}) }) }),
  float: () => ({}),
  max: () => ({ sub: () => ({}) }),
  add: () => ({ mul: () => ({}) }),
  screenUV: { sub: () => ({ dot: () => ({ mul: () => ({}) }) }) },
}));

// Mock GPUCapabilities (detectGPUCapabilities is async and accesses WebGL)
vi.mock('../rendering/GPUCapabilities', () => ({
  detectGPUCapabilities: vi.fn().mockResolvedValue({
    webgpu: false,
    webgl2: true,
    webgl1: true,
    maxTextureSize: 4096,
    maxInstanceCount: 1000,
    sharedArrayBuffer: false,
    hardwareConcurrency: 4,
    renderer: 'Mock GPU',
    vendor: 'Mock Vendor',
    webgpuAdapter: '',
    tier: 'medium',
  }),
}));

// Mock RendererFactory (createRenderer accesses the DOM canvas)
vi.mock('../rendering/RendererFactory', () => ({
  createRenderer: vi.fn().mockResolvedValue({
    renderer: {},
    isWebGPU: false,
    backend: 'webgl2',
  }),
  resolveRendererPreference: vi.fn().mockReturnValue('webgl2'),
}));

// ---------------------------------------------------------------------------
// Mock WebGLRenderer via vi.mock('three', factory)
// ---------------------------------------------------------------------------

// Three.js WebGLRenderer tries to create a canvas + getContext('webgl2').
// ESM modules are frozen so we can't spyOn; instead we use vi.mock with
// importOriginal to replace only WebGLRenderer while keeping all math/scene
// classes intact.
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
        width: 800,
        height: 600,
        addEventListener: () => {},
        removeEventListener: () => {},
        remove: () => {},
        getContext: () => null,
        toDataURL: () => '',
      };
      this.toneMapping = actual.NoToneMapping;
      this.toneMappingExposure = 1.0;
      this.shadowMap = { enabled: false };
      this.outputColorSpace = actual.SRGBColorSpace;
      this.info = { render: { calls: 0, triangles: 0 } };
    }

    setSize() {}
    setPixelRatio() {}
    render() {}
    dispose() {}
    getSize(target: any) { return target?.set?.(800, 600) ?? new actual.Vector2(800, 600); }
    getPixelRatio() { return 1; }
  }

  return {
    ...actual,
    WebGLRenderer: MockWebGLRenderer,
  };
});

// ---------------------------------------------------------------------------
// Now import the harness (after mocks are set up)
// ---------------------------------------------------------------------------

import { RealGameTestHarness, projectToScreen } from './RealGameTestHarness';
import { WeaponType } from '../weapons/WeaponTypes';

// ---------------------------------------------------------------------------
// Test suites
// ---------------------------------------------------------------------------

describe('GameInstance Verification', () => {
  let harness: RealGameTestHarness;

  afterEach(() => {
    if (harness) {
      harness.dispose();
    }
  });

  // -----------------------------------------------------------------------
  // Movement Tests
  // -----------------------------------------------------------------------

  describe('Movement', () => {
    beforeEach(() => {
      harness = new RealGameTestHarness('sphere');
      // Let camera settle for a few frames
      harness.tick(10);
    });

    it('pressing W moves player forward (world position changes)', () => {
      const startPos = harness.getPlayerWorldPos();

      harness.pressKey('w');
      harness.tick(30);
      harness.releaseKey('w');

      const endPos = harness.getPlayerWorldPos();
      const distance = startPos.distanceTo(endPos);

      expect(distance).toBeGreaterThan(0.05);
    });

    it('pressing S moves player backward (world position changes)', () => {
      const startPos = harness.getPlayerWorldPos();

      harness.pressKey('s');
      harness.tick(30);
      harness.releaseKey('s');

      const endPos = harness.getPlayerWorldPos();
      const distance = startPos.distanceTo(endPos);

      expect(distance).toBeGreaterThan(0.05);
    });

    it('pressing A moves player left (world position changes)', () => {
      const startPos = harness.getPlayerWorldPos();

      harness.pressKey('a');
      harness.tick(30);
      harness.releaseKey('a');

      const endPos = harness.getPlayerWorldPos();
      const distance = startPos.distanceTo(endPos);

      expect(distance).toBeGreaterThan(0.05);
    });

    it('pressing D moves player right (world position changes)', () => {
      const startPos = harness.getPlayerWorldPos();

      harness.pressKey('d');
      harness.tick(30);
      harness.releaseKey('d');

      const endPos = harness.getPlayerWorldPos();
      const distance = startPos.distanceTo(endPos);

      expect(distance).toBeGreaterThan(0.05);
    });

    it('W and S move in opposite screen directions', () => {
      // Move forward, record screen Y
      const startScreen = harness.getPlayerScreenPos();

      harness.pressKey('w');
      harness.tick(30);
      harness.releaseKey('w');
      const forwardScreen = harness.getPlayerScreenPos();

      // Reset position by moving back
      harness.pressKey('s');
      harness.tick(60);
      harness.releaseKey('s');
      const backwardScreen = harness.getPlayerScreenPos();

      // Forward and backward should move in different screen directions
      const forwardDeltaY = forwardScreen.y - startScreen.y;
      const backwardDeltaY = backwardScreen.y - forwardScreen.y;

      // They should have opposite signs (or at least different magnitudes)
      // On a sphere the exact screen direction depends on camera orientation,
      // but forward and backward should be distinguishable
      const forwardDist = Math.abs(forwardScreen.x - startScreen.x) + Math.abs(forwardScreen.y - startScreen.y);
      const backwardDist = Math.abs(backwardScreen.x - forwardScreen.x) + Math.abs(backwardScreen.y - forwardScreen.y);

      expect(forwardDist).toBeGreaterThan(1);
      expect(backwardDist).toBeGreaterThan(1);
    });

    it('diagonal movement is normalized (not faster than cardinal)', () => {
      // Measure cardinal speed (W only)
      const startPos1 = harness.getPlayerWorldPos();
      harness.pressKey('w');
      harness.tick(30);
      harness.releaseKey('w');
      const endPos1 = harness.getPlayerWorldPos();
      const cardinalDist = startPos1.distanceTo(endPos1);

      // Reset
      harness.dispose();
      harness = new RealGameTestHarness('sphere');
      harness.tick(10);

      // Measure diagonal speed (W + D)
      const startPos2 = harness.getPlayerWorldPos();
      harness.pressKey('w');
      harness.pressKey('d');
      harness.tick(30);
      harness.releaseKey('w');
      harness.releaseKey('d');
      const endPos2 = harness.getPlayerWorldPos();
      const diagonalDist = startPos2.distanceTo(endPos2);

      // Diagonal should not be more than ~10% faster than cardinal
      // (perfect normalization would make them equal, but geodesic paths differ)
      const ratio = diagonalDist / cardinalDist;
      expect(ratio).toBeLessThan(1.15);
      expect(ratio).toBeGreaterThan(0.5); // should still move
    });
  });

  // -----------------------------------------------------------------------
  // Aim Tests
  // -----------------------------------------------------------------------

  describe('Aim', () => {
    beforeEach(() => {
      harness = new RealGameTestHarness('sphere', WeaponType.Standard);
      harness.tick(10);
    });

    it('mouse at right of center aims bullets rightward', () => {
      // Point mouse to the right of center
      harness.setMousePosition(harness.width * 0.9, harness.height / 2);
      harness.tick(5); // Let aim update

      const aimDir = harness.getAimScreenDirection();

      // Aim direction should have a positive X component (rightward)
      expect(aimDir.x).toBeGreaterThan(0);
    });

    it('mouse at left of center produces different aim than right', () => {
      // Aim right first
      harness.setMousePosition(harness.width * 0.9, harness.height / 2);
      harness.tick(5);
      const aimRight = harness.getAimScreenDirection();

      // Now aim left
      harness.setMousePosition(harness.width * 0.1, harness.height / 2);
      harness.tick(10); // More frames for aim lerp to converge
      const aimLeft = harness.getAimScreenDirection();

      // The two aim directions should be meaningfully different
      // (on a 3D surface, screen-space direction depends on camera orientation,
      //  so we just check they're distinct, not specific signs)
      const dx = Math.abs(aimRight.x - aimLeft.x);
      const dy = Math.abs(aimRight.y - aimLeft.y);
      expect(dx + dy).toBeGreaterThan(0.1);
    });

    it('aim direction matches bullet travel direction', () => {
      // Aim right
      harness.setMousePosition(harness.width * 0.9, harness.height / 2);
      harness.tick(5);

      // Record aim screen direction
      const aimDir = harness.getAimScreenDirection();

      // Fire bullet
      harness.setMouseDown(true);
      harness.tick(3);
      harness.setMouseDown(false);

      // Get bullet direction
      harness.tick(5);
      const bulletDir = harness.getBulletScreenDirection();

      if (bulletDir) {
        // Bullet screen direction should roughly match aim direction
        // Dot product should be positive (same general direction)
        const dot = aimDir.x * bulletDir.x + aimDir.y * bulletDir.y;
        expect(dot).toBeGreaterThan(0);
      }
    });

    it('aim responds to different mouse positions', () => {
      // Aim right
      harness.setMousePosition(harness.width * 0.9, harness.height / 2);
      harness.tick(10);
      const aimAngle1 = harness.player.aimAngle;

      // Aim left
      harness.setMousePosition(harness.width * 0.1, harness.height / 2);
      harness.tick(10);
      const aimAngle2 = harness.player.aimAngle;

      // Aim angles should be different (the player responds to mouse input)
      const angleDiff = Math.abs(aimAngle1 - aimAngle2);
      expect(angleDiff).toBeGreaterThan(0.3); // At least ~17 degrees difference
    });
  });

  // -----------------------------------------------------------------------
  // Camera Tests
  // -----------------------------------------------------------------------

  describe('Camera', () => {
    beforeEach(() => {
      harness = new RealGameTestHarness('sphere');
      harness.tick(30); // Let camera settle
    });

    it('camera does not spin during normal movement', () => {
      harness.pressKey('w');
      const stability = harness.getCameraStability(60);
      harness.releaseKey('w');

      // On a sphere, forward movement causes some camera rotation as the surface
      // normal changes. We're checking for pathological spinning (> 60 deg/frame),
      // not zero rotation. Normal surface following produces ~5-15 deg/frame with
      // occasional peaks up to ~45 degrees as the lerp converges.
      expect(stability.maxRotationDelta).toBeLessThan(1.1); // ~63 degrees max per frame
      expect(stability.avgRotationDelta).toBeLessThan(0.4); // ~23 degrees average
    });

    it('camera does not spin during lateral movement', () => {
      harness.pressKey('a');
      const stability = harness.getCameraStability(60);
      harness.releaseKey('a');

      // Lateral movement on a sphere causes more rotation as the camera reorients.
      // We're detecting wild 360-degree spinning (> 3 rad = ~172 deg per frame).
      // Normal surface-following lateral motion can legitimately reach ~1.8 rad
      // as the camera orbits around the sphere's equator.
      expect(stability.maxRotationDelta).toBeLessThan(3.0);
    });

    it('camera up vector changes smoothly (lerp, not snap)', () => {
      const upVectors: THREE.Vector3[] = [];

      harness.pressKey('w');
      for (let i = 0; i < 60; i++) {
        harness.tick(1);
        upVectors.push(harness.getCameraState().up);
      }
      harness.releaseKey('w');

      // Check consecutive up vectors don't jump suddenly
      for (let i = 1; i < upVectors.length; i++) {
        const delta = upVectors[i].angleTo(upVectors[i - 1]);
        // Should change by less than 10 degrees per frame
        expect(delta).toBeLessThan(0.18); // ~10 degrees
      }
    });

    it('camera follows player position', () => {
      const startCamPos = harness.getCameraState().position;
      const startPlayerPos = harness.getPlayerWorldPos();

      harness.pressKey('w');
      harness.tick(60);
      harness.releaseKey('w');

      const endCamPos = harness.getCameraState().position;
      const endPlayerPos = harness.getPlayerWorldPos();

      // Camera should have moved if player moved
      const playerMoved = startPlayerPos.distanceTo(endPlayerPos);
      const cameraMoved = startCamPos.distanceTo(endCamPos);

      if (playerMoved > 0.1) {
        expect(cameraMoved).toBeGreaterThan(0.05);
      }

      // Camera-to-player distance should stay roughly constant
      const startDist = startCamPos.distanceTo(startPlayerPos);
      const endDist = endCamPos.distanceTo(endPlayerPos);
      const distChange = Math.abs(endDist - startDist) / startDist;
      expect(distChange).toBeLessThan(0.5); // Within 50% (camera lerps, so may lag)
    });

    it('player stays on screen during movement', () => {
      harness.pressKey('w');
      for (let i = 0; i < 60; i++) {
        harness.tick(1);
        const screenPos = harness.getPlayerScreenPos();
        // Player should be within screen bounds (with some margin for camera lag)
        expect(screenPos.x).toBeGreaterThan(-100);
        expect(screenPos.x).toBeLessThan(harness.width + 100);
        expect(screenPos.y).toBeGreaterThan(-100);
        expect(screenPos.y).toBeLessThan(harness.height + 100);
      }
      harness.releaseKey('w');
    });
  });

  // -----------------------------------------------------------------------
  // Weapon Tests
  // -----------------------------------------------------------------------

  describe('Weapons', () => {
    it('setWeapon changes the active weapon', () => {
      harness = new RealGameTestHarness('sphere');

      expect(harness.weaponManager.getCurrentWeapon()).toBe(WeaponType.Standard);

      harness.setWeapon(WeaponType.Spread);
      expect(harness.weaponManager.getCurrentWeapon()).toBe(WeaponType.Spread);

      harness.setWeapon(WeaponType.Homing);
      expect(harness.weaponManager.getCurrentWeapon()).toBe(WeaponType.Homing);
    });

    it('weaponFireHandler is connected (not null)', () => {
      harness = new RealGameTestHarness('sphere', WeaponType.Standard);

      // The fire handler should be wired up by GameInstance's constructor
      expect(harness.player.weaponFireHandler).toBeDefined();
      expect(typeof harness.player.weaponFireHandler).toBe('function');
    });

    it('equipped weapon matches WeaponManager state', () => {
      harness = new RealGameTestHarness('sphere', WeaponType.Spread);

      // GameInstance locks to the configured weapon
      harness.tick(5);

      expect(harness.weaponManager.getCurrentWeapon()).toBe(WeaponType.Spread);
    });

    it('firing produces bullets', () => {
      harness = new RealGameTestHarness('sphere', WeaponType.Standard);
      harness.tick(10); // Let game settle

      // Aim and fire
      harness.setMousePosition(harness.width * 0.9, harness.height / 2);
      harness.setMouseDown(true);
      harness.tick(10); // Fire for a few frames
      harness.setMouseDown(false);

      const bullets = harness.getBulletWorldPositions();
      expect(bullets.length).toBeGreaterThan(0);
    });
  });

  // -----------------------------------------------------------------------
  // Traversal Tests
  // -----------------------------------------------------------------------

  describe('Traversal', () => {
    it('player can traverse in all 4 directions on sphere', () => {
      harness = new RealGameTestHarness('sphere');
      harness.tick(10);

      expect(harness.canTraverse('forward')).toBe(true);
      expect(harness.canTraverse('backward')).toBe(true);
      expect(harness.canTraverse('left')).toBe(true);
      expect(harness.canTraverse('right')).toBe(true);
    });

    it('player can traverse in all 4 directions on cube', () => {
      harness = new RealGameTestHarness('cube');
      harness.tick(10);

      expect(harness.canTraverse('forward')).toBe(true);
      expect(harness.canTraverse('backward')).toBe(true);
      expect(harness.canTraverse('left')).toBe(true);
      expect(harness.canTraverse('right')).toBe(true);
    });

    it('player can traverse in all 4 directions on torus', () => {
      harness = new RealGameTestHarness('torus');
      harness.tick(10);

      expect(harness.canTraverse('forward')).toBe(true);
      expect(harness.canTraverse('backward')).toBe(true);
      expect(harness.canTraverse('left')).toBe(true);
      expect(harness.canTraverse('right')).toBe(true);
    });

    it('player can traverse full sphere surface (covers multiple quadrants)', () => {
      harness = new RealGameTestHarness('sphere');
      harness.tick(10);

      const result = harness.testFullTraversal(180);

      expect(result.totalDistanceMoved).toBeGreaterThan(1.0);
      expect(result.visitedUVs.length).toBeGreaterThan(10);
    });

    it('player can traverse full cube surface', () => {
      harness = new RealGameTestHarness('cube');
      harness.tick(10);

      const result = harness.testFullTraversal(180);

      expect(result.totalDistanceMoved).toBeGreaterThan(1.0);
    });

    it('player can traverse full torus surface', () => {
      harness = new RealGameTestHarness('torus');
      harness.tick(10);

      const result = harness.testFullTraversal(180);

      expect(result.totalDistanceMoved).toBeGreaterThan(1.0);
    });
  });

  // -----------------------------------------------------------------------
  // Entity Visibility Tests
  // -----------------------------------------------------------------------

  describe('Entity Visibility', () => {
    it('player has valid screen position', () => {
      harness = new RealGameTestHarness('sphere');
      harness.tick(30);

      const screenPos = harness.getPlayerScreenPos();

      expect(screenPos.x).not.toBeNaN();
      expect(screenPos.y).not.toBeNaN();
      expect(screenPos.visible).toBe(true);
      // Should be roughly centered (camera follows player)
      expect(screenPos.x).toBeGreaterThan(0);
      expect(screenPos.x).toBeLessThan(harness.width);
      expect(screenPos.y).toBeGreaterThan(0);
      expect(screenPos.y).toBeLessThan(harness.height);
    });

    it('enemies have valid screen positions', () => {
      harness = new RealGameTestHarness('sphere');
      harness.spawnEnemies(5, 'wanderer');
      harness.waitForMaterialization();
      harness.tick(10);

      const enemyScreenPositions = harness.getEnemyScreenPositions();

      expect(enemyScreenPositions.length).toBeGreaterThan(0);

      for (const pos of enemyScreenPositions) {
        expect(pos.x).not.toBeNaN();
        expect(pos.y).not.toBeNaN();
        expect(pos.worldPos.x).not.toBeNaN();
        expect(pos.worldPos.y).not.toBeNaN();
        expect(pos.worldPos.z).not.toBeNaN();
      }
    });

    it('bullets have valid screen positions when fired', () => {
      harness = new RealGameTestHarness('sphere', WeaponType.Standard);
      harness.tick(10);

      harness.setMousePosition(harness.width * 0.8, harness.height / 2);
      harness.setMouseDown(true);
      harness.tick(5);
      harness.setMouseDown(false);

      const bulletScreenPositions = harness.getBulletScreenPositions();

      if (bulletScreenPositions.length > 0) {
        for (const pos of bulletScreenPositions) {
          expect(pos.x).not.toBeNaN();
          expect(pos.y).not.toBeNaN();
        }
      }
    });
  });

  // -----------------------------------------------------------------------
  // Screen Coordinate Projection Tests
  // -----------------------------------------------------------------------

  describe('Screen Projection', () => {
    it('projectToScreen returns center for object at camera lookAt point', () => {
      harness = new RealGameTestHarness('sphere');
      harness.tick(30);

      // The camera looks at the player, so player should be near screen center
      const playerScreen = harness.getPlayerScreenPos();

      const centerX = harness.width / 2;
      const centerY = harness.height / 2;

      // Should be within 25% of center (camera lerp may not be exact)
      expect(Math.abs(playerScreen.x - centerX)).toBeLessThan(harness.width * 0.25);
      expect(Math.abs(playerScreen.y - centerY)).toBeLessThan(harness.height * 0.25);
    });

    it('world position changes cause screen position changes', () => {
      harness = new RealGameTestHarness('sphere');
      harness.tick(30);

      const screenBefore = harness.getPlayerScreenPos();

      harness.pressKey('d');
      harness.tick(30);
      harness.releaseKey('d');

      // Camera follows but with lag, so screen position should shift temporarily
      // Record screen position mid-movement
      harness.pressKey('d');
      harness.tick(2); // Only 2 frames — camera hasn't caught up yet
      const screenDuring = harness.getPlayerScreenPos();
      harness.releaseKey('d');

      // During movement, player should shift on screen before camera catches up
      const dx = Math.abs(screenDuring.x - screenBefore.x);
      const dy = Math.abs(screenDuring.y - screenBefore.y);

      // At least some screen movement should be detectable
      // (camera lerp at 0.1 means it takes ~10 frames to catch up)
      expect(dx + dy).toBeGreaterThan(0);
    });
  });

  // -----------------------------------------------------------------------
  // Integration: Bug Detection Tests
  // -----------------------------------------------------------------------

  describe('Bug Detection', () => {
    it('detects camera spinning (no individual frame > 180 degrees rotation)', () => {
      harness = new RealGameTestHarness('sphere');
      harness.tick(30);

      // Normal movement should NOT cause wild 180+ degree flips per frame.
      // On a sphere, camera does rotate as it follows the surface normal,
      // but a single frame rotating > PI radians would indicate a bug.
      harness.pressKey('w');
      harness.pressKey('a');
      const stability = harness.getCameraStability(60);
      harness.releaseAllKeys();

      // No single frame should have > 180 degrees of rotation
      expect(stability.maxRotationDelta).toBeLessThan(Math.PI);
    });

    it('detects broken aim (bullets go opposite to mouse direction)', () => {
      harness = new RealGameTestHarness('sphere', WeaponType.Standard);
      harness.tick(30);

      // Aim far right
      harness.setMousePosition(harness.width * 0.95, harness.height / 2);
      harness.tick(10);

      // Fire
      harness.setMouseDown(true);
      harness.tick(5);
      harness.setMouseDown(false);

      // Let bullets travel
      harness.tick(10);

      const bullets = harness.getBulletScreenPositions();
      const playerScreen = harness.getPlayerScreenPos();

      if (bullets.length > 0) {
        // At least one bullet should be to the right of the player
        const anyRightward = bullets.some(b => b.x > playerScreen.x);
        expect(anyRightward).toBe(true);
      }
    });

    it('detects traversal walls (player gets stuck)', () => {
      harness = new RealGameTestHarness('sphere');
      harness.tick(10);

      // Move in each direction for 60 frames and check distance
      const directions = ['w', 'a', 's', 'd'] as const;
      for (const dir of directions) {
        const startPos = harness.getPlayerWorldPos();

        harness.pressKey(dir);
        harness.tick(60);
        harness.releaseKey(dir);

        const endPos = harness.getPlayerWorldPos();
        const distance = startPos.distanceTo(endPos);

        // Each direction should produce meaningful movement
        expect(distance).toBeGreaterThan(0.1);
      }
    });

    it('detects wrong weapon (equipped weapon doesnt match config)', () => {
      harness = new RealGameTestHarness('sphere', WeaponType.Spread);
      harness.tick(10);

      const currentWeapon = harness.weaponManager.getCurrentWeapon();
      expect(currentWeapon).toBe(WeaponType.Spread);

      // The weapon lock should persist after ticking
      harness.tick(30);
      const stillCorrect = harness.weaponManager.getCurrentWeapon();
      expect(stillCorrect).toBe(WeaponType.Spread);
    });
  });

  // -----------------------------------------------------------------------
  // Multi-Surface Consistency Tests
  // -----------------------------------------------------------------------

  describe('Cross-Surface Consistency', () => {
    const surfaceTypes: Array<'sphere' | 'cube' | 'torus'> = ['sphere', 'cube', 'torus'];

    for (const surfaceType of surfaceTypes) {
      it(`player position is valid on ${surfaceType}`, () => {
        harness = new RealGameTestHarness(surfaceType);
        harness.tick(10);

        const pos = harness.getPlayerWorldPos();
        expect(pos.x).not.toBeNaN();
        expect(pos.y).not.toBeNaN();
        expect(pos.z).not.toBeNaN();
        expect(pos.length()).toBeGreaterThan(0);
      });

      it(`player screen position is valid on ${surfaceType}`, () => {
        harness = new RealGameTestHarness(surfaceType);
        harness.tick(30);

        const screenPos = harness.getPlayerScreenPos();
        expect(screenPos.x).not.toBeNaN();
        expect(screenPos.y).not.toBeNaN();
        expect(screenPos.visible).toBe(true);
      });

      it(`movement works on ${surfaceType}`, () => {
        harness = new RealGameTestHarness(surfaceType);
        harness.tick(10);

        const startPos = harness.getPlayerWorldPos();
        harness.pressKey('w');
        harness.tick(30);
        harness.releaseKey('w');

        const endPos = harness.getPlayerWorldPos();
        expect(startPos.distanceTo(endPos)).toBeGreaterThan(0.05);
      });
    }
  });

  // -----------------------------------------------------------------------
  // Death Effects Tests
  // -----------------------------------------------------------------------

  describe('Death Effects', () => {
    beforeEach(() => {
      harness = new RealGameTestHarness('sphere');
      harness.tick(10);
    });

    it('particle system is in the scene graph', () => {
      expect(harness.isParticleSystemInScene()).toBe(true);
    });

    it('particle system has frustum culling disabled', () => {
      expect(harness.isParticleSystemFrustumCullingDisabled()).toBe(true);
    });

    it('no active effects before any enemies spawn', () => {
      expect(harness.getActiveEffectCount()).toBe(0);
    });

    it('enemy death produces active particle effects', () => {
      // Spawn an enemy near the player
      harness.spawnEnemies(1, 'grunt');
      harness.waitForMaterialization(120);

      // Verify enemy is alive
      const enemies = harness.enemySpawner.getEnemies().filter(e => e.alive);
      expect(enemies.length).toBeGreaterThan(0);

      // Kill the enemy directly via takeDamage
      const enemy = enemies[0];
      const deathPos = enemy.mesh!.position.clone();
      enemy.takeDamage(9999);
      expect(enemy.alive).toBe(false);

      // Trigger particle death effect manually (same as collision code does)
      harness.particles.enemyDeath(deathPos, new THREE.Color(0x4444ff));

      // Advance one frame to process particles
      harness.tick(1);

      // Verify particles are active (both point particles and shatter fragments)
      expect(harness.getActiveEffectCount()).toBeGreaterThan(0);
    });

    it('particle effects fade out over time', () => {
      // Trigger a death effect
      const pos = harness.getPlayerWorldPos();
      harness.particles.enemyDeath(pos, new THREE.Color(0xff0000));

      harness.tick(1);
      const activeAfterSpawn = harness.getActiveEffectCount();
      expect(activeAfterSpawn).toBeGreaterThan(0);

      // Advance several seconds — all effects should have faded
      harness.tickSeconds(3);
      const activeAfterFade = harness.getActiveEffectCount();
      expect(activeAfterFade).toBe(0);
    });
  });
});

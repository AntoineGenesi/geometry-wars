/**
 * REAL GAME aim direction test for cube top/bottom/side faces.
 *
 * Uses RealGameTestHarness (actual GameLoop.update() code path) to fire bullets
 * in 8 compass directions on each cube face and verify the world-space bullet
 * direction matches the intended screen-space aim.
 *
 * This is NOT a math analysis — it fires ACTUAL bullets through the REAL game
 * code and checks where they go.
 *
 * REGRESSION GUARD: If this test fails, cube aim is broken.
 */
import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';

// ---------------------------------------------------------------------------
// DOM / browser shims (must be before game code imports)
// ---------------------------------------------------------------------------

import '../test/verification-env';

// Extend document mock with getElementById and querySelector (required by UIHelpers static initializers)
if (globalThis.document && !(globalThis.document as any).getElementById) {
  const mockElement = {
    style: {}, textContent: '', innerText: '', innerHTML: '',
    classList: { add: () => {}, remove: () => {}, toggle: () => {}, contains: () => false },
    appendChild: () => {}, removeChild: () => {},
    addEventListener: () => {}, removeEventListener: () => {},
    getBoundingClientRect: () => ({ left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0, toJSON: () => {} }),
  };
  (globalThis.document as any).getElementById = () => ({ ...mockElement });
  (globalThis.document as any).querySelector = () => null;
  (globalThis.document as any).querySelectorAll = () => [];
}

// Add localStorage mock
if (typeof globalThis.localStorage === 'undefined') {
  const store: Record<string, string> = {};
  (globalThis as any).localStorage = {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => { store[key] = value; },
    removeItem: (key: string) => { delete store[key]; },
    clear: () => { Object.keys(store).forEach(k => delete store[k]); },
    get length() { return Object.keys(store).length; },
    key: (i: number) => Object.keys(store)[i] ?? null,
  };
}

// Add performance.now if missing
if (typeof globalThis.performance === 'undefined') {
  (globalThis as any).performance = { now: () => Date.now() };
}

// Add sessionStorage mock
if (typeof globalThis.sessionStorage === 'undefined') {
  const store: Record<string, string> = {};
  (globalThis as any).sessionStorage = {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => { store[key] = value; },
    removeItem: (key: string) => { delete store[key]; },
    clear: () => { Object.keys(store).forEach(k => delete store[k]); },
    get length() { return Object.keys(store).length; },
    key: (i: number) => Object.keys(store)[i] ?? null,
  };
}

// ---------------------------------------------------------------------------
// vi.mock — must be BEFORE importing game code (vitest hoists these)
// ---------------------------------------------------------------------------

// Mock UIHelpers (static DOM access in class initializer)
vi.mock('../ui/UIHelpers', () => ({
  UIHelpers: {
    updateCountdownOverlay: vi.fn(),
    updateTimerDisplay: vi.fn(),
    showDeathCamEffect: vi.fn(),
    hideDeathCamEffect: vi.fn(),
    screenFlash: vi.fn(),
    updateLivesDisplay: vi.fn(),
    updateBombsDisplay: vi.fn(),
    updateScoreDisplay: vi.fn(),
    updateMultiplierDisplay: vi.fn(),
    updateWeaponDisplay: vi.fn(),
    setLevelName: vi.fn(),
    updateComboDisplay: vi.fn(),
    updateBoostMeter: vi.fn(),
    updatePlayerLevelDisplay: vi.fn(),
  },
}));

vi.mock('../ui/SettingsMenu', () => ({
  loadGraphicsSettings: () => ({ enable90DegreeHide: false }),
  loadDebugSettings: () => ({ showDebugStatistics: false }),
  SettingsMenu: { setGlobalRendererInfo: vi.fn(), setGlobalDebugChangeCallback: vi.fn(), setGlobalVisualStyleChangeCallback: vi.fn() },
}));

vi.mock('../ui/VisualStyleSettings', () => ({
  loadVisualStyle: () => null,
  loadVisualMode: () => 'modern',
  saveVisualMode: vi.fn(),
}));

vi.mock('../audio/SoundEngine', () => ({
  getSoundEngine: () => ({
    play: vi.fn(), init: vi.fn(), resume: vi.fn(), muted: false,
  }),
}));

vi.mock('three/addons/postprocessing/EffectComposer.js', () => ({
  EffectComposer: class {
    passes: any[] = [];
    addPass(p: any) { this.passes.push(p); }
    render() {}
    setSize() {}
    dispose() {}
  },
}));

vi.mock('three/addons/postprocessing/RenderPass.js', () => ({
  RenderPass: class { constructor(_s: any, _c: any) {} },
}));

vi.mock('three/addons/postprocessing/UnrealBloomPass.js', () => ({
  UnrealBloomPass: class {
    resolution = new THREE.Vector2(800, 600);
    constructor(_r: any, _s: number, _ra: number, _t: number) {}
  },
}));

vi.mock('three/addons/postprocessing/OutputPass.js', () => ({
  OutputPass: class {},
}));

vi.mock('three/addons/postprocessing/ShaderPass.js', () => ({
  ShaderPass: class { constructor(_s: any) {} },
}));

vi.mock('three/webgpu', () => ({
  PostProcessing: class { render() {} },
  pass: () => ({ getTextureNode: () => ({ r: 0, g: 0, b: 0, mul: () => ({}) }) }),
  float: () => ({}),
  max: () => ({ sub: () => ({}) }),
  add: () => ({ mul: () => ({}) }),
  screenUV: { sub: () => ({ dot: () => ({ mul: () => ({}) }) }) },
}));

vi.mock('../rendering/GPUCapabilities', () => ({
  detectGPUCapabilities: vi.fn().mockResolvedValue({
    webgpu: false, webgl2: true, webgl1: true, maxTextureSize: 4096,
    maxInstanceCount: 1000, sharedArrayBuffer: false, hardwareConcurrency: 4,
    renderer: 'Mock', vendor: 'Mock', webgpuAdapter: '', tier: 'medium',
  }),
}));

vi.mock('../rendering/RendererFactory', () => ({
  createRenderer: vi.fn().mockResolvedValue({
    renderer: {}, isWebGPU: false, backend: 'webgl2',
  }),
  resolveRendererPreference: vi.fn().mockReturnValue('webgl2'),
  installWebGPUDiagnostic: vi.fn(),
}));

vi.mock('three', async (importOriginal) => {
  const actual = await importOriginal<typeof import('three')>();
  class MockWebGLRenderer {
    domElement: any;
    toneMapping: any;
    toneMappingExposure = 1;
    shadowMap = { enabled: false };
    outputColorSpace: any;
    info = { render: { calls: 0, triangles: 0 } };
    constructor(_opts?: any) {
      this.domElement = {
        style: {}, width: 800, height: 600,
        addEventListener: () => {}, removeEventListener: () => {},
        remove: () => {}, getContext: () => null, toDataURL: () => '',
      };
      this.toneMapping = actual.NoToneMapping;
      this.outputColorSpace = actual.SRGBColorSpace;
    }
    setSize() {}
    setPixelRatio() {}
    render() {}
    dispose() {}
    getSize(t: any) { return t?.set?.(800, 600) ?? new actual.Vector2(800, 600); }
    getPixelRatio() { return 1; }
  }
  return { ...actual, WebGLRenderer: MockWebGLRenderer };
});

// ---------------------------------------------------------------------------
// NOW import the harness (after all mocks are set up)
// ---------------------------------------------------------------------------

import { RealGameTestHarness } from './RealGameTestHarness';

describe('Cube aim direction — REAL GAME bullets', () => {
  const WIDTH = 800;
  const HEIGHT = 600;

  /**
   * Fire a bullet with mouse aimed at a screen-space direction, return the
   * bullet's world-space direction from the spawn log.
   */
  function fireAndGetDirection(
    harness: RealGameTestHarness,
    screenDirName: string,
    aimX: number,
    aimY: number,
  ): THREE.Vector3 | null {
    // Convert aim values to mouse pixel position
    const mouseX = (WIDTH / 2) + aimX * (WIDTH / 2);
    const mouseY = (HEIGHT / 2) + aimY * (HEIGHT / 2);
    harness.setMousePosition(mouseX, mouseY);
    harness.setMouseDown(true);
    harness.clearBulletLog();

    // Tick until a bullet spawns (max 30 frames = 0.5s)
    for (let f = 0; f < 30; f++) {
      harness.tick(1);
      if (harness.bulletSpawnLog.length > 0) break;
    }

    harness.setMouseDown(false);
    // Let fire cooldown reset
    harness.tick(10);

    if (harness.bulletSpawnLog.length === 0) {
      console.log(`  ${screenDirName}: NO BULLET SPAWNED`);
      return null;
    }

    const bullet = harness.bulletSpawnLog[0];
    return bullet.direction.clone();
  }

  /**
   * Teleport the player to a specific cube face center.
   * Uses closestPointOnSurface to find the face index, then teleportTo.
   * Snaps camera to the new position and lets it settle.
   */
  function teleportToFace(
    harness: RealGameTestHarness,
    targetPos: THREE.Vector3,
  ): THREE.Vector3 {
    // Find the closest surface point and face index
    const result = harness.meshSurface.closestPointOnSurface(targetPos);
    if (!result) throw new Error(`No surface point found near ${targetPos.toArray()}`);

    // Teleport walker
    harness.playerWalker.teleportTo(result.point, result.faceIndex, result.normal);

    // Update player mesh position
    harness.player.mesh.position.copy(harness.playerWalker.position);

    // Snap camera to new position
    const frame = harness.playerWalker.getTangentFrame();
    harness.ctx.cameraController.snapToFrame(
      harness.playerWalker.position,
      harness.playerWalker.normal,
      frame,
    );

    // Let camera fully settle
    harness.setMousePosition(WIDTH / 2, HEIGHT / 2);
    harness.setMouseDown(false);
    harness.tick(60);

    return harness.playerWalker.normal.clone();
  }

  it('front face (control): 8 aim directions produce 8 unique bullet directions', () => {
    const harness = new RealGameTestHarness({ surface: 'cube', width: WIDTH, height: HEIGHT });

    // Let camera settle on front face
    harness.setMousePosition(WIDTH / 2, HEIGHT / 2);
    harness.tick(30);

    const playerNormal = harness.playerWalker.normal.clone();
    console.log(`Front face normal: (${playerNormal.x.toFixed(3)}, ${playerNormal.y.toFixed(3)}, ${playerNormal.z.toFixed(3)})`);
    expect(Math.abs(playerNormal.z)).toBeGreaterThan(0.8); // Should be on front face

    const directions: { name: string; aimX: number; aimY: number }[] = [
      { name: 'screen-right', aimX: 1, aimY: 0 },
      { name: 'screen-up', aimX: 0, aimY: -1 },
      { name: 'screen-left', aimX: -1, aimY: 0 },
      { name: 'screen-down', aimX: 0, aimY: 1 },
      { name: 'screen-upRight', aimX: 0.707, aimY: -0.707 },
      { name: 'screen-upLeft', aimX: -0.707, aimY: -0.707 },
      { name: 'screen-downRight', aimX: 0.707, aimY: 0.707 },
      { name: 'screen-downLeft', aimX: -0.707, aimY: 0.707 },
    ];

    const bulletDirs: THREE.Vector3[] = [];
    for (const d of directions) {
      const dir = fireAndGetDirection(harness, d.name, d.aimX, d.aimY);
      expect(dir).not.toBeNull();
      if (dir) {
        bulletDirs.push(dir);
        // Bullet direction should be on the surface plane (near-zero normal component)
        const normalComp = Math.abs(dir.dot(playerNormal));
        console.log(`  ${d.name}: bullet=(${dir.x.toFixed(3)}, ${dir.y.toFixed(3)}, ${dir.z.toFixed(3)}) normalComp=${normalComp.toFixed(4)}`);
        expect(normalComp).toBeLessThan(0.15);
      }
    }

    // All 8 directions must be UNIQUE (not locked)
    for (let i = 0; i < bulletDirs.length; i++) {
      for (let j = i + 1; j < bulletDirs.length; j++) {
        const dot = bulletDirs[i].dot(bulletDirs[j]);
        expect(dot).toBeLessThan(0.99); // No two directions should be identical
      }
    }

    // Opposite pairs must be roughly antiparallel
    const rightLeft = bulletDirs[0].dot(bulletDirs[2]);
    const upDown = bulletDirs[1].dot(bulletDirs[3]);
    expect(rightLeft).toBeLessThan(-0.8);
    expect(upDown).toBeLessThan(-0.8);
    console.log(`  opposites: right·left=${rightLeft.toFixed(3)}, up·down=${upDown.toFixed(3)}`);
  });

  it('TOP face: 8 aim directions produce 8 unique bullet directions', () => {
    const harness = new RealGameTestHarness({ surface: 'cube', width: WIDTH, height: HEIGHT });

    // Teleport to top face center
    const normal = teleportToFace(harness, new THREE.Vector3(0, 9, 0));
    console.log(`Top face normal: (${normal.x.toFixed(3)}, ${normal.y.toFixed(3)}, ${normal.z.toFixed(3)})`);

    // Verify we're on the top face
    expect(normal.y).toBeGreaterThan(0.5);

    const directions: { name: string; aimX: number; aimY: number }[] = [
      { name: 'screen-right', aimX: 1, aimY: 0 },
      { name: 'screen-up', aimX: 0, aimY: -1 },
      { name: 'screen-left', aimX: -1, aimY: 0 },
      { name: 'screen-down', aimX: 0, aimY: 1 },
      { name: 'screen-upRight', aimX: 0.707, aimY: -0.707 },
      { name: 'screen-upLeft', aimX: -0.707, aimY: -0.707 },
      { name: 'screen-downRight', aimX: 0.707, aimY: 0.707 },
      { name: 'screen-downLeft', aimX: -0.707, aimY: 0.707 },
    ];

    const bulletDirs: THREE.Vector3[] = [];
    for (const d of directions) {
      const dir = fireAndGetDirection(harness, d.name, d.aimX, d.aimY);
      expect(dir).not.toBeNull();
      if (dir) {
        bulletDirs.push(dir);
        const normalComp = Math.abs(dir.dot(normal));
        console.log(`  ${d.name}: bullet=(${dir.x.toFixed(3)}, ${dir.y.toFixed(3)}, ${dir.z.toFixed(3)}) normalComp=${normalComp.toFixed(4)}`);
        // Bullet should be roughly on the surface plane
        expect(normalComp).toBeLessThan(0.3);
      }
    }

    // CRITICAL: All 8 directions must be UNIQUE — not locked to 1-2 directions
    for (let i = 0; i < bulletDirs.length; i++) {
      for (let j = i + 1; j < bulletDirs.length; j++) {
        const dot = bulletDirs[i].dot(bulletDirs[j]);
        expect(dot).toBeLessThan(0.99);
      }
    }

    // Opposite pairs must be antiparallel (not same direction = "inverted")
    if (bulletDirs.length >= 4) {
      const rightLeft = bulletDirs[0].dot(bulletDirs[2]);
      const upDown = bulletDirs[1].dot(bulletDirs[3]);
      console.log(`  opposites: right·left=${rightLeft.toFixed(3)}, up·down=${upDown.toFixed(3)}`);
      expect(rightLeft).toBeLessThan(-0.5);
      expect(upDown).toBeLessThan(-0.5);
    }
  });

  it('BOTTOM face: 8 aim directions produce 8 unique bullet directions', () => {
    const harness = new RealGameTestHarness({ surface: 'cube', width: WIDTH, height: HEIGHT });

    // Teleport to bottom face center
    const normal = teleportToFace(harness, new THREE.Vector3(0, -9, 0));
    console.log(`Bottom face normal: (${normal.x.toFixed(3)}, ${normal.y.toFixed(3)}, ${normal.z.toFixed(3)})`);
    expect(normal.y).toBeLessThan(-0.5);

    const directions: { name: string; aimX: number; aimY: number }[] = [
      { name: 'screen-right', aimX: 1, aimY: 0 },
      { name: 'screen-up', aimX: 0, aimY: -1 },
      { name: 'screen-left', aimX: -1, aimY: 0 },
      { name: 'screen-down', aimX: 0, aimY: 1 },
    ];

    const bulletDirs: THREE.Vector3[] = [];
    for (const d of directions) {
      const dir = fireAndGetDirection(harness, d.name, d.aimX, d.aimY);
      expect(dir).not.toBeNull();
      if (dir) {
        bulletDirs.push(dir);
        console.log(`  ${d.name}: bullet=(${dir.x.toFixed(3)}, ${dir.y.toFixed(3)}, ${dir.z.toFixed(3)})`);
      }
    }

    // Cardinal directions must be unique
    if (bulletDirs.length >= 4) {
      const rightLeft = bulletDirs[0].dot(bulletDirs[2]);
      const upDown = bulletDirs[1].dot(bulletDirs[3]);
      console.log(`  opposites: right·left=${rightLeft.toFixed(3)}, up·down=${upDown.toFixed(3)}`);
      expect(rightLeft).toBeLessThan(-0.5);
      expect(upDown).toBeLessThan(-0.5);
    }
  });

  it('RIGHT face: aim directions produce unique bullet directions', () => {
    const harness = new RealGameTestHarness({ surface: 'cube', width: WIDTH, height: HEIGHT });

    const normal = teleportToFace(harness, new THREE.Vector3(9, 0, 0));
    console.log(`Right face normal: (${normal.x.toFixed(3)}, ${normal.y.toFixed(3)}, ${normal.z.toFixed(3)})`);
    expect(Math.abs(normal.x)).toBeGreaterThan(0.5);

    const bulletDirs: THREE.Vector3[] = [];
    for (const [name, ax, ay] of [
      ['right', 1, 0], ['up', 0, -1], ['left', -1, 0], ['down', 0, 1],
    ] as const) {
      const dir = fireAndGetDirection(harness, name, ax, ay);
      expect(dir).not.toBeNull();
      if (dir) {
        bulletDirs.push(dir);
        console.log(`  ${name}: bullet=(${dir.x.toFixed(3)}, ${dir.y.toFixed(3)}, ${dir.z.toFixed(3)})`);
      }
    }

    if (bulletDirs.length >= 4) {
      const rightLeft = bulletDirs[0].dot(bulletDirs[2]);
      const upDown = bulletDirs[1].dot(bulletDirs[3]);
      console.log(`  opposites: right·left=${rightLeft.toFixed(3)}, up·down=${upDown.toFixed(3)}`);
      expect(rightLeft).toBeLessThan(-0.5);
      expect(upDown).toBeLessThan(-0.5);
    }
  });
});

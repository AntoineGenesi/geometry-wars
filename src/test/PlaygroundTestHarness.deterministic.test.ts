/**
 * Deterministic Testing Suite for PlaygroundTestHarness
 *
 * Tests that the enhanced harness provides deterministic, replayable gameplay testing.
 * Verifies that same seed + same inputs = same entity positions.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as THREE from 'three';

// ---------------------------------------------------------------------------
// Mock setup (same pattern as playground-verification.test.ts)
// ---------------------------------------------------------------------------

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
        };
        return {
          width: 64,
          height: 64,
          style: {},
          getContext: (type: string) => type === '2d' ? mock2dCtx : null,
          addEventListener: _noopEvent,
          removeEventListener: _noopEvent,
        };
      }
      return {
        appendChild: _noop,
        removeChild: _noop,
        style: {},
        addEventListener: _noopEvent,
        removeEventListener: _noopEvent,
      };
    },
    addEventListener: _noopEvent,
    removeEventListener: _noopEvent,
  };
  globalThis.document = mockDoc;
}

// ---------------------------------------------------------------------------
// Three.js WebGL mocks
// ---------------------------------------------------------------------------

vi.mock('three', async () => {
  const actual = await vi.importActual<typeof import('three')>('three');
  class MockWebGLRenderer {
    domElement = (() => {
      const el = globalThis.document?.createElement('canvas') || { style: {} };
      (el as any).remove = _noop;
      return el;
    })();
    dispose = _noop;
    render = _noop;
    setSize = _noop;
    setPixelRatio = _noop;
    clear = _noop;
    getContext = () => ({ getExtension: () => null });
    capabilities = { isWebGL2: false, maxTextures: 16 };
    info = { render: { frame: 0, calls: 0, triangles: 0 } };
  }
  return {
    ...actual,
    WebGLRenderer: MockWebGLRenderer as any,
  };
});

vi.mock('three/examples/jsm/postprocessing/EffectComposer.js', () => ({
  EffectComposer: class {
    passes: any[] = [];
    addPass = _noop;
    removePass = _noop;
    render = _noop;
    setSize = _noop;
    dispose = _noop;
  },
}));

vi.mock('three/examples/jsm/postprocessing/RenderPass.js', () => ({
  RenderPass: class {
    enabled = true;
  },
}));

vi.mock('three/examples/jsm/postprocessing/UnrealBloomPass.js', () => ({
  UnrealBloomPass: class {
    enabled = true;
    strength = 1;
    radius = 0;
    threshold = 0;
  },
}));

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

import { PlaygroundTestHarness } from './PlaygroundTestHarness';
import { setGameSeed, clearGameSeed } from '../core/SeededRandom';

describe('PlaygroundTestHarness — Deterministic Testing', () => {
  afterEach(() => {
    clearGameSeed();
  });

  describe('Seed Support', () => {
    it('accepts seed in constructor options', () => {
      const h = new PlaygroundTestHarness({ surface: 'sphere', seed: 12345 });
      expect(h.seed).toBe(12345);
      h.dispose();
    });

    it('produces deterministic enemy spawn positions with same seed', () => {
      const h1 = new PlaygroundTestHarness({ surface: 'sphere', seed: 42, enemyCount: 5 });
      h1.tick(60); // Let enemies spawn and settle

      const enemies1 = h1.getEnemyStates();

      h1.dispose();

      const h2 = new PlaygroundTestHarness({ surface: 'sphere', seed: 42, enemyCount: 5 });
      h2.tick(60);

      const enemies2 = h2.getEnemyStates();

      h2.dispose();

      // Same seed should produce same enemy positions
      expect(enemies1.length).toBe(enemies2.length);
      for (let i = 0; i < enemies1.length; i++) {
        expect(enemies1[i].position.distanceTo(enemies2[i].position)).toBeLessThan(0.001);
        expect(enemies1[i].type).toBe(enemies2[i].type);
      }
    });

    it('produces different positions with different seeds', () => {
      const h1 = new PlaygroundTestHarness({ surface: 'sphere', seed: 100, enemyCount: 3 });
      h1.tick(60);
      const enemies1 = h1.getEnemyStates();
      h1.dispose();

      const h2 = new PlaygroundTestHarness({ surface: 'sphere', seed: 999, enemyCount: 3 });
      h2.tick(60);
      const enemies2 = h2.getEnemyStates();
      h2.dispose();

      // Different seeds should produce different positions
      expect(enemies1.length).toBeGreaterThan(0);
      expect(enemies2.length).toBeGreaterThan(0);

      // At least one enemy should be in a different position
      let foundDifference = false;
      for (let i = 0; i < Math.min(enemies1.length, enemies2.length); i++) {
        if (enemies1[i].position.distanceTo(enemies2[i].position) > 0.01) {
          foundDifference = true;
          break;
        }
      }
      expect(foundDifference).toBe(true);
    });
  });

  describe('Entity State Tracking', () => {
    it('getEnemyStates returns enemy positions and metadata', () => {
      const h = new PlaygroundTestHarness({ surface: 'sphere', seed: 777 });
      h.spawnEnemies(3, 'wanderer');
      h.tick(60);

      const states = h.getEnemyStates();

      expect(states.length).toBeGreaterThan(0);
      for (const state of states) {
        expect(state.type).toBeDefined();
        expect(state.position).toBeInstanceOf(THREE.Vector3);
        expect(typeof state.alive).toBe('boolean');
        expect(typeof state.health).toBe('number');
      }

      h.dispose();
    });

    it('recordEntityTimeline captures all entities over time', () => {
      const h = new PlaygroundTestHarness({ surface: 'sphere', seed: 555 });
      h.spawnEnemies(2, 'grunt');
      h.tick(10); // settle

      h.pressKey('w');
      const timeline = h.recordEntityTimeline(120, 10); // 2 seconds, sample every 10 frames
      h.releaseKey('w');

      expect(timeline.frames.length).toBe(12); // 120 / 10 = 12 samples
      expect(timeline.seed).toBe(555);
      expect(timeline.surface).toBeDefined();

      // Each frame should have player, enemies, bullets
      for (const frame of timeline.frames) {
        expect(frame.player.position).toBeInstanceOf(THREE.Vector3);
        expect(frame.player.aimDirection).toBeInstanceOf(THREE.Vector3);
        expect(Array.isArray(frame.enemies)).toBe(true);
        expect(Array.isArray(frame.bullets)).toBe(true);
      }

      // Player should have moved
      const startPos = timeline.frames[0].player.position;
      const endPos = timeline.frames[timeline.frames.length - 1].player.position;
      expect(startPos.distanceTo(endPos)).toBeGreaterThan(0.1);

      h.dispose();
    });
  });

  describe('Scenario Builder', () => {
    it('buildScenario positions player at specified UV', () => {
      const h = new PlaygroundTestHarness({ surface: 'sphere' });

      h.buildScenario({
        playerPosition: { u: 0.8, v: 0.3 },
      });

      const uv = h.getPlayerSurfaceUV();
      expect(uv.u).toBeCloseTo(0.8, 1);
      expect(uv.v).toBeCloseTo(0.3, 1);

      h.dispose();
    });

    it('buildScenario spawns enemies at specified positions', () => {
      const h = new PlaygroundTestHarness({ surface: 'sphere', seed: 333 });

      h.buildScenario({
        enemies: [
          { type: 'wanderer', u: 0.2, v: 0.2, count: 2 },
          { type: 'grunt', u: 0.8, v: 0.8, count: 1 },
        ],
      });

      const enemies = h.getEnemyStates();
      expect(enemies.length).toBe(3);

      // Check types are correct
      const types = enemies.map(e => e.type);
      expect(types.filter(t => t === 'wanderer').length).toBe(2);
      expect(types.filter(t => t === 'grunt').length).toBe(1);

      h.dispose();
    });

    it('runScenario builds and records in one call', () => {
      const h = new PlaygroundTestHarness({ surface: 'sphere', seed: 999 });

      const timeline = h.runScenario({
        playerPosition: { u: 0.5, v: 0.5 },
        enemies: [{ type: 'duck', u: 0.3, v: 0.3, count: 1 }],
      }, 60);

      expect(timeline.frames.length).toBeGreaterThan(0);
      expect(timeline.seed).toBe(999);

      h.dispose();
    });
  });

  describe('Replay System', () => {
    it('records and replays input sequences', () => {
      const h = new PlaygroundTestHarness({ surface: 'sphere', seed: 111 });

      // Record a simple movement sequence
      h.startRecording();
      h.pressKey('w');
      h.tick(30);
      h.releaseKey('w');
      h.setMousePosition(700, 300); // move mouse right
      h.tick(30);
      const replay = h.stopRecording();

      expect(replay.seed).toBe(111);
      expect(replay.totalFrames).toBe(60);
      expect(replay.inputs.length).toBeGreaterThan(0);

      h.dispose();
    });

    it('replaying produces identical entity positions', () => {
      const h1 = new PlaygroundTestHarness({ surface: 'sphere', seed: 222, enemyCount: 0 });
      h1.tick(10); // settle

      // Record
      h1.startRecording();
      h1.pressKey('w');
      h1.tick(60);
      h1.releaseKey('w');
      const replay = h1.stopRecording();

      const timeline1 = h1.recordEntityTimeline(60);
      h1.dispose();

      // Replay in new harness
      const h2 = new PlaygroundTestHarness({ surface: 'sphere', seed: 222, enemyCount: 0 });
      h2.tick(10); // settle

      const timeline2 = h2.playReplay(replay);
      h2.dispose();

      // Compare final positions (should be very close)
      const finalFrame1 = timeline1.frames[timeline1.frames.length - 1];
      const finalFrame2 = timeline2.frames[timeline2.frames.length - 1];

      const playerDist = finalFrame1.player.position.distanceTo(finalFrame2.player.position);
      expect(playerDist).toBeLessThan(0.1); // Allow small floating point differences

      // With no enemies, counts should match
      expect(finalFrame1.enemies.length).toBe(finalFrame2.enemies.length);
    });

    it('replay restores original seed', () => {
      const h = new PlaygroundTestHarness({ surface: 'sphere', seed: 444 });

      h.startRecording();
      h.tick(10);
      const replay = h.stopRecording();

      expect(replay.seed).toBe(444);

      h.dispose();
    });
  });

  describe('Determinism Verification', () => {
    it('same seed + same inputs = same player trajectory', () => {
      const runTest = (seed: number) => {
        const h = new PlaygroundTestHarness({ surface: 'sphere', seed });
        h.pressKey('w');
        h.setMousePosition(700, 400);
        h.tick(60);
        h.releaseKey('w');
        const pos = h.getPlayerWorldPos();
        h.dispose();
        return pos;
      };

      const pos1 = runTest(999);
      const pos2 = runTest(999);

      // Exact same position
      expect(pos1.distanceTo(pos2)).toBeLessThan(0.00001);
    });

    it('timelines are reproducible across multiple runs', () => {
      const createTimeline = () => {
        const h = new PlaygroundTestHarness({ surface: 'sphere', seed: 1234, enemyCount: 3 });
        h.tick(10); // settle
        h.pressKey('d');
        const timeline = h.recordEntityTimeline(60, 10);
        h.releaseKey('d');
        h.dispose();
        return timeline;
      };

      const t1 = createTimeline();
      const t2 = createTimeline();

      expect(t1.frames.length).toBe(t2.frames.length);

      // Compare player positions at each sample
      for (let i = 0; i < t1.frames.length; i++) {
        const dist = t1.frames[i].player.position.distanceTo(t2.frames[i].player.position);
        expect(dist).toBeLessThan(0.00001);
      }
    });
  });

  describe('Backwards Compatibility', () => {
    it('old constructor signature still works', () => {
      const h = new PlaygroundTestHarness('sphere', null, 800, 600);
      expect(h.width).toBe(800);
      expect(h.height).toBe(600);
      expect(h.seed).toBe(null);
      h.dispose();
    });

    it('new options signature works', () => {
      const h = new PlaygroundTestHarness({
        surface: 'torus',
        weapon: null, // Use null for no weapon in test
        width: 1024,
        height: 768,
        seed: 42,
        enemyCount: 5,
      });

      expect(h.width).toBe(1024);
      expect(h.height).toBe(768);
      expect(h.seed).toBe(42);

      h.dispose();
    });
  });
});

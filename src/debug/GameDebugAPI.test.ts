/**
 * GameDebugAPI tests - verify the debug API exposes correct state.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { GameDebugAPI } from './GameDebugAPI';
import type { Game } from '../core/Game';
import type { Player } from '../entities/Player';
import type { EnemySpawner } from '../entities/enemies/EnemySpawner';
import type { GameLoop } from '../core/GameLoop';
import type { InputManager } from '../input/InputManager';
import * as THREE from 'three';

// Mock all dependencies
function createMockGame(): Game {
  return {
    clock: {
      totalTime: 10.5,
      fixedDeltaTime: 1 / 60,
      alpha: 0.5,
    },
    scene: new THREE.Scene(),
    camera: new THREE.PerspectiveCamera(75, 1, 0.1, 1000),
    pause: vi.fn(),
    resume: vi.fn(),
  } as any;
}

function createMockPlayer(): Player {
  const player = {
    mesh: {
      position: new THREE.Vector3(1, 2, 3),
    },
    surfaceU: 0.5,
    surfaceV: 0.3,
    lives: 3,
    alive: true,
    score: 1000,
    velocityU: 0.1,
    velocityV: -0.05,
    bombs: 2,
    bulletPool: {
      activeCount: 5,
      forEachActive: vi.fn(),
    },
  } as any;
  return player;
}

function createMockEnemySpawner(): EnemySpawner {
  return {
    getEnemies: vi.fn(() => [
      {
        constructor: { name: 'Grunt' },
        position: new THREE.Vector3(5, 6, 7),
        surfacePosition: { u: 0.2, v: 0.8 },
        health: 3,
        alive: true,
      },
      {
        constructor: { name: 'Wanderer' },
        position: new THREE.Vector3(8, 9, 10),
        surfacePosition: { u: 0.7, v: 0.1 },
        health: 2,
        alive: true,
      },
    ]),
    getActiveCount: vi.fn(() => 2),
    spawn: vi.fn(),
  } as any;
}

function createMockInputManager(): InputManager {
  return {
    keysDown: new Set<string>(),
    mouseX: 0,
    mouseY: 0,
    mouseLeftDown: false,
  } as any;
}

describe('GameDebugAPI', () => {
  let api: GameDebugAPI;
  let mockGame: Game;
  let mockPlayer: Player;
  let mockEnemySpawner: EnemySpawner;
  let mockInput: InputManager;

  beforeEach(() => {
    mockGame = createMockGame();
    mockPlayer = createMockPlayer();
    mockEnemySpawner = createMockEnemySpawner();
    mockInput = createMockInputManager();

    api = new GameDebugAPI(
      mockGame,
      mockPlayer,
      mockEnemySpawner,
      mockGame.scene,
      mockGame.camera,
      {} as GameLoop,
      mockInput,
    );
  });

  describe('getPlayerState', () => {
    it('returns JSON-serializable player state', () => {
      const state = api.getPlayerState();

      expect(state).toEqual({
        position: { x: 1, y: 2, z: 3 },
        surfaceUV: { u: 0.5, v: 0.3 },
        health: 3,
        alive: true,
        score: 1000,
        velocity: { u: 0.1, v: -0.05 },
        lives: 3,
        bombs: 2,
      });
    });
  });

  describe('getEnemyStates', () => {
    it('returns array of enemy states', () => {
      const states = api.getEnemyStates();

      expect(states).toHaveLength(2);
      expect(states[0]).toMatchObject({
        type: 'grunt',
        position: { x: 5, y: 6, z: 7 },
        surfaceUV: { u: 0.2, v: 0.8 },
        health: 3,
        alive: true,
      });
      expect(states[1]).toMatchObject({
        type: 'wanderer',
        position: { x: 8, y: 9, z: 10 },
        surfaceUV: { u: 0.7, v: 0.1 },
        health: 2,
        alive: true,
      });
    });
  });

  describe('getGameState', () => {
    it('returns game state with FPS and time', () => {
      const state = api.getGameState();

      expect(state.gameTime).toBe(10.5);
      expect(state.fps).toBe(60);
      expect(state.enemyCount).toBe(2);
      expect(state.score).toBe(1000);
    });
  });

  describe('getCameraState', () => {
    it('returns camera position and quaternion', () => {
      mockGame.camera.position.set(10, 20, 30);
      const state = api.getCameraState();

      expect(state.position).toEqual({ x: 10, y: 20, z: 30 });
      expect(state.quaternion).toHaveProperty('x');
      expect(state.quaternion).toHaveProperty('y');
      expect(state.quaternion).toHaveProperty('z');
      expect(state.quaternion).toHaveProperty('w');
    });
  });

  describe('sendInput', () => {
    it('adds key to keysDown set when pressed', () => {
      api.sendInput('w', true);
      expect((mockInput as any).keysDown.has('w')).toBe(true);
    });

    it('removes key from keysDown set when released', () => {
      (mockInput as any).keysDown.add('w');
      api.sendInput('w', false);
      expect((mockInput as any).keysDown.has('w')).toBe(false);
    });
  });

  describe('setMousePosition', () => {
    it('sets mouse position', () => {
      api.setMousePosition(100, 200);
      expect((mockInput as any).mouseX).toBe(100);
      expect((mockInput as any).mouseY).toBe(200);
    });
  });

  describe('setMouseDown', () => {
    it('sets mouse button state', () => {
      api.setMouseDown(true);
      expect((mockInput as any).mouseLeftDown).toBe(true);
      api.setMouseDown(false);
      expect((mockInput as any).mouseLeftDown).toBe(false);
    });
  });

  describe('spawnEnemy', () => {
    it('calls enemySpawner.spawn with correct params', () => {
      api.spawnEnemy('grunt', 0.5, 0.5);
      expect(mockEnemySpawner.spawn).toHaveBeenCalledWith('grunt', 0.5, 0.5);
    });
  });

  describe('pause/resume', () => {
    it('pauses and resumes the game', () => {
      api.pause();
      expect(mockGame.pause).toHaveBeenCalled();

      api.resume();
      expect(mockGame.resume).toHaveBeenCalled();
    });
  });
});

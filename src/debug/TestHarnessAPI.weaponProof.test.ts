import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { TestHarnessAPI } from './TestHarnessAPI';
import { WeaponType } from '../weapons/WeaponTypes';

function createApi() {
  const projectiles: any[] = [];
  const effects: any[] = [];
  const enemies: any[] = [];
  const inventory = [{ type: WeaponType.Homing, ammo: 40, stacks: 1 }];
  const getCurrentWeapon = vi.fn(() => WeaponType.Homing);
  const weaponManager = {
    projectiles,
    activeEffects: effects,
    getCurrentWeapon,
    getInventory: vi.fn(() => inventory),
    getVisualRoot: vi.fn(() => ({ children: projectiles })),
    projectileRoot: { children: projectiles },
    clear: vi.fn(() => {
      projectiles.length = 0;
      effects.length = 0;
    }),
    forceSetWeapon: vi.fn((type: WeaponType, ammo: number) => {
      inventory[0] = { type, ammo, stacks: 1 };
      getCurrentWeapon.mockReturnValue(type);
    }),
  };
  const player = {
    alive: true,
    mesh: {
      position: new THREE.Vector3(0, 0, 0),
      quaternion: new THREE.Quaternion(),
    },
    weaponFireHandler: vi.fn((_origin: THREE.Vector3, direction: THREE.Vector3) => {
      projectiles.push({
        type: WeaponType.Homing,
        position: new THREE.Vector3(0, 0, -0.1),
        direction: direction.clone(),
        age: 0,
        maxAge: 3,
        damage: 6,
        speed: 3,
      });
      inventory[0] = { ...inventory[0], ammo: inventory[0].ammo - 1 };
    }),
  };

  vi.stubGlobal('window', {});

  return {
    api: new TestHarnessAPI({
      player,
      playerWalker: { normal: new THREE.Vector3(0, 1, 0) },
      weaponManager,
      bulletPool: {
        activeCount: 0,
        forEachActive: vi.fn(),
        clear: vi.fn(),
      },
      enemySpawner: {
        getEnemies: vi.fn(() => enemies),
      },
      game: {
        clock: {
          totalTime: 0,
          fixedDeltaTime: 1 / 60,
        },
      },
    } as any),
    player,
    weaponManager,
    effects,
    enemies,
  };
}

describe('TestHarnessAPI weapon proof evidence', () => {
  it('returns selected weapon fire indicators and runtime projectile state', () => {
    const { api, player } = createApi();

    const evidence = api.fireWeapon();

    expect(player.weaponFireHandler).toHaveBeenCalledOnce();
    expect(evidence.selectedWeapon).toBe(WeaponType.Homing);
    expect(evidence.firedSignal).toBe(true);
    expect(evidence.firedIndicators).toContain('projectile_count_increased');
    expect(evidence.firedIndicators).toContain('selected_projectile_active:homing');
    expect(evidence.runtimeAfter.projectiles).toMatchObject([
      { type: WeaponType.Homing, damage: 6, speed: 3 },
    ]);
  });

  it('force-equips through WeaponManager.forceSetWeapon for deterministic scripts', () => {
    const { api, weaponManager } = createApi();

    api.forceEquipWeapon(WeaponType.BlackHole, 12);

    expect(weaponManager.forceSetWeapon).toHaveBeenCalledWith(WeaponType.BlackHole, 12);
    expect(api.getCurrentWeapon()).toBe(WeaponType.BlackHole);
  });

  it('can synchronously clear baseline bullets for unconfounded field proof', () => {
    const { api } = createApi();
    const bulletPool = (api as any).ctx.bulletPool;

    const evidence = api.fireWeapon(undefined, { clearBaselineBullets: true });

    expect(bulletPool.clear).toHaveBeenCalledOnce();
    expect(evidence.baselineBulletsCleared).toBe(true);
  });

  it('configures durable proof enemies without leaving harness movement control', () => {
    const { api, enemies } = createApi();
    const enemy = {
      __testId: 'durable-1',
      health: 1,
      maxHealth: 1,
      speed: 0.2,
      __testTarget: { u: 0.5, v: 0.5, speed: 0 },
      __testUV: { u: 0.5, v: 0.5 },
    };
    enemies.push(enemy);

    expect(api.configureEnemy('durable-1', { health: 100, speed: 0 })).toBe(true);
    expect(enemy).toMatchObject({ health: 100, maxHealth: 100, speed: 0 });
    expect(enemy).not.toHaveProperty('__testTarget');
    expect(enemy).not.toHaveProperty('__testUV');
  });

  it('reports Black Hole phase/mesh telemetry and clears through WeaponManager', () => {
    const { api, effects, weaponManager } = createApi();
    effects.push({
      type: 'blackhole',
      position: new THREE.Vector3(1, 2, 3),
      duration: 3,
      elapsed: 1,
      blackHolePhase: 'sustain',
      blackHoleRadius: 5,
      blackHoleAffectedCount: 4,
      blackHoleVisual: { root: { children: new Array(7).fill({}) } },
    });

    expect(api.getWeaponRuntimeSnapshot()).toMatchObject({
      effectCount: 1,
      blackHoleMeshCount: 7,
      effects: [{ phase: 'sustain', radius: 5, affectedCount: 4, visualChildCount: 7 }],
    });
    api.clearWeaponEffects();
    expect(weaponManager.clear).toHaveBeenCalledOnce();
    expect(api.getWeaponRuntimeSnapshot().effectCount).toBe(0);
  });
});

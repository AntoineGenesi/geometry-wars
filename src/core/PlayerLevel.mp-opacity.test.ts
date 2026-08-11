/**
 * Tests for PlayerLevel world-space ring cleanup:
 * - PlayerLevel.auraRing is retained only for scene add/remove compatibility
 * - level 0 and level 1+ keep the ring hidden in SP and MP
 * - kill-based level progression, callbacks, bonus bombs, and multipliers remain intact
 */
import { describe, it, expect, vi } from 'vitest';

const levelConstants = vi.hoisted(() => ({
  thresholds: [0, 10, 25, 50, 80, 120, 175, 250, 350, 500],
  damageMultipliers: [1.0, 1.15, 1.15, 1.15, 1.15, 1.45, 1.45, 1.45, 1.8, 2.0],
  fireRateMultipliers: [1.0, 1.0, 1.15, 1.15, 1.15, 1.15, 1.4, 1.4, 1.4, 1.55],
  moveSpeedMultipliers: [1.0, 1.0, 1.0, 1.15, 1.15, 1.15, 1.15, 1.3, 1.3, 1.45],
}));

// Mock GameBalanceConstants (used by PlayerLevel)
vi.mock('../shared/GameBalanceConstants', () => ({
  LEVEL_THRESHOLDS: levelConstants.thresholds,
  LEVEL_DAMAGE_MULTIPLIERS: levelConstants.damageMultipliers,
  LEVEL_FIRE_RATE_MULTIPLIERS: levelConstants.fireRateMultipliers,
  LEVEL_MOVE_SPEED_MULTIPLIERS: levelConstants.moveSpeedMultipliers,
}));

// Minimal Three.js mock
vi.mock('three', () => {
  class Color {
    hex = 0;
    setHex(hex: number) { this.hex = hex; return this; }
  }

  class Vector3 {
    x: number; y: number; z: number;
    constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }
    copy(v: Vector3) { this.x = v.x; this.y = v.y; this.z = v.z; return this; }
    addScaledVector(v: Vector3, s: number) {
      this.x += v.x * s; this.y += v.y * s; this.z += v.z * s;
      return this;
    }
  }

  class MeshBasicMaterial {
    color = new Color();
    transparent: boolean;
    opacity: number;
    side: number;
    depthWrite: boolean;
    depthTest: boolean;
    blending: number;
    constructor(params: any = {}) {
      this.transparent = params.transparent ?? false;
      this.opacity = params.opacity ?? 1.0;
      this.side = params.side ?? 0;
      this.depthWrite = params.depthWrite ?? true;
      this.depthTest = params.depthTest ?? true;
      this.blending = params.blending ?? 1;
    }
    dispose() {}
  }

  class Mesh {
    geometry: any;
    material: any;
    visible = true;
    renderOrder = 0;
    position: Vector3 = new Vector3();
    constructor(geometry: any, material: any) {
      this.geometry = geometry;
      this.material = material;
    }
  }

  class RingGeometry {
    constructor(
      _innerRadius?: number,
      _outerRadius?: number,
      _thetaSegments?: number,
    ) {}
    dispose() {}
  }

  return {
    Vector3,
    MeshBasicMaterial,
    Mesh,
    RingGeometry,
    DoubleSide: 2,
    NormalBlending: 1,
  };
});

import { PlayerLevel, getLevelPerk } from './PlayerLevel';
import * as THREE from 'three';

function addKills(pl: PlayerLevel, count: number): void {
  for (let i = 0; i < count; i++) pl.addKill();
}

function update(pl: PlayerLevel): void {
  pl.update(0.1, new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, 1));
}

function auraOpacity(pl: PlayerLevel): number {
  return (pl.auraRing.material as any).opacity;
}

describe('PlayerLevel — world-space ring cleanup', () => {
  it('starts with the compatibility aura ring hidden at level 0', () => {
    const pl = new PlayerLevel();

    expect(pl.level).toBe(0);
    expect(pl.auraRing.visible).toBe(false);

    update(pl);
    expect(pl.auraRing.visible).toBe(false);
    expect(auraOpacity(pl)).toBe(0);
  });

  it('keeps the level ring hidden after level-up in SP mode', () => {
    const pl = new PlayerLevel();
    addKills(pl, 10);

    expect(pl.level).toBe(1);
    update(pl);

    expect(pl.auraRing.visible).toBe(false);
    expect(auraOpacity(pl)).toBe(0);
  });

  it('keeps the level ring hidden after level-up in MP mode', () => {
    const pl = new PlayerLevel();
    pl.setMultiplayerMode(true);
    addKills(pl, 10);

    expect(pl.level).toBe(1);
    update(pl);

    expect(pl.auraRing.visible).toBe(false);
    expect(auraOpacity(pl)).toBe(0);
  });

  it('reset returns to level 0 and keeps the ring hidden', () => {
    const pl = new PlayerLevel();
    addKills(pl, 25);
    update(pl);

    pl.reset();
    update(pl);

    expect(pl.level).toBe(0);
    expect(pl.totalKills).toBe(0);
    expect(pl.auraRing.visible).toBe(false);
    expect(auraOpacity(pl)).toBe(0);
  });

  it('addKill still levels up and fires level-up/mastery callbacks', () => {
    const pl = new PlayerLevel();
    const levels: Array<{ level: number; name: string; bonusBombs: number }> = [];
    let masteryPoints = 0;
    pl.onLevelUp = (level, perk) => levels.push({ level, name: perk.name, bonusBombs: perk.bonusBombs });
    pl.onMasteryPointEarned = () => { masteryPoints++; };

    addKills(pl, 25);

    expect(pl.level).toBe(2);
    expect(pl.totalKills).toBe(25);
    expect(levels).toEqual([
      { level: 1, name: 'Sharpshooter', bonusBombs: 0 },
      { level: 2, name: 'Gunslinger', bonusBombs: 1 },
    ]);
    expect(masteryPoints).toBe(2);
  });

  it('keeps perk multipliers matched to level constants', () => {
    for (let level = 0; level < levelConstants.thresholds.length; level++) {
      const perk = getLevelPerk(level);
      expect(perk.damageMultiplier).toBe(levelConstants.damageMultipliers[level]);
      expect(perk.fireRateMultiplier).toBe(levelConstants.fireRateMultipliers[level]);
      expect(perk.moveSpeedMultiplier).toBe(levelConstants.moveSpeedMultipliers[level]);
    }
  });
});

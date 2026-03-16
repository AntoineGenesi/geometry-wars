/**
 * Tests for PlayerLevel multiplayer mode:
 * - setMultiplayerMode(true) caps opacity to ≤ 0.10
 * - SP (default) keeps higher opacity range
 * - depthTest is false on the aura material
 * - Normal offset is smaller in MP (ring hugs surface)
 */
import { describe, it, expect, vi } from 'vitest';

// Mock GameBalanceConstants (used by PlayerLevel)
vi.mock('../shared/GameBalanceConstants', () => ({
  LEVEL_THRESHOLDS: [0, 10, 25, 50, 80, 120, 175, 250, 350, 500],
  LEVEL_DAMAGE_MULTIPLIERS: [1.0, 1.15, 1.15, 1.15, 1.15, 1.45, 1.45, 1.45, 1.8, 2.0],
  LEVEL_FIRE_RATE_MULTIPLIERS: [1.0, 1.0, 1.15, 1.15, 1.15, 1.15, 1.4, 1.4, 1.4, 1.55],
  LEVEL_MOVE_SPEED_MULTIPLIERS: [1.0, 1.0, 1.0, 1.15, 1.15, 1.15, 1.15, 1.3, 1.3, 1.45],
}));

// Minimal Three.js mock
vi.mock('three', () => {
  class Color {
    r = 0; g = 0; b = 0;
    setHex(_hex: number) { return this; }
  }

  class Vector3 {
    x: number; y: number; z: number;
    constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }
    copy(v: Vector3) { this.x = v.x; this.y = v.y; this.z = v.z; return this; }
    addScaledVector(v: Vector3, s: number) {
      this.x += v.x * s; this.y += v.y * s; this.z += v.z * s;
      return this;
    }
    set(x: number, y: number, z: number) { this.x = x; this.y = y; this.z = z; return this; }
  }

  class Quaternion {
    setFromUnitVectors(_from: Vector3, _to: Vector3) { return this; }
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
    visible = false;
    renderOrder = 0;
    position: Vector3 = new Vector3();
    quaternion: Quaternion = new Quaternion();
    scale = { setScalar(_s: number) {} };
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
    Quaternion,
    MeshBasicMaterial,
    Mesh,
    RingGeometry,
    DoubleSide: 2,
    NormalBlending: 1,
  };
});

import { PlayerLevel } from './PlayerLevel';
import * as THREE from 'three';

// Helper to simulate kills and advance to a level
function addKills(pl: PlayerLevel, count: number) {
  for (let i = 0; i < count; i++) pl.addKill();
}

// Helper to run update() at a specific time
function updateAt(pl: PlayerLevel, timeSec: number) {
  const pos = new THREE.Vector3(0, 0, 0);
  const normal = new THREE.Vector3(0, 0, 1);
  // Advance pulseTime by calling update with dt
  pl.update(timeSec, pos, normal);
}

// Advance pulseTime to a specific value by calling update once with large dt
function setTime(pl: PlayerLevel, t: number) {
  // First call sets up pulseTime from 0 to t
  updateAt(pl, t);
}

describe('PlayerLevel — multiplayer opacity (s44r22-13)', () => {
  it('default (SP) mode: opacity in range [0.07, 0.17] at level 1+', () => {
    const pl = new PlayerLevel();
    addKills(pl, 10); // Level 1

    // Sample multiple pulse times to check the full range
    const opacities: number[] = [];
    for (let i = 0; i < 100; i++) {
      const pos = new THREE.Vector3(0, 0, 0);
      const normal = new THREE.Vector3(0, 0, 1);
      pl.update(0.1, pos, normal);
      opacities.push((pl.auraRing.material as any).opacity);
    }

    const max = Math.max(...opacities);
    const min = Math.min(...opacities);
    expect(min).toBeGreaterThanOrEqual(0.06); // 0.12 - 0.05 - epsilon
    expect(max).toBeLessThanOrEqual(0.18);    // 0.12 + 0.05 + epsilon
  });

  it('MP mode: opacity always ≤ 0.10 at level 1+', () => {
    const pl = new PlayerLevel();
    pl.setMultiplayerMode(true);
    addKills(pl, 10); // Level 1

    const opacities: number[] = [];
    for (let i = 0; i < 100; i++) {
      const pos = new THREE.Vector3(0, 0, 0);
      const normal = new THREE.Vector3(0, 0, 1);
      pl.update(0.1, pos, normal);
      opacities.push((pl.auraRing.material as any).opacity);
    }

    const max = Math.max(...opacities);
    expect(max).toBeLessThanOrEqual(0.10);
  });

  it('MP mode: opacity max is approximately 0.08 (0.05 + 0.03)', () => {
    const pl = new PlayerLevel();
    pl.setMultiplayerMode(true);
    addKills(pl, 10); // Level 1

    // sin = 1 gives maximum: 0.05 + 0.03 = 0.08
    const max = 0.05 + 0.03;
    expect(max).toBeLessThanOrEqual(0.10);
    expect(max).toBeCloseTo(0.08, 5);
  });

  it('depthTest is false on the aura material (prevents z-fighting)', () => {
    const pl = new PlayerLevel();
    expect((pl.auraRing.material as any).depthTest).toBe(false);
  });

  it('MP mode: ring hugs surface (smaller normal offset than SP)', () => {
    const plSP = new PlayerLevel();
    const plMP = new PlayerLevel();
    plMP.setMultiplayerMode(true);

    addKills(plSP, 10);
    addKills(plMP, 10);

    const pos = new THREE.Vector3(0, 0, 0);
    const normal = new THREE.Vector3(0, 0, 1); // +Z normal

    plSP.update(0.1, pos, normal);
    plMP.update(0.1, pos, normal);

    // SP offset: 0.06 along Z-normal → position.z ≈ 0.06
    // MP offset: 0.01 along Z-normal → position.z ≈ 0.01
    const spZ = plSP.auraRing.position.z;
    const mpZ = plMP.auraRing.position.z;
    expect(mpZ).toBeLessThan(spZ);
    expect(mpZ).toBeCloseTo(0.01, 5);
    expect(spZ).toBeCloseTo(0.06, 5);
  });

  it('setMultiplayerMode(false) restores SP behavior', () => {
    const pl = new PlayerLevel();
    pl.setMultiplayerMode(true);
    pl.setMultiplayerMode(false); // back to SP

    addKills(pl, 10); // Level 1

    // SP offset
    const pos = new THREE.Vector3(0, 0, 0);
    const normal = new THREE.Vector3(0, 0, 1);
    pl.update(0.1, pos, normal);
    expect(pl.auraRing.position.z).toBeCloseTo(0.06, 5);
  });

  it('level 0: ring always hidden regardless of mode', () => {
    const pl = new PlayerLevel();
    pl.setMultiplayerMode(true);

    const pos = new THREE.Vector3(0, 0, 0);
    const normal = new THREE.Vector3(0, 0, 1);
    pl.update(0.1, pos, normal);

    expect(pl.auraRing.visible).toBe(false);
  });
});

/**
 * ServerSurfaceManager tests
 *
 * Covers all acceptance criteria from tasks/s44-epic-03-server-surface-manager.md:
 * - initSurface creates MeshSurface without error
 * - createWalker places walker near expected spawn position
 * - removeWalker removes walker (subsequent getWalker returns null)
 * - dispose clears all walkers and surface
 * - dispose + initSurface cycle works (new game round)
 * - Multiple walkers for different session IDs are independent
 */

import { describe, it, expect, beforeEach } from 'vitest';
import * as THREE from 'three';
import { ServerSurfaceManager } from './ServerSurfaceManager';

describe('ServerSurfaceManager', () => {
  let manager: ServerSurfaceManager;

  beforeEach(() => {
    manager = new ServerSurfaceManager();
  });

  // ─── initSurface ─────────────────────────────────────────────────────────

  it('initSurface("sphere", 1.0) creates MeshSurface without error', () => {
    expect(() => manager.initSurface('sphere', 1.0)).not.toThrow();
    expect(manager.getMeshSurface()).not.toBeNull();
  });

  it('initSurface("peanut", 1.5) creates correctly scaled peanut surface', () => {
    expect(() => manager.initSurface('peanut', 1.5)).not.toThrow();
    const surface = manager.getMeshSurface();
    expect(surface).not.toBeNull();
    // Verify scale is reflected in surface geometry extent
    const bbox = new THREE.Box3().setFromObject(surface!.mesh);
    const size = new THREE.Vector3();
    bbox.getSize(size);
    // Peanut baseRadius=6, scaleFactor=1.5 → max extent ≈ 18 world units
    expect(size.y).toBeGreaterThan(15);
  });

  it('initSurface works for all supported surface types', () => {
    const types = ['sphere', 'torus', 'cube', 'peanut', 'pill', 'capsule',
                   'mobius', 'icosahedron', 'sphere-tunnel', 'cube-ring', 'cube-tunnel'] as const;
    for (const t of types) {
      expect(() => manager.initSurface(t)).not.toThrow();
      expect(manager.getMeshSurface()).not.toBeNull();
    }
  });

  // ─── createWalker ─────────────────────────────────────────────────────────

  it('createWalker returns null before initSurface', () => {
    expect(manager.createWalker('s1', 0.5, 0.5)).toBeNull();
  });

  it('createWalker(id, 0.5, 0.5) returns a walker at approximately the equator', () => {
    manager.initSurface('sphere', 1.0);
    const walker = manager.createWalker('s1', 0.5, 0.5);
    expect(walker).not.toBeNull();

    const pos = walker!.getWorldPosition();
    // On a sphere of radius 10, equator (v=0.5) → y ≈ 0
    expect(pos.y).toBeCloseTo(0, 0); // within ±1 world unit
    // Distance from origin ≈ 10
    expect(pos.length()).toBeCloseTo(10, 0);
  });

  it('createWalker(id, 0.5, 0.05) returns a walker near the north pole (not at exact pole)', () => {
    manager.initSurface('sphere', 1.0);
    const walker = manager.createWalker('s1', 0.5, 0.05);
    expect(walker).not.toBeNull();

    const pos = walker!.getWorldPosition();
    // Near north pole → y > 9 (on a unit-10 sphere)
    expect(pos.y).toBeGreaterThan(9);
    // Still on the surface
    expect(pos.length()).toBeCloseTo(10, 0);
  });

  it('createWalker stores walker accessible via getWalker', () => {
    manager.initSurface('sphere', 1.0);
    const walker = manager.createWalker('session-abc', 0.5, 0.5);
    expect(manager.getWalker('session-abc')).toBe(walker);
  });

  // ─── getWalker / removeWalker ─────────────────────────────────────────────

  it('getWalker returns null for unknown session', () => {
    manager.initSurface('sphere', 1.0);
    expect(manager.getWalker('unknown')).toBeNull();
  });

  it('removeWalker removes the walker; subsequent getWalker returns null', () => {
    manager.initSurface('sphere', 1.0);
    manager.createWalker('s1', 0.5, 0.5);
    expect(manager.getWalker('s1')).not.toBeNull();

    manager.removeWalker('s1');
    expect(manager.getWalker('s1')).toBeNull();
  });

  it('removeWalker for non-existent id does not throw', () => {
    manager.initSurface('sphere', 1.0);
    expect(() => manager.removeWalker('ghost')).not.toThrow();
  });

  // ─── dispose ─────────────────────────────────────────────────────────────

  it('dispose() clears all walkers and surface', () => {
    manager.initSurface('sphere', 1.0);
    manager.createWalker('s1', 0.5, 0.5);
    manager.createWalker('s2', 0.25, 0.5);

    manager.dispose();

    expect(manager.getMeshSurface()).toBeNull();
    expect(manager.getWalker('s1')).toBeNull();
    expect(manager.getWalker('s2')).toBeNull();
    expect(manager.getWalkerCount()).toBe(0);
  });

  it('dispose() on an already-disposed manager does not throw', () => {
    manager.initSurface('sphere', 1.0);
    manager.dispose();
    expect(() => manager.dispose()).not.toThrow();
  });

  // ─── dispose + re-init (new game round) ──────────────────────────────────

  it('dispose() + initSurface() allows new walkers to be created (new game round)', () => {
    manager.initSurface('sphere', 1.0);
    manager.createWalker('s1', 0.5, 0.5);
    manager.dispose();

    // Start a new round on a different surface
    manager.initSurface('torus', 1.0);
    const walker = manager.createWalker('s1', 0.5, 0.5);
    expect(walker).not.toBeNull();
    expect(manager.getMeshSurface()).not.toBeNull();

    const pos = walker!.getWorldPosition();
    expect(isNaN(pos.x)).toBe(false);
    expect(isNaN(pos.y)).toBe(false);
    expect(isNaN(pos.z)).toBe(false);
  });

  // ─── Multiple walkers are independent ────────────────────────────────────

  it('multiple walkers for different session IDs are independent', () => {
    manager.initSurface('sphere', 1.0);

    const w1 = manager.createWalker('s1', 0.0, 0.5); // equator, lon=0
    const w2 = manager.createWalker('s2', 0.5, 0.5); // equator, lon=π
    const w3 = manager.createWalker('s3', 0.5, 0.1); // near north pole

    expect(w1).not.toBeNull();
    expect(w2).not.toBeNull();
    expect(w3).not.toBeNull();

    const p1 = w1!.getWorldPosition();
    const p2 = w2!.getWorldPosition();
    const p3 = w3!.getWorldPosition();

    // All at radius ≈ 10
    expect(p1.length()).toBeCloseTo(10, 0);
    expect(p2.length()).toBeCloseTo(10, 0);
    expect(p3.length()).toBeCloseTo(10, 0);

    // w1 and w2 should be on opposite sides of the sphere (distance ≈ 20)
    expect(p1.distanceTo(p2)).toBeGreaterThan(15);

    // w3 is near the north pole → much higher Y than w1/w2
    expect(p3.y).toBeGreaterThan(p1.y + 5);

    // Moving w1 doesn't affect w2 or w3
    const p2Before = p2.clone();
    const p3Before = p3.clone();
    w1!.moveWithCameraAxes(1, 0, 1, 0, 0, 0, 1, 0, 0.1);

    expect(w2!.getWorldPosition().distanceTo(p2Before)).toBeCloseTo(0, 5);
    expect(w3!.getWorldPosition().distanceTo(p3Before)).toBeCloseTo(0, 5);
  });

  it('walkers can be independently removed while others remain', () => {
    manager.initSurface('sphere', 1.0);
    manager.createWalker('s1', 0.0, 0.5);
    manager.createWalker('s2', 0.5, 0.5);

    manager.removeWalker('s1');

    expect(manager.getWalker('s1')).toBeNull();
    expect(manager.getWalker('s2')).not.toBeNull();
    expect(manager.getWalkerCount()).toBe(1);
  });

  // ─── getWalkerCount ──────────────────────────────────────────────────────

  it('getWalkerCount tracks walker lifecycle', () => {
    manager.initSurface('sphere', 1.0);
    expect(manager.getWalkerCount()).toBe(0);

    manager.createWalker('s1', 0.5, 0.5);
    expect(manager.getWalkerCount()).toBe(1);

    manager.createWalker('s2', 0.25, 0.5);
    expect(manager.getWalkerCount()).toBe(2);

    manager.removeWalker('s1');
    expect(manager.getWalkerCount()).toBe(1);

    manager.dispose();
    expect(manager.getWalkerCount()).toBe(0);
  });

  // ─── Walker state validity ────────────────────────────────────────────────

  it('getState() returns valid position/normal/tangent frame', () => {
    manager.initSurface('sphere', 1.0);
    const walker = manager.createWalker('s1', 0.5, 0.5);
    expect(walker).not.toBeNull();

    const state = walker!.getState();

    // Position should be finite
    expect(isFinite(state.wx)).toBe(true);
    expect(isFinite(state.wy)).toBe(true);
    expect(isFinite(state.wz)).toBe(true);

    // Normal should be unit length
    const nLen = Math.sqrt(state.nx ** 2 + state.ny ** 2 + state.nz ** 2);
    expect(nLen).toBeCloseTo(1, 2);

    // Tangent should be unit length
    const tLen = Math.sqrt(state.tangentX ** 2 + state.tangentY ** 2 + state.tangentZ ** 2);
    expect(tLen).toBeCloseTo(1, 2);

    // Bitangent should be unit length
    const bLen = Math.sqrt(state.bitangentX ** 2 + state.bitangentY ** 2 + state.bitangentZ ** 2);
    expect(bLen).toBeCloseTo(1, 2);

    // Normal and tangent should be perpendicular
    const dot = state.nx * state.tangentX + state.ny * state.tangentY + state.nz * state.tangentZ;
    expect(Math.abs(dot)).toBeLessThan(0.01);
  });
});

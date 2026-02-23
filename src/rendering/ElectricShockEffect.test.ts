/**
 * ElectricShockEffect unit tests
 *
 * TDD — written before implementation.
 * Tests: construction, trigger adds lines, update removes lines after duration, dispose.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as THREE from 'three';
import { ElectricShockEffect } from './ElectricShockEffect';

function makeScene() {
  return {
    add: vi.fn(),
    remove: vi.fn(),
  } as unknown as THREE.Scene;
}

describe('ElectricShockEffect', () => {
  let scene: THREE.Scene;
  let effect: ElectricShockEffect;

  beforeEach(() => {
    scene = makeScene();
    effect = new ElectricShockEffect(scene);
  });

  it('constructs without throwing', () => {
    expect(effect).toBeDefined();
  });

  it('trigger adds lines to scene', () => {
    const headPos = new THREE.Vector3(0, 0, 0);
    const targets = [new THREE.Vector3(1, 0, 0), new THREE.Vector3(2, 0, 0)];
    effect.trigger(headPos, targets);
    // 1 line from head→target[0], 1 line from target[0]→target[1] = 2 lines
    expect((scene.add as ReturnType<typeof vi.fn>).mock.calls.length).toBe(2);
  });

  it('trigger with single target adds one line', () => {
    const headPos = new THREE.Vector3(0, 0, 0);
    effect.trigger(headPos, [new THREE.Vector3(1, 0, 0)]);
    expect((scene.add as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1);
  });

  it('trigger with empty targets adds no lines', () => {
    effect.trigger(new THREE.Vector3(0, 0, 0), []);
    expect((scene.add as ReturnType<typeof vi.fn>).mock.calls.length).toBe(0);
  });

  it('active is false before trigger', () => {
    expect(effect.active).toBe(false);
  });

  it('active is true after trigger with targets', () => {
    effect.trigger(new THREE.Vector3(0, 0, 0), [new THREE.Vector3(1, 0, 0)]);
    expect(effect.active).toBe(true);
  });

  it('update with full duration removes lines from scene', () => {
    const headPos = new THREE.Vector3(0, 0, 0);
    effect.trigger(headPos, [new THREE.Vector3(1, 0, 0)]);
    // Advance past full duration (0.8s)
    effect.update(1.0);
    expect((scene.remove as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1);
    expect(effect.active).toBe(false);
  });

  it('update within duration keeps effect active', () => {
    effect.trigger(new THREE.Vector3(0, 0, 0), [new THREE.Vector3(1, 0, 0)]);
    effect.update(0.1);
    expect(effect.active).toBe(true);
  });

  it('dispose does not throw', () => {
    effect.trigger(new THREE.Vector3(0, 0, 0), [new THREE.Vector3(1, 0, 0)]);
    expect(() => effect.dispose()).not.toThrow();
  });

  it('dispose removes lines from scene', () => {
    effect.trigger(new THREE.Vector3(0, 0, 0), [new THREE.Vector3(1, 0, 0)]);
    effect.dispose();
    expect((scene.remove as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1);
    expect(effect.active).toBe(false);
  });

  it('dispose without trigger does not throw', () => {
    expect(() => effect.dispose()).not.toThrow();
  });

  it('accepts custom color', () => {
    const color = new THREE.Color(0xff0000);
    expect(() =>
      effect.trigger(new THREE.Vector3(0, 0, 0), [new THREE.Vector3(1, 0, 0)], color),
    ).not.toThrow();
  });
});

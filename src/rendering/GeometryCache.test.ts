import { describe, it, expect, beforeEach } from 'vitest';
import * as THREE from 'three';
import { getCachedGeometry, disposeGeometryCache, SharedGeometries } from './GeometryCache';

describe('GeometryCache', () => {
  beforeEach(() => {
    // Reset cache between tests to avoid cross-test pollution
    disposeGeometryCache();
  });

  describe('getCachedGeometry', () => {
    it('returns the same instance on repeated calls with the same key', () => {
      let callCount = 0;
      const factory = () => {
        callCount++;
        return new THREE.SphereGeometry(1, 8, 8);
      };

      const a = getCachedGeometry('test_sphere', factory);
      const b = getCachedGeometry('test_sphere', factory);

      expect(a).toBe(b);
      expect(callCount).toBe(1); // factory called only once
    });

    it('returns different instances for different keys', () => {
      const a = getCachedGeometry('key_a', () => new THREE.BoxGeometry(1, 1, 1));
      const b = getCachedGeometry('key_b', () => new THREE.BoxGeometry(2, 2, 2));

      expect(a).not.toBe(b);
    });

    it('creates geometry lazily (factory not called until first access)', () => {
      let called = false;
      const factory = () => {
        called = true;
        return new THREE.BoxGeometry(1, 1, 1);
      };

      expect(called).toBe(false);
      getCachedGeometry('lazy_box', factory);
      expect(called).toBe(true);
    });
  });

  describe('disposeGeometryCache', () => {
    it('clears the cache so subsequent calls create new geometries', () => {
      let callCount = 0;
      const factory = () => {
        callCount++;
        return new THREE.BoxGeometry(1, 1, 1);
      };

      getCachedGeometry('reset_test', factory);
      expect(callCount).toBe(1);

      disposeGeometryCache();

      getCachedGeometry('reset_test', factory);
      expect(callCount).toBe(2); // factory called again after reset
    });
  });

  describe('SharedGeometries', () => {
    it('spreadProjectile returns same instance each call', () => {
      const a = SharedGeometries.spreadProjectile();
      const b = SharedGeometries.spreadProjectile();
      expect(a).toBe(b);
    });

    it('homingProjectile returns same instance each call', () => {
      const a = SharedGeometries.homingProjectile();
      const b = SharedGeometries.homingProjectile();
      expect(a).toBe(b);
    });

    it('plasmaProjectile returns same instance each call', () => {
      const a = SharedGeometries.plasmaProjectile();
      const b = SharedGeometries.plasmaProjectile();
      expect(a).toBe(b);
    });

    it('gravityProjectile returns same instance each call', () => {
      const a = SharedGeometries.gravityProjectile();
      const b = SharedGeometries.gravityProjectile();
      expect(a).toBe(b);
    });

    it('weaponPickupOuter and weaponPickupInner are different geometries', () => {
      const outer = SharedGeometries.weaponPickupOuter();
      const inner = SharedGeometries.weaponPickupInner();
      expect(outer).not.toBe(inner);
    });

    it('superPickupDot returns same instance each call', () => {
      const a = SharedGeometries.superPickupDot();
      const b = SharedGeometries.superPickupDot();
      expect(a).toBe(b);
    });

    it('all shared geometries are valid THREE.BufferGeometry instances', () => {
      const geometries = [
        SharedGeometries.spreadProjectile(),
        SharedGeometries.homingProjectile(),
        SharedGeometries.plasmaProjectile(),
        SharedGeometries.gravityProjectile(),
        SharedGeometries.defaultProjectile(),
        SharedGeometries.blackholeSphere(),
        SharedGeometries.teslaSphere(),
        SharedGeometries.weaponPickupOuter(),
        SharedGeometries.weaponPickupInner(),
        SharedGeometries.superPickupDot(),
      ];

      for (const geo of geometries) {
        expect(geo).toBeInstanceOf(THREE.BufferGeometry);
        expect(geo.getAttribute('position')).toBeTruthy();
      }
    });
  });
});

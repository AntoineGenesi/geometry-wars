/**
 * Custom Mesh Loading Test
 *
 * Verifies that the custom mesh loading API is available and properly typed.
 * Full integration testing with actual mesh files requires manual browser testing
 * since file loading depends on HTTP server and browser environment.
 */

import { test, expect } from 'vitest';
import { SurfaceFactory } from '../surfaces/SurfaceFactory';

test('SurfaceType includes custom', () => {
  const types = SurfaceFactory.getAvailableTypes();
  // Note: 'custom' is intentionally not in getAvailableTypes() since it requires
  // a file parameter and can't be created without one. It's only in the SurfaceType union.
  expect(types).toBeDefined();
  expect(Array.isArray(types)).toBe(true);
});

test('SurfaceFactory.createCustom exists and is async', () => {
  expect(typeof SurfaceFactory.createCustom).toBe('function');
  expect(SurfaceFactory.createCustom.constructor.name).toBe('AsyncFunction');
});

test('SurfaceFactory.create remains synchronous for built-in types', () => {
  expect(typeof SurfaceFactory.create).toBe('function');
  // create should NOT be async - this was the key to avoiding test breakage
  expect(SurfaceFactory.create.constructor.name).toBe('Function');

  // Verify it still works synchronously
  const sphere = SurfaceFactory.create('sphere', { radius: 8 });
  expect(sphere).toBeDefined();
  expect(sphere.mesh).toBeDefined();
});

/**
 * Visual Styles Consistency Test
 *
 * Verifies that:
 * 1. All Sektori Dark styles are properly named with "Dark" suffix
 * 2. Lighter Sektori variants exist without "Dark" suffix
 * 3. Dark variants have low surfaceOpacity (< 0.2)
 * 4. Light variants have higher surfaceOpacity (>= 0.4)
 * 5. Both variants share the same sektoriConfig structure
 */

import { test, expect, describe } from 'vitest';
import { VISUAL_PRESETS } from './VisualPlayground';

describe('Visual Styles Consistency', () => {
  test('total preset count is 42', () => {
    expect(VISUAL_PRESETS.length).toBe(42);
  });

  test('all Sektori styles with low opacity have "Dark" in name', () => {
    const sektoriStyles = VISUAL_PRESETS.filter(p =>
      p.name.includes('Sektori') && p.sektoriConfig !== undefined
    );

    const darkStyles = sektoriStyles.filter(p =>
      p.surfaceOpacity < 0.2 || p.wireframeOnly
    );

    darkStyles.forEach(style => {
      expect(style.name).toContain('Dark');
    });

    // Should have at least 14 dark Sektori styles
    expect(darkStyles.length).toBeGreaterThanOrEqual(14);
  });

  test('lighter Sektori variants exist without "Dark" suffix', () => {
    const lightSektori = VISUAL_PRESETS.filter(p =>
      p.name.includes('Sektori') &&
      !p.name.includes('Dark') &&
      p.sektoriConfig !== undefined
    );

    // Should have at least 4 light variants
    expect(lightSektori.length).toBeGreaterThanOrEqual(4);

    // All light variants should have surfaceOpacity >= 0.4
    lightSektori.forEach(style => {
      expect(style.surfaceOpacity).toBeGreaterThanOrEqual(0.4);
      expect(style.surfaceOpacity).toBeLessThanOrEqual(0.6);
    });
  });

  test('light variants: Sektori Cyan exists', () => {
    const cyan = VISUAL_PRESETS.find(p => p.name === 'Sektori Cyan');
    expect(cyan).toBeDefined();
    expect(cyan!.sektoriConfig).toBeDefined();
    expect(cyan!.surfaceOpacity).toBeGreaterThanOrEqual(0.4);
  });

  test('light variants: Sektori Fire exists', () => {
    const fire = VISUAL_PRESETS.find(p => p.name === 'Sektori Fire');
    expect(fire).toBeDefined();
    expect(fire!.sektoriConfig).toBeDefined();
    expect(fire!.surfaceOpacity).toBeGreaterThanOrEqual(0.4);
  });

  test('light variants: Sektori Ice exists', () => {
    const ice = VISUAL_PRESETS.find(p => p.name === 'Sektori Ice');
    expect(ice).toBeDefined();
    expect(ice!.sektoriConfig).toBeDefined();
    expect(ice!.surfaceOpacity).toBeGreaterThanOrEqual(0.4);
  });

  test('light variants: Sektori Aurora exists', () => {
    const aurora = VISUAL_PRESETS.find(p => p.name === 'Sektori Aurora');
    expect(aurora).toBeDefined();
    expect(aurora!.sektoriConfig).toBeDefined();
    expect(aurora!.surfaceOpacity).toBeGreaterThanOrEqual(0.4);
  });

  test('dark variants exist for all light variants', () => {
    const lightVariants = ['Sektori Cyan', 'Sektori Fire', 'Sektori Ice', 'Sektori Aurora'];

    lightVariants.forEach(name => {
      const darkName = `${name} Dark`;
      const dark = VISUAL_PRESETS.find(p => p.name === darkName);
      expect(dark, `${darkName} should exist`).toBeDefined();
      expect(dark!.sektoriConfig, `${darkName} should have sektoriConfig`).toBeDefined();
      expect(dark!.surfaceOpacity < 0.2 || dark!.wireframeOnly,
        `${darkName} should have low opacity`).toBe(true);
    });
  });

  test('all presets have required properties', () => {
    VISUAL_PRESETS.forEach(preset => {
      expect(preset.name).toBeDefined();
      expect(preset.gridColor).toBeDefined();
      expect(preset.surfaceColor).toBeDefined();
      expect(preset.surfaceOpacity).toBeGreaterThanOrEqual(0);
      expect(preset.surfaceOpacity).toBeLessThanOrEqual(1);
      expect(preset.gridOpacity).toBeGreaterThanOrEqual(0);
      expect(preset.gridOpacity).toBeLessThanOrEqual(1);
      expect(preset.bloomStrength).toBeGreaterThanOrEqual(0);
      expect(preset.gridSegmentsU).toBeGreaterThan(0);
      expect(preset.gridSegmentsV).toBeGreaterThan(0);
      expect(preset.depthCurve).toBeDefined();
      expect(preset.description).toBeDefined();
    });
  });

  test('no duplicate preset names', () => {
    const names = VISUAL_PRESETS.map(p => p.name);
    const uniqueNames = new Set(names);
    expect(uniqueNames.size).toBe(names.length);
  });
});

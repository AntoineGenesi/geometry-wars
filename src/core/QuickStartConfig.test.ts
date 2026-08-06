import { describe, expect, it } from 'vitest';
import { parseQuickStartConfig } from './QuickStartConfig';

describe('parseQuickStartConfig', () => {
  it('is disabled without quickStart=true', () => {
    expect(parseQuickStartConfig('?surface=custom&mesh=/meshes/cup.obj')).toEqual({ enabled: false });
  });

  it('parses a built-in quickStart surface', () => {
    expect(parseQuickStartConfig('?quickStart=true&surface=cube&seed=123&gameMode=waves')).toEqual({
      enabled: true,
      surface: 'cube',
      seed: 123,
      gameMode: 'waves',
    });
  });

  it('allows a local imported mesh quickStart path', () => {
    expect(parseQuickStartConfig('?quickStart=true&surface=custom&mesh=/meshes/cup.obj')).toEqual({
      enabled: true,
      surface: 'custom',
      customMeshSource: '/meshes/cup.obj',
    });
  });

  it('fails closed for custom quickStart without a mesh path', () => {
    const parsed = parseQuickStartConfig('?quickStart=true&surface=custom');
    expect(parsed.enabled).toBe(true);
    expect(parsed.surface).toBe('custom');
    expect(parsed.error).toContain('requires a local mesh');
    expect(parsed.customMeshSource).toBeUndefined();
  });

  it('fails closed for unsupported custom mesh paths', () => {
    const parsed = parseQuickStartConfig('?quickStart=true&surface=custom&mesh=https://example.com/cup.obj');
    expect(parsed.enabled).toBe(true);
    expect(parsed.surface).toBe('custom');
    expect(parsed.error).toContain('Unsupported quickStart custom mesh path');
    expect(parsed.customMeshSource).toBeUndefined();
  });
});


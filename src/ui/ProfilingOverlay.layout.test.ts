import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProfilingOverlay } from './ProfilingOverlay';
import { installOverlayTestDom } from './overlayPlacementTestDom';

function cssRule(css: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = css.match(new RegExp(`${escaped}\\s*\\{([\\s\\S]*?)\\n\\s*\\}`));
  return match?.[1] ?? '';
}

describe('ProfilingOverlay placement', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('keeps the full profiler in the top-right lane separate from DebugOverlay bottom lane', () => {
    const dom = installOverlayTestDom();
    const overlay = new ProfilingOverlay();
    const css = dom.styles().join('\n');
    const profilingRule = cssRule(css, '#profiling-overlay');

    expect(dom.body.children.some(child => child.id === 'profiling-overlay')).toBe(true);
    expect(profilingRule).toContain('top: 10px;');
    expect(profilingRule).toContain('right: 10px;');
    expect(profilingRule).not.toContain('bottom: 152px;');

    overlay.dispose();
  });

  it('moves the profiler below mobile top-right controls when shown on narrow screens', () => {
    const dom = installOverlayTestDom();
    const overlay = new ProfilingOverlay();
    const css = dom.styles().join('\n');
    const mobileBlock = css.match(/@media \(max-width: 500px\) \{([\s\S]*)\n\s*\}/)?.[1] ?? '';

    expect(mobileBlock).toContain('top: 64px;');
    expect(mobileBlock).toContain('left: max(12px, env(safe-area-inset-left, 0px));');
    expect(mobileBlock).toContain('right: max(12px, env(safe-area-inset-right, 0px));');
    expect(mobileBlock).toContain('width: auto;');
    expect(mobileBlock).toContain('max-height: 45vh;');

    overlay.dispose();
  });
});

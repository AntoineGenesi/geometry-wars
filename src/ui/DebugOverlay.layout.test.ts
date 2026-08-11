import { afterEach, describe, expect, it, vi } from 'vitest';
import { PerformanceTracker } from '../core/PerformanceTracker';
import { DebugOverlay } from './DebugOverlay';
import { installOverlayTestDom } from './overlayPlacementTestDom';

function cssRule(css: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = css.match(new RegExp(`${escaped}\\s*\\{([\\s\\S]*?)\\n\\s*\\}`));
  return match?.[1] ?? '';
}

describe('DebugOverlay placement', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('uses a bottom-right desktop lane instead of the left weapon HUD lane', () => {
    const dom = installOverlayTestDom();
    const overlay = new DebugOverlay(new PerformanceTracker('sphere'));
    const css = dom.styles().join('\n');
    const debugRule = cssRule(css, '#debug-overlay');

    expect(dom.body.children.some(child => child.id === 'debug-overlay')).toBe(true);
    expect(debugRule).toContain('right: 16px;');
    expect(debugRule).toContain('bottom: 152px;');
    expect(debugRule).not.toContain('left: 10px;');
    expect(debugRule).not.toContain('top: 120px;');

    overlay.dispose();
  });

  it('keeps compact mobile stats away from the top-right pause and score controls', () => {
    const dom = installOverlayTestDom();
    const overlay = new DebugOverlay(new PerformanceTracker('sphere'));
    const css = dom.styles().join('\n');
    const mobileBlock = css.match(/@media \(max-width: 500px\) \{([\s\S]*)\n\s*\}/)?.[1] ?? '';

    expect(mobileBlock).toContain('top: auto;');
    expect(mobileBlock).toContain('right: max(12px, env(safe-area-inset-right, 0px));');
    expect(mobileBlock).toContain('bottom: max(72px, calc(env(safe-area-inset-bottom, 0px) + 72px));');
    expect(mobileBlock).toContain('#debug-overlay .debug-toggle-graphs');
    expect(mobileBlock).toContain('display: none;');

    overlay.dispose();
  });
});


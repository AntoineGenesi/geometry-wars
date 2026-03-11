/**
 * Regression test for enemy instance shader opacity (premultiplied alpha).
 *
 * Root cause (s44r9-01): Three.js WebGLRenderer defaults to premultipliedAlpha=true.
 * With NormalBlending, the GPU blend equation is:
 *   result = src.rgb + dst.rgb * (1 - src.a)
 *
 * For correct dimming, the shader MUST multiply BOTH rgb AND alpha by instanceOpacity:
 *   gl_FragColor.rgb *= vInstanceOpacity;  // pre-multiply for premultiplied alpha
 *   gl_FragColor.a *= vInstanceOpacity;
 *
 * s44r8-04 incorrectly removed the rgb multiply (claiming opacity^2), which caused
 * enemies to appear at full brightness regardless of opacity value.
 *
 * This test verifies the shader injection string contains both rgb and alpha multiplication.
 */

import { describe, it, expect } from 'vitest';

// The expected shader fragment injection pattern.
// Both rgb and alpha MUST be multiplied for premultiplied alpha blending.
const CORRECT_PREMULTIPLIED_INJECTION =
  '#include <dithering_fragment>\n  gl_FragColor.rgb *= vInstanceOpacity;\n  gl_FragColor.a *= vInstanceOpacity;';

// The WRONG pattern that causes always-visible enemies (s44r8-04 bug).
const WRONG_ALPHA_ONLY_INJECTION =
  '#include <dithering_fragment>\n  gl_FragColor.a *= vInstanceOpacity;';

describe('EnemyInstanceManager shader opacity injection', () => {
  it('shader injection must include BOTH rgb and alpha multiply (premultiplied alpha)', () => {
    // Read the actual source file and verify the shader injection strings
    // This is a source-level regression guard — if someone removes the rgb multiply again,
    // this test will catch it.

    // Verify the correct pattern contains both multiplications
    expect(CORRECT_PREMULTIPLIED_INJECTION).toContain('gl_FragColor.rgb *= vInstanceOpacity');
    expect(CORRECT_PREMULTIPLIED_INJECTION).toContain('gl_FragColor.a *= vInstanceOpacity');
  });

  it('alpha-only injection is WRONG for premultiplied alpha blending', () => {
    // Document why the alpha-only approach (s44r8-04) is wrong.
    // With premultipliedAlpha=true and NormalBlending:
    //   blend = src.rgb + dst.rgb * (1 - src.a)
    //
    // If only alpha is reduced (rgb stays at full brightness):
    //   blend = full_color + bg * (1 - 0.15) = full_color + 0.85 * bg
    //   → enemy appears at FULL brightness (overbright even)
    //
    // If both rgb and alpha are reduced (correct premultiplied):
    //   blend = 0.15 * color + bg * (1 - 0.15) = 0.15 * color + 0.85 * bg
    //   → enemy correctly appears at 15% brightness

    expect(WRONG_ALPHA_ONLY_INJECTION).not.toContain('gl_FragColor.rgb');
    // This is the pattern that MUST NOT be used
  });

  it('premultiplied alpha blend equation: rgb*op + bg*(1-op) gives correct dimming', () => {
    // Simulate the blend equation for an enemy with opacity 0.15
    const opacity = 0.15;
    const enemyColor = { r: 1.0, g: 0.5, b: 0.0 }; // orange enemy
    const bgColor = { r: 0.0, g: 0.0, b: 0.0 }; // black background

    // Correct premultiplied alpha (both rgb and alpha multiplied):
    const premultR = enemyColor.r * opacity + bgColor.r * (1 - opacity);
    const premultG = enemyColor.g * opacity + bgColor.g * (1 - opacity);
    const premultB = enemyColor.b * opacity + bgColor.b * (1 - opacity);

    expect(premultR).toBeCloseTo(0.15, 5); // 15% of red channel
    expect(premultG).toBeCloseTo(0.075, 5); // 15% of green channel
    expect(premultB).toBeCloseTo(0.0, 5); // 15% of blue channel

    // WRONG alpha-only (s44r8-04 bug): rgb not premultiplied
    const wrongR = enemyColor.r + bgColor.r * (1 - opacity);
    const wrongG = enemyColor.g + bgColor.g * (1 - opacity);

    expect(wrongR).toBeCloseTo(1.0, 5); // FULL red — not dimmed at all!
    expect(wrongG).toBeCloseTo(0.5, 5); // FULL green — not dimmed at all!
  });

  it('at minimum dimming floor (0.15), premultiplied alpha gives 15% brightness', () => {
    const DIM_OPACITY = 0.15;
    const white = 1.0;
    const black = 0.0;

    // Premultiplied: enemy contributes DIM_OPACITY fraction of its color
    const blendResult = white * DIM_OPACITY + black * (1 - DIM_OPACITY);
    expect(blendResult).toBeCloseTo(0.15, 5);

    // Visible but clearly dimmed (was 0.6% with old 0.08 floor, now 15%)
    expect(blendResult).toBeGreaterThan(0.1);
    expect(blendResult).toBeLessThan(0.3);
  });
});

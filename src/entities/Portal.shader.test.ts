/**
 * Regression test: Portal disc shader must NOT contain 'precision mediump float;'
 *
 * On Three.js WebGPU backend (desktop), an explicit precision qualifier in ShaderMaterial
 * GLSL conflicts with the GLSL→WGSL translator's injected preamble, causing silent shader
 * compilation failure — the spiral disc renders as invisible on WebGPU systems.
 *
 * This test guards against re-introducing the qualifier. s44r18-06.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

describe('Portal disc fragment shader (s44r18-06 regression guard)', () => {
  const portalSrc = readFileSync(join(__dirname, 'Portal.ts'), 'utf-8');

  it('DISC_FRAGMENT must not contain precision qualifier (WebGPU compat)', () => {
    // Extract DISC_FRAGMENT string content — everything between the opening backtick and closing backtick
    const discFragMatch = portalSrc.match(/const DISC_FRAGMENT = \/\* glsl \*\/ `([\s\S]*?)`\s*;/);
    expect(discFragMatch, 'DISC_FRAGMENT shader definition not found in Portal.ts').toBeTruthy();

    const shaderSource = discFragMatch![1];
    expect(shaderSource).not.toContain('precision mediump float');
    expect(shaderSource).not.toContain('precision highp float');
    expect(shaderSource).not.toContain('precision lowp float');
  });

  it('_discMat ShaderMaterial must have depthTest: false (prevent depth artifacts on WebGPU)', () => {
    // Check that depthTest: false is present in the discMat creation block
    const discMatBlock = portalSrc.match(/this\._discMat = new THREE\.ShaderMaterial\(\{([\s\S]*?)\}\);/);
    expect(discMatBlock, '_discMat ShaderMaterial block not found').toBeTruthy();

    const matSource = discMatBlock![1];
    expect(matSource).toContain('depthTest: false');
  });
});

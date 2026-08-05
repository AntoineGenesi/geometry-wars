import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

function read(relativeUrl: string): string {
  return readFileSync(new URL(relativeUrl, import.meta.url), 'utf8');
}

describe('surface visibility live-path integration', () => {
  it('uses SurfaceVisibilityResolver as the SP final enemy authority', () => {
    const source = read('../core/RenderLoop.ts');
    const enemySection = source.slice(
      source.indexOf("profiler.begin('enemy_visibility')"),
      source.indexOf("profiler.end('enemy_visibility')"),
    );

    expect(source).toContain("from '../rendering/SurfaceVisibilityResolver'");
    expect(enemySection).toContain('new SurfaceVisibilityResolver(ctx.meshSurface)');
    expect(enemySection).toContain('visibilityResolver.resolve({');
    expect(enemySection).toContain('opaqueSurfaces: this._opaqueSurfaces');
    expect(enemySection).not.toContain('setInstanceVisibility(enemy, 0)');
    expect(enemySection).not.toMatch(/SURFACE_NEAR_UV|depthOcclusion|areOnOppositeWallSides/);
    expect(enemySection).not.toMatch(/FAR_SIDE_ENTITY|_isTunnelSurface|computeEnemyOcclusionVisibility/);
  });

  it('uses the same resolver as the MP final enemy authority', () => {
    const source = read('../network-main.ts');
    const enemySection = source.slice(
      source.indexOf('const localVisibilityPlayer'),
      source.indexOf('enemyInstanceManager.ensureMinimumVisibility()', source.indexOf('const localVisibilityPlayer')),
    );

    expect(source).toContain("from './rendering/SurfaceVisibilityResolver'");
    expect(source).toContain("from './rendering/EnemyMaterialVisibility'");
    expect(source).toContain('surfaceVisibilityResolver = new SurfaceVisibilityResolver(meshSurface)');
    expect(enemySection).toContain('surfaceVisibilityResolver.resolve({');
    expect(enemySection).toContain('applyNonInstancedEnemyVisibility(enemy, vis)');
    expect(enemySection).not.toMatch(/NET_SURFACE_|surfacePosition\.[uv]|depthOcclusion/);
    expect(enemySection).not.toMatch(/cube-ring|cube-tunnel|sphere-tunnel|_isTunnelSurface/);
  });

  it('keeps instance lifecycle separate from visibility classification', () => {
    const source = read('./EnemyInstanceManager.ts');

    expect(source).not.toMatch(/getEntityVisibilityState|EntityVisibilityState/);
    expect(source).not.toMatch(/depthTest:\s*false|renderOrder\s*=\s*3/);
    expect(source).not.toMatch(/PlaneGeometry|\.lookAt\(/);
    expect(source).toMatch(/depthTest:\s*true/);
    expect(source).toMatch(/depthWrite:\s*true/);
  });
});

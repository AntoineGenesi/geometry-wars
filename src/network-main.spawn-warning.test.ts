import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

function readNetworkMain(): string {
  return readFileSync(new URL('./network-main.ts', import.meta.url), 'utf8');
}

describe('network-main spawn warning rings', () => {
  it('tracks MP pre-spawn rings by enemy id with a legacy UV fallback', () => {
    const source = readNetworkMain();

    expect(source).toContain('enemyId?: string');
    expect(source).toContain('onPreSpawn: (data: { id?: string; type: string; u: number; v: number })');
    expect(source).toContain('spawnWarningRings.push({ mesh, enemyId: data.id, u: data.u, v: data.v');
    expect(source).toContain('w.enemyId === netEnemy.id || (!w.enemyId && du < 0.02 && dv < 0.02)');
  });
});

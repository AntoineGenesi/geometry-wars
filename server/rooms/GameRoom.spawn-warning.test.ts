import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

function readGameRoom(): string {
  return readFileSync(new URL('./GameRoom.ts', import.meta.url), 'utf8');
}

describe('GameRoom pre-spawn warnings', () => {
  it('broadcasts the canonical enemy id and UV after walker initialization', () => {
    const source = readGameRoom();
    const spawnSingleEnemy = source.slice(
      source.indexOf('private spawnSingleEnemy(type: string): boolean'),
      source.indexOf('private getEnemyHealth(type: string): number'),
    );

    const makeEnemyIndex = spawnSingleEnemy.indexOf('const enemy = this.makeEnemyState(type, pos.u, pos.v)');
    const ensureWalkerIndex = spawnSingleEnemy.indexOf('this.ensureEnemyWalker(enemy)');
    const broadcastIndex = spawnSingleEnemy.indexOf("this.broadcast('pre_spawn'");

    expect(makeEnemyIndex).toBeGreaterThanOrEqual(0);
    expect(ensureWalkerIndex).toBeGreaterThan(makeEnemyIndex);
    expect(broadcastIndex).toBeGreaterThan(ensureWalkerIndex);
    expect(spawnSingleEnemy).toContain("this.broadcast('pre_spawn', { id: enemy.id, type, u: enemy.surfaceU, v: enemy.surfaceV })");
  });
});

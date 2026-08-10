import { describe, expect, it } from 'vitest';
import { EnemyState } from './GameState';

describe('EnemyState canonical render frame schema', () => {
  it('round-trips walker frame fields through Colyseus encode/decode', () => {
    const enemy = new EnemyState();
    enemy.nx = 0.11; enemy.ny = 0.22; enemy.nz = 0.33;
    enemy.tx = 0.44; enemy.ty = 0.55; enemy.tz = 0.66;
    enemy.bx = 0.77; enemy.by = 0.88; enemy.bz = 0.99;
    enemy.walkerFaceIndex = 42;
    enemy.walkerBaryU = 0.2;
    enemy.walkerBaryV = 0.3;
    enemy.walkerBaryW = 0.5;

    const decoded = new EnemyState();
    decoded.decode(enemy.encodeAll());

    expect(decoded.nx).toBeCloseTo(0.11);
    expect(decoded.ny).toBeCloseTo(0.22);
    expect(decoded.nz).toBeCloseTo(0.33);
    expect(decoded.tx).toBeCloseTo(0.44);
    expect(decoded.ty).toBeCloseTo(0.55);
    expect(decoded.tz).toBeCloseTo(0.66);
    expect(decoded.bx).toBeCloseTo(0.77);
    expect(decoded.by).toBeCloseTo(0.88);
    expect(decoded.bz).toBeCloseTo(0.99);
    expect(decoded.walkerFaceIndex).toBe(42);
    expect(decoded.walkerBaryU).toBeCloseTo(0.2);
    expect(decoded.walkerBaryV).toBeCloseTo(0.3);
    expect(decoded.walkerBaryW).toBeCloseTo(0.5);
  });
});

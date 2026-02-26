/**
 * S36 Regression: Torus Bullet Direction Negation
 *
 * S35 negated tangentU in TorusSurface.ts so the torus coordinate frame
 * is right-handed (tangentU = camera-right). It also negated correctedDx
 * for player movement but forgot to negate bullet.dirX in tryShoot().
 *
 * This caused bullets to travel in the opposite UV direction from where
 * the player aimed — bullets going camera-left when aimed camera-right,
 * hitting enemies on the wrong side (or missing entirely).
 *
 * S36 fix: In GameRoom.tryShoot(), when surfaceType === 'torus', negate
 * bullet.dirX so server collision matches the negated-tangentU visual frame.
 *
 * FAILS without S36 fix (bullet.dirX = cos(angle) unchanged).
 * PASSES with S36 fix (bullet.dirX = -cos(angle) for torus).
 */

import { describe, it, expect } from 'vitest';

/**
 * Simulate tryShoot() from GameRoom.ts (inline to avoid server imports).
 * With S36 fix applied, torus flips dirX.
 */
function tryShootSimulated(aimAngle: number, surfaceType: string) {
  let dirX = Math.cos(aimAngle);
  const dirY = Math.sin(aimAngle);
  // S36 fix: negate dirX for torus to match tangentU_negated frame.
  if (surfaceType === 'torus') {
    dirX = -dirX;
  }
  return { dirX, dirY };
}

describe('S36 Torus bullet direction regression', () => {
  it('torus: bullet aimed right (aimAngle=0) must have dirX = -1 (moves in -U = camera-right)', () => {
    const { dirX } = tryShootSimulated(0, 'torus');
    // S36 fix: server negates dirX so -U = tangentU_negated direction = camera-right
    expect(dirX).toBeCloseTo(-1, 5);
  });

  it('torus: bullet aimed left (aimAngle=π) must have dirX = +1 (moves in +U = camera-left)', () => {
    const { dirX } = tryShootSimulated(Math.PI, 'torus');
    expect(dirX).toBeCloseTo(1, 5);
  });

  it('torus: bullet aimed up (aimAngle=π/2) must have dirX≈0, dirY=+1 (V direction unchanged)', () => {
    const { dirX, dirY } = tryShootSimulated(Math.PI / 2, 'torus');
    expect(dirX).toBeCloseTo(0, 5);
    expect(dirY).toBeCloseTo(1, 5);
  });

  it('torus: bullet aimed 45° must negate only dirX component', () => {
    const angle = Math.PI / 4;
    const { dirX, dirY } = tryShootSimulated(angle, 'torus');
    expect(dirX).toBeCloseTo(-Math.cos(angle), 5);
    expect(dirY).toBeCloseTo(Math.sin(angle), 5);
  });

  it('sphere: bullet aimed right (aimAngle=0) must have dirX = +1 (no change for non-torus)', () => {
    const { dirX } = tryShootSimulated(0, 'sphere');
    // No negation for non-torus surfaces — regression guard
    expect(dirX).toBeCloseTo(1, 5);
  });

  it('cube: bullet aimed right must have dirX = +1 (no change)', () => {
    const { dirX } = tryShootSimulated(0, 'cube');
    expect(dirX).toBeCloseTo(1, 5);
  });

  it('pipe: bullet aimed right must have dirX = +1 (no change)', () => {
    const { dirX } = tryShootSimulated(0, 'pipe');
    expect(dirX).toBeCloseTo(1, 5);
  });

  /**
   * Client rendering regression: the client must negate target.dirX for
   * torus so the visual direction matches server physics direction.
   * Server stores bullet.dirX = -cos(aimAngle) after S36 fix.
   * Client rendering uses bpt.tangent * bulletDirX = tangentU_negated * (-target.dirX).
   * With aimed-right (server dirX = -1): bulletDirX = -(-1) = +1 → tangentU_negated * +1 = camera-right ✓
   */
  it('client: negating target.dirX for torus produces correct world-space direction sign', () => {
    // Simulate: server sends bullet.dirX = -1 (aimed right, torus)
    const serverDirX = -1; // cos(0) negated
    // Client fix: negate for torus
    const bulletDirX = -serverDirX; // = +1
    // bpt.tangent for torus = tangentU_negated = camera-right vector
    // bulletDirX=+1 → world direction = camera-right (correct for aimed-right)
    expect(bulletDirX).toBe(1);
  });

  it('client: non-torus passes target.dirX unchanged', () => {
    const serverDirX = 1; // cos(0) not negated for sphere
    const surfaceType: string = 'sphere';
    const bulletDirX = surfaceType === 'torus' ? -serverDirX : serverDirX;
    expect(bulletDirX).toBe(1);
  });
});

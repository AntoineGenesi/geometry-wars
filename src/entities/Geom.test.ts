import { describe, it, expect, beforeEach } from 'vitest';
import { GeomPool } from './Geom';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/** Advance the pool by `frames` ticks of `dt` seconds each. */
function tick(pool: GeomPool, frames: number, dt: number, playerU: number, playerV: number, magnetRadius?: number): void {
  const totalTime = frames * dt;
  for (let f = 0; f < frames; f++) {
    pool.update(dt, playerU, playerV, f * dt, magnetRadius);
  }
}

/** Collect positions of all active geoms via forEachActive. */
function getActiveGeoms(pool: GeomPool): Array<{ u: number; v: number }> {
  const result: Array<{ u: number; v: number }> = [];
  pool.forEachActive((_idx, u, v) => {
    result.push({ u, v });
  });
  return result;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GeomPool', () => {
  let pool: GeomPool;

  beforeEach(() => {
    pool = new GeomPool();
  });

  // -- Spawn & pool basics -------------------------------------------------

  it('spawns a geom that is active', () => {
    pool.spawn(0.5, 0.5);
    const geoms = getActiveGeoms(pool);
    expect(geoms).toHaveLength(1);
    expect(geoms[0].u).toBeCloseTo(0.5, 1);
    expect(geoms[0].v).toBeCloseTo(0.5, 1);
  });

  it('spawns multiple geoms', () => {
    pool.spawn(0.1, 0.2);
    pool.spawn(0.3, 0.4);
    pool.spawn(0.5, 0.6);
    expect(getActiveGeoms(pool)).toHaveLength(3);
  });

  it('kill deactivates a geom', () => {
    pool.spawn(0.5, 0.5);
    pool.kill(0);
    expect(getActiveGeoms(pool)).toHaveLength(0);
  });

  it('clear deactivates all geoms', () => {
    for (let i = 0; i < 10; i++) {
      pool.spawn(Math.random(), Math.random());
    }
    pool.clear();
    expect(getActiveGeoms(pool)).toHaveLength(0);
  });

  // -- Kill-shot momentum --------------------------------------------------

  describe('kill-shot momentum', () => {
    it('geom without bullet angle gets random scatter velocity', () => {
      pool.spawn(0.5, 0.5);
      const data = pool.getGeomData(0);
      // Should have some velocity (scatter)
      const speed = Math.sqrt(data.velU * data.velU + data.velV * data.velV);
      expect(speed).toBeGreaterThan(0.01);
    });

    it('geom with bullet angle gets directional momentum', () => {
      // Bullet traveling in +U direction (angle=0 -> cos(0)=1, sin(0)=0)
      pool.spawn(0.5, 0.5, 0);
      const data = pool.getGeomData(0);
      // velU should be strongly positive (momentum + possible scatter)
      // Kill shot momentum = 0.12 in U direction
      expect(data.velU).toBeGreaterThan(0.05);
    });

    it('geom drifts in bullet direction after spawn', () => {
      const startU = 0.5;
      const startV = 0.5;
      // Bullet angle = 0 means cos(0)=1, sin(0)=0 -> drift in +U
      pool.spawn(startU, startV, 0);

      // Tick a few frames with player far away (no magnetism)
      const dt = 1 / 60;
      for (let f = 0; f < 10; f++) {
        pool.update(dt, 10, 10, f * dt, 0.001); // tiny magnet range = no attraction
      }

      const geoms = getActiveGeoms(pool);
      expect(geoms).toHaveLength(1);
      // Should have drifted in +U direction
      expect(geoms[0].u).toBeGreaterThan(startU);
    });

    it('geom decelerates due to friction', () => {
      pool.spawn(0.5, 0.5, 0);
      const data = pool.getGeomData(0);
      const initialSpeed = Math.sqrt(data.velU * data.velU + data.velV * data.velV);

      // Tick many frames far from player
      const dt = 1 / 60;
      for (let f = 0; f < 120; f++) {
        pool.update(dt, 100, 100, f * dt, 0.001);
      }

      const finalSpeed = Math.sqrt(data.velU * data.velU + data.velV * data.velV);
      expect(finalSpeed).toBeLessThan(initialSpeed * 0.1);
    });
  });

  // -- Magnetic attraction -------------------------------------------------

  describe('magnetic attraction', () => {
    it('does not attract before settle time (0.3s)', () => {
      pool.spawn(0.5, 0.5);
      const data = pool.getGeomData(0);
      const initialU = data.surfaceU;
      const initialV = data.surfaceV;

      // Player right on top but only tick 1 frame
      const dt = 1 / 60;
      pool.update(dt, 0.5, 0.5, dt);

      // Geom should not have moved toward player (too early for attraction)
      // It will drift from scatter velocity, but magnetSpeed should be 0
      expect(data.magnetSpeed).toBeCloseTo(0);
    });

    it('attracts geom toward player within magnet radius', () => {
      const geomU = 0.5;
      const geomV = 0.5;
      // Player 1.5 UV units away (within default 2.5 magnet range)
      const playerU = 2.0;
      const playerV = 0.5;

      pool.spawn(geomU, geomV);
      const data = pool.getGeomData(0);

      // Zero out scatter velocity to isolate magnetism
      data.velU = 0;
      data.velV = 0;
      data.age = 0.5; // Past settle time

      // Tick with player nearby
      const dt = 1 / 60;
      for (let f = 0; f < 30; f++) {
        pool.update(dt, playerU, playerV, f * dt);
      }

      // Geom should have moved toward player (higher U)
      expect(data.surfaceU).toBeGreaterThan(geomU);
    });

    it('does NOT attract geom outside magnet radius', () => {
      const geomU = 0.5;
      const geomV = 0.5;
      const playerU = 10; // Very far away
      const playerV = 10;

      pool.spawn(geomU, geomV);
      // Zero out drift velocity to isolate magnetism
      const data = pool.getGeomData(0);
      data.velU = 0;
      data.velV = 0;

      const dt = 1 / 60;
      for (let f = 0; f < 60; f++) {
        pool.update(dt, playerU, playerV, f * dt, 2.5); // base radius only
      }

      // Should NOT have moved toward player (too far)
      expect(data.surfaceU).toBeCloseTo(geomU, 3);
      expect(data.surfaceV).toBeCloseTo(geomV, 3);
    });

    it('attraction uses smooth acceleration (magnetSpeed ramps up)', () => {
      pool.spawn(0.5, 0.5);
      const data = pool.getGeomData(0);
      data.velU = 0;
      data.velV = 0;
      data.age = 0.5; // Past settle time

      const playerU = 0.51;
      const playerV = 0.5;
      const dt = 1 / 60;

      // After 1 tick, magnetSpeed should be small but nonzero
      pool.update(dt, playerU, playerV, dt);
      const speed1 = data.magnetSpeed;

      // After several more ticks, magnetSpeed should be larger
      for (let f = 0; f < 10; f++) {
        pool.update(dt, playerU, playerV, (f + 2) * dt);
      }
      const speed2 = data.magnetSpeed;

      expect(speed1).toBeGreaterThan(0);
      expect(speed2).toBeGreaterThan(speed1);
    });

    it('stronger attraction when closer (quadratic falloff)', () => {
      // Spawn two geoms at different distances from the player
      // Player at (0, 0), geom 0 at dist=1.0, geom 1 at dist=3.0
      pool.spawn(1.0, 0);  // geom 0: 1.0 units away
      pool.spawn(3.0, 0);  // geom 1: 3.0 units away

      const dataClose = pool.getGeomData(0);
      const dataFar = pool.getGeomData(1);

      // Zero out drift
      dataClose.velU = 0; dataClose.velV = 0;
      dataFar.velU = 0; dataFar.velV = 0;
      dataClose.age = 0.5;
      dataFar.age = 0.5;

      const playerU = 0;
      const playerV = 0;

      const dt = 1 / 60;
      // Single tick to compare initial attraction force
      pool.update(dt, playerU, playerV, dt, 5); // large radius to include both

      // Close geom should have stronger magnetSpeed (it's closer, so quadratic strength is higher)
      expect(dataClose.magnetSpeed).toBeGreaterThan(dataFar.magnetSpeed);
    });

    it('magnetSpeed decays when geom leaves magnet range', () => {
      pool.spawn(0.5, 0.5);
      const data = pool.getGeomData(0);
      data.velU = 0;
      data.velV = 0;
      data.age = 0.5;

      const dt = 1 / 60;
      // Build up some magnetic speed
      for (let f = 0; f < 30; f++) {
        pool.update(dt, 0.52, 0.5, f * dt, 2.5);
      }
      expect(data.magnetSpeed).toBeGreaterThan(0);

      // Now move player far away
      for (let f = 0; f < 60; f++) {
        pool.update(dt, 100, 100, (30 + f) * dt, 2.5);
      }
      // magnetSpeed should have decayed significantly
      expect(data.magnetSpeed).toBeLessThan(0.1);
    });
  });

  // -- Magnetism buff radius -----------------------------------------------

  describe('magnetism radius parameter', () => {
    it('larger radius attracts from further away', () => {
      const geomU = 0.5;
      const playerU = 0.53; // About 0.03 UV away

      pool.spawn(geomU, 0.5);
      const data = pool.getGeomData(0);
      data.velU = 0;
      data.velV = 0;
      data.age = 0.5;

      const dt = 1 / 60;

      // With tiny radius (0.01), should NOT attract
      for (let f = 0; f < 30; f++) {
        pool.update(dt, playerU, 0.5, f * dt, 0.01);
      }
      expect(data.attracted).toBe(false);

      // Reset position
      data.surfaceU = geomU;
      data.magnetSpeed = 0;

      // With large radius (5.0), should attract
      for (let f = 0; f < 30; f++) {
        pool.update(dt, playerU, 0.5, (30 + f) * dt, 5.0);
      }
      expect(data.attracted).toBe(true);
    });

    it('default radius is used when not specified', () => {
      pool.spawn(0.5, 0.5);
      const data = pool.getGeomData(0);
      data.velU = 0;
      data.velV = 0;
      data.age = 0.5;

      const dt = 1 / 60;
      // Player within default range (~2.5)
      for (let f = 0; f < 30; f++) {
        pool.update(dt, 0.51, 0.5, f * dt); // no magnetRadius arg
      }
      expect(data.attracted).toBe(true);
    });
  });

  // -- Visual feedback (attracted state) ------------------------------------

  describe('visual feedback', () => {
    it('attracted flag is set when within range', () => {
      pool.spawn(0.5, 0.5);
      const data = pool.getGeomData(0);
      data.velU = 0;
      data.velV = 0;
      data.age = 0.5;

      const dt = 1 / 60;
      pool.update(dt, 0.51, 0.5, dt, 2.5);
      expect(data.attracted).toBe(true);
    });

    it('attracted flag is false when outside range', () => {
      pool.spawn(0.5, 0.5);
      const data = pool.getGeomData(0);
      data.velU = 0;
      data.velV = 0;
      data.age = 0.5;

      const dt = 1 / 60;
      pool.update(dt, 100, 100, dt, 2.5);
      expect(data.attracted).toBe(false);
    });
  });

  // -- Despawn and fade (existing behavior preserved) ----------------------

  describe('despawn and fade', () => {
    it('geom despawns after fade duration (10s)', () => {
      pool.spawn(0.5, 0.5);
      expect(getActiveGeoms(pool)).toHaveLength(1);

      // Tick for 10+ seconds
      const dt = 1 / 60;
      for (let f = 0; f < 700; f++) { // ~11.6 seconds
        pool.update(dt, 100, 100, f * dt, 0.001);
      }

      expect(getActiveGeoms(pool)).toHaveLength(0);
    });
  });

  // -- Pool slot reuse -----------------------------------------------------

  describe('pool slot reuse', () => {
    it('resets magnetSpeed and attracted on re-spawn', () => {
      pool.spawn(0.5, 0.5);
      const data = pool.getGeomData(0);
      data.magnetSpeed = 5;
      data.attracted = true;

      pool.kill(0);
      pool.spawn(0.5, 0.5);

      const reused = pool.getGeomData(0);
      expect(reused.magnetSpeed).toBe(0);
      expect(reused.attracted).toBe(false);
    });
  });

  // -- Zero allocation check -----------------------------------------------

  describe('performance', () => {
    it('update does not throw with many active geoms', () => {
      for (let i = 0; i < 100; i++) {
        pool.spawn(Math.random(), Math.random(), Math.random() * Math.PI * 2);
      }

      const dt = 1 / 60;
      expect(() => {
        for (let f = 0; f < 60; f++) {
          pool.update(dt, 0.5, 0.5, f * dt, 5.0);
        }
      }).not.toThrow();
    });
  });
});

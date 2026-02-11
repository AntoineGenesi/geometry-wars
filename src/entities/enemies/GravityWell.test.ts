import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as THREE from 'three';
import { GravityWell, WellType } from './GravityWell';

describe('GravityWell', () => {
  let scene: THREE.Scene;

  beforeEach(() => {
    scene = new THREE.Scene();
    // Reset static callbacks
    GravityWell.onDetonate = null;
    GravityWell.onApplyGridForce = null;
    GravityWell.onPullPlayer = null;
    GravityWell.onWellActivated = null;
  });

  describe('Constructor and Initialization', () => {
    it('should create a blue well by default', () => {
      const well = new GravityWell(0.5, 0.5);
      expect(well.getWellType()).toBe('blue');
      expect(well.mesh).toBeTruthy();
    });

    it('should create a blue well when explicitly specified', () => {
      const well = new GravityWell(0.5, 0.5, 'blue');
      expect(well.getWellType()).toBe('blue');
    });

    it('should create a red well when specified', () => {
      const well = new GravityWell(0.5, 0.5, 'red');
      expect(well.getWellType()).toBe('red');
    });

    it('should have correct initial properties', () => {
      const well = new GravityWell(0.3, 0.7);
      expect(well.surfacePosition.u).toBe(0.3);
      expect(well.surfacePosition.v).toBe(0.7);
      expect(well.isGravityActive()).toBe(false);
      expect(well.alive).toBe(true);
    });

    it('should create mesh with correct color for blue well', () => {
      const well = new GravityWell(0.5, 0.5, 'blue');
      expect(well.mesh).toBeTruthy();

      // Check that at least one child has blue-ish color (0x4488ff)
      let hasBlueColor = false;
      well.mesh!.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          const mat = child.material as THREE.MeshStandardMaterial | THREE.MeshBasicMaterial;
          if (mat.color && mat.color.getHex() === 0x4488ff) {
            hasBlueColor = true;
          }
        }
      });
      expect(hasBlueColor).toBe(true);
    });

    it('should create mesh with correct color for red well', () => {
      const well = new GravityWell(0.5, 0.5, 'red');
      expect(well.mesh).toBeTruthy();

      // Check that at least one child has red-ish color (0xff4444)
      let hasRedColor = false;
      well.mesh!.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          const mat = child.material as THREE.MeshStandardMaterial | THREE.MeshBasicMaterial;
          if (mat.color && mat.color.getHex() === 0xff4444) {
            hasRedColor = true;
          }
        }
      });
      expect(hasRedColor).toBe(true);
    });
  });

  describe('Activation', () => {
    it('should activate on first damage', () => {
      const well = new GravityWell(0.5, 0.5);
      expect(well.isGravityActive()).toBe(false);

      well.takeDamage(5);
      expect(well.isGravityActive()).toBe(true);
    });

    it('should call onWellActivated callback when activated', () => {
      const callback = vi.fn();
      GravityWell.onWellActivated = callback;

      const well = new GravityWell(0.5, 0.5);
      well.takeDamage(5);

      expect(callback).toHaveBeenCalledTimes(1);
    });

    it('should only activate once', () => {
      const callback = vi.fn();
      GravityWell.onWellActivated = callback;

      const well = new GravityWell(0.5, 0.5);
      well.takeDamage(5);
      well.takeDamage(5);
      well.takeDamage(5);

      expect(callback).toHaveBeenCalledTimes(1);
    });
  });

  describe('Pull Mechanics', () => {
    it('should call onPullPlayer when active and player in range', () => {
      const pullCallback = vi.fn();
      GravityWell.onPullPlayer = pullCallback;

      const well = new GravityWell(0.5, 0.5);
      well.takeDamage(1); // Activate

      // Player at (0.6, 0.5) - close enough to be pulled
      well.updateBehavior(0.016, 0.6, 0.5);

      expect(pullCallback).toHaveBeenCalled();
      const [deltaU, deltaV] = pullCallback.mock.calls[0];

      // Should pull toward well (negative deltaU since player is at higher U)
      expect(deltaU).toBeLessThan(0);
      expect(Math.abs(deltaU)).toBeGreaterThan(0);
    });

    it('should not pull player when inactive', () => {
      const pullCallback = vi.fn();
      GravityWell.onPullPlayer = pullCallback;

      const well = new GravityWell(0.5, 0.5);
      // Don't activate

      well.updateBehavior(0.016, 0.6, 0.5);

      expect(pullCallback).not.toHaveBeenCalled();
    });

    it('should not pull player when out of range', () => {
      const pullCallback = vi.fn();
      GravityWell.onPullPlayer = pullCallback;

      const well = new GravityWell(0.5, 0.5);
      well.takeDamage(1); // Activate

      // Player far away (pullRadius is 2.0, so 3.0 is out of range)
      well.updateBehavior(0.016, 3.5, 0.5);

      expect(pullCallback).not.toHaveBeenCalled();
    });

    it('should have stronger pull when closer (force falloff)', () => {
      const pullCallback = vi.fn();
      GravityWell.onPullPlayer = pullCallback;

      const well = new GravityWell(0.5, 0.5);
      well.takeDamage(1); // Activate

      // Test at two distances
      well.updateBehavior(0.016, 0.6, 0.5); // Close
      const closeCall = pullCallback.mock.calls[0];
      const closeMagnitude = Math.sqrt(closeCall[0] ** 2 + closeCall[1] ** 2);

      pullCallback.mockClear();

      well.updateBehavior(0.016, 1.5, 0.5); // Farther (but still in range)
      const farCall = pullCallback.mock.calls[0];
      const farMagnitude = Math.sqrt(farCall[0] ** 2 + farCall[1] ** 2);

      expect(closeMagnitude).toBeGreaterThan(farMagnitude);
    });
  });

  describe('Lethal Zone (Red Wells)', () => {
    it('should identify lethal zone for red wells', () => {
      const well = new GravityWell(0.5, 0.5, 'red');
      well.takeDamage(1); // Activate

      // Very close position (within lethal radius 0.5)
      expect(well.isInLethalZone(0.52, 0.51)).toBe(true);

      // Outside lethal radius (0.5) but within pull radius (2.0)
      expect(well.isInLethalZone(1.0, 0.5)).toBe(false);

      // Far outside
      expect(well.isInLethalZone(3.0, 3.0)).toBe(false);
    });

    it('should not have lethal zone for blue wells', () => {
      const well = new GravityWell(0.5, 0.5, 'blue');
      well.takeDamage(1); // Activate

      // Even very close, blue wells don't kill
      expect(well.isInLethalZone(0.51, 0.5)).toBe(false);
      expect(well.isInLethalZone(0.5, 0.5)).toBe(false);
    });

    it('should not have lethal zone when inactive', () => {
      const well = new GravityWell(0.5, 0.5, 'red');
      // Don't activate

      expect(well.isInLethalZone(0.51, 0.5)).toBe(false);
    });
  });

  describe('Consume and Detonate', () => {
    it('should increment consumed count when consuming enemy', () => {
      const well = new GravityWell(0.5, 0.5);
      well.takeDamage(1); // Activate

      well.consumeEnemy(100);
      well.consumeEnemy(150);

      // consumedCount is private, but we can check if it detonates at max
      expect(well.alive).toBe(true);
    });

    it('should detonate after maxConsumed enemies', () => {
      const detonateCallback = vi.fn();
      GravityWell.onDetonate = detonateCallback;

      const well = new GravityWell(0.5, 0.5);
      well.takeDamage(1); // Activate

      // Consume 10 enemies (maxConsumed = 10)
      for (let i = 0; i < 10; i++) {
        well.consumeEnemy(100);
      }

      // Trigger update to check detonation
      well.updateBehavior(0.016, 0.5, 0.5);

      expect(detonateCallback).toHaveBeenCalled();
      expect(well.alive).toBe(false);
    });

    it('should accumulate score when consuming enemies', () => {
      const detonateCallback = vi.fn();
      GravityWell.onDetonate = detonateCallback;

      const well = new GravityWell(0.5, 0.5);
      well.takeDamage(1); // Activate

      well.consumeEnemy(100);
      well.consumeEnemy(200);
      well.consumeEnemy(300);

      // Consume until detonation
      for (let i = 3; i < 10; i++) {
        well.consumeEnemy(50);
      }

      well.updateBehavior(0.016, 0.5, 0.5);

      expect(detonateCallback).toHaveBeenCalled();
      const [position, finalScore] = detonateCallback.mock.calls[0];

      // Final score should include consumed score + bonus
      expect(finalScore).toBeGreaterThan(100 + 200 + 300);
    });
  });

  describe('Visual Indicators', () => {
    it('should have radius ring that is initially hidden', () => {
      const well = new GravityWell(0.5, 0.5);

      let radiusRingFound = false;
      well.mesh!.traverse((child) => {
        if (child instanceof THREE.Mesh && child.geometry instanceof THREE.RingGeometry) {
          // Check if it's the large pull radius ring (not the danger ring)
          const mat = child.material as THREE.MeshBasicMaterial;
          if (mat.blending === THREE.AdditiveBlending && !child.visible) {
            radiusRingFound = true;
          }
        }
      });

      expect(radiusRingFound).toBe(true);
    });

    it('should show radius ring when activated', () => {
      const well = new GravityWell(0.5, 0.5);
      well.takeDamage(1); // Activate

      let radiusRingVisible = false;
      well.mesh!.traverse((child) => {
        if (child instanceof THREE.Mesh && child.geometry instanceof THREE.RingGeometry) {
          const mat = child.material as THREE.MeshBasicMaterial;
          if (mat.blending === THREE.AdditiveBlending && child.visible) {
            radiusRingVisible = true;
          }
        }
      });

      expect(radiusRingVisible).toBe(true);
    });

    it('should have danger ring for red wells', () => {
      const well = new GravityWell(0.5, 0.5, 'red');

      let dangerRingFound = false;
      well.mesh!.traverse((child) => {
        if (child instanceof THREE.Mesh && child.geometry instanceof THREE.RingGeometry) {
          const mat = child.material as THREE.MeshBasicMaterial;
          // Danger ring has higher opacity and red color
          if (mat.color.getHex() === 0xff0000 && mat.opacity > 0.2) {
            dangerRingFound = true;
          }
        }
      });

      expect(dangerRingFound).toBe(true);
    });

    it('should not have danger ring for blue wells', () => {
      const well = new GravityWell(0.5, 0.5, 'blue');

      let dangerRingFound = false;
      well.mesh!.traverse((child) => {
        if (child instanceof THREE.Mesh && child.geometry instanceof THREE.RingGeometry) {
          const mat = child.material as THREE.MeshBasicMaterial;
          // Check for red danger ring
          if (mat.color.getHex() === 0xff0000) {
            dangerRingFound = true;
          }
        }
      });

      expect(dangerRingFound).toBe(false);
    });
  });

  describe('Update Behavior', () => {
    it('should pulse visual scale', () => {
      const well = new GravityWell(0.5, 0.5);
      const initialScale = well.mesh!.scale.x;

      well.updateBehavior(0.5, 0.5, 0.5); // Half second

      // Scale should have changed due to pulse
      expect(well.mesh!.scale.x).not.toBe(initialScale);
    });

    it('should drift when inactive', () => {
      const well = new GravityWell(0.5, 0.5);
      const initialU = well.surfacePosition.u;
      const initialV = well.surfacePosition.v;

      well.updateBehavior(1.0, 0.5, 0.5); // 1 second

      // Position should have drifted
      const movedU = well.surfacePosition.u !== initialU;
      const movedV = well.surfacePosition.v !== initialV;

      expect(movedU || movedV).toBe(true);
    });

    it('should call onApplyGridForce when active', () => {
      const gridCallback = vi.fn();
      GravityWell.onApplyGridForce = gridCallback;

      const well = new GravityWell(0.5, 0.5);
      well.takeDamage(1); // Activate

      well.updateBehavior(0.016, 0.5, 0.5);

      expect(gridCallback).toHaveBeenCalled();
    });
  });

  describe('Pull Radius', () => {
    it('should return correct pull radius', () => {
      const well = new GravityWell(0.5, 0.5);
      expect(well.getPullRadius()).toBe(2.0);
    });

    it('should return correct lethal radius', () => {
      const well = new GravityWell(0.5, 0.5);
      expect(well.getLethalRadius()).toBe(0.5);
    });
  });
});

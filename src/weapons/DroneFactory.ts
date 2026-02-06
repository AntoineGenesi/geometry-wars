import { BaseDrone, DroneType } from './BaseDrone';
import { AttackDrone } from './AttackDrone';
import { CollectDrone } from './CollectDrone';
import { RamDrone } from './RamDrone';
import { SnipeDrone } from './SnipeDrone';
import { DefendDrone } from './DefendDrone';
import { SweepDrone } from './SweepDrone';

// Default callbacks (no-ops; override via DroneCallbacks)
const defaultOnShoot = (_origin: { u: number; v: number }, _direction: number) => {};
const defaultOnCollectGeom = (_surfaceU: number, _surfaceV: number) => {};
const defaultOnRamKill = (_enemy: any) => {};
const defaultOnSnipeHit = (_enemy: any) => {};
const defaultOnSweepKill = (_enemy: any) => {};

export interface DroneCallbacks {
  onShoot?: (origin: { u: number; v: number }, direction: number) => void;
  onCollectGeom?: (surfaceU: number, surfaceV: number) => void;
  onRamKill?: (enemy: any) => void;
  onSnipeHit?: (enemy: any) => void;
  onSweepKill?: (enemy: any) => void;
}

export function createDrone(
  type: DroneType,
  level = 0,
  callbacks: DroneCallbacks = {}
): BaseDrone {
  const {
    onShoot = defaultOnShoot,
    onCollectGeom = defaultOnCollectGeom,
    onRamKill = defaultOnRamKill,
    onSnipeHit = defaultOnSnipeHit,
    onSweepKill = defaultOnSweepKill,
  } = callbacks;

  switch (type) {
    case DroneType.Attack:
      return new AttackDrone(level, onShoot);
    case DroneType.Collect:
      return new CollectDrone(level, onCollectGeom);
    case DroneType.Ram:
      return new RamDrone(level, onRamKill);
    case DroneType.Snipe:
      return new SnipeDrone(level, onSnipeHit);
    case DroneType.Defend:
      return new DefendDrone(level, onShoot);
    case DroneType.Sweep:
      return new SweepDrone(level, onSweepKill);
    default:
      throw new Error(`Unknown drone type: ${type}`);
  }
}

import * as THREE from 'three';
import { SHARED_WEAPON_CONFIGS } from '../shared/GameBalanceConstants';

/**
 * Weapon type identifiers
 */
export enum WeaponType {
  Standard = 'standard',
  Spread = 'spread',
  Piercing = 'piercing',
  ChainLightning = 'chain_lightning',
  Homing = 'homing',
  PlasmaMortar = 'plasma_mortar',
  GravityGun = 'gravity_gun',
  LaserBeam = 'laser_beam',
  BlackHole = 'black_hole',
  TeslaCoil = 'tesla_coil',
}

/**
 * Weapon configuration data
 */
export interface WeaponConfig {
  type: WeaponType;
  name: string;
  color: number;
  damage: number;
  fireRate: number; // shots per second
  ammo: number; // -1 for unlimited (standard)
  projectileSpeed: number;
  description: string;
}

// Helper to build a WeaponConfig from shared numeric values + visual properties
function weaponConfig(
  type: WeaponType,
  name: string,
  color: number,
  projectileSpeed: number,
  description: string,
): WeaponConfig {
  const shared = SHARED_WEAPON_CONFIGS[type];
  return { type, name, color, damage: shared.damage, fireRate: shared.fireRate, ammo: shared.ammo, projectileSpeed, description };
}

/**
 * Weapon configurations
 * Numeric values (damage, fireRate, ammo) come from src/shared/GameBalanceConstants.ts.
 * Visual properties (color, name, description, projectileSpeed) are defined here.
 */
export const WEAPON_CONFIGS: Record<WeaponType, WeaponConfig> = {
  [WeaponType.Standard]: weaponConfig(WeaponType.Standard, 'Blaster', 0xffff44, 1.5, 'Rapid-fire energy bolts (always fires alongside equipped weapon)'),
  [WeaponType.Spread]: weaponConfig(WeaponType.Spread, 'Spread Shot', 0x44ffff, 3.0, '5 bullets in a fan pattern'),
  [WeaponType.Piercing]: weaponConfig(WeaponType.Piercing, 'Piercing Beam', 0xffffff, 0, 'Geodesic beam that hits all enemies in its path'),
  [WeaponType.ChainLightning]: weaponConfig(WeaponType.ChainLightning, 'Chain Lightning', 0xaaffff, 0, 'Arcs between up to 6 enemies'),
  [WeaponType.Homing]: weaponConfig(WeaponType.Homing, 'Homing Missiles', 0xff4444, 3.0, 'Seeks nearest enemy with explosive impact'),
  [WeaponType.PlasmaMortar]: weaponConfig(WeaponType.PlasmaMortar, 'Plasma Mortar', 0x44ff44, 1.0, 'Devastating AoE explosion on impact'),
  [WeaponType.GravityGun]: weaponConfig(WeaponType.GravityGun, 'Gravity Gun', 0x8844ff, 1.0, 'Pulls enemies together'),
  [WeaponType.LaserBeam]: weaponConfig(WeaponType.LaserBeam, 'Laser Beam', 0xff0000, 0, 'Sustained high-damage beam'),
  [WeaponType.BlackHole]: weaponConfig(WeaponType.BlackHole, 'Black Hole', 0x220044, 0.4, 'Vortex that destroys everything'),
  [WeaponType.TeslaCoil]: weaponConfig(WeaponType.TeslaCoil, 'Tesla Coil', 0x88aaff, 0, 'Damages all nearby enemies'),
};

/**
 * Get weapon color as THREE.Color
 */
export function getWeaponColor(type: WeaponType): THREE.Color {
  return new THREE.Color(WEAPON_CONFIGS[type].color);
}

/**
 * Get weapon display info
 */
export function getWeaponInfo(type: WeaponType): { name: string; description: string } {
  const config = WEAPON_CONFIGS[type];
  return { name: config.name, description: config.description };
}

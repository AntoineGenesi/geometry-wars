import * as THREE from 'three';

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

/**
 * Weapon configurations
 */
export const WEAPON_CONFIGS: Record<WeaponType, WeaponConfig> = {
  [WeaponType.Standard]: {
    type: WeaponType.Standard,
    name: 'Blaster',
    color: 0xffff44,
    damage: 0.5,
    fireRate: 15,
    ammo: -1,
    projectileSpeed: 1.5,
    description: 'Rapid-fire energy bolts',
  },
  [WeaponType.Spread]: {
    type: WeaponType.Spread,
    name: 'Spread Shot',
    color: 0x44ffff,
    damage: 1,
    fireRate: 6,
    ammo: 100,
    projectileSpeed: 3.0,
    description: '5 bullets in a fan pattern',
  },
  [WeaponType.Piercing]: {
    type: WeaponType.Piercing,
    name: 'Piercing Beam',
    color: 0xffffff,
    damage: 3,
    fireRate: 3,
    ammo: 50,
    projectileSpeed: 0, // instant beam
    description: 'Geodesic beam that hits all enemies in its path',
  },
  [WeaponType.ChainLightning]: {
    type: WeaponType.ChainLightning,
    name: 'Chain Lightning',
    color: 0xaaffff,
    damage: 4,
    fireRate: 3,
    ammo: 50,
    projectileSpeed: 0, // instant
    description: 'Arcs between up to 6 enemies',
  },
  [WeaponType.Homing]: {
    type: WeaponType.Homing,
    name: 'Homing Missiles',
    color: 0xff4444,
    damage: 5,
    fireRate: 2,
    ammo: 40,
    projectileSpeed: 0.8,
    description: 'Seeks nearest enemy',
  },
  [WeaponType.PlasmaMortar]: {
    type: WeaponType.PlasmaMortar,
    name: 'Plasma Mortar',
    color: 0x44ff44,
    damage: 20,
    fireRate: 1.0,
    ammo: 18,
    projectileSpeed: 1.0,
    description: 'Devastating AoE explosion on impact',
  },
  [WeaponType.GravityGun]: {
    type: WeaponType.GravityGun,
    name: 'Gravity Gun',
    color: 0x8844ff,
    damage: 1,
    fireRate: 1,
    ammo: 20,
    projectileSpeed: 1.0,
    description: 'Pulls enemies together',
  },
  [WeaponType.LaserBeam]: {
    type: WeaponType.LaserBeam,
    name: 'Laser Beam',
    color: 0xff0000,
    damage: 2, // per tick
    fireRate: 60, // continuous
    ammo: 200, // duration ticks
    projectileSpeed: 0, // instant
    description: 'Sustained high-damage beam',
  },
  [WeaponType.BlackHole]: {
    type: WeaponType.BlackHole,
    name: 'Black Hole',
    color: 0x220044,
    damage: 999,
    fireRate: 0.3,
    ammo: 6,
    projectileSpeed: 0.4,
    description: 'Vortex that destroys everything',
  },
  [WeaponType.TeslaCoil]: {
    type: WeaponType.TeslaCoil,
    name: 'Tesla Coil',
    color: 0x88aaff,
    damage: 1, // per tick
    fireRate: 30, // ticks per second
    ammo: 300, // duration ticks (10 seconds)
    projectileSpeed: 0, // area effect
    description: 'Damages all nearby enemies',
  },
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

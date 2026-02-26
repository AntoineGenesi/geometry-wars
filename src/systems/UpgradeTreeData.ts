import { WeaponType } from '../weapons/WeaponTypes';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type UpgradeBranch = 'a' | 'b';

export interface UpgradeNode {
  /** Stable unique identifier: "${weaponType}_${branch}_${nodeIndex}" */
  id: string;
  branch: UpgradeBranch;
  /** 1-indexed position within the branch */
  nodeIndex: number;
  description: string;
  /** In-match kill count required to activate this node */
  killThreshold: number;
  /** Human-readable summary of the gameplay effect */
  effect: string;
}

export interface UpgradeTree {
  weaponType: WeaponType;
  branchAName: string;
  branchBName: string;
  nodes: UpgradeNode[];
}

// ---------------------------------------------------------------------------
// Kill thresholds per node index (1-based)
// ---------------------------------------------------------------------------

const KILL_THRESHOLDS: Record<number, number> = {
  1: 10,
  2: 25,
  3: 50,
  4: 80,
  5: 120,
};

// ---------------------------------------------------------------------------
// Helper to build a node
// ---------------------------------------------------------------------------

function node(
  weaponType: WeaponType,
  branch: UpgradeBranch,
  index: number,
  description: string,
  effect: string,
): UpgradeNode {
  return {
    id: `${weaponType}_${branch}_${index}`,
    branch,
    nodeIndex: index,
    description,
    killThreshold: KILL_THRESHOLDS[index],
    effect,
  };
}

// ---------------------------------------------------------------------------
// Upgrade Trees — all 10 weapons, 2 branches × 5 nodes = 10 nodes per weapon
// ---------------------------------------------------------------------------

export const UPGRADE_TREES: Record<WeaponType, UpgradeTree> = {
  // -------------------------------------------------------------------------
  // 1. Standard (Blaster)
  //    Branch A "SCATTER" — fan out, more bullets, wider arc
  //    Branch B "HONE"    — tight cone, more bullets, homing bias
  // -------------------------------------------------------------------------
  [WeaponType.Standard]: {
    weaponType: WeaponType.Standard,
    branchAName: 'Scatter',
    branchBName: 'Hone',
    nodes: [
      node(WeaponType.Standard, 'a', 1, 'Dual bolts',     'Fires 2 bolts side by side (+1 bullet)'),
      node(WeaponType.Standard, 'a', 2, 'Triple spray',   'Fires 3 bolts in a narrow fan (+2 bullets)'),
      node(WeaponType.Standard, 'a', 3, 'Quad burst',     'Fires 4 bolts, fan widens slightly (+3 bullets)'),
      node(WeaponType.Standard, 'a', 4, 'Shotgun spread', 'Fires 5 bolts in a 25° arc (+4 bullets)'),
      node(WeaponType.Standard, 'a', 5, 'Hellstorm',      'Fires 7 bolts in a 40° arc (+6 bullets)'),
      node(WeaponType.Standard, 'b', 1, 'Focused pair',   'Fires 2 bolts in a tight 5° cone (+1 bullet)'),
      node(WeaponType.Standard, 'b', 2, 'Triple needle',  'Fires 3 bolts in a 5° cone, tighter grouping (+2 bullets)'),
      node(WeaponType.Standard, 'b', 3, 'Quad lance',     'Fires 4 tightly-grouped bolts (+3 bullets)'),
      node(WeaponType.Standard, 'b', 4, 'Seeking bolts',  'Fires 4 bolts with mild homing bias (+3 bullets, +homing)'),
      node(WeaponType.Standard, 'b', 5, 'Smart swarm',    'Fires 5 bolts, each auto-corrects toward nearest enemy'),
    ],
  },

  // -------------------------------------------------------------------------
  // 2. Spread Shot
  //    Branch A "MORE PELLETS" — pure pellet count, damage per pellet
  //    Branch B "TIGHT CLUSTER" — reduce cone, increase damage, no width reversal
  // -------------------------------------------------------------------------
  [WeaponType.Spread]: {
    weaponType: WeaponType.Spread,
    branchAName: 'More Pellets',
    branchBName: 'Tight Cluster',
    nodes: [
      node(WeaponType.Spread, 'a', 1, 'Extra pellet',    '+1 pellet (6 total)'),
      node(WeaponType.Spread, 'a', 2, 'Two extra',       '+2 pellets (7 total)'),
      node(WeaponType.Spread, 'a', 3, 'Three extra',     '+3 pellets (8 total)'),
      node(WeaponType.Spread, 'a', 4, 'Heavy barrage',   '+4 pellets (9 total)'),
      node(WeaponType.Spread, 'a', 5, 'Pellet storm',    '+5 pellets (10 total), +15% damage/pellet'),
      node(WeaponType.Spread, 'b', 1, 'Tight pattern',   '-10% cone width, denser grouping'),
      node(WeaponType.Spread, 'b', 2, 'Focused burst',   '-20% cone width, +10% damage/pellet'),
      node(WeaponType.Spread, 'b', 3, 'Slug mode',       '-30% cone width, +20% damage/pellet'),
      node(WeaponType.Spread, 'b', 4, 'Piercing cluster','-30% cone, +30% dmg/pellet, pellets pierce 1 enemy'),
      node(WeaponType.Spread, 'b', 5, 'Needle volley',   '-30% cone, +50% dmg/pellet, pellets pierce 2 enemies'),
    ],
  },

  // -------------------------------------------------------------------------
  // 3. Piercing Beam
  //    Branch A "RANGE"      — longer beam, bigger reach
  //    Branch B "RAPID FIRE" — fire rate, multi-shot
  // -------------------------------------------------------------------------
  [WeaponType.Piercing]: {
    weaponType: WeaponType.Piercing,
    branchAName: 'Range',
    branchBName: 'Rapid Fire',
    nodes: [
      node(WeaponType.Piercing, 'a', 1, 'Extended beam', '+40% beam length'),
      node(WeaponType.Piercing, 'a', 2, 'Long reach',    '+80% beam length'),
      node(WeaponType.Piercing, 'a', 3, 'Full sweep',    '+130% beam length'),
      node(WeaponType.Piercing, 'a', 4, 'Arc beam',      '+200% beam length, beam curves to hit 2nd target off-axis'),
      node(WeaponType.Piercing, 'a', 5, 'Cross surface', 'Beam wraps across entire surface topology'),
      node(WeaponType.Piercing, 'b', 1, 'Fast reload',   '+25% fire rate'),
      node(WeaponType.Piercing, 'b', 2, 'Overclock',     '+50% fire rate'),
      node(WeaponType.Piercing, 'b', 3, 'Double tap',    'Fires 2 beams per trigger pull (0.1s apart)'),
      node(WeaponType.Piercing, 'b', 4, 'Triple tap',    'Fires 3 beams per trigger pull'),
      node(WeaponType.Piercing, 'b', 5, 'Beam burst',    'Fires 4 beams per trigger pull at +70% total fire rate'),
    ],
  },

  // -------------------------------------------------------------------------
  // 4. Chain Lightning
  //    Branch A "VIRALITY" — more chain targets, wider jump range
  //    Branch B "VOLTAGE"  — damage per arc, stun
  // -------------------------------------------------------------------------
  [WeaponType.ChainLightning]: {
    weaponType: WeaponType.ChainLightning,
    branchAName: 'Virality',
    branchBName: 'Voltage',
    nodes: [
      node(WeaponType.ChainLightning, 'a', 1, 'Extra arc',   '+2 chain targets (8 total)'),
      node(WeaponType.ChainLightning, 'a', 2, 'Wide arcs',   '+3 chain targets (9 total), +15% jump range'),
      node(WeaponType.ChainLightning, 'a', 3, 'Storm arcs',  '+5 chain targets (11 total), +25% jump range'),
      node(WeaponType.ChainLightning, 'a', 4, 'Mega chain',  '+7 chain targets (13 total), +40% jump range'),
      node(WeaponType.ChainLightning, 'a', 5, 'Uberstorm',   '+10 chain targets (16 total), chains re-arc to already-hit targets for bonus damage'),
      node(WeaponType.ChainLightning, 'b', 1, 'High voltage','+30% damage per arc'),
      node(WeaponType.ChainLightning, 'b', 2, 'Overcharge',  '+60% damage per arc'),
      node(WeaponType.ChainLightning, 'b', 3, 'Supercharge', '+100% damage per arc'),
      node(WeaponType.ChainLightning, 'b', 4, 'Stun bolt',   '+100% dmg/arc, hit enemies are slowed 30% for 1s'),
      node(WeaponType.ChainLightning, 'b', 5, 'Overload',    '+130% dmg/arc, enemies killed by chain explode in a mini-shockwave'),
    ],
  },

  // -------------------------------------------------------------------------
  // 5. Homing Missiles
  //    Branch A "SPEED"   — faster missiles, tighter tracking
  //    Branch B "WARHEAD" — bigger explosion, area effects
  // -------------------------------------------------------------------------
  [WeaponType.Homing]: {
    weaponType: WeaponType.Homing,
    branchAName: 'Speed',
    branchBName: 'Warhead',
    nodes: [
      node(WeaponType.Homing, 'a', 1, 'Afterburner',   '+25% missile speed'),
      node(WeaponType.Homing, 'a', 2, 'Hyperdrive',    '+50% missile speed'),
      node(WeaponType.Homing, 'a', 3, 'Laser-guided',  '+75% speed, tighter turn radius'),
      node(WeaponType.Homing, 'a', 4, 'Mach strike',   '+100% speed, tighter turn radius'),
      node(WeaponType.Homing, 'a', 5, 'Hypersonic',    '+150% speed, missiles cannot be outrun'),
      node(WeaponType.Homing, 'b', 1, 'Bigger warhead','+30% explosion radius'),
      node(WeaponType.Homing, 'b', 2, 'Shockwave',     '+60% explosion radius'),
      node(WeaponType.Homing, 'b', 3, 'Cluster bomb',  'On detonation, spawns 3 child missiles'),
      node(WeaponType.Homing, 'b', 4, 'Napalm',        'Explosion leaves gas cloud (3s, 3 dmg/tick)'),
      node(WeaponType.Homing, 'b', 5, 'Nova burst',    '+100% explosion radius + napalm cloud + shockwave stun'),
    ],
  },

  // -------------------------------------------------------------------------
  // 6. Plasma Mortar
  //    Branch A "EXPLOSION" — AoE radius, chain explosions
  //    Branch B "STRENGTH"  — raw damage, armor penetration
  // -------------------------------------------------------------------------
  [WeaponType.PlasmaMortar]: {
    weaponType: WeaponType.PlasmaMortar,
    branchAName: 'Explosion',
    branchBName: 'Strength',
    nodes: [
      node(WeaponType.PlasmaMortar, 'a', 1, 'Wide blast',   '+25% AoE radius'),
      node(WeaponType.PlasmaMortar, 'a', 2, 'Mega blast',   '+50% AoE radius'),
      node(WeaponType.PlasmaMortar, 'a', 3, 'Shockwave',    '+80% AoE radius'),
      node(WeaponType.PlasmaMortar, 'a', 4, 'Chain blast',  '+80% AoE radius, explosion triggers secondary blast in 0.3s'),
      node(WeaponType.PlasmaMortar, 'a', 5, 'Carpet bomb',  'Fires 3 mortars per shot in a spread'),
      node(WeaponType.PlasmaMortar, 'b', 1, 'Dense plasma', '+30% explosion damage'),
      node(WeaponType.PlasmaMortar, 'b', 2, 'Heavy payload','+60% explosion damage'),
      node(WeaponType.PlasmaMortar, 'b', 3, 'Critical mass','+100% explosion damage'),
      node(WeaponType.PlasmaMortar, 'b', 4, 'Armor pierce', '+100% dmg, bypasses enemy damage resistance'),
      node(WeaponType.PlasmaMortar, 'b', 5, 'Annihilator',  '+150% dmg, instant-kill weak enemies, devastating vs elites'),
    ],
  },

  // -------------------------------------------------------------------------
  // 7. Gravity Gun
  //    Branch A "REACH" — pull radius, multi-pull
  //    Branch B "CRUSH" — damage to pulled enemies, collision force
  // -------------------------------------------------------------------------
  [WeaponType.GravityGun]: {
    weaponType: WeaponType.GravityGun,
    branchAName: 'Reach',
    branchBName: 'Crush',
    nodes: [
      node(WeaponType.GravityGun, 'a', 1, 'Wider field',      '+30% pull radius'),
      node(WeaponType.GravityGun, 'a', 2, 'Extended pull',    '+60% pull radius'),
      node(WeaponType.GravityGun, 'a', 3, 'Mega pull',        '+100% pull radius'),
      node(WeaponType.GravityGun, 'a', 4, 'Mass capture',     '+100% pull radius, holds up to 8 enemies simultaneously'),
      node(WeaponType.GravityGun, 'a', 5, 'Event gravity',    '+150% pull radius, enemies pulled together collide for bonus damage'),
      node(WeaponType.GravityGun, 'b', 1, 'Kinetic crush',    'Pulled enemies take 2 dmg/s'),
      node(WeaponType.GravityGun, 'b', 2, 'Heavy crush',      'Pulled enemies take 5 dmg/s'),
      node(WeaponType.GravityGun, 'b', 3, 'Implosion',        'Pulled enemies take 10 dmg/s + collision damage'),
      node(WeaponType.GravityGun, 'b', 4, 'Singularity',      'Pulled enemies take 15 dmg/s; collisions deal 3x damage'),
      node(WeaponType.GravityGun, 'b', 5, 'Black compression','20 dmg/s; enemies that die in field explode, damaging others'),
    ],
  },

  // -------------------------------------------------------------------------
  // 8. Laser Beam
  //    Branch A "RAMP"     — faster damage ramp-up, instant peak
  //    Branch B "DURATION" — longer sustained fire, width
  // -------------------------------------------------------------------------
  [WeaponType.LaserBeam]: {
    weaponType: WeaponType.LaserBeam,
    branchAName: 'Ramp',
    branchBName: 'Duration',
    nodes: [
      node(WeaponType.LaserBeam, 'a', 1, 'Fast ramp',    '+30% damage ramp-up speed'),
      node(WeaponType.LaserBeam, 'a', 2, 'Hot start',    '+60% ramp-up speed'),
      node(WeaponType.LaserBeam, 'a', 3, 'Instant peak', 'Beam immediately fires at max damage'),
      node(WeaponType.LaserBeam, 'a', 4, 'Overdriven',   'Max damage is 50% higher than baseline max'),
      node(WeaponType.LaserBeam, 'a', 5, 'Meltdown',     'Max damage is 100% higher; beam ignites enemies (DoT 2s)'),
      node(WeaponType.LaserBeam, 'b', 1, 'Extended beam','+25% beam duration'),
      node(WeaponType.LaserBeam, 'b', 2, 'Sustained fire','+50% beam duration'),
      node(WeaponType.LaserBeam, 'b', 3, 'Endurance mode','+80% beam duration'),
      node(WeaponType.LaserBeam, 'b', 4, 'Wide beam',    '+80% duration, beam width doubles (hits nearby enemies)'),
      node(WeaponType.LaserBeam, 'b', 5, 'Sweep mode',   '+80% duration, wide beam, slowly sweeps ±15° automatically'),
    ],
  },

  // -------------------------------------------------------------------------
  // 9. Black Hole
  //    Branch A "SIZE"    — duration, number of shots
  //    Branch B "GRAVITY" — pull radius, crush damage
  // -------------------------------------------------------------------------
  [WeaponType.BlackHole]: {
    weaponType: WeaponType.BlackHole,
    branchAName: 'Size',
    branchBName: 'Gravity',
    nodes: [
      node(WeaponType.BlackHole, 'a', 1, 'Bigger void', '+30% duration'),
      node(WeaponType.BlackHole, 'a', 2, 'Deep void',   '+60% duration, +1 shot'),
      node(WeaponType.BlackHole, 'a', 3, 'Singularity', '+100% duration, +2 shots'),
      node(WeaponType.BlackHole, 'a', 4, 'Twin holes',  'Fires 2 black holes simultaneously'),
      node(WeaponType.BlackHole, 'a', 5, 'Doomsday',    'Fires 2 black holes, each +150% duration'),
      node(WeaponType.BlackHole, 'b', 1, 'Stronger pull','+30% pull radius'),
      node(WeaponType.BlackHole, 'b', 2, 'Deep pull',   '+60% pull radius'),
      node(WeaponType.BlackHole, 'b', 3, 'Inescapable', '+100% pull radius'),
      node(WeaponType.BlackHole, 'b', 4, 'Crushing void','+100% radius; trapped enemies take 5 dmg/s'),
      node(WeaponType.BlackHole, 'b', 5, 'Event horizon','+150% radius; enemies that enter cannot escape; 10 dmg/s'),
    ],
  },

  // -------------------------------------------------------------------------
  // 10. Tesla Coil
  //     Branch A "RADIUS" — larger AoE, chain to out-of-range
  //     Branch B "DPS"    — damage per tick, tick frequency
  // -------------------------------------------------------------------------
  [WeaponType.TeslaCoil]: {
    weaponType: WeaponType.TeslaCoil,
    branchAName: 'Radius',
    branchBName: 'DPS',
    nodes: [
      node(WeaponType.TeslaCoil, 'a', 1, 'Wider arc',   '+25% AoE radius'),
      node(WeaponType.TeslaCoil, 'a', 2, 'Storm field', '+50% AoE radius'),
      node(WeaponType.TeslaCoil, 'a', 3, 'Mega storm',  '+80% AoE radius'),
      node(WeaponType.TeslaCoil, 'a', 4, 'Arc reach',   '+80% radius, arcs jump 20% beyond the field edge'),
      node(WeaponType.TeslaCoil, 'a', 5, 'Tempest',     '+120% AoE radius'),
      node(WeaponType.TeslaCoil, 'b', 1, 'Higher voltage','+30% dmg/tick'),
      node(WeaponType.TeslaCoil, 'b', 2, 'Overcharge',  '+60% dmg/tick'),
      node(WeaponType.TeslaCoil, 'b', 3, 'Overload',    '+100% dmg/tick'),
      node(WeaponType.TeslaCoil, 'b', 4, 'Rapid tick',  '+100% dmg/tick, tick frequency doubles'),
      node(WeaponType.TeslaCoil, 'b', 5, 'Surge overload','+150% dmg/tick, rapid tick, stuns enemies briefly'),
    ],
  },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Returns all nodes for a given weapon type. */
export function getUpgradeTree(weaponType: WeaponType): UpgradeTree {
  return UPGRADE_TREES[weaponType];
}

/** Returns all nodes across all weapons (100 total). */
export function getAllNodes(): UpgradeNode[] {
  return Object.values(UPGRADE_TREES).flatMap(tree => tree.nodes);
}

/** Looks up a single node by id. Returns undefined if not found. */
export function getNodeById(nodeId: string): UpgradeNode | undefined {
  return getAllNodes().find(n => n.id === nodeId);
}

/** Returns nodes for a specific weapon and branch. */
export function getBranchNodes(weaponType: WeaponType, branch: UpgradeBranch): UpgradeNode[] {
  return UPGRADE_TREES[weaponType].nodes.filter(n => n.branch === branch);
}

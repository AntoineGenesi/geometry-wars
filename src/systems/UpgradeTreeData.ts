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
// Upgrade Trees — all 10 weapons
// ---------------------------------------------------------------------------

export const UPGRADE_TREES: Record<WeaponType, UpgradeTree> = {
  [WeaponType.Standard]: {
    weaponType: WeaponType.Standard,
    branchAName: 'Damage',
    branchBName: 'Rate',
    nodes: [
      node(WeaponType.Standard, 'a', 1, 'Focused rounds', '+20% damage per bolt'),
      node(WeaponType.Standard, 'a', 2, 'Armor-piercing', '+40% damage per bolt'),
      node(WeaponType.Standard, 'a', 3, 'Overcharged', '+60% damage per bolt'),
      node(WeaponType.Standard, 'b', 1, 'Rapid cycling', '+15% fire rate'),
      node(WeaponType.Standard, 'b', 2, 'Overclock', '+30% fire rate'),
      node(WeaponType.Standard, 'b', 3, 'Hyperburst', '+50% fire rate'),
    ],
  },

  [WeaponType.Spread]: {
    weaponType: WeaponType.Spread,
    branchAName: 'Pellets',
    branchBName: 'Cone',
    nodes: [
      node(WeaponType.Spread, 'a', 1, 'Extra pellet I', '+1 pellet per burst (6 total)'),
      node(WeaponType.Spread, 'a', 2, 'Extra pellet II', '+1 pellet per burst (7 total)'),
      node(WeaponType.Spread, 'a', 3, 'Extra pellet III', '+1 pellet per burst (8 total)'),
      node(WeaponType.Spread, 'b', 1, 'Tight pattern', '-15% cone width — denser spread'),
      node(WeaponType.Spread, 'b', 2, 'Wide sweep', '+20% cone width — broader coverage'),
      node(WeaponType.Spread, 'b', 3, 'Adaptive cone', 'Alternates tight/wide each shot'),
    ],
  },

  [WeaponType.Piercing]: {
    weaponType: WeaponType.Piercing,
    branchAName: 'Range',
    branchBName: 'Reload',
    nodes: [
      node(WeaponType.Piercing, 'a', 1, 'Extended beam I', '+50% beam length'),
      node(WeaponType.Piercing, 'a', 2, 'Extended beam II', '+100% beam length'),
      node(WeaponType.Piercing, 'a', 3, 'Full surface', '+200% beam length — crosses entire surface'),
      node(WeaponType.Piercing, 'b', 1, 'Fast reload I', '+20% fire rate'),
      node(WeaponType.Piercing, 'b', 2, 'Fast reload II', '+40% fire rate'),
      node(WeaponType.Piercing, 'b', 3, 'Rapid burst', '+60% fire rate'),
    ],
  },

  [WeaponType.ChainLightning]: {
    weaponType: WeaponType.ChainLightning,
    branchAName: 'Virality',
    branchBName: 'Strength',
    nodes: [
      node(WeaponType.ChainLightning, 'a', 1, 'Extra arc I', '+2 chain targets (8 total)'),
      node(WeaponType.ChainLightning, 'a', 2, 'Extra arc II', '+2 chain targets (10 total)'),
      node(WeaponType.ChainLightning, 'a', 3, 'Extra arc III', '+2 chain targets (12 total)'),
      node(WeaponType.ChainLightning, 'b', 1, 'High voltage I', '+25% damage per arc'),
      node(WeaponType.ChainLightning, 'b', 2, 'High voltage II', '+50% damage per arc'),
      node(WeaponType.ChainLightning, 'b', 3, 'Overload', '+80% damage per arc'),
    ],
  },

  [WeaponType.Homing]: {
    weaponType: WeaponType.Homing,
    branchAName: 'Speed',
    branchBName: 'Radius',
    nodes: [
      node(WeaponType.Homing, 'a', 1, 'Afterburner I', '+25% missile speed'),
      node(WeaponType.Homing, 'a', 2, 'Afterburner II', '+50% missile speed'),
      node(WeaponType.Homing, 'a', 3, 'Hypersonic', '+80% missile speed'),
      node(WeaponType.Homing, 'b', 1, 'Bigger warhead', '+30% explosion radius'),
      node(WeaponType.Homing, 'b', 2, 'Shockwave', '+60% explosion radius'),
      node(WeaponType.Homing, 'b', 3, 'Gas cloud', 'Explosion leaves lingering damage cloud for 3s'),
    ],
  },

  [WeaponType.PlasmaMortar]: {
    weaponType: WeaponType.PlasmaMortar,
    branchAName: 'Explosion',
    branchBName: 'Strength',
    nodes: [
      node(WeaponType.PlasmaMortar, 'a', 1, 'Wide blast I', '+30% AoE radius'),
      node(WeaponType.PlasmaMortar, 'a', 2, 'Wide blast II', '+60% AoE radius'),
      node(WeaponType.PlasmaMortar, 'a', 3, 'Mega blast', '+100% AoE radius'),
      node(WeaponType.PlasmaMortar, 'b', 1, 'Dense plasma I', '+25% explosion damage'),
      node(WeaponType.PlasmaMortar, 'b', 2, 'Dense plasma II', '+50% explosion damage'),
      node(WeaponType.PlasmaMortar, 'b', 3, 'Critical mass', '+80% explosion damage'),
    ],
  },

  [WeaponType.GravityGun]: {
    weaponType: WeaponType.GravityGun,
    branchAName: 'Pull Radius',
    branchBName: 'Damage',
    nodes: [
      node(WeaponType.GravityGun, 'a', 1, 'Wider field I', '+30% pull radius'),
      node(WeaponType.GravityGun, 'a', 2, 'Wider field II', '+60% pull radius'),
      node(WeaponType.GravityGun, 'a', 3, 'Mega pull', '+100% pull radius'),
      node(WeaponType.GravityGun, 'b', 1, 'Kinetic crush I', 'Pulled enemies take 2 damage/s while held'),
      node(WeaponType.GravityGun, 'b', 2, 'Kinetic crush II', 'Pulled enemies take 5 damage/s while held'),
      node(WeaponType.GravityGun, 'b', 3, 'Collision force', 'Enemies collide with each other for bonus damage'),
    ],
  },

  [WeaponType.LaserBeam]: {
    weaponType: WeaponType.LaserBeam,
    branchAName: 'Ramp',
    branchBName: 'Duration',
    nodes: [
      node(WeaponType.LaserBeam, 'a', 1, 'Fast ramp I', '+25% damage ramp-up speed'),
      node(WeaponType.LaserBeam, 'a', 2, 'Fast ramp II', '+50% damage ramp-up speed'),
      node(WeaponType.LaserBeam, 'a', 3, 'Instant peak', 'Beam immediately fires at max damage'),
      node(WeaponType.LaserBeam, 'b', 1, 'Extended beam I', '+20% beam duration'),
      node(WeaponType.LaserBeam, 'b', 2, 'Extended beam II', '+40% beam duration'),
      node(WeaponType.LaserBeam, 'b', 3, 'Sustained fire', '+70% beam duration'),
    ],
  },

  [WeaponType.BlackHole]: {
    weaponType: WeaponType.BlackHole,
    branchAName: 'Size',
    branchBName: 'Gravity',
    nodes: [
      node(WeaponType.BlackHole, 'a', 1, 'Bigger void I', '+30% duration and +1 shot'),
      node(WeaponType.BlackHole, 'a', 2, 'Bigger void II', '+60% duration and +2 shots'),
      node(WeaponType.BlackHole, 'a', 3, 'Singularity', '+100% duration and +3 shots'),
      node(WeaponType.BlackHole, 'b', 1, 'Stronger pull I', '+30% pull radius'),
      node(WeaponType.BlackHole, 'b', 2, 'Stronger pull II', '+60% pull radius'),
      node(WeaponType.BlackHole, 'b', 3, 'Event horizon', '+100% pull radius — inescapable'),
    ],
  },

  [WeaponType.TeslaCoil]: {
    weaponType: WeaponType.TeslaCoil,
    branchAName: 'Radius',
    branchBName: 'DPS',
    nodes: [
      node(WeaponType.TeslaCoil, 'a', 1, 'Wider arc I', '+25% AoE radius'),
      node(WeaponType.TeslaCoil, 'a', 2, 'Wider arc II', '+50% AoE radius'),
      node(WeaponType.TeslaCoil, 'a', 3, 'Storm field', '+80% AoE radius'),
      node(WeaponType.TeslaCoil, 'b', 1, 'Higher voltage I', '+25% damage per tick'),
      node(WeaponType.TeslaCoil, 'b', 2, 'Higher voltage II', '+50% damage per tick'),
      node(WeaponType.TeslaCoil, 'b', 3, 'Overload', '+80% damage per tick'),
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

/** Returns all nodes across all weapons (60 total). */
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

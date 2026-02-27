import { WeaponType } from '../weapons/WeaponTypes';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Branch identifier.
 * 'a' / 'b' = main branches (root of each side).
 * 'al' / 'ar' = sub-branches off the A main branch (left / right split).
 * 'bl' / 'br' = sub-branches off the B main branch (left / right split).
 */
export type UpgradeBranch = 'a' | 'b' | 'al' | 'ar' | 'bl' | 'br';

export interface UpgradeNode {
  /** Stable unique identifier: "${weaponType}_${branch}_${nodeIndex}" */
  id: string;
  branch: UpgradeBranch;
  /** 1-indexed position within the branch (sub-branches continue counting from split depth) */
  nodeIndex: number;
  /**
   * Parent node ID. If set, lines draw from parent → this node.
   * If undefined, the node is a root node and connects to the weapon center.
   */
  parentId?: string;
  description: string;
  /** In-match kill count required to activate this node */
  killThreshold: number;
  /** Human-readable summary of the gameplay effect */
  effect: string;
  /**
   * Mastery-point cost to unlock this node (default: 1).
   * Higher-cost nodes unlock more powerful effects.
   */
  cost?: number;
  /**
   * How many mastery points can be spent in this node (default: 1).
   * When > 1, the node supports internal upgrade leveling.
   */
  maxPoints?: number;
  /** Optional explicit SVG x position (0–280). Used for branching layouts. */
  x?: number;
  /** Optional explicit SVG y position (0–svgHeight). Used for branching layouts. */
  y?: number;
}

export interface UpgradeTree {
  weaponType: WeaponType;
  branchAName: string;
  branchBName: string;
  /** Sub-branch labels (only for 4-endpoint branching trees) */
  branchALName?: string;
  branchARName?: string;
  branchBLName?: string;
  branchBRName?: string;
  /**
   * Custom SVG viewBox height. Defaults inferred from max nodeIndex:
   * ≤5 → 240, ≤10 → 380, branching → set explicitly.
   */
  svgHeight?: number;
  nodes: UpgradeNode[];
}

// ---------------------------------------------------------------------------
// Kill thresholds per node index (1-based) — extended to 10 levels
// ---------------------------------------------------------------------------

const KILL_THRESHOLDS: Record<number, number> = {
  1: 10,
  2: 25,
  3: 50,
  4: 80,
  5: 120,
  6: 175,
  7: 250,
  8: 350,
  9: 480,
  10: 650,
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
  opts?: number | {
    maxPoints?: number;
    parentId?: string;
    cost?: number;
    x?: number;
    y?: number;
  },
): UpgradeNode {
  const maxPoints = typeof opts === 'number' ? opts : opts?.maxPoints;
  const extra = (typeof opts === 'object' && opts !== null) ? opts : {};
  return {
    id: `${weaponType}_${branch}_${index}`,
    branch,
    nodeIndex: index,
    description,
    killThreshold: KILL_THRESHOLDS[index] ?? KILL_THRESHOLDS[10],
    effect,
    ...(maxPoints !== undefined && maxPoints > 1 ? { maxPoints } : {}),
    ...(extra.parentId ? { parentId: extra.parentId } : {}),
    ...(extra.cost !== undefined && extra.cost !== 1 ? { cost: extra.cost } : {}),
    ...(extra.x !== undefined ? { x: extra.x } : {}),
    ...(extra.y !== undefined ? { y: extra.y } : {}),
  };
}

// ---------------------------------------------------------------------------
// Upgrade Trees
// ---------------------------------------------------------------------------

export const UPGRADE_TREES: Record<WeaponType, UpgradeTree> = {
  // -------------------------------------------------------------------------
  // 1. Standard (Blaster) — 4-endpoint branching tree
  //
  //    Branch A trunk (a_1..a_4): Fire-rate theme, diverges at level 4
  //      Sub-branch AL (al_5..al_10): "Scatter" — explosive multi-bolt spread [cost:1]
  //      Sub-branch AR (ar_5..ar_10): "Rapid Fire" — extreme fire rate [cost:2]
  //
  //    Branch B trunk (b_1..b_4): Damage theme, diverges at level 4
  //      Sub-branch BL (bl_5..bl_10): "Seeking" — homing bolts [cost:1]
  //      Sub-branch BR (br_5..br_10): "Devastation" — raw damage [cost:2]
  //
  //    SVG viewBox: 280 × 390
  //    4 endpoints at level 10: al_10, ar_10, bl_10, br_10
  // -------------------------------------------------------------------------
  [WeaponType.Standard]: {
    weaponType: WeaponType.Standard,
    branchAName: 'Fire Rate',
    branchBName: 'Damage',
    branchALName: 'Scatter',
    branchARName: 'Rapid Fire',
    branchBLName: 'Seeking',
    branchBRName: 'Devastation',
    svgHeight: 390,
    nodes: [
      // ── Trunk A (Fire Rate theme) ──
      node(WeaponType.Standard, 'a', 1, 'Dual bolts',    'Fires 2 bolts side by side (+1 bullet)',          { x: 103, y:  46 }),
      node(WeaponType.Standard, 'a', 2, 'Triple spray',  'Fires 3 bolts in a narrow fan (+2 bullets)',      { x:  80, y:  78 }),
      node(WeaponType.Standard, 'a', 3, 'Quad burst',    'Fires 4 bolts, fan widens slightly (+3 bullets)', { x:  57, y: 110 }),
      node(WeaponType.Standard, 'a', 4, 'Rapid burst',   '+30% fire rate; fires 5 bolts in tight burst',    { x:  35, y: 142 }),

      // ── Sub-branch AL: Scatter (cost:1) ──
      node(WeaponType.Standard, 'al', 5, 'Shotgun spread',  'Fires 5 bolts in a 25° arc (+4 bullets)',              { parentId: 'standard_a_4', x:  10, y: 178 }),
      node(WeaponType.Standard, 'al', 6, 'Nova burst',      'Fires 9 bolts in a 55° arc (+8 bullets)',              { parentId: 'standard_al_5', x:   8, y: 214 }),
      node(WeaponType.Standard, 'al', 7, 'Ring shot',       'Fires 12 bolts in a full 360° ring burst',             { parentId: 'standard_al_6', x:  10, y: 250 }),
      node(WeaponType.Standard, 'al', 8, 'Bullet wall',     '360° ring + forward 5-bolt dense fan simultaneously',  { parentId: 'standard_al_7', x:  15, y: 285 }),
      node(WeaponType.Standard, 'al', 9, 'Annihilator',     'Bullet wall with +30% damage per bolt',                { parentId: 'standard_al_8', x:  23, y: 318 }),
      node(WeaponType.Standard, 'al', 10,'Omega scatter',   'Dual-phase ring burst then 15-bolt fan; +50% damage',  { parentId: 'standard_al_9', x:  14, y: 352 }),

      // ── Sub-branch AR: Rapid Fire (cost:2 — premium path) ──
      node(WeaponType.Standard, 'ar', 5, 'Overclock',      '+50% fire rate',                                        { parentId: 'standard_a_4',  cost: 2, x:  63, y: 178 }),
      node(WeaponType.Standard, 'ar', 6, 'Hyperclock',     '+80% fire rate; bullets pierce 1 enemy',               { parentId: 'standard_ar_5', cost: 2, x:  66, y: 214 }),
      node(WeaponType.Standard, 'ar', 7, 'Machine gun',    '+120% fire rate; bolts gain slight homing',             { parentId: 'standard_ar_6', cost: 2, x:  63, y: 250 }),
      node(WeaponType.Standard, 'ar', 8, 'Railgun charge', 'Every 10th shot fires a high-damage piercing bolt',     { parentId: 'standard_ar_7', cost: 2, x:  56, y: 285 }),
      node(WeaponType.Standard, 'ar', 9, 'Minigun',        '+200% fire rate; enters rapid-fire mode',               { parentId: 'standard_ar_8', cost: 2, x:  48, y: 318 }),
      node(WeaponType.Standard, 'ar', 10,'Infinity burst', 'Unlimited rapid fire for 3s on kill; +30% bolt speed', { parentId: 'standard_ar_9', cost: 2, x:  56, y: 352 }),

      // ── Trunk B (Damage theme) ──
      node(WeaponType.Standard, 'b', 1, 'Focused pair',   'Fires 2 bolts in a tight 5° cone (+1 bullet)',   { x: 177, y:  46 }),
      node(WeaponType.Standard, 'b', 2, 'Triple needle',  'Fires 3 bolts in a 5° cone (+2 bullets)',        { x: 200, y:  78 }),
      node(WeaponType.Standard, 'b', 3, 'Quad lance',     'Fires 4 tightly-grouped bolts (+3 bullets)',     { x: 223, y: 110 }),
      node(WeaponType.Standard, 'b', 4, 'Heavy bolt',     'Bolts deal +40% damage; penetrate 1 enemy',     { x: 245, y: 142 }),

      // ── Sub-branch BL: Seeking (cost:1) ──
      node(WeaponType.Standard, 'bl', 5, 'Seeking bolts',  'Fires 4 bolts with mild homing bias',                  { parentId: 'standard_b_4',  x: 217, y: 178 }),
      node(WeaponType.Standard, 'bl', 6, 'Smart swarm',    'Fires 5 bolts, each auto-corrects toward nearest enemy',{ parentId: 'standard_bl_5', x: 214, y: 214 }),
      node(WeaponType.Standard, 'bl', 7, 'Precision burst','Fires 6 homing bolts with +10% speed',                  { parentId: 'standard_bl_6', x: 217, y: 250 }),
      node(WeaponType.Standard, 'bl', 8, 'Lock-on volley', 'Fires 8 homing bolts split among 2 enemies',            { parentId: 'standard_bl_7', x: 224, y: 285 }),
      node(WeaponType.Standard, 'bl', 9, 'Guided cluster', 'Homing bolts + secondary seeker per bolt on impact',    { parentId: 'standard_bl_8', x: 232, y: 318 }),
      node(WeaponType.Standard, 'bl', 10,'Apex hunter',    'Near-perfect homing; bolts loop back once on miss',     { parentId: 'standard_bl_9', x: 224, y: 352 }),

      // ── Sub-branch BR: Devastation (cost:2 — premium path) ──
      node(WeaponType.Standard, 'br', 5, 'Power shot',     '+60% damage per bolt',                                  { parentId: 'standard_b_4',  cost: 2, x: 268, y: 178 }),
      node(WeaponType.Standard, 'br', 6, 'Explosive round','Bolts detonate on impact; +30% AoE splash',             { parentId: 'standard_br_5', cost: 2, x: 272, y: 214 }),
      node(WeaponType.Standard, 'br', 7, 'Supercharged',   '+100% damage; bolts leave ignite trail',                { parentId: 'standard_br_6', cost: 2, x: 270, y: 250 }),
      node(WeaponType.Standard, 'br', 8, 'Armor-pierce',   'Ignores 50% enemy damage resistance',                   { parentId: 'standard_br_7', cost: 2, x: 264, y: 285 }),
      node(WeaponType.Standard, 'br', 9, 'Death bolt',     'Each bolt has 5% chance to instant-kill enemy',         { parentId: 'standard_br_8', cost: 2, x: 256, y: 318 }),
      node(WeaponType.Standard, 'br', 10,'Annihilator',    '+150% damage; kills trigger mini-shockwave',            { parentId: 'standard_br_9', cost: 2, x: 266, y: 352 }),
    ],
  },

  // -------------------------------------------------------------------------
  // 2. Spread Shot
  //    Branch A "MORE PELLETS" — pure pellet count, damage per pellet
  //    Branch B "TIGHT CLUSTER" — reduce cone, increase damage
  // -------------------------------------------------------------------------
  [WeaponType.Spread]: {
    weaponType: WeaponType.Spread,
    branchAName: 'More Pellets',
    branchBName: 'Tight Cluster',
    nodes: [
      node(WeaponType.Spread, 'a', 1, 'Extra pellet',     '+1 pellet (6 total)'),
      node(WeaponType.Spread, 'a', 2, 'Two extra',        '+2 pellets (7 total)'),
      node(WeaponType.Spread, 'a', 3, 'Three extra',      '+3 pellets (8 total)'),
      node(WeaponType.Spread, 'a', 4, 'Heavy barrage',    '+4 pellets (9 total)'),
      node(WeaponType.Spread, 'a', 5, 'Pellet storm',     '+5 pellets (10 total), +15% damage/pellet'),
      node(WeaponType.Spread, 'b', 1, 'Tight pattern',    '-10% cone width, denser grouping'),
      node(WeaponType.Spread, 'b', 2, 'Focused burst',    '-20% cone width, +10% damage/pellet'),
      node(WeaponType.Spread, 'b', 3, 'Slug mode',        '-30% cone width, +20% damage/pellet'),
      node(WeaponType.Spread, 'b', 4, 'Piercing cluster', '-30% cone, +30% dmg/pellet, pellets pierce 1 enemy'),
      node(WeaponType.Spread, 'b', 5, 'Needle volley',    '-30% cone, +50% dmg/pellet, pellets pierce 2 enemies'),
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
      node(WeaponType.ChainLightning, 'a', 5, 'Uberstorm',   '+10 chain targets (16 total), chains re-arc for bonus damage'),
      node(WeaponType.ChainLightning, 'b', 1, 'High voltage','+30% damage per arc'),
      node(WeaponType.ChainLightning, 'b', 2, 'Overcharge',  '+60% damage per arc'),
      node(WeaponType.ChainLightning, 'b', 3, 'Supercharge', '+100% damage per arc'),
      node(WeaponType.ChainLightning, 'b', 4, 'Stun bolt',   '+100% dmg/arc, hit enemies are slowed 30% for 1s'),
      node(WeaponType.ChainLightning, 'b', 5, 'Overload',    '+130% dmg/arc, enemies killed by chain explode in mini-shockwave'),
    ],
  },

  // -------------------------------------------------------------------------
  // 5. Homing Missiles
  //    Branch A "SPEED"   — faster missiles, tighter tracking (10 levels)
  //    Branch B "WARHEAD" — bigger explosion, area effects (10 levels)
  // -------------------------------------------------------------------------
  [WeaponType.Homing]: {
    weaponType: WeaponType.Homing,
    branchAName: 'Speed',
    branchBName: 'Warhead',
    nodes: [
      node(WeaponType.Homing, 'a', 1,  'Afterburner',    '+25% missile speed'),
      node(WeaponType.Homing, 'a', 2,  'Hyperdrive',     '+50% missile speed'),
      node(WeaponType.Homing, 'a', 3,  'Laser-guided',   '+75% speed, tighter turn radius'),
      node(WeaponType.Homing, 'a', 4,  'Mach strike',    '+100% speed, tighter turn radius'),
      node(WeaponType.Homing, 'a', 5,  'Hypersonic',     '+150% speed, missiles cannot be outrun'),
      node(WeaponType.Homing, 'a', 6,  'Ramjet',         '+200% speed, missile explodes on near-miss for 50% damage'),
      node(WeaponType.Homing, 'a', 7,  'Railshot',       'Missiles travel in straight line (instant) to target'),
      node(WeaponType.Homing, 'a', 8,  'Twin rails',     'Fires 2 railshots per trigger pull'),
      node(WeaponType.Homing, 'a', 9,  'Quad rails',     'Fires 4 railshots that fan slightly'),
      node(WeaponType.Homing, 'a', 10, 'Gauss barrage',  '6 railshots; each penetrates through first target'),
      node(WeaponType.Homing, 'b', 1,  'Bigger warhead', '+30% explosion radius'),
      node(WeaponType.Homing, 'b', 2,  'Shockwave',      '+60% explosion radius'),
      node(WeaponType.Homing, 'b', 3,  'Cluster bomb',   'On detonation, spawns 3 child missiles'),
      node(WeaponType.Homing, 'b', 4,  'Napalm',         'Explosion leaves gas cloud (3s, 3 dmg/tick)'),
      node(WeaponType.Homing, 'b', 5,  'Nova burst',     '+100% explosion radius + napalm cloud + shockwave stun'),
      node(WeaponType.Homing, 'b', 6,  'Thermobaric',    'Nova burst + secondary explosion 0.5s later'),
      node(WeaponType.Homing, 'b', 7,  'Fuel-air bomb',  'Thermobaric + napalm cloud is double-size and lasts 5s'),
      node(WeaponType.Homing, 'b', 8,  'Carpet bombing', 'Each missile splits into 3 sub-munitions mid-flight'),
      node(WeaponType.Homing, 'b', 9,  'Devastator',     'Carpet bomb sub-munitions each have nova burst'),
      node(WeaponType.Homing, 'b', 10, 'Armageddon',     'Devastator + screen-wide shockwave on first hit'),
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
  //                         Nodes a_1 and b_1 have maxPoints: 3 (internal leveling demo)
  //    Branch B "GRAVITY" — pull radius, crush damage
  // -------------------------------------------------------------------------
  [WeaponType.BlackHole]: {
    weaponType: WeaponType.BlackHole,
    branchAName: 'Size',
    branchBName: 'Gravity',
    nodes: [
      // a_1: maxPoints=3 — "Bigger void" can be upgraded up to 3 times
      node(WeaponType.BlackHole, 'a', 1, 'Bigger void', '+30% duration per rank (up to 3 ranks = +90%)', 3),
      node(WeaponType.BlackHole, 'a', 2, 'Deep void',   '+60% duration, +1 shot'),
      node(WeaponType.BlackHole, 'a', 3, 'Singularity', '+100% duration, +2 shots'),
      node(WeaponType.BlackHole, 'a', 4, 'Twin holes',  'Fires 2 black holes simultaneously'),
      node(WeaponType.BlackHole, 'a', 5, 'Doomsday',    'Fires 2 black holes, each +150% duration'),
      // b_1: maxPoints=3 — "Stronger pull" can be upgraded up to 3 times
      node(WeaponType.BlackHole, 'b', 1, 'Stronger pull','+30% pull radius per rank (up to 3 ranks = +90%)', 3),
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

/** Returns all nodes across all weapons. */
export function getAllNodes(): UpgradeNode[] {
  return Object.values(UPGRADE_TREES).flatMap(tree => tree.nodes);
}

/** Looks up a single node by id. Returns undefined if not found. */
export function getNodeById(nodeId: string): UpgradeNode | undefined {
  return getAllNodes().find(n => n.id === nodeId);
}

/** Returns nodes for a specific weapon and branch (exact branch match). */
export function getBranchNodes(weaponType: WeaponType, branch: UpgradeBranch): UpgradeNode[] {
  return UPGRADE_TREES[weaponType].nodes.filter(n => n.branch === branch);
}

/**
 * Returns the maximum number of points that can be spent in a node.
 * Defaults to 1 for nodes that don't specify maxPoints.
 */
export function getNodeMaxPoints(node: UpgradeNode): number {
  return node.maxPoints ?? 1;
}

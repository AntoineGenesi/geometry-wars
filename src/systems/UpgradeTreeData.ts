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
  /**
   * Node IDs that become unavailable if this node gains any points.
   * For bidirectional mutual exclusion, prefer `exclusionPairs` on the tree instead.
   */
  excludes?: string[];
}

/**
 * A cross-branch skip connection lets a player unlock `toId` using `fromId`
 * as an alternative prerequisite (instead of the normal sequential parent).
 * Visually rendered as a dashed golden line.
 */
export interface SkipConnection {
  /** Source node ID — must be fully unlocked to activate this skip. */
  fromId: string;
  /** Target node ID — can be unlocked via this skip (alternative to normal parent). */
  toId: string;
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
  /**
   * Optional cross-branch skip connections. A skip allows unlocking `toId`
   * without going through its normal prerequisite chain, as long as `fromId`
   * is fully unlocked.
   */
  skipConnections?: SkipConnection[];
  /**
   * Bidirectional mutual-exclusion pairs declared at the tree level.
   * If either node in a pair has points > 0, the other becomes unavailable.
   * Prefer this over per-node `excludes` for cross-branch pairs — declare once, enforced both ways.
   */
  exclusionPairs?: [string, string][];
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
  // 1. Standard (Blaster) — broad starter weapon with four readable finishers.
  //
  //    Branch A trunk (a_1..a_4): Volley — more forward bolts.
  //      Sub-branch AL (al_5..al_6): Scatter — wider fan payoff.
  //      Sub-branch AR (ar_5..ar_6): Cadence — faster sustained fire.
  //
  //    Branch B trunk (b_1..b_4): Focus — tighter bolts and payload.
  //      Sub-branch BL (bl_5/bl_7/bl_10): Guidance — homing reliability.
  //      Sub-branch BR (br_5/br_7/br_10): Payload — damage and kill payoff.
  // -------------------------------------------------------------------------
  [WeaponType.Standard]: {
    weaponType: WeaponType.Standard,
    branchAName: 'Volley',
    branchBName: 'Focus',
    branchALName: 'Scatter',
    branchARName: 'Cadence',
    branchBLName: 'Guidance',
    branchBRName: 'Payload',
    svgHeight: 318,
    nodes: [
      // Volley trunk: direct, readable extra-bolt progression.
      node(WeaponType.Standard, 'a', 1, 'Dual bolts',    'Fires 2 bolts side by side (+1 bullet)',          { x: 103, y:  46 }),
      node(WeaponType.Standard, 'a', 2, 'Triple spray',  'Fires 3 bolts in a narrow fan (+2 bullets)',      { x:  80, y:  78 }),
      node(WeaponType.Standard, 'a', 3, 'Quad burst',    'Fires 4 bolts, fan widens slightly (+3 bullets)', { x:  57, y: 110 }),
      node(WeaponType.Standard, 'a', 4, 'Rapid burst',   '+30% fire rate; fires 5 bolts in tight burst',    { x:  35, y: 142 }),

      // Scatter: retain the proven fan shapes instead of speculative ring/final forms.
      node(WeaponType.Standard, 'al', 5, 'Shotgun spread', 'Fires 5 bolts in a 25 deg arc (+4 bullets)', { parentId: 'standard_a_4', x:  10, y: 184 }),
      node(WeaponType.Standard, 'al', 6, 'Nova fan',       'Capstone: fires 9 bolts in a 55 deg arc',    { parentId: 'standard_al_5', x:   8, y: 226 }),

      // Cadence: premium path for fire-rate players.
      node(WeaponType.Standard, 'ar', 5, 'Overclock',  '+50% fire rate',                          { parentId: 'standard_a_4',  cost: 2, x:  63, y: 184 }),
      node(WeaponType.Standard, 'ar', 6, 'Hyperclock', 'Capstone: +80% total fire-rate pressure', { parentId: 'standard_ar_5', cost: 2, x:  66, y: 226 }),

      // Focus trunk: tight extra bolts and a real damage step.
      node(WeaponType.Standard, 'b', 1, 'Focused pair',   'Fires 2 bolts in a tight 5° cone (+1 bullet)',   { x: 177, y:  46 }),
      node(WeaponType.Standard, 'b', 2, 'Triple needle',  'Fires 3 bolts in a 5° cone (+2 bullets)',        { x: 200, y:  78 }),
      node(WeaponType.Standard, 'b', 3, 'Quad lance',     'Fires 4 tightly-grouped bolts (+3 bullets)',     { x: 223, y: 110 }),
      node(WeaponType.Standard, 'b', 4, 'Heavy bolt',     'Bolts deal +40% damage',                                { x: 245, y: 142 }),

      // Guidance: fewer steps, each mapped to existing homing behavior.
      node(WeaponType.Standard, 'bl', 5, 'Seeking bolts',   'Mild homing bias for focused bolts',                    { parentId: 'standard_b_4',  x: 217, y: 184 }),
      node(WeaponType.Standard, 'bl', 7, 'Precision burst', 'Faster homing bolts with stronger correction',          { parentId: 'standard_bl_5', x: 222, y: 226 }),
      node(WeaponType.Standard, 'bl', 10,'Apex hunter',     'Capstone: strongest homing with one loop-back on miss', { parentId: 'standard_bl_7', x: 224, y: 270 }),

      // Payload: premium damage path with the speculative middle filler removed.
      node(WeaponType.Standard, 'br', 5, 'Power shot',    '+60% damage per bolt',                          { parentId: 'standard_b_4',  cost: 2, x: 268, y: 184 }),
      node(WeaponType.Standard, 'br', 7, 'Supercharged',  '+40% additional bolt damage',                  { parentId: 'standard_br_5', cost: 2, x: 270, y: 226 }),
      node(WeaponType.Standard, 'br', 10,'Shockwave kill','Capstone: high damage; kills trigger shockwave',{ parentId: 'standard_br_7', cost: 2, x: 266, y: 270 }),
    ],
    // Cross-branch shortcuts: Multi-Bolt trunk tier 2 → Damage trunk tier 3 (and vice versa).
    // Unlocking Triple spray (a_2) grants shortcut access to Quad lance (b_3),
    // and unlocking Triple needle (b_2) grants shortcut to Quad burst (a_3).
    skipConnections: [
      { fromId: 'standard_a_2', toId: 'standard_b_3' },
      { fromId: 'standard_b_2', toId: 'standard_a_3' },
    ],
  },

  // -------------------------------------------------------------------------
  // 2. Spread Shot — 4-endpoint branching tree
  //
  //    Branch A trunk (a_1..a_3): More Pellets theme, diverges at level 3
  //      Sub-branch AL (al_4..al_5): "Storm" — max pellet count [cost:1]
  //      Sub-branch AR (ar_4..ar_5): "Explosive" — pellets with AoE splash [cost:2]
  //
  //    Branch B trunk (b_1..b_3): Tight Cluster theme, diverges at level 3
  //      Sub-branch BL (bl_4..bl_5): "Piercing" — pierce through enemies [cost:1]
  //      Sub-branch BR (br_4..br_5): "Sniper" — extreme damage, tight focus [cost:2]
  //
  //    SVG viewBox: 280 × 224
  // -------------------------------------------------------------------------
  [WeaponType.Spread]: {
    weaponType: WeaponType.Spread,
    branchAName: 'More Pellets',
    branchBName: 'Tight Cluster',
    branchALName: 'Storm',
    branchARName: 'Explosive',
    branchBLName: 'Piercing',
    branchBRName: 'Sniper',
    svgHeight: 224,
    nodes: [
      // ── Trunk A (More Pellets theme) ──
      node(WeaponType.Spread, 'a', 1, 'Extra pellet',      '+1 pellet (6 total)',                                     { x: 103, y:  46 }),
      node(WeaponType.Spread, 'a', 2, 'Two extra',         '+2 pellets (7 total)',                                    { x:  80, y:  78 }),
      node(WeaponType.Spread, 'a', 3, 'Three extra',       '+3 pellets (8 total)',                                    { x:  57, y: 110 }),

      // ── Sub-branch AL: Storm (maximum pellets) ──
      node(WeaponType.Spread, 'al', 4, 'Heavy barrage',    '+4 pellets (9 total)',                                    { parentId: 'spread_a_3', x:  30, y: 148 }),
      node(WeaponType.Spread, 'al', 5, 'Pellet storm',     '+5 pellets (10 total), +15% damage/pellet',              { parentId: 'spread_al_4', x:  16, y: 186 }),

      // ── Sub-branch AR: Explosive (pellets with AoE splash) ──
      node(WeaponType.Spread, 'ar', 4, 'Explosive pellets','Pellet hits add a small splash burst',                    { parentId: 'spread_a_3', cost: 2, x:  68, y: 148 }),
      node(WeaponType.Spread, 'ar', 5, 'Nova burst',       'Capstone: stronger close-range splash from each pellet',  { parentId: 'spread_ar_4', cost: 2, x:  66, y: 186 }),

      // ── Trunk B (Tight Cluster theme) ──
      node(WeaponType.Spread, 'b', 1, 'Tight pattern',     '-10% cone width, denser grouping',                       { x: 177, y:  46 }),
      node(WeaponType.Spread, 'b', 2, 'Focused burst',     '-20% cone width, +10% damage/pellet',                    { x: 200, y:  78 }),
      node(WeaponType.Spread, 'b', 3, 'Slug mode',         '-30% cone width, +20% damage/pellet',                    { x: 223, y: 110 }),

      // ── Sub-branch BL: Piercing (pierce through enemies) ──
      node(WeaponType.Spread, 'bl', 4, 'Piercing cluster', '-30% cone, +30% dmg/pellet, pellets pierce 1 enemy',     { parentId: 'spread_b_3', x: 212, y: 148 }),
      node(WeaponType.Spread, 'bl', 5, 'Needle volley',    '-30% cone, +50% dmg/pellet, pellets pierce 2 enemies',   { parentId: 'spread_bl_4', x: 214, y: 186 }),

      // ── Sub-branch BR: Sniper (extreme damage, ultra-tight focus) ──
      node(WeaponType.Spread, 'br', 4, 'Sniper spread',    'Ultra-tight 5 deg cone, +50% damage per pellet',         { parentId: 'spread_b_3', cost: 2, x: 250, y: 148 }),
      node(WeaponType.Spread, 'br', 5, 'Needle burst',     'Capstone: queued focused shots with a damage bump',      { parentId: 'spread_br_4', cost: 2, x: 264, y: 186 }),
    ],
  },

  // -------------------------------------------------------------------------
  // 3. Piercing Beam — 4-endpoint branching tree
  //
  //    Branch A trunk (a_1..a_3): Range theme, diverges at level 3
  //      Sub-branch AL (al_4..al_5): "Reach" — extreme range & topology [cost:1]
  //      Sub-branch AR (ar_4..ar_5): "Multi-Beam" — multiple simultaneous beams [cost:2]
  //
  //    Branch B trunk (b_1..b_3): Rapid Fire theme, diverges at level 3
  //      Sub-branch BL (bl_4..bl_5): "Burst" — multiple beams per trigger [cost:1]
  //      Sub-branch BR (br_4..br_5): "Charged" — devastating charged shots [cost:2]
  //
  //    SVG viewBox: 280 × 224
  // -------------------------------------------------------------------------
  [WeaponType.Piercing]: {
    weaponType: WeaponType.Piercing,
    branchAName: 'Range',
    branchBName: 'Rapid Fire',
    branchALName: 'Reach',
    branchARName: 'Multi-Beam',
    branchBLName: 'Burst',
    branchBRName: 'Charged',
    svgHeight: 224,
    nodes: [
      // ── Trunk A (Range theme) ──
      node(WeaponType.Piercing, 'a', 1, 'Extended beam',   '+40% beam length',                                         { x: 103, y:  46 }),
      node(WeaponType.Piercing, 'a', 2, 'Long reach',      '+80% beam length',                                         { x:  80, y:  78 }),
      node(WeaponType.Piercing, 'a', 3, 'Full sweep',      '+130% beam length for safer line clears',                 { x:  57, y: 110 }),

      // ── Sub-branch AL: Reach (extreme range and topology-wrap) ──
      node(WeaponType.Piercing, 'al', 4, 'Arc beam',       'Longer beam path with a secondary off-axis hit',           { parentId: 'piercing_a_3', x:  30, y: 148 }),
      node(WeaponType.Piercing, 'al', 5, 'Deep trace',     'Capstone: maximum retained beam path length',              { parentId: 'piercing_al_4', x:  16, y: 186 }),

      // ── Sub-branch AR: Multi-Beam (fire multiple beams simultaneously) ──
      node(WeaponType.Piercing, 'ar', 4, 'Twin beams',     'Fires 2 parallel beams simultaneously',                    { parentId: 'piercing_a_3', cost: 2, x:  68, y: 148 }),
      node(WeaponType.Piercing, 'ar', 5, 'Fan sweep',      'Fires 3 beams in a 45° fan',                               { parentId: 'piercing_ar_4', cost: 2, x:  66, y: 186 }),

      // ── Trunk B (Rapid Fire theme) ──
      node(WeaponType.Piercing, 'b', 1, 'Fast reload',     '+25% fire rate',                                           { x: 177, y:  46 }),
      node(WeaponType.Piercing, 'b', 2, 'Overclock',       '+50% fire rate',                                           { x: 200, y:  78 }),
      node(WeaponType.Piercing, 'b', 3, 'Double tap',      'Fires 2 beams per trigger pull (0.1s apart)',              { x: 223, y: 110 }),

      // ── Sub-branch BL: Burst (multiple beams per trigger pull) ──
      node(WeaponType.Piercing, 'bl', 4, 'Triple tap',     'Fires 3 beams per trigger pull',                           { parentId: 'piercing_b_3', x: 212, y: 148 }),
      node(WeaponType.Piercing, 'bl', 5, 'Beam burst',     'Fires 4 beams per trigger pull at +70% total fire rate',   { parentId: 'piercing_bl_4', x: 214, y: 186 }),

      // ── Sub-branch BR: Charged (devastating charged shots) ──
      node(WeaponType.Piercing, 'br', 4, 'Charged bolt',   'Delayed heavy beam shot for burst damage',                 { parentId: 'piercing_b_3', cost: 2, x: 250, y: 148 }),
      node(WeaponType.Piercing, 'br', 5, 'Overcharge',     'Capstone: periodic auto-charged beam shot',                { parentId: 'piercing_br_4', cost: 2, x: 264, y: 186 }),
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
      node(WeaponType.ChainLightning, 'a', 4, 'Mega chain',  '+7 chain targets, +40% jump range'),
      node(WeaponType.ChainLightning, 'a', 5, 'Storm relay', 'Capstone: maximum chain count with bonus re-arc pressure'),
      node(WeaponType.ChainLightning, 'b', 1, 'High voltage','+25% damage per arc'),
      node(WeaponType.ChainLightning, 'b', 2, 'Overcharge',  '+60% damage per arc'),
      node(WeaponType.ChainLightning, 'b', 3, 'Supercharge', '+80% damage per arc'),
      node(WeaponType.ChainLightning, 'b', 4, 'Stun bolt',   '+100% damage per arc; hit enemies are slowed briefly'),
      node(WeaponType.ChainLightning, 'b', 5, 'Overload',    'Capstone: highest voltage with a small overload burst on hit'),
    ],
  },

  // -------------------------------------------------------------------------
  // 5. Homing Missiles
  //    Branch A "INTERCEPT" — faster, tighter tracking to reach targets.
  //    Branch B "WARHEAD"   — bigger detonations and area denial.
  // -------------------------------------------------------------------------
  [WeaponType.Homing]: {
    weaponType: WeaponType.Homing,
    branchAName: 'Intercept',
    branchBName: 'Warhead',
    nodes: [
      node(WeaponType.Homing, 'a', 1,  'Afterburner',    '+25% missile speed'),
      node(WeaponType.Homing, 'a', 2,  'Hyperdrive',     '+50% missile speed'),
      node(WeaponType.Homing, 'a', 3,  'Laser-guided',   '+80% speed, tighter turn radius'),
      node(WeaponType.Homing, 'a', 4,  'Mach strike',    '+100% speed, tighter turn radius'),
      node(WeaponType.Homing, 'a', 5,  'Hypersonic',     'Capstone: +150% speed for hard target interception'),
      node(WeaponType.Homing, 'b', 1,  'Bigger warhead', '+30% explosion radius'),
      node(WeaponType.Homing, 'b', 2,  'Shockwave',      '+60% explosion radius'),
      node(WeaponType.Homing, 'b', 3,  'Cluster bomb',   'On detonation, spawns 3 child missiles'),
      node(WeaponType.Homing, 'b', 4,  'Napalm',         'Explosion leaves gas cloud (3s, 3 dmg/tick)'),
      node(WeaponType.Homing, 'b', 5,  'Nova burst',     'Capstone: large blast plus persistent gas cloud'),
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
      node(WeaponType.PlasmaMortar, 'a', 1, 'Wide blast',   '+30% AoE radius'),
      node(WeaponType.PlasmaMortar, 'a', 2, 'Mega blast',   '+60% AoE radius'),
      node(WeaponType.PlasmaMortar, 'a', 3, 'Shockwave',    '+100% AoE radius'),
      node(WeaponType.PlasmaMortar, 'a', 4, 'Chain blast',  '+100% AoE radius with delayed secondary blast'),
      node(WeaponType.PlasmaMortar, 'a', 5, 'Carpet bomb',  'Capstone: fires 3 mortars per shot in a spread'),
      node(WeaponType.PlasmaMortar, 'b', 1, 'Dense plasma', '+25% explosion damage'),
      node(WeaponType.PlasmaMortar, 'b', 2, 'Heavy payload','+50% explosion damage'),
      node(WeaponType.PlasmaMortar, 'b', 3, 'Critical mass','+80% explosion damage'),
      node(WeaponType.PlasmaMortar, 'b', 4, 'Armor crack',  '+100% damage with extra pressure against tough enemies'),
      node(WeaponType.PlasmaMortar, 'b', 5, 'Annihilator',  'Capstone: highest payload damage for elite cracking'),
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
      node(WeaponType.GravityGun, 'a', 5, 'Event gravity',    'Capstone: widest pull field for crowd control'),
      node(WeaponType.GravityGun, 'b', 1, 'Kinetic crush',    'Pulled enemies take 2 dmg/s'),
      node(WeaponType.GravityGun, 'b', 2, 'Heavy crush',      'Pulled enemies take 5 dmg/s'),
      node(WeaponType.GravityGun, 'b', 3, 'Implosion',        'Pulled enemies take 10 damage per second'),
      node(WeaponType.GravityGun, 'b', 4, 'Singularity',      'Pulled enemies take 15 damage per second'),
      node(WeaponType.GravityGun, 'b', 5, 'Black compression','Capstone: strongest sustained crush damage'),
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
      node(WeaponType.LaserBeam, 'a', 5, 'Meltdown',     'Capstone: max damage is 100% higher with heat damage'),
      node(WeaponType.LaserBeam, 'b', 1, 'Extended beam','+20% beam duration'),
      node(WeaponType.LaserBeam, 'b', 2, 'Sustained fire','+40% beam duration'),
      node(WeaponType.LaserBeam, 'b', 3, 'Endurance mode','+70% beam duration'),
      node(WeaponType.LaserBeam, 'b', 4, 'Wide beam',    '+100% duration, beam width doubles (hits nearby enemies)'),
      node(WeaponType.LaserBeam, 'b', 5, 'Sweep mode',   'Capstone: longest wide beam with automatic sweep'),
    ],
  },

  // -------------------------------------------------------------------------
  // 9. Black Hole — 4-endpoint branching tree built around the proven
  // travelling vortex bolt that becomes a temporary black hole on contact.
  //
  //    Branch A trunk (a_1..a_3): Persistence, diverges at level 3.
  //      Sub-branch AL (al_4..al_5): Multi Void — more simultaneous fields.
  //      Sub-branch AR (ar_4..ar_5): Giant Void — one larger/longer field.
  //
  //    Branch B trunk (b_1..b_3): Pull, diverges at level 3.
  //      Sub-branch BL (bl_4..bl_5): Capture — hold and collide enemies.
  //      Sub-branch BR (br_4..br_5): Crush — damage inside the field.
  // -------------------------------------------------------------------------
  [WeaponType.BlackHole]: {
    weaponType: WeaponType.BlackHole,
    branchAName: 'Persistence',
    branchBName: 'Pull',
    branchALName: 'Multi Void',
    branchARName: 'Giant Void',
    branchBLName: 'Capture',
    branchBRName: 'Crush',
    svgHeight: 224,
    nodes: [
      // Persistence trunk.
      node(WeaponType.BlackHole, 'a', 1, 'Bigger void',   '+30% duration',                                 { x: 103, y:  46 }),
      node(WeaponType.BlackHole, 'a', 2, 'Deep void',     '+60% duration, +1 shot',                        { x:  80, y:  78 }),
      node(WeaponType.BlackHole, 'a', 3, 'Singularity',   '+100% duration, +2 shots',                      { x:  57, y: 110 }),

      // ── Sub-branch AL: Multi Void (multiple simultaneous black holes) ──
      node(WeaponType.BlackHole, 'al', 4, 'Twin holes',   'Fires 2 black holes simultaneously',            { parentId: 'black_hole_a_3', x:  30, y: 148 }),
      node(WeaponType.BlackHole, 'al', 5, 'Doomsday',     'Fires 2 black holes, each +150% duration',     { parentId: 'black_hole_al_4', x:  16, y: 186 }),

      // ── Sub-branch AR: Giant Void (single massive long-duration black hole) ──
      node(WeaponType.BlackHole, 'ar', 4, 'Mega void',    '+200% duration; black hole is 40% larger',     { parentId: 'black_hole_a_3', cost: 2, x:  68, y: 148 }),
      node(WeaponType.BlackHole, 'ar', 5, 'Collapse wave','Capstone: larger long-duration field with collapse shockwave', { parentId: 'black_hole_ar_4', cost: 2, x:  66, y: 186 }),

      // Pull trunk.
      node(WeaponType.BlackHole, 'b', 1, 'Stronger pull', '+30% pull radius',                                { x: 177, y:  46 }),
      node(WeaponType.BlackHole, 'b', 2, 'Deep pull',     '+60% pull radius',                              { x: 200, y:  78 }),
      node(WeaponType.BlackHole, 'b', 3, 'Inescapable',   '+100% pull radius',                             { x: 223, y: 110 }),

      // ── Sub-branch BL: Gravity Well (mass capture & collision damage) ──
      node(WeaponType.BlackHole, 'bl', 4, 'Mass capture', 'Can hold up to 12 enemies simultaneously',     { parentId: 'black_hole_b_3', x: 212, y: 148 }),
      node(WeaponType.BlackHole, 'bl', 5, 'Event gravity','Capstone: captured enemies collide for bonus damage', { parentId: 'black_hole_bl_4', x: 214, y: 186 }),

      // ── Sub-branch BR: Event Horizon (maximum gravitational damage) ──
      node(WeaponType.BlackHole, 'br', 4, 'Crushing void','+100% radius; trapped enemies take 5 dmg/s',  { parentId: 'black_hole_b_3', cost: 2, x: 250, y: 148 }),
      node(WeaponType.BlackHole, 'br', 5, 'Event horizon','Capstone: +150% radius and 10 damage per second',{ parentId: 'black_hole_br_4', cost: 2, x: 264, y: 186 }),
    ],
    // Multi Void fires multiple simultaneous black holes; Giant Void is the
    // single massive/eternal black-hole path. The root pair blocks the split.
    exclusionPairs: [
      ['black_hole_al_4', 'black_hole_ar_4'],
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
      node(WeaponType.TeslaCoil, 'a', 4, 'Arc reach',   '+80% radius with extended edge arcs'),
      node(WeaponType.TeslaCoil, 'a', 5, 'Tempest',     'Capstone: widest sustained shock field'),
      node(WeaponType.TeslaCoil, 'b', 1, 'Higher voltage','+25% dmg/tick'),
      node(WeaponType.TeslaCoil, 'b', 2, 'Overcharge',  '+60% dmg/tick'),
      node(WeaponType.TeslaCoil, 'b', 3, 'Overload',    '+80% dmg/tick'),
      node(WeaponType.TeslaCoil, 'b', 4, 'Rapid tick',  '+100% damage per tick with faster pulses'),
      node(WeaponType.TeslaCoil, 'b', 5, 'Surge overload','Capstone: highest pulse damage with brief stun'),
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

/** Returns the point cost for one rank of a node. */
export function getNodeCost(node: UpgradeNode): number {
  return node.cost ?? 1;
}

/** Returns the retained investment capacity for a node, including multi-rank nodes. */
export function getNodeInvestmentCapacity(node: UpgradeNode): number {
  return getNodeCost(node) * (node.maxPoints ?? 1);
}

/** Returns the retained investment capacity for a tree. */
export function getTreeInvestmentCapacity(tree: UpgradeTree): number {
  return tree.nodes.reduce((sum, node) => sum + getNodeInvestmentCapacity(node), 0);
}

/** Returns investment capacity by weapon for current tree data. */
export function getInvestmentCapacityByWeapon(): Record<WeaponType, number> {
  return Object.fromEntries(
    Object.values(WeaponType).map(weaponType => [
      weaponType,
      getTreeInvestmentCapacity(UPGRADE_TREES[weaponType]),
    ]),
  ) as Record<WeaponType, number>;
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

/**
 * Returns the prerequisite node for a given node:
 * - If the node has an explicit `parentId`, returns that parent.
 * - Otherwise, returns the previous node (nodeIndex - 1) in the same branch.
 * - Returns null for root nodes (nodeIndex === 1 with no parentId).
 */
export function getImplicitParent(node: UpgradeNode, tree: UpgradeTree): UpgradeNode | null {
  if (node.parentId) {
    return tree.nodes.find(n => n.id === node.parentId) ?? null;
  }
  if (node.nodeIndex <= 1) return null;
  const prevId = `${tree.weaponType}_${node.branch}_${node.nodeIndex - 1}`;
  return tree.nodes.find(n => n.id === prevId) ?? null;
}

/**
 * Duck-typed interface for the point store used in prerequisite checks.
 * Avoids importing MasteryPointStore to prevent circular dependencies.
 */
interface PointLookup {
  getNodePoints(id: string): number;
}

/**
 * Returns true if the node's prerequisite is met:
 * - Root nodes (no sequential parent) are always accessible.
 * - Non-root nodes require their implicit parent to be fully invested.
 * - OR: any skip connection targeting this node has its source fully invested.
 */
export function isPrerequisiteMet(node: UpgradeNode, tree: UpgradeTree, ps: PointLookup): boolean {
  const parent = getImplicitParent(node, tree);
  if (!parent) return true; // Root node — always accessible

  // Normal prerequisite: parent is fully invested
  if (ps.getNodePoints(parent.id) >= getNodeMaxPoints(parent)) return true;

  // Skip connections: any skip source fully invested grants access to this node
  if (tree.skipConnections) {
    for (const skip of tree.skipConnections) {
      if (skip.toId === node.id) {
        const from = tree.nodes.find(n => n.id === skip.fromId);
        if (from && ps.getNodePoints(from.id) >= getNodeMaxPoints(from)) return true;
      }
    }
  }

  return false;
}

/**
 * Returns the IDs of already-unlocked nodes that exclude `nodeId`.
 * Checks both `tree.exclusionPairs` (bidirectional) and per-node `excludes` arrays.
 * An already-unlocked node is one with points > 0.
 */
export function getExcludedBy(nodeId: string, tree: UpgradeTree, ps: PointLookup): string[] {
  const sources: string[] = [];

  // Check tree-level bidirectional exclusion pairs
  if (tree.exclusionPairs) {
    for (const [a, b] of tree.exclusionPairs) {
      if (a === nodeId && ps.getNodePoints(b) > 0) sources.push(b);
      else if (b === nodeId && ps.getNodePoints(a) > 0) sources.push(a);
    }
  }

  // Check per-node excludes arrays
  for (const n of tree.nodes) {
    if (n.excludes?.includes(nodeId) && ps.getNodePoints(n.id) > 0) {
      sources.push(n.id);
    }
  }

  return sources;
}

/**
 * Returns true if `nodeId` is excluded by any already-unlocked node.
 * A node is excluded when at least one node that mutually excludes it has points > 0.
 */
export function isExcluded(nodeId: string, tree: UpgradeTree, ps: PointLookup): boolean {
  return getExcludedBy(nodeId, tree, ps).length > 0;
}

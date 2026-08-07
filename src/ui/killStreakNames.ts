// killStreakNames.ts — SP/MP enemy kill streak data.
// Completely separate from the PvP KillStreakAnnouncer system.

import type { BraillePattern } from './BrailleAnimator';
import { ALL_PATTERNS } from './BrailleAnimator';

export interface StreakTier {
  minStreak: number;
  color: string;
  glowColor: string;
  pitch: number;
}

// ---------------------------------------------------------------------------
// 200 unique streak names, grouped by intensity tier
// ---------------------------------------------------------------------------

export const STREAK_NAMES: Record<number, string> = {
  // Kills 1–5: Casual/familiar
  1:   'Nice Shot',
  2:   'Double Kill',
  3:   'Triple Kill',
  4:   'Quad Kill',
  5:   'Killing Spree',

  // Kills 6–15: Military/professional
  6:   'Rampage',
  7:   'Unstoppable',
  8:   'Invincible',
  9:   'Domination',
  10:  'Decimation',
  11:  'Merciless',
  12:  'Ruthless',
  13:  'Annihilation',
  14:  'Obliteration',
  15:  'Extermination',

  // Kills 16–30: Supernatural
  16:  'Godlike',
  17:  'Beyond Mortal',
  18:  'Ethereal',
  19:  'Transcendent',
  20:  'Phantasm',
  21:  'Spectral Wrath',
  22:  'Wraith',
  23:  'Shadow Lord',
  24:  'Soul Reaper',
  25:  'Death Incarnate',
  26:  'Undying',
  27:  'Immortal',
  28:  'Eternal',
  29:  'Ancient Terror',
  30:  'Mythic',

  // Kills 31–60: Cosmic/sci-fi
  31:  'Nebula Slayer',
  32:  'Void Walker',
  33:  'Star Destroyer',
  34:  'Nova Burst',
  35:  'Pulsar',
  36:  'Quasar',
  37:  'Dark Matter',
  38:  'Event Horizon',
  39:  'Singularity',
  40:  'Supernova',
  41:  'Gamma Ray',
  42:  'Neutron Star',
  43:  'Black Hole',
  44:  'Warp Core',
  45:  'Hyperdrive',
  46:  'Antimatter',
  47:  'Plasma Storm',
  48:  'Solar Flare',
  49:  'Cosmic Ray',
  50:  'Galaxy Breaker',
  51:  'Nebula Born',
  52:  'Stellar Core',
  53:  'Photon Lance',
  54:  'Ion Storm',
  55:  'Dark Energy',
  56:  'Void Rift',
  57:  'Space Tyrant',
  58:  'Orbit Crusher',
  59:  'Astral Blade',
  60:  'Celestial Wrath',

  // Kills 61–100: Eldritch/mythological
  61:  'Ragnarok',
  62:  'Apocalypse',
  63:  'Armageddon',
  64:  'Zeus Wrath',
  65:  "Thor's Hammer",
  66:  "Odin's Eye",
  67:  'Mjolnir',
  68:  'Fenrir Unleashed',
  69:  'Jormungandr',
  70:  'Yggdrasil Burns',
  71:  'Valhalla',
  72:  'Asgard Falls',
  73:  'Dragon Slayer',
  74:  "Hydra's Bane",
  75:  'Chimera Lord',
  76:  'Phoenix Rising',
  77:  'Basilisk Gaze',
  78:  'Leviathan',
  79:  'Behemoth',
  80:  'Kraken',
  81:  'Titan Fall',
  82:  'Olympus Shattered',
  83:  "Hades' Gate",
  84:  'Elysium',
  85:  'Tartarus',
  86:  'Cerberus',
  87:  "Medusa's Gaze",
  88:  "Poseidon's Fury",
  89:  "Apollo's Fire",
  90:  "Artemis' Arrow",
  91:  "Hermes' Wings",
  92:  "Athena's Shield",
  93:  "Ares' Blade",
  94:  "Hephaestus' Forge",
  95:  "Dionysus' Wrath",
  96:  "Demeter's Curse",
  97:  "Persephone's Veil",
  98:  "Hecate's Spell",
  99:  'Nemesis',
  100: 'Omega',

  // Kills 101–150: Transcendent
  101: 'Beyond Time',
  102: 'Reality Shatter',
  103: 'Multiverse Collapse',
  104: 'Quantum Flux',
  105: 'Dimensional Rift',
  106: 'Spacetime Fracture',
  107: 'Causality Break',
  108: 'Timeline Erasure',
  109: 'Paradox Engine',
  110: "Infinity's Edge",
  111: "Eternity's Dawn",
  112: 'Temporal Void',
  113: 'Chrono Breaker',
  114: 'Fate Weaver',
  115: 'Destiny Unbound',
  116: 'Existence Ender',
  117: 'Universe Breaker',
  118: 'Physics Broken',
  119: 'Chaos Absolute',
  120: 'Order Supreme',
  121: "Creation's End",
  122: 'Void Absolute',
  123: 'Primordial Force',
  124: 'Cosmic Constant',
  125: 'Universal Law',
  126: 'Omnipresence',
  127: 'Omniscience',
  128: 'Omnipotence',
  129: 'The Eternal',
  130: 'Alpha Force',
  131: 'Omega Drive',
  132: 'The Infinite Blade',
  133: 'Source Code',
  134: 'Root Cause',
  135: 'First Principle',
  136: 'Grand Design',
  137: 'Master Equation',
  138: 'Final Theory',
  139: 'Unified Field',
  140: 'Hidden Variable',
  141: 'Dark Constant',
  142: "Planck's Edge",
  143: 'Heisenberg',
  144: "Schrödinger's Kill",
  145: 'Hawking Radiation',
  146: 'String Theory',
  147: 'M-Theory',
  148: 'Membrane Collapse',
  149: 'Brane Singularity',
  150: 'Cosmic Inflation',

  // Kills 151–200: Incomprehensible
  151: 'Entropy Incarnate',
  152: 'Oblivion',
  153: 'The Infinite',
  154: 'Void God',
  155: 'Death of Stars',
  156: 'Universe Devourer',
  157: 'The Nameless',
  158: 'Unspeakable',
  159: 'Unimaginable',
  160: 'The Absolute',
  161: 'Null and Void',
  162: 'The Last Light',
  163: 'Final Darkness',
  164: 'Primordial Chaos',
  165: 'The First Void',
  166: 'Pre-Existence',
  167: 'Before Time',
  168: 'After Universe',
  169: 'Null Set',
  170: 'Empty Infinity',
  171: 'The Great Silence',
  172: 'Last Echo',
  173: 'Zero Point',
  174: 'Ground State',
  175: 'Vacuum Energy',
  176: 'False Vacuum',
  177: 'True Void',
  178: 'Nothingness',
  179: 'The End',
  180: 'Beyond End',
  181: 'Post-Apocalyptic',
  182: 'Death of Death',
  183: 'Silence of Silence',
  184: 'Void of Voids',
  185: 'Darkness Absolute',
  186: 'The Forgotten',
  187: 'Erased From Time',
  188: 'Never Was',
  189: 'Cannot Be Named',
  190: 'The Unreal',
  191: 'Anti-Existence',
  192: 'Negative Space',
  193: 'Inverted Reality',
  194: 'The Un-Kill',
  195: 'Paradox Absolute',
  196: 'Contradiction',
  197: 'The Impossible',
  198: 'The Undefined',
  199: 'Final Answer',
  200: 'The Incomprehensible',
};

// ---------------------------------------------------------------------------
// Milestone counts that trigger announcements (≥30 required)
// ---------------------------------------------------------------------------

export const STREAK_MILESTONES: number[] = [
  1, 2, 3, 4, 5, 7, 10, 13, 15, 20, 25, 30,
  35, 40, 45, 50, 55, 60, 65, 70, 75, 80, 85,
  90, 95, 100, 110, 120, 130, 140, 150, 160, 170,
  180, 190, 200,
];
// Count: 36 milestones ✓

// ---------------------------------------------------------------------------
// Visual tiers — ≥10 required
// ---------------------------------------------------------------------------

export const STREAK_TIERS: StreakTier[] = [
  // Sorted ascending by minStreak so getStreakTier can iterate forward
  { minStreak: 1,   color: '#44ff88', glowColor: '#00dd55', pitch: 0.8 },  // Casual
  { minStreak: 6,   color: '#88ff44', glowColor: '#55dd00', pitch: 0.9 },  // Military
  { minStreak: 11,  color: '#ffff44', glowColor: '#dddd00', pitch: 1.0 },  // Professional
  { minStreak: 16,  color: '#ffaa22', glowColor: '#ff8800', pitch: 1.1 },  // Supernatural
  { minStreak: 21,  color: '#ff6644', glowColor: '#ff3300', pitch: 1.2 },  // Godlike
  { minStreak: 31,  color: '#ff44ff', glowColor: '#dd00dd', pitch: 1.3 },  // Cosmic
  { minStreak: 51,  color: '#aa44ff', glowColor: '#8800ff', pitch: 1.4 },  // Eldritch
  { minStreak: 76,  color: '#ff1166', glowColor: '#cc0044', pitch: 1.5 },  // Mythological
  { minStreak: 101, color: '#00ffff', glowColor: '#00aaff', pitch: 1.6 },  // Transcendent
  { minStreak: 151, color: '#ffffff', glowColor: '#aaaaff', pitch: 1.8 },  // Incomprehensible
];
// Count: 10 tiers ✓

const POST_200_STREAK_PREFIXES = [
  'Ascendant',
  'Mythic',
  'Singularity',
  'Infinite',
  'Absolute',
  'Impossible',
  'Eternal',
  'Final',
  'Beyond',
  'Ultra',
] as const;

const ASCII_STREAK_FRAMES: ReadonlyArray<ReadonlyArray<string>> = [
  ['[>      ]', '[=>     ]', '[==>    ]', '[===>   ]', '[ ===>  ]', '[  ===> ]'],
  ['<*>     ', ' <*>    ', '  <*>   ', '   <*>  ', '    <*> ', '     <*>'],
  ['//  //  ', ' //  // ', '  //  //', '\\\\  \\\\  ', ' \\\\  \\\\', '  \\\\  \\\\'],
  ['[+-----]', '[-+----]', '[--+---]', '[---+--]', '[----+-]', '[-----+]'],
  ['<>      ', ' <><>   ', '  <><><>', '   <><> ', '      <>', '   <><> '],
  ['x.....x', '.x...x.', '..x.x..', '...x...', '..x.x..', '.x...x.'],
  ['* . . *', '.* . *.', '..* *..', '...*...', '..* *..', '.* . *.'],
  ['|=====|', '/=====/', '-=====-', '\\=====\\', '|=====|', '/=====/'],
] as const;

// ---------------------------------------------------------------------------
// Helper functions
// ---------------------------------------------------------------------------

/**
 * Returns the name for the given streak count.
 * Counts above 200 keep the base 1-200 name and add escalating prefixes, so
 * ultra-long runs keep feeling different without needing an unbounded table.
 */
export function getStreakName(count: number): string {
  if (count <= 0) count = 1;
  const wrapped = count % 200 || 200;
  const baseName = STREAK_NAMES[wrapped];
  if (count <= 200) return baseName;

  const cycle = Math.floor((count - 1) / 200);
  const prefix = POST_200_STREAK_PREFIXES[(cycle - 1) % POST_200_STREAK_PREFIXES.length];
  const rank = cycle > POST_200_STREAK_PREFIXES.length
    ? ` ${Math.floor((cycle - 1) / POST_200_STREAK_PREFIXES.length) + 1}`
    : '';
  return `${prefix}${rank} ${baseName}`;
}

/**
 * Returns the visual tier for any streak count (including >200).
 * For counts >200 the tier is based on count directly (no wrapping for tiers).
 */
export function getStreakTier(count: number): StreakTier {
  let result = STREAK_TIERS[0];
  for (const tier of STREAK_TIERS) {
    if (count >= tier.minStreak) {
      result = tier;
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Tier-to-animation mapping (for EnemyKillStreakAnnouncer)
// ---------------------------------------------------------------------------

/**
 * 20 distinct patterns for kill tiers 0-19 (one per 10-kill tier in [1,200]).
 * Index i corresponds to kills [i*10, i*10+9], except tier 0 starts at kill 1.
 * All 20 are distinct — no repeats within [1,200].
 */
const ANIMATION_TIERS: BraillePattern[] = [
  'pulse',          // tier 0  (kills   1–9)
  'wave',           // tier 1  (kills  10–19)
  'orbit',          // tier 2  (kills  20–29)
  'snake',          // tier 3  (kills  30–39)
  'cascade',        // tier 4  (kills  40–49)
  'helix',          // tier 5  (kills  50–59)
  'sparkle',        // tier 6  (kills  60–69)
  'rain',           // tier 7  (kills  70–79)
  'vortex',         // tier 8  (kills  80–89)
  'fireworks',      // tier 9  (kills  90–99)
  'lightning',      // tier 10 (kills 100–109)
  'explosion',      // tier 11 (kills 110–119)
  'aurora',         // tier 12 (kills 120–129)
  'blackhole',      // tier 13 (kills 130–139)
  'supernova',      // tier 14 (kills 140–149)
  'matrix',         // tier 15 (kills 150–159)
  'glitch',         // tier 16 (kills 160–169)
  'nebula',         // tier 17 (kills 170–179)
  'tornado',        // tier 18 (kills 180–189)
  'earthquake',     // tier 19 (kills 190–200)
];

/**
 * Returns the Braille animation pattern and intensity for the given kill streak count.
 *
 * - Kills 1–200: 20 distinct 10-kill tiers, intensity rises within each tier (0.0–1.0)
 * - Kills >200: cycles through ALL_PATTERNS (all 50) cyclically, intensity always ≥ 0.8
 *
 * Never throws for any positive integer (or large values like 2000).
 */
export function getAnimationForStreak(count: number): { pattern: BraillePattern; intensity: number } {
  if (count <= 0) count = 1;

  if (count <= 200) {
    const tier = Math.min(Math.floor(count / 10), 19);
    const tierStart = tier * 10;
    const intensity = Math.min((count - tierStart) / 10, 1.0);
    return { pattern: ANIMATION_TIERS[tier], intensity };
  }

  // Above 200: cycle through all 50 patterns, intensity always ≥ 0.8
  const pos = (count - 201) % (ALL_PATTERNS.length * 10);
  const cycleTier = Math.floor(pos / 10);
  const cycleOffset = pos % 10;
  const pattern = ALL_PATTERNS[cycleTier % ALL_PATTERNS.length];
  const intensity = 0.8 + 0.2 * (cycleOffset / 10);
  return { pattern, intensity };
}

export function getAsciiFrameForStreak(count: number, frameIndex: number): string {
  if (count <= 0) count = 1;
  const normalizedFrame = Math.max(0, Math.floor(frameIndex));
  const tierIndex = Math.min(
    ASCII_STREAK_FRAMES.length - 1,
    Math.floor((Math.min(count, 200) - 1) / 25),
  );
  const frames = ASCII_STREAK_FRAMES[tierIndex];
  return frames[normalizedFrame % frames.length];
}

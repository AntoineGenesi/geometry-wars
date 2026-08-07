import { ENEMY_TYPES, type EnemyType } from './EnemySpawner';

export interface EnemyCompendiumEntry {
  type: EnemyType;
  displayName: string;
  previewType: EnemyType;
  attackDescription: string;
  lockedName: string;
}

const DESCRIPTIONS: Record<EnemyType, string> = {
  wanderer: 'Drifts steadily toward the player and pressures open space with simple pursuit.',
  grunt: 'Charges directly at the player and punishes slow turns or cornered movement.',
  duck: 'Darts in quick bursts, changing lanes to catch players who aim in one direction too long.',
  mayfly: 'Rushes fast in fragile swarms, forcing quick target priority before it closes distance.',
  rocket: 'Accelerates into a high-speed chase and tries to ram the player from long range.',
  neutron: 'Homes with heavy pressure and survives long enough to force sustained fire.',
  weaver: 'Slides in weaving arcs, making its approach harder to track with straight shots.',
  spinner: 'Rotates through the arena while pushing into the player with a tight angular path.',
  snake: 'Leads a segmented body across the surface, creating a moving wall behind its head.',
  repulsor: 'Pushes nearby movement and shots away, disrupting spacing while it advances.',
  gravity_well: 'Pulls the player and nearby objects toward its center to break escape routes.',
  gravity_well_red: 'Creates a stronger hostile pull that drags the player into dangerous traffic.',
  gate: 'Forms a blocking hazard that controls lanes and punishes careless crossings.',
  painter: 'Leaves a dangerous trail behind its path, turning safe routes into hazards.',
  virus: 'Replicates pressure by spreading into more threats if it is not cleared quickly.',
  spawner: 'Creates additional enemies over time, making it a priority support target.',
  titan_grunt: 'A heavier grunt variant that soaks more damage while forcing direct evasive movement.',
  titan_spinner: 'A durable spinner that holds space longer and stays dangerous through sustained fire.',
  titan_weaver: 'A tougher weaver that keeps its evasive approach while demanding more focus fire.',
  giant_wanderer: 'A large drifting body that occupies broad space and limits escape angles.',
  giant_rocket: 'A large rocket threat that builds speed and turns long lanes into danger zones.',
  giant_snake: 'A huge segmented enemy that cuts off large sections of the surface as it moves.',
  giant_neutron: 'A bulky homing enemy that combines high durability with persistent chase pressure.',
  cluster: 'Breaks into grouped threats, rewarding players who clear the pack before it spreads.',
  helix: 'Moves in twisting patterns that make its approach difficult to line up cleanly.',
  fractal: 'Splits into branching fragments, multiplying danger if left unmanaged.',
  swarm: 'Attacks as a packed group, trying to overwhelm the player with many small bodies.',
  lurker: 'Hangs back and uses delayed pressure, punishing players who ignore the edge of a fight.',
  orbiter: 'Circles around the player and creates side pressure instead of charging straight in.',
  splitter: 'Breaks into smaller enemies when destroyed, turning one target into several follow-ups.',
  phaser: 'Phases through expected lanes and reappears in awkward positions around the player.',
  approach_glow: 'Signals its approach with a glow before committing to a close-range attack.',
  stealth_stalker: 'Uses low-visibility pursuit to sneak into the player path before striking.',
  fractal_snake: 'Leads coordinated follower rows that fan out from the head and crowd escape routes.',
  prism_lancer: 'Lines up piercing lance attacks that punish standing in a straight firing lane.',
  sentinel_orb: 'Guards space with orbiting pressure and forces the player to respect its zone.',
  shatter_bloom: 'Blooms into shard enemies, turning a single target into a sudden close-range burst.',
  boss_sapphire: 'A sapphire boss that combines heavy durability with broad arena pressure.',
  boss_ruby: 'A ruby boss that attacks aggressively and demands sustained movement and fire.',
  boss_emerald: 'An emerald boss that controls space while surviving long damage windows.',
  boss_topaz: 'A topaz boss that pressures the player with durable, high-threat movement.',
  boss_amethyst: 'An amethyst boss that layers boss-scale pressure over normal enemy traffic.',
  boss_opal: 'An opal boss that acts as a late high-durability threat with varied pressure.',
};

const DISPLAY_NAME_OVERRIDES: Partial<Record<EnemyType, string>> = {
  gravity_well: 'Gravity Well',
  gravity_well_red: 'Red Gravity Well',
  titan_grunt: 'Titan Grunt',
  titan_spinner: 'Titan Spinner',
  titan_weaver: 'Titan Weaver',
  giant_wanderer: 'Giant Wanderer',
  giant_rocket: 'Giant Rocket',
  giant_snake: 'Giant Snake',
  giant_neutron: 'Giant Neutron',
  approach_glow: 'Approach Glow',
  stealth_stalker: 'Stealth Stalker',
  fractal_snake: 'Fractal Snake',
  prism_lancer: 'Prism Lancer',
  sentinel_orb: 'Sentinel Orb',
  shatter_bloom: 'Shatter Bloom',
  boss_sapphire: 'Sapphire Boss',
  boss_ruby: 'Ruby Boss',
  boss_emerald: 'Emerald Boss',
  boss_topaz: 'Topaz Boss',
  boss_amethyst: 'Amethyst Boss',
  boss_opal: 'Opal Boss',
};

const SERVER_ALIAS_TO_COMPENDIUM_TYPE: Record<string, EnemyType> = {
  arrow: 'grunt',
  blackhole: 'gravity_well',
  black_hole: 'gravity_well',
  proton: 'neutron',
  ufo: 'wanderer',
  mines: 'grunt',
  mine: 'grunt',
  mutator: 'weaver',
  bubbles: 'wanderer',
  bubble: 'wanderer',
  spawnlet: 'grunt',
  titangrunt: 'titan_grunt',
  titanspinner: 'titan_spinner',
  titanweaver: 'titan_weaver',
  boss: 'boss_sapphire',
};

function toDisplayName(type: EnemyType): string {
  const override = DISPLAY_NAME_OVERRIDES[type];
  if (override) return override;
  return type
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

export const ENEMY_COMPENDIUM = Object.freeze(
  Object.fromEntries(
    ENEMY_TYPES.map((type) => [
      type,
      {
        type,
        displayName: toDisplayName(type),
        previewType: type,
        attackDescription: DESCRIPTIONS[type],
        lockedName: 'Unknown Enemy',
      } satisfies EnemyCompendiumEntry,
    ]),
  ) as Record<EnemyType, EnemyCompendiumEntry>,
);

export const ENEMY_COMPENDIUM_ENTRIES: readonly EnemyCompendiumEntry[] = ENEMY_TYPES.map(
  (type) => ENEMY_COMPENDIUM[type],
);

export function normalizeEnemyCompendiumType(value: string | null | undefined): EnemyType | null {
  if (!value) return null;
  const normalized = value.trim().toLowerCase().replace(/[\s-]+/g, '_');
  if ((ENEMY_TYPES as readonly string[]).includes(normalized)) {
    return normalized as EnemyType;
  }
  return SERVER_ALIAS_TO_COMPENDIUM_TYPE[normalized] ?? null;
}

export function maskEnemyDescription(description: string): string {
  return Array.from(description, (char, index) => {
    if (char === ' ') return ' ';
    if (/[.,;:!?'-]/.test(char)) return index % 3 === 0 ? '?' : char;
    return index % 7 === 0 ? '#' : '?';
  }).join('');
}

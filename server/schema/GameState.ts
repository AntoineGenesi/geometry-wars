import { Schema, MapSchema, ArraySchema, defineTypes } from '@colyseus/schema';

/**
 * Player state synced across all clients
 *
 * CRITICAL: Properties use `declare` keyword (not class field initializers or `!:`)
 * because ES2022 class fields use Object.defineProperty which overwrites
 * the getter/setter change-tracking descriptors installed by Schema's constructor.
 * `declare` emits NO JavaScript, so Schema's getter/setters survive.
 * Defaults are set in the constructor body, going through the tracked setters.
 */
export class PlayerState extends Schema {
  declare id: string;
  declare name: string;
  declare surfaceU: number;
  declare surfaceV: number;
  declare aimAngle: number;
  declare lives: number;
  declare bombs: number;
  declare score: number;
  declare multiplier: number;
  declare alive: boolean;
  /** Current health in PvP mode (0–maxHealth). Non-PvP rounds: always maxHealth. */
  declare health: number;
  /** Maximum health in PvP mode (synced for HUD display). */
  declare maxHealth: number;
  /**
   * Seconds of post-respawn invincibility remaining (synced so clients can
   * flash / dim the player mesh). 0 when not invincible.
   */
  declare invincibilityTimer: number;
  declare shooting: boolean;
  declare color: number;
  declare weaponType: string;
  declare weaponAmmo: number;
  declare playerLevel: number;
  declare playerKills: number;
  declare ddaLevel: number;
  /** Buff stack counts: maps buff type string (e.g. 'hot_hands') → stack count */
  declare buffStacks: MapSchema<number>;
  /** PvP kill count: number of times this player killed another player. */
  declare kills: number;
  /** PvP death count: number of times this player was killed by another player. */
  declare deaths: number;
  /** PvPvE enemy kill count: number of enemies killed by this player (for leaderboard). */
  declare enemyKills: number;
  /** Total damage dealt to other players this match (PvP mode). */
  declare totalDamageDealt: number;
  /** Zone time in seconds (KotH: time in zone; Claustrophobia: time inside boundary). */
  declare zoneTime: number;
  // World-space position (from ServerMeshWalker)
  declare wx: number;
  declare wy: number;
  declare wz: number;
  // Surface normal (world-space)
  declare nx: number;
  declare ny: number;
  declare nz: number;
  // Tangent frame — tangent (surface "right")
  declare tx: number;
  declare ty: number;
  declare tz: number;
  // Tangent frame — bitangent (surface "forward", used as camera upHint)
  declare bx: number;
  declare by: number;
  declare bz: number;
  // Face index for debugging/telemetry
  declare walkerFaceIndex: number;
  // Companion counts — synced so all clients can render other players' drones (s44r2-04)
  declare guardianCount: number;
  declare hunterCount: number;
  declare protectorCount: number;

  constructor() {
    super();
    this.id = '';
    this.name = '';
    this.surfaceU = 0.5;
    this.surfaceV = 0.5;
    this.aimAngle = 0;
    this.lives = 3;
    this.bombs = 0; // Bombs disabled in MP (s44r-02)
    this.score = 0;
    this.multiplier = 1;
    this.alive = true;
    this.health = 100;
    this.maxHealth = 100;
    this.invincibilityTimer = 0;
    this.shooting = false;
    this.color = 0x00ffff;
    this.weaponType = 'standard';
    this.weaponAmmo = -1; // -1 = infinite (standard)
    this.playerLevel = 0;
    this.playerKills = 0;
    this.kills = 0;
    this.deaths = 0;
    this.enemyKills = 0;
    this.totalDamageDealt = 0;
    this.ddaLevel = 0;
    this.buffStacks = new MapSchema<number>();
    this.zoneTime = 0;
    // World-space position: default to top of sphere (radius 10)
    this.wx = 0; this.wy = 10; this.wz = 0;
    // Surface normal: pointing up
    this.nx = 0; this.ny = 1; this.nz = 0;
    // Tangent frame defaults
    this.tx = 1; this.ty = 0; this.tz = 0;
    this.bx = 0; this.by = 0; this.bz = 1;
    this.walkerFaceIndex = 0;
    this.guardianCount = 0;
    this.hunterCount = 0;
    this.protectorCount = 0;
  }
}

defineTypes(PlayerState, {
  id: 'string',
  name: 'string',
  surfaceU: 'number',
  surfaceV: 'number',
  aimAngle: 'number',
  lives: 'number',
  bombs: 'number',
  score: 'number',
  multiplier: 'number',
  alive: 'boolean',
  health: 'number',
  maxHealth: 'number',
  invincibilityTimer: 'number',
  shooting: 'boolean',
  color: 'number',
  weaponType: 'string',
  weaponAmmo: 'number',
  playerLevel: 'number',
  playerKills: 'number',
  kills: 'number',
  deaths: 'number',
  enemyKills: 'number',
  totalDamageDealt: 'number',
  ddaLevel: 'number',
  buffStacks: { map: 'number' },
  zoneTime: 'number',
  wx: 'number', wy: 'number', wz: 'number',
  nx: 'number', ny: 'number', nz: 'number',
  tx: 'number', ty: 'number', tz: 'number',
  bx: 'number', by: 'number', bz: 'number',
  walkerFaceIndex: 'number',
  guardianCount: 'int8',
  hunterCount: 'int8',
  protectorCount: 'int8',
});

/**
 * Bullet state
 */
export class BulletState extends Schema {
  declare id: string;
  declare ownerId: string;
  declare x: number;
  declare y: number;
  declare z: number;
  declare dirX: number;
  declare dirY: number;
  declare dirZ: number;
  declare age: number;
  /** Weapon type that fired this bullet — used for client-side visual assignment in dual-fire. */
  declare weaponType: string;

  constructor() {
    super();
    this.id = '';
    this.ownerId = '';
    this.x = 0;
    this.y = 0;
    this.z = 0;
    this.dirX = 0;
    this.dirY = 0;
    this.dirZ = 0;
    this.age = 0;
    this.weaponType = 'standard';
  }
}

defineTypes(BulletState, {
  id: 'string',
  ownerId: 'string',
  x: 'number',
  y: 'number',
  z: 'number',
  dirX: 'number',
  dirY: 'number',
  dirZ: 'number',
  age: 'number',
  weaponType: 'string',
});

/**
 * Enemy state
 */
export class EnemyState extends Schema {
  declare id: string;
  declare type: string;
  declare surfaceU: number;
  declare surfaceV: number;
  declare health: number;
  declare alive: boolean;

  constructor() {
    super();
    this.id = '';
    this.type = 'grunt';
    this.surfaceU = 0.5;
    this.surfaceV = 0.5;
    this.health = 1;
    this.alive = true;
  }
}

defineTypes(EnemyState, {
  id: 'string',
  type: 'string',
  surfaceU: 'number',
  surfaceV: 'number',
  health: 'number',
  alive: 'boolean',
});

/**
 * Geom (collectible) state
 */
export class GeomState extends Schema {
  declare id: string;
  declare surfaceU: number;
  declare surfaceV: number;
  declare active: boolean;

  constructor() {
    super();
    this.id = '';
    this.surfaceU = 0;
    this.surfaceV = 0;
    this.active = true;
  }
}

defineTypes(GeomState, {
  id: 'string',
  surfaceU: 'number',
  surfaceV: 'number',
  active: 'boolean',
});

/**
 * Weapon pickup state
 */
export class WeaponPickupState extends Schema {
  declare id: string;
  declare surfaceU: number;
  declare surfaceV: number;
  declare weaponType: string;
  declare age: number;
  declare active: boolean;

  constructor() {
    super();
    this.id = '';
    this.surfaceU = 0;
    this.surfaceV = 0;
    this.weaponType = 'spread';
    this.age = 0;
    this.active = true;
  }
}

defineTypes(WeaponPickupState, {
  id: 'string',
  surfaceU: 'number',
  surfaceV: 'number',
  weaponType: 'string',
  age: 'number',
  active: 'boolean',
});

/**
 * Super pickup state (bomb resupply, multiplier boost)
 * Spawned by server on wave milestones; collected by player proximity.
 */
export class SuperPickupState extends Schema {
  declare id: string;
  declare surfaceU: number;
  declare surfaceV: number;
  /** 'bomb_resupply' | 'multiplier_boost' */
  declare pickupType: string;
  declare active: boolean;
  declare age: number;

  constructor() {
    super();
    this.id = '';
    this.surfaceU = 0.5;
    this.surfaceV = 0.5;
    this.pickupType = 'bomb_resupply';
    this.active = true;
    this.age = 0;
  }
}

defineTypes(SuperPickupState, {
  id: 'string',
  surfaceU: 'number',
  surfaceV: 'number',
  pickupType: 'string',
  active: 'boolean',
  age: 'number',
});

/**
 * Buff pickup state (server-authoritative — spawns on enemy death, collected by player proximity)
 * Phase D: only the 4 damage-affecting buffs: hot_hands, trigger_happy, incendiary_rounds, volatile
 */
export class BuffPickupState extends Schema {
  declare id: string;
  declare surfaceU: number;
  declare surfaceV: number;
  /** Buff type string e.g. 'hot_hands', 'trigger_happy', 'incendiary_rounds', 'volatile' */
  declare buffType: string;
  declare active: boolean;
  declare age: number;

  constructor() {
    super();
    this.id = '';
    this.surfaceU = 0.5;
    this.surfaceV = 0.5;
    this.buffType = 'hot_hands';
    this.active = true;
    this.age = 0;
  }
}

defineTypes(BuffPickupState, {
  id: 'string',
  surfaceU: 'number',
  surfaceV: 'number',
  buffType: 'string',
  active: 'boolean',
  age: 'number',
});

/**
 * Health pickup state (PvP mode — spawns near damaged players)
 */
export class HealthPickupState extends Schema {
  declare id: string;
  declare surfaceU: number;
  declare surfaceV: number;
  declare active: boolean;
  declare age: number;

  constructor() {
    super();
    this.id = '';
    this.surfaceU = 0.5;
    this.surfaceV = 0.5;
    this.active = true;
    this.age = 0;
  }
}

defineTypes(HealthPickupState, {
  id: 'string',
  surfaceU: 'number',
  surfaceV: 'number',
  active: 'boolean',
  age: 'number',
});

/**
 * Main game state synced across all clients
 */
export class GameState extends Schema {
  declare players: MapSchema<PlayerState>;
  declare bullets: ArraySchema<BulletState>;
  declare enemies: ArraySchema<EnemyState>;
  declare geoms: ArraySchema<GeomState>;
  declare weaponPickups: ArraySchema<WeaponPickupState>;
  declare superPickups: ArraySchema<SuperPickupState>;
  declare buffPickups: ArraySchema<BuffPickupState>;
  declare healthPickups: ArraySchema<HealthPickupState>;
  declare surfaceType: string;
  declare waveNumber: number;
  declare gameTime: number;
  declare gameStarted: boolean;
  declare gameOver: boolean;
  declare hostId: string;
  declare isPaused: boolean;

  // Lobby voting state machine
  /** Canonical room phase: 'lobby' | 'playing' | 'voting' */
  declare roomPhase: string;
  /** Maps sessionId → choice string ('surface:mode:size') */
  declare voteMap: MapSchema<string>;
  /** Voting countdown in seconds (counts down when roomPhase='voting' and !hostPickMode) */
  declare votingCountdown: number;
  /** When true, host picks directly via host_launch; when false, voting + countdown runs */
  declare hostPickMode: boolean;
  /** Vote divergence countdown in seconds (3-sec timer when votes are split, auto-picks random voted map) */
  declare voteDivergenceCountdown: number;
  /** Current game mode (default: 'waves') */
  declare gameMode: string;
  /** Current map size (default: 'medium') */
  declare mapSize: string;
  /** PvP sub-mode: '' (none/co-op), 'pvp' (all vs all), 'pvpve' (players vs enemies + each other) */
  declare pvpMode: string;
  /** Win condition type: 'none', 'kills', 'time', 'lives' */
  declare winCondition: string;
  /** Target kill count for 'kills' win condition */
  declare killTarget: number;
  /** Time limit in seconds for 'time' win condition */
  declare timeLimit: number;
  /** Lives count per player for 'lives' win condition */
  declare livesCount: number;
  /** Maps sessionId → ready boolean for ready-up system */
  declare readyMap: MapSchema<boolean>;
  /** When true, host has paused the voting countdown */
  declare countdownPaused: boolean;
  /** Number of lives each player starts with (1-9, default: 3) */
  declare initialLives: number;
  /** When true, lives never deplete on death */
  declare infiniteLives: boolean;
  /** When true, player-to-player bullet damage is active (PvP mode). */
  declare pvpEnabled: boolean;
  /** Controls whose health bars are visible: 'all' | 'friendly' | 'enemy' | 'none' */
  declare healthBarVisibility: string;

  // --- Full GameSettings fields synced to clients for display ---
  /** Global difficulty multiplier (0.5–2.0, default 1.0). */
  declare difficultyMultiplier: number;
  /** Max simultaneous enemies on-surface (10–100, default 50). */
  declare enemyCountCap: number;
  /** Enemy spawn rate multiplier (0.25–3.0, default 1.0). Higher = more frequent waves. */
  declare enemySpawnRateMultiplier: number;
  /** How often healing orbs spawn, in seconds (5–120, default 30). */
  declare healingFrequency: number;
  /** HP restored per healing pickup (5–100, default 25). */
  declare healingAmount: number;
  /** When true, bullets damage teammates (PvP only, default false). */
  declare friendlyFire: boolean;
  /** Win condition for PvP modes: 'kills' | 'survival' | 'score' (default 'kills'). */
  declare pvpWinCondition: string;
  /** Kill count required to win when pvpWinCondition is 'kills' (1–50, default 10). */
  declare pvpKillLimit: number;
  /** Weapon all players start with (default 'standard'). */
  declare startingWeapon: string;
  /** Match time limit in seconds. 0 = unlimited (default 0). */
  declare timeLimit: number;
  /** When true, the host has queued settings for the next wave boundary ("Apply Next Round"). */
  declare hasPendingSettings: boolean;
  /** Time limit in seconds for 'time' win condition (0 = no limit) — s44p-06 */
  declare timeLimitSeconds: number;
  /** Remaining seconds for time-limit countdown (server-authoritative) — s44p-06 */
  declare timeRemaining: number;
  /** Kill goal for 'kills' win condition (0 = no limit) — s44p-06 */
  declare killGoal: number;

  // ── Portals (PvP/PvPvE only) ──────────────────────────────────────────────
  /** When true, portals are active this match (pvp or pvpve mode). */
  declare portalsActive: boolean;
  /** Portal A UV position (surface parameterization, 0-1). */
  declare portalAU: number;
  declare portalAV: number;
  /** Portal B UV position (surface parameterization, 0-1). */
  declare portalBU: number;
  declare portalBV: number;

  constructor() {
    super();
    this.players = new MapSchema<PlayerState>();
    this.bullets = new ArraySchema<BulletState>();
    this.enemies = new ArraySchema<EnemyState>();
    this.geoms = new ArraySchema<GeomState>();
    this.weaponPickups = new ArraySchema<WeaponPickupState>();
    this.superPickups = new ArraySchema<SuperPickupState>();
    this.buffPickups = new ArraySchema<BuffPickupState>();
    this.healthPickups = new ArraySchema<HealthPickupState>();
    this.surfaceType = 'sphere';
    this.waveNumber = 0;
    this.gameTime = 0;
    this.gameStarted = false;
    this.gameOver = false;
    this.hostId = '';
    this.isPaused = false;

    // Lobby voting state machine defaults
    this.roomPhase = 'lobby';
    this.voteMap = new MapSchema<string>();
    this.votingCountdown = 0;
    this.hostPickMode = false;
    this.voteDivergenceCountdown = 0;
    this.gameMode = 'waves';
    this.mapSize = 'medium';
    this.readyMap = new MapSchema<boolean>();
    this.countdownPaused = false;

    // PvP win condition fields (s44m-17)
    this.pvpMode = '';
    this.winCondition = 'none';
    this.killTarget = 10;
    this.livesCount = 3;

    // Lives configuration
    this.initialLives = 3;
    this.infiniteLives = false;

    // PvP / health bar settings
    this.pvpEnabled = false;
    this.healthBarVisibility = 'all';

    // Full settings fields (synced for client display)
    this.difficultyMultiplier = 1.0;
    this.enemyCountCap = 50;
    this.enemySpawnRateMultiplier = 1.0;
    this.healingFrequency = 30;
    this.healingAmount = 25;
    this.friendlyFire = false;
    this.pvpWinCondition = 'kills';
    this.pvpKillLimit = 10;
    this.startingWeapon = 'standard';
    this.timeLimit = 0;
    this.hasPendingSettings = false;

    // s44p-06: countdown timer fields
    this.timeLimitSeconds = 0;
    this.timeRemaining = 0;
    this.killGoal = 0;

    // Portals (PvP/PvPvE) — inactive by default until startGame() sets them
    this.portalsActive = false;
    this.portalAU = 0.25;
    this.portalAV = 0.25;
    this.portalBU = 0.75;
    this.portalBV = 0.75;
  }
}

defineTypes(GameState, {
  players: { map: PlayerState },
  bullets: [BulletState],
  enemies: [EnemyState],
  geoms: [GeomState],
  weaponPickups: [WeaponPickupState],
  superPickups: [SuperPickupState],
  buffPickups: [BuffPickupState],
  healthPickups: [HealthPickupState],
  surfaceType: 'string',
  waveNumber: 'number',
  gameTime: 'number',
  gameStarted: 'boolean',
  gameOver: 'boolean',
  hostId: 'string',
  isPaused: 'boolean',
  roomPhase: 'string',
  voteMap: { map: 'string' },
  votingCountdown: 'number',
  voteDivergenceCountdown: 'number',
  hostPickMode: 'boolean',
  gameMode: 'string',
  mapSize: 'string',
  readyMap: { map: 'boolean' },
  countdownPaused: 'boolean',
  pvpMode: 'string',
  winCondition: 'string',
  killTarget: 'number',
  livesCount: 'number',
  initialLives: 'number',
  infiniteLives: 'boolean',
  pvpEnabled: 'boolean',
  healthBarVisibility: 'string',
  difficultyMultiplier: 'number',
  enemyCountCap: 'number',
  enemySpawnRateMultiplier: 'number',
  healingFrequency: 'number',
  healingAmount: 'number',
  friendlyFire: 'boolean',
  pvpWinCondition: 'string',
  pvpKillLimit: 'number',
  startingWeapon: 'string',
  timeLimit: 'number',
  hasPendingSettings: 'boolean',
  timeLimitSeconds: 'number',
  timeRemaining: 'number',
  killGoal: 'number',
  portalsActive: 'boolean',
  portalAU: 'number',
  portalAV: 'number',
  portalBU: 'number',
  portalBV: 'number',
});

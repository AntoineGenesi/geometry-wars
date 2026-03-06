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
  declare shooting: boolean;
  declare color: number;
  declare weaponType: string;
  declare weaponAmmo: number;
  declare playerLevel: number;
  declare playerKills: number;
  declare ddaLevel: number;
  /** Buff stack counts: maps buff type string (e.g. 'hot_hands') → stack count */
  declare buffStacks: MapSchema<number>;
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

  constructor() {
    super();
    this.id = '';
    this.name = '';
    this.surfaceU = 0.5;
    this.surfaceV = 0.5;
    this.aimAngle = 0;
    this.lives = 3;
    this.bombs = 3;
    this.score = 0;
    this.multiplier = 1;
    this.alive = true;
    this.shooting = false;
    this.color = 0x00ffff;
    this.weaponType = 'standard';
    this.weaponAmmo = -1; // -1 = infinite (standard)
    this.playerLevel = 0;
    this.playerKills = 0;
    this.ddaLevel = 0;
    this.buffStacks = new MapSchema<number>();
    // World-space position: default to top of sphere (radius 10)
    this.wx = 0; this.wy = 10; this.wz = 0;
    // Surface normal: pointing up
    this.nx = 0; this.ny = 1; this.nz = 0;
    // Tangent frame defaults
    this.tx = 1; this.ty = 0; this.tz = 0;
    this.bx = 0; this.by = 0; this.bz = 1;
    this.walkerFaceIndex = 0;
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
  shooting: 'boolean',
  color: 'number',
  weaponType: 'string',
  weaponAmmo: 'number',
  playerLevel: 'number',
  playerKills: 'number',
  ddaLevel: 'number',
  buffStacks: { map: 'number' },
  wx: 'number', wy: 'number', wz: 'number',
  nx: 'number', ny: 'number', nz: 'number',
  tx: 'number', ty: 'number', tz: 'number',
  bx: 'number', by: 'number', bz: 'number',
  walkerFaceIndex: 'number',
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

  constructor() {
    super();
    this.players = new MapSchema<PlayerState>();
    this.bullets = new ArraySchema<BulletState>();
    this.enemies = new ArraySchema<EnemyState>();
    this.geoms = new ArraySchema<GeomState>();
    this.weaponPickups = new ArraySchema<WeaponPickupState>();
    this.superPickups = new ArraySchema<SuperPickupState>();
    this.buffPickups = new ArraySchema<BuffPickupState>();
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
    this.gameMode = 'waves';
    this.mapSize = 'medium';
    this.readyMap = new MapSchema<boolean>();
    this.countdownPaused = false;
    this.pvpMode = '';
    this.winCondition = 'none';
    this.killTarget = 10;
    this.timeLimit = 300;
    this.livesCount = 3;
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
  hostPickMode: 'boolean',
  gameMode: 'string',
  mapSize: 'string',
  readyMap: { map: 'boolean' },
  countdownPaused: 'boolean',
  pvpMode: 'string',
  winCondition: 'string',
  killTarget: 'number',
  timeLimit: 'number',
  livesCount: 'number',
});

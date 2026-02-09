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
 * Main game state synced across all clients
 */
export class GameState extends Schema {
  declare players: MapSchema<PlayerState>;
  declare bullets: ArraySchema<BulletState>;
  declare enemies: ArraySchema<EnemyState>;
  declare geoms: ArraySchema<GeomState>;
  declare weaponPickups: ArraySchema<WeaponPickupState>;
  declare surfaceType: string;
  declare waveNumber: number;
  declare gameTime: number;
  declare gameStarted: boolean;
  declare gameOver: boolean;
  declare hostId: string;
  declare isPaused: boolean;

  constructor() {
    super();
    this.players = new MapSchema<PlayerState>();
    this.bullets = new ArraySchema<BulletState>();
    this.enemies = new ArraySchema<EnemyState>();
    this.geoms = new ArraySchema<GeomState>();
    this.weaponPickups = new ArraySchema<WeaponPickupState>();
    this.surfaceType = 'sphere';
    this.waveNumber = 0;
    this.gameTime = 0;
    this.gameStarted = false;
    this.gameOver = false;
    this.hostId = '';
    this.isPaused = false;
  }
}

defineTypes(GameState, {
  players: { map: PlayerState },
  bullets: [BulletState],
  enemies: [EnemyState],
  geoms: [GeomState],
  weaponPickups: [WeaponPickupState],
  surfaceType: 'string',
  waveNumber: 'number',
  gameTime: 'number',
  gameStarted: 'boolean',
  gameOver: 'boolean',
  hostId: 'string',
  isPaused: 'boolean',
});

import { Schema, MapSchema, ArraySchema, defineTypes } from '@colyseus/schema';

/**
 * Player state synced across all clients
 */
export class PlayerState extends Schema {
  id: string = '';
  name: string = '';
  surfaceU: number = 0.5;
  surfaceV: number = 0.5;
  aimAngle: number = 0;
  lives: number = 3;
  bombs: number = 3;
  score: number = 0;
  multiplier: number = 1;
  alive: boolean = true;
  shooting: boolean = false;
  color: number = 0x00ffff;
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
});

/**
 * Bullet state
 */
export class BulletState extends Schema {
  id: string = '';
  ownerId: string = '';
  x: number = 0;
  y: number = 0;
  z: number = 0;
  dirX: number = 0;
  dirY: number = 0;
  dirZ: number = 0;
  age: number = 0;
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
  id: string = '';
  type: string = 'grunt';
  surfaceU: number = 0.5;
  surfaceV: number = 0.5;
  health: number = 1;
  alive: boolean = true;
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
  id: string = '';
  surfaceU: number = 0;
  surfaceV: number = 0;
  active: boolean = true;
}

defineTypes(GeomState, {
  id: 'string',
  surfaceU: 'number',
  surfaceV: 'number',
  active: 'boolean',
});

/**
 * Main game state synced across all clients
 */
export class GameState extends Schema {
  players = new MapSchema<PlayerState>();
  bullets = new ArraySchema<BulletState>();
  enemies = new ArraySchema<EnemyState>();
  geoms = new ArraySchema<GeomState>();

  surfaceType: string = 'sphere';
  waveNumber: number = 0;
  gameTime: number = 0;
  gameStarted: boolean = false;
  gameOver: boolean = false;
}

defineTypes(GameState, {
  players: { map: PlayerState },
  bullets: [BulletState],
  enemies: [EnemyState],
  geoms: [GeomState],
  surfaceType: 'string',
  waveNumber: 'number',
  gameTime: 'number',
  gameStarted: 'boolean',
  gameOver: 'boolean',
});

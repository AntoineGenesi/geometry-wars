import { Room, Client } from 'colyseus';
import {
  GameState,
  PlayerState,
  BulletState,
  EnemyState,
  GeomState,
  WeaponPickupState,
} from '../schema/GameState';
import { InterestManager, type PlayerSyncSet, type SyncableEntity } from '../systems/InterestManager';
import type { UVPosition } from '../systems/PriorityQueue';

/** Input message from client */
interface PlayerInput {
  moveX: number;
  moveY: number;
  aimAngle: number;
  shooting: boolean;
  bomb: boolean;
}

/** Enemy spawn message (server-authoritative) */
interface EnemySpawn {
  type: string;
  u: number;
  v: number;
}

// Constants
const TICK_RATE = 60;
// Movement speed in UV units per second.
// Co-op uses MeshWalker at 3.0 world units/s. On a sphere of radius 5,
// 1 UV unit = pi*5 world units. So 3.0 / (pi*5) = ~0.19 UV/s.
const PLAYER_SPEED = 0.19;
// Bullet speed in UV/s. Co-op bullets move at 4.0 world units/s.
// On a sphere of radius 5: 4.0 / (pi*5) = ~0.255 UV/s.
const BULLET_SPEED = 0.26;
const BULLET_LIFETIME = 3.0;
const SPAWN_INTERVAL = 2.0;
const MAX_ENEMIES = 50;

// Player colors
const PLAYER_COLORS = [0x00ffff, 0xff00ff, 0x00ff00, 0xffff00];

// Weapon configs (server side) - ammo and damage multiplier
const WEAPON_CONFIGS: Record<string, { ammo: number; damageMultiplier: number }> = {
  standard: { ammo: -1, damageMultiplier: 1.0 },
  spread: { ammo: 50, damageMultiplier: 0.8 },
  piercing: { ammo: 30, damageMultiplier: 1.5 },
  homing: { ammo: 20, damageMultiplier: 1.2 },
  chain_lightning: { ammo: 25, damageMultiplier: 1.0 },
  plasma_mortar: { ammo: 15, damageMultiplier: 2.0 },
  gravity_gun: { ammo: 20, damageMultiplier: 0.5 },
  laser_beam: { ammo: 40, damageMultiplier: 0.6 },
  black_hole: { ammo: 5, damageMultiplier: 5.0 },
  tesla_coil: { ammo: 30, damageMultiplier: 0.7 },
};

const WEAPON_DROP_CHANCE = 0.08; // 8% on enemy death
const WEAPON_PICKUP_LIFETIME = 20.0; // seconds before despawn
const WEAPON_TYPES = Object.keys(WEAPON_CONFIGS).filter(t => t !== 'standard');

// How often to log interest management metrics (every N ticks)
const METRICS_LOG_INTERVAL = 600; // every 10 seconds at 60Hz

export class GameRoom extends Room<GameState> {
  private spawnTimer = 0;
  private nextBulletId = 0;
  private nextEnemyId = 0;
  private nextGeomId = 0;
  private nextPickupId = 0;
  private waveNumber = 0;

  /** Interest management: per-client entity filtering */
  private interestManager: InterestManager | null = null;
  /** Latest per-player sync sets from interest management */
  private syncSets: Map<string, PlayerSyncSet> = new Map();

  onCreate(options: { surfaceType?: string }) {
    this.setState(new GameState());
    this.state.surfaceType = options.surfaceType || 'sphere';

    // Initialize interest management for per-client entity filtering
    this.interestManager = new InterestManager(this.state.surfaceType);

    // Set max clients (4 player co-op)
    this.maxClients = 4;

    // Set room metadata for lobby browser
    this.setMetadata({
      surface: this.state.surfaceType,
      status: 'waiting',
      wave: 0,
    });

    // Register message handlers
    this.onMessage('input', (client, input: PlayerInput) => {
      this.handleInput(client, input);
    });

    this.onMessage('start', () => {
      if (!this.state.gameStarted) {
        this.startGame();
      }
    });

    this.onMessage('pause', (client, data: { paused: boolean }) => {
      if (client.sessionId !== this.state.hostId) return;
      this.state.isPaused = data.paused;
      console.log(`[GameRoom] Game ${data.paused ? 'paused' : 'resumed'} by host`);
    });

    this.onMessage('end_game', (client) => {
      if (client.sessionId !== this.state.hostId) return;
      console.log('[GameRoom] Host ended the game');
      this.broadcast('game_ended');
      this.disconnect();
    });

    // Use Colyseus's built-in simulation interval (triggers state patch broadcasting)
    this.setSimulationInterval((dt) => this.tick(), 1000 / TICK_RATE);

    // Patch rate controls how often state changes are broadcast to clients.
    // Lower = more responsive but more bandwidth. 33ms = ~30Hz is a good balance.
    // (Previously 50ms/20Hz which felt laggy.)
    this.setPatchRate(33); // Send patches every ~33ms (~30Hz)

    console.log(`[GameRoom] Created with surface: ${this.state.surfaceType}`);
  }

  onJoin(client: Client, options: { name?: string }) {
    const player = new PlayerState();
    player.id = client.sessionId;

    // Sanitize and validate name
    let rawName = (options.name || '').trim().replace(/<[^>]*>/g, '').slice(0, 20);
    if (!rawName) {
      rawName = `Player ${this.state.players.size + 1}`;
    }

    // Check for name uniqueness; if taken, append a number
    let finalName = rawName;
    let suffix = 2;
    const existingNames = new Set<string>();
    this.state.players.forEach((p) => {
      existingNames.add(p.name.toLowerCase());
    });
    while (existingNames.has(finalName.toLowerCase())) {
      finalName = `${rawName.slice(0, 17)}(${suffix})`;
      suffix++;
    }

    player.name = finalName;
    player.color = PLAYER_COLORS[this.state.players.size % PLAYER_COLORS.length];

    // First player to join becomes host
    if (this.state.players.size === 0) {
      this.state.hostId = client.sessionId;
      console.log(`[GameRoom] ${player.name} is the host`);
    }

    // Spawn at different positions based on player count
    const spawnOffsets = [
      { u: 0.5, v: 0.5 },
      { u: 0.6, v: 0.5 },
      { u: 0.4, v: 0.5 },
      { u: 0.5, v: 0.6 },
    ];
    const spawnPos = spawnOffsets[this.state.players.size % spawnOffsets.length];
    player.surfaceU = spawnPos.u;
    player.surfaceV = spawnPos.v;

    this.state.players.set(client.sessionId, player);
    console.log(`[GameRoom] ${player.name} joined (${client.sessionId})`);
    console.log(`[GameRoom] State after join: players.size=${this.state.players.size}, surfaceType=${this.state.surfaceType}, gameStarted=${this.state.gameStarted}`);
    this.state.players.forEach((p, k) => {
      console.log(`[GameRoom]   player ${k}: name=${p.name}, alive=${p.alive}, lives=${p.lives}`);
    });
  }

  onLeave(client: Client, consented: boolean) {
    const player = this.state.players.get(client.sessionId);
    if (player) {
      console.log(`[GameRoom] ${player.name} left`);
      this.state.players.delete(client.sessionId);
    }

    // If the host left, notify remaining clients and close the room
    if (client.sessionId === this.state.hostId) {
      console.log('[GameRoom] Host left, closing room');
      this.broadcast('host_left');
      this.disconnect();
      return;
    }

    // End game if no players left
    if (this.state.players.size === 0) {
      this.state.gameStarted = false;
      this.state.gameOver = true;
      this.setMetadata({
        surface: this.state.surfaceType,
        status: 'empty',
        wave: this.waveNumber,
      });
    }
  }

  onDispose() {
    console.log('[GameRoom] Disposed');
  }

  private startGame() {
    this.state.gameStarted = true;
    this.state.gameOver = false;
    this.state.waveNumber = 0;
    this.state.gameTime = 0;
    this.waveNumber = 0;
    this.spawnTimer = 0;

    // Reset all players
    this.state.players.forEach((player) => {
      player.lives = 3;
      player.bombs = 3;
      player.score = 0;
      player.multiplier = 1;
      player.alive = true;
      player.weaponType = 'standard';
      player.weaponAmmo = -1;
    });

    // Clear entities
    this.state.bullets.clear();
    this.state.enemies.clear();
    this.state.geoms.clear();
    this.state.weaponPickups.clear();

    this.setMetadata({
      surface: this.state.surfaceType,
      status: 'playing',
      wave: 0,
    });

    console.log('[GameRoom] Game started!');
  }

  private handleInput(client: Client, input: PlayerInput) {
    const player = this.state.players.get(client.sessionId);
    if (!player || !player.alive) return;

    const dx = input.moveX * PLAYER_SPEED * (1 / TICK_RATE);
    const dy = input.moveY * PLAYER_SPEED * (1 / TICK_RATE);

    // Apply sin(phi) correction ONLY for sphere-like surfaces where
    // UV maps to spherical coordinates (U = longitude, V = latitude).
    // For other surfaces (cube, torus, pill, pipe, etc.), UV space is
    // roughly uniform, so no correction is needed.
    const surfaceType = this.state.surfaceType;
    const isSphereLike = surfaceType === 'sphere' || surfaceType === 'sphere-tunnel'
      || surfaceType === 'icosahedron' || surfaceType === 'capsule'
      || surfaceType === 'peanut';

    let correctedDx = dx;
    if (isSphereLike) {
      const phi = player.surfaceV * Math.PI;
      const sinPhi = Math.sin(phi);
      // Limit correction near poles to prevent getting stuck.
      // Use a generous minimum of 0.3 (about 17 degrees from pole) to ensure
      // the player always has reasonable horizontal movement near poles.
      // Previous value of 0.15 still caused stuck/jitter near poles.
      const clampedSinPhi = Math.max(sinPhi, 0.3);
      correctedDx = dx / clampedSinPhi;
    }

    player.surfaceU = this.wrapCoord(player.surfaceU + correctedDx);
    // Use wrap for surfaces that wrap in V (torus, pipe, mobius, cube-ring,
    // cube-tunnel). Use clamp with a small margin for sphere-like surfaces
    // and pill (which has clamped poles) to prevent getting stuck at exact 0 or 1.
    const wrapsInV = surfaceType === 'torus' || surfaceType === 'pipe'
      || surfaceType === 'mobius' || surfaceType === 'cube-ring'
      || surfaceType === 'cube-tunnel' || surfaceType === 'cube';
    if (wrapsInV) {
      player.surfaceV = this.wrapCoord(player.surfaceV + dy);
    } else {
      // Clamp with wider margin to keep player well away from pole singularity.
      // Previous 0.02/0.98 allowed getting too close. 0.05/0.95 is safer.
      player.surfaceV = Math.max(0.05, Math.min(0.95, player.surfaceV + dy));
    }
    player.aimAngle = input.aimAngle;
    player.shooting = input.shooting;

    // Handle shooting
    if (input.shooting) {
      this.tryShoot(player);
    }

    // Handle bomb
    if (input.bomb && player.bombs > 0) {
      this.useBomb(player);
    }
  }

  private tryShoot(player: PlayerState) {
    // Rate limit shooting (every 0.1 seconds)
    const now = this.state.gameTime;
    const lastShot = (player as unknown as { lastShotTime?: number }).lastShotTime || 0;
    if (now - lastShot < 0.1) return;

    (player as unknown as { lastShotTime: number }).lastShotTime = now;

    // Create bullet
    const bullet = new BulletState();
    bullet.id = `b${this.nextBulletId++}`;
    bullet.ownerId = player.id;

    // Position at player
    const angle = player.aimAngle;
    bullet.x = player.surfaceU;
    bullet.y = player.surfaceV;
    bullet.z = 0;
    bullet.dirX = Math.cos(angle);
    bullet.dirY = Math.sin(angle);
    bullet.dirZ = 0;
    bullet.age = 0;

    this.state.bullets.push(bullet);
  }

  private useBomb(player: PlayerState) {
    player.bombs--;

    // Kill all enemies
    const enemiesToRemove: number[] = [];
    this.state.enemies.forEach((enemy, index) => {
      if (enemy.alive) {
        enemy.alive = false;
        enemiesToRemove.push(index);

        // Spawn geoms at enemy position
        this.spawnGeom(enemy.surfaceU, enemy.surfaceV);

        // Add score
        player.score += 100 * player.multiplier;
      }
    });

    // Remove dead enemies (iterate in reverse)
    for (let i = enemiesToRemove.length - 1; i >= 0; i--) {
      this.state.enemies.splice(enemiesToRemove[i], 1);
    }

    console.log(`[GameRoom] ${player.name} used bomb, killed ${enemiesToRemove.length} enemies`);
  }

  private tick() {
    if (!this.state.gameStarted || this.state.gameOver) return;
    if (this.state.isPaused) return;

    const dt = 1 / TICK_RATE;
    this.state.gameTime += dt;

    // Update bullets
    this.updateBullets(dt);

    // Update enemies
    this.updateEnemies(dt);

    // Check collisions
    this.checkCollisions();

    // Update weapon pickups (age + despawn)
    this.updateWeaponPickups(dt);

    // Spawn enemies
    this.spawnTimer += dt;
    if (this.spawnTimer >= SPAWN_INTERVAL && this.state.enemies.length < MAX_ENEMIES) {
      this.spawnEnemy();
      this.spawnTimer = 0;
    }

    // NOTE: Interest management (updateInterestManagement) is disabled.
    // The shouldSyncEntity() results were never consumed by Colyseus's state
    // patching, so the computation was wasted. Needs proper Colyseus filter
    // integration before re-enabling.

    // Check game over
    this.checkGameOver();
  }

  private updateBullets(dt: number) {
    const bulletsToRemove: number[] = [];

    this.state.bullets.forEach((bullet, index) => {
      bullet.age += dt;

      // Move bullet
      bullet.x += bullet.dirX * BULLET_SPEED * dt;
      bullet.y += bullet.dirY * BULLET_SPEED * dt;

      // Wrap/clamp coordinates
      bullet.x = this.wrapCoord(bullet.x);
      bullet.y = this.clampCoord(bullet.y);

      // Remove old bullets
      if (bullet.age > BULLET_LIFETIME) {
        bulletsToRemove.push(index);
      }
    });

    // Remove bullets (iterate in reverse)
    for (let i = bulletsToRemove.length - 1; i >= 0; i--) {
      this.state.bullets.splice(bulletsToRemove[i], 1);
    }
  }

  private updateEnemies(dt: number) {
    // Simple enemy AI: move toward nearest player
    this.state.enemies.forEach((enemy) => {
      if (!enemy.alive) return;

      // Find nearest player
      let nearestPlayer: PlayerState | null = null;
      let nearestDist = Infinity;

      this.state.players.forEach((player) => {
        if (!player.alive) return;
        const du = player.surfaceU - enemy.surfaceU;
        const dv = player.surfaceV - enemy.surfaceV;
        const dist = Math.sqrt(du * du + dv * dv);
        if (dist < nearestDist) {
          nearestDist = dist;
          nearestPlayer = player;
        }
      });

      if (nearestPlayer) {
        // Move toward player
        const du = nearestPlayer.surfaceU - enemy.surfaceU;
        const dv = nearestPlayer.surfaceV - enemy.surfaceV;
        const dist = Math.sqrt(du * du + dv * dv);
        if (dist > 0.01) {
          const speed = this.getEnemySpeed(enemy.type);
          enemy.surfaceU += (du / dist) * speed * dt;
          enemy.surfaceV += (dv / dist) * speed * dt;
        }
      }
    });
  }

  private getEnemySpeed(type: string): number {
    // Enemy speeds in UV/s. Scaled to match PLAYER_SPEED = 0.19.
    // Ratio: enemies should be somewhat slower than the player so the game
    // is playable. These values match the relative speeds from co-op.
    const speeds: Record<string, number> = {
      grunt: 0.07,
      arrow: 0.14,
      weaver: 0.10,
      spinner: 0.06,
      snake: 0.12,
      gate: 0.05,
      blackhole: 0.025,
      repulsor: 0.08,
      mayfly: 0.19,
      proton: 0.10,
      ufo: 0.05,
      mines: 0,
      mutator: 0.07,
      bubbles: 0.06,
      spawnlet: 0.12,
    };
    return speeds[type] || 0.07;
  }

  private checkCollisions() {
    // Bullet-enemy collisions
    const bulletsToRemove: number[] = [];
    const enemiesToRemove: number[] = [];

    this.state.bullets.forEach((bullet, bIndex) => {
      this.state.enemies.forEach((enemy, eIndex) => {
        if (!enemy.alive) return;

        const du = bullet.x - enemy.surfaceU;
        const dv = bullet.y - enemy.surfaceV;
        const dist = Math.sqrt(du * du + dv * dv);

        if (dist < 0.05) {
          // Hit! Apply weapon damage multiplier
          const owner = this.state.players.get(bullet.ownerId);
          const weaponCfg = WEAPON_CONFIGS[owner?.weaponType ?? 'standard'] ?? WEAPON_CONFIGS.standard;
          const damage = Math.ceil(weaponCfg.damageMultiplier);
          enemy.health -= damage;

          if (enemy.health <= 0) {
            enemy.alive = false;
            enemiesToRemove.push(eIndex);

            if (owner) {
              owner.score += this.getEnemyScore(enemy.type) * owner.multiplier;
            }

            // Spawn geom
            this.spawnGeom(enemy.surfaceU, enemy.surfaceV);

            // Chance to spawn weapon pickup
            if (Math.random() < WEAPON_DROP_CHANCE) {
              this.spawnWeaponPickup(enemy.surfaceU, enemy.surfaceV);
            }
          }
          bulletsToRemove.push(bIndex);
        }
      });
    });

    // Player-enemy collisions
    this.state.players.forEach((player) => {
      if (!player.alive) return;

      this.state.enemies.forEach((enemy, eIndex) => {
        if (!enemy.alive) return;

        const du = player.surfaceU - enemy.surfaceU;
        const dv = player.surfaceV - enemy.surfaceV;
        const dist = Math.sqrt(du * du + dv * dv);

        if (dist < 0.04) {
          // Player hit!
          player.lives--;
          player.multiplier = 1;

          if (player.lives <= 0) {
            player.alive = false;
            console.log(`[GameRoom] ${player.name} died!`);
          } else {
            // Respawn at center
            player.surfaceU = 0.5;
            player.surfaceV = 0.5;
          }
        }
      });
    });

    // Player-geom collisions
    const geomsToRemove: number[] = [];
    this.state.players.forEach((player) => {
      if (!player.alive) return;

      this.state.geoms.forEach((geom, index) => {
        if (!geom.active) return;

        const du = player.surfaceU - geom.surfaceU;
        const dv = player.surfaceV - geom.surfaceV;
        const dist = Math.sqrt(du * du + dv * dv);

        if (dist < 0.05) {
          // Collect geom
          geom.active = false;
          geomsToRemove.push(index);
          player.multiplier = Math.min(player.multiplier + 1, 150);
          player.score += 10;
        }
      });
    });

    // Player-weaponPickup collisions
    const pickupsToRemove: number[] = [];
    this.state.players.forEach((player) => {
      if (!player.alive) return;

      this.state.weaponPickups.forEach((pickup, index) => {
        if (!pickup.active) return;

        const du = player.surfaceU - pickup.surfaceU;
        const dv = player.surfaceV - pickup.surfaceV;
        const dist = Math.sqrt(du * du + dv * dv);

        if (dist < 0.06) {
          pickup.active = false;
          pickupsToRemove.push(index);

          const cfg = WEAPON_CONFIGS[pickup.weaponType] ?? WEAPON_CONFIGS.standard;
          player.weaponType = pickup.weaponType;
          player.weaponAmmo = cfg.ammo;
        }
      });
    });

    // Remove entities (iterate in reverse)
    for (let i = bulletsToRemove.length - 1; i >= 0; i--) {
      this.state.bullets.splice(bulletsToRemove[i], 1);
    }
    for (let i = enemiesToRemove.length - 1; i >= 0; i--) {
      this.state.enemies.splice(enemiesToRemove[i], 1);
    }
    for (let i = geomsToRemove.length - 1; i >= 0; i--) {
      this.state.geoms.splice(geomsToRemove[i], 1);
    }
    for (let i = pickupsToRemove.length - 1; i >= 0; i--) {
      this.state.weaponPickups.splice(pickupsToRemove[i], 1);
    }
  }

  private getEnemyScore(type: string): number {
    const scores: Record<string, number> = {
      grunt: 25,
      arrow: 75,
      weaver: 50,
      spinner: 100,
      snake: 50,
      gate: 150,
      blackhole: 200,
      repulsor: 50,
      mayfly: 150,
      proton: 100,
      ufo: 300,
      mines: 25,
      mutator: 200,
      bubbles: 50,
      spawnlet: 25,
    };
    return scores[type] || 25;
  }

  private spawnEnemy() {
    const enemy = new EnemyState();
    enemy.id = `e${this.nextEnemyId++}`;

    // Random type weighted by wave number
    const types = ['grunt', 'arrow', 'weaver', 'spinner'];
    if (this.waveNumber > 2) types.push('snake', 'repulsor');
    if (this.waveNumber > 5) types.push('gate', 'mayfly', 'proton');
    if (this.waveNumber > 8) types.push('blackhole', 'ufo', 'mutator');

    enemy.type = types[Math.floor(Math.random() * types.length)];

    // Spawn at edge
    const side = Math.floor(Math.random() * 4);
    switch (side) {
      case 0:
        enemy.surfaceU = Math.random();
        enemy.surfaceV = 0;
        break;
      case 1:
        enemy.surfaceU = Math.random();
        enemy.surfaceV = 1;
        break;
      case 2:
        enemy.surfaceU = 0;
        enemy.surfaceV = Math.random();
        break;
      case 3:
        enemy.surfaceU = 1;
        enemy.surfaceV = Math.random();
        break;
    }

    enemy.health = this.getEnemyHealth(enemy.type);
    enemy.alive = true;

    this.state.enemies.push(enemy);

    // Increment wave every 10 enemies
    if (this.nextEnemyId % 10 === 0) {
      this.waveNumber++;
      this.state.waveNumber = this.waveNumber;
      this.setMetadata({
        surface: this.state.surfaceType,
        status: 'playing',
        wave: this.waveNumber,
      });
      console.log(`[GameRoom] Wave ${this.waveNumber} started`);
    }
  }

  private getEnemyHealth(type: string): number {
    const health: Record<string, number> = {
      grunt: 1,
      arrow: 1,
      weaver: 2,
      spinner: 3,
      snake: 1,
      gate: 2,
      blackhole: 10,
      repulsor: 3,
      mayfly: 1,
      proton: 5,
      ufo: 5,
      mines: 1,
      mutator: 4,
      bubbles: 2,
      spawnlet: 1,
    };
    return health[type] || 1;
  }

  private spawnGeom(u: number, v: number) {
    const geom = new GeomState();
    geom.id = `g${this.nextGeomId++}`;
    geom.surfaceU = u + (Math.random() - 0.5) * 0.05;
    geom.surfaceV = v + (Math.random() - 0.5) * 0.05;
    geom.active = true;
    this.state.geoms.push(geom);
  }

  private checkGameOver() {
    // Game over if all players are dead
    let anyAlive = false;
    this.state.players.forEach((player) => {
      if (player.alive) anyAlive = true;
    });

    if (!anyAlive && this.state.players.size > 0) {
      this.state.gameOver = true;
      this.setMetadata({
        surface: this.state.surfaceType,
        status: 'game_over',
        wave: this.waveNumber,
      });
      console.log('[GameRoom] Game Over!');
    }
  }

  private spawnWeaponPickup(u: number, v: number) {
    const pickup = new WeaponPickupState();
    pickup.id = `wp${this.nextPickupId++}`;
    pickup.surfaceU = u + (Math.random() - 0.5) * 0.04;
    pickup.surfaceV = v + (Math.random() - 0.5) * 0.04;
    pickup.weaponType = WEAPON_TYPES[Math.floor(Math.random() * WEAPON_TYPES.length)];
    pickup.age = 0;
    pickup.active = true;
    this.state.weaponPickups.push(pickup);
  }

  private updateWeaponPickups(dt: number) {
    const toRemove: number[] = [];
    this.state.weaponPickups.forEach((pickup, index) => {
      if (!pickup.active) {
        toRemove.push(index);
        return;
      }
      pickup.age += dt;
      if (pickup.age > WEAPON_PICKUP_LIFETIME) {
        pickup.active = false;
        toRemove.push(index);
      }
    });
    for (let i = toRemove.length - 1; i >= 0; i--) {
      this.state.weaponPickups.splice(toRemove[i], 1);
    }

    // Deplete ammo on shooting players
    this.state.players.forEach((player) => {
      if (!player.alive || !player.shooting) return;
      if (player.weaponAmmo > 0) {
        // Deduct ammo at fire rate (roughly 10 shots/sec)
        player.weaponAmmo--;
        if (player.weaponAmmo <= 0) {
          player.weaponType = 'standard';
          player.weaponAmmo = -1;
        }
      }
    });
  }

  /**
   * Run interest management to determine which entities each player
   * should receive updates for. Stores results in this.syncSets.
   */
  private updateInterestManagement(): void {
    if (!this.interestManager) return;

    // Build player position map
    const playerPositions = new Map<string, UVPosition>();
    this.state.players.forEach((player, id) => {
      if (player.alive) {
        playerPositions.set(id, { u: player.surfaceU, v: player.surfaceV });
      }
    });

    // Build entity arrays
    const enemies: SyncableEntity[] = [];
    this.state.enemies.forEach((enemy) => {
      if (enemy.alive) {
        enemies.push({ id: enemy.id, u: enemy.surfaceU, v: enemy.surfaceV });
      }
    });

    const bullets: SyncableEntity[] = [];
    this.state.bullets.forEach((bullet) => {
      bullets.push({ id: bullet.id, u: bullet.x, v: bullet.y });
    });

    const geoms: SyncableEntity[] = [];
    this.state.geoms.forEach((geom) => {
      if (geom.active) {
        geoms.push({ id: geom.id, u: geom.surfaceU, v: geom.surfaceV });
      }
    });

    const pickups: SyncableEntity[] = [];
    this.state.weaponPickups.forEach((pickup) => {
      if (pickup.active) {
        pickups.push({ id: pickup.id, u: pickup.surfaceU, v: pickup.surfaceV });
      }
    });

    // Run interest management update
    this.syncSets = this.interestManager.update(
      playerPositions, enemies, bullets, geoms, pickups,
    );

    // Periodic metrics logging
    const tick = this.interestManager.getTickNumber();
    if (tick % METRICS_LOG_INTERVAL === 0 && tick > 0) {
      const metrics = this.interestManager.getMetrics();
      console.log(
        `[InterestMgr] tick=${tick} entities=${metrics.totalEntities}` +
        ` avg_synced=${metrics.avgEntitiesPerPlayer.toFixed(1)}` +
        ` savings=${(metrics.bandwidthSavingsRatio * 100).toFixed(1)}%`,
      );
    }
  }

  /**
   * Query whether a specific entity should be synced to a specific client.
   * Used for Colyseus filter integration.
   *
   * @returns true if entity should be sent to this client
   */
  shouldSyncEntity(
    clientId: string,
    entityId: string,
    entityType: 'enemy' | 'bullet' | 'geom' | 'pickup',
  ): boolean {
    const syncSet = this.syncSets.get(clientId);
    if (!syncSet) return true; // No filtering data yet, sync everything

    switch (entityType) {
      case 'enemy': return syncSet.enemyIds.has(entityId);
      case 'bullet': return syncSet.bulletIds.has(entityId);
      case 'geom': return syncSet.geomIds.has(entityId);
      case 'pickup': return syncSet.pickupIds.has(entityId);
    }
  }

  /** Get the interest manager instance (for external metrics/debugging) */
  getInterestManager(): InterestManager | null {
    return this.interestManager;
  }

  private wrapCoord(v: number): number {
    return ((v % 1) + 1) % 1;
  }

  private clampCoord(v: number): number {
    return Math.max(0, Math.min(1, v));
  }
}

import { Room, Client } from 'colyseus';
import {
  GameState,
  PlayerState,
  BulletState,
  EnemyState,
  GeomState,
  WeaponPickupState,
} from '../schema/GameState';

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
const PLAYER_SPEED = 0.08;
const BULLET_SPEED = 0.15;
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

export class GameRoom extends Room<GameState> {
  private spawnTimer = 0;
  private nextBulletId = 0;
  private nextEnemyId = 0;
  private nextGeomId = 0;
  private nextPickupId = 0;
  private waveNumber = 0;

  onCreate(options: { surfaceType?: string }) {
    this.setState(new GameState());
    this.state.surfaceType = options.surfaceType || 'sphere';

    // Set max clients (4 player co-op)
    this.maxClients = 4;

    // Register message handlers
    this.onMessage('input', (client, input: PlayerInput) => {
      this.handleInput(client, input);
    });

    this.onMessage('start', () => {
      if (!this.state.gameStarted) {
        this.startGame();
      }
    });

    // Use Colyseus's built-in simulation interval (triggers state patch broadcasting)
    this.setSimulationInterval((dt) => this.tick(), 1000 / TICK_RATE);

    // Explicitly set patch rate to ensure state changes are broadcast
    this.setPatchRate(50); // Send patches every 50ms

    console.log(`[GameRoom] Created with surface: ${this.state.surfaceType}`);
  }

  onJoin(client: Client, options: { name?: string }) {
    const player = new PlayerState();
    player.id = client.sessionId;
    player.name = options.name || `Player ${this.state.players.size + 1}`;
    player.color = PLAYER_COLORS[this.state.players.size % PLAYER_COLORS.length];

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

    // End game if no players left
    if (this.state.players.size === 0) {
      this.state.gameStarted = false;
      this.state.gameOver = true;
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

    console.log('[GameRoom] Game started!');
  }

  private handleInput(client: Client, input: PlayerInput) {
    const player = this.state.players.get(client.sessionId);
    if (!player || !player.alive) return;

    // Update player position
    const dx = input.moveX * PLAYER_SPEED * (1 / TICK_RATE);
    const dy = input.moveY * PLAYER_SPEED * (1 / TICK_RATE);

    player.surfaceU = this.wrapCoord(player.surfaceU + dx);
    player.surfaceV = this.clampCoord(player.surfaceV + dy);
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
    const speeds: Record<string, number> = {
      grunt: 0.03,
      arrow: 0.06,
      weaver: 0.04,
      spinner: 0.025,
      snake: 0.05,
      gate: 0.02,
      blackhole: 0.01,
      repulsor: 0.035,
      mayfly: 0.08,
      proton: 0.04,
      ufo: 0.02,
      mines: 0,
      mutator: 0.03,
      bubbles: 0.025,
      spawnlet: 0.05,
    };
    return speeds[type] || 0.03;
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

  private wrapCoord(v: number): number {
    return ((v % 1) + 1) % 1;
  }

  private clampCoord(v: number): number {
    return Math.max(0, Math.min(1, v));
  }
}

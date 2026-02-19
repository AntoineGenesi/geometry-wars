import { Room, Client } from 'colyseus';
import {
  GameState,
  PlayerState,
  BulletState,
  EnemyState,
  GeomState,
  WeaponPickupState,
} from '../schema/GameState';
// NOTE: InterestManager and PriorityQueue exist in ../systems/ but are not
// currently used. Interest management was disabled because Colyseus's state
// patching doesn't consume shouldSyncEntity() results. If re-enabled, import
// from '../systems/InterestManager' and '../systems/PriorityQueue'.
// See decisions/lan-deep-audit-2026-02-11.md #11.

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

export class GameRoom extends Room<GameState> {
  private spawnTimer = 0;
  private nextBulletId = 0;
  private nextEnemyId = 0;
  private nextGeomId = 0;
  private nextPickupId = 0;
  private waveNumber = 0;

  /**
   * Latest input state per player. Updated on message receipt, consumed
   * in tick(). This decouples input send rate from movement speed:
   * movement is applied every tick (60Hz) regardless of how often the
   * client sends input. Previously, movement was applied per-message,
   * meaning 30Hz input = half speed, 60Hz input = full speed.
   */
  private playerInputs: Map<string, PlayerInput> = new Map();

  onCreate(options: { surfaceType?: string }) {
    this.setState(new GameState());
    this.state.surfaceType = options.surfaceType || 'sphere';

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
      // Allow restart after game over (gameStarted stays true, but gameOver is set)
      if (!this.state.gameStarted || this.state.gameOver) {
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
    // Lower = more responsive but more bandwidth. On LAN, bandwidth is not a
    // concern so we match the simulation rate (60Hz) for minimum perceived latency.
    // Previously 33ms/30Hz — caused bullets and entities to stutter because the
    // client only received updates every other frame. See decisions/lan-deep-audit-2026-02-11.md #4.
    this.setPatchRate(16); // Send patches every ~16ms (~60Hz, matches TICK_RATE)

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
      this.playerInputs.delete(client.sessionId);
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

    // Store the latest input. Movement will be applied in tick() at a
    // consistent 60Hz, decoupling movement speed from input send rate.
    this.playerInputs.set(client.sessionId, input);

    // Apply aim angle immediately (no movement dependency)
    player.aimAngle = input.aimAngle;

    // Handle bomb immediately (one-shot action, not continuous)
    if (input.bomb && player.bombs > 0) {
      this.useBomb(player);
    }
  }

  /**
   * Apply stored input as movement. Called once per tick (60Hz).
   * This ensures movement speed is consistent regardless of client input rate.
   */
  private applyPlayerMovement(dt: number) {
    this.playerInputs.forEach((input, clientId) => {
      const player = this.state.players.get(clientId);
      if (!player || !player.alive) return;

      const dx = input.moveX * PLAYER_SPEED * dt;
      const dy = input.moveY * PLAYER_SPEED * dt;

      // Apply sin(phi) correction for sphere-like surfaces
      const surfaceType = this.state.surfaceType;
      const isSphereLike = surfaceType === 'sphere' || surfaceType === 'sphere-tunnel'
        || surfaceType === 'icosahedron' || surfaceType === 'capsule'
        || surfaceType === 'peanut';

      let correctedDx = dx;
      if (isSphereLike) {
        const phi = player.surfaceV * Math.PI;
        const sinPhi = Math.sin(phi);
        const clampedSinPhi = Math.max(sinPhi, 0.3);
        correctedDx = dx / clampedSinPhi;
      }

      player.surfaceU = this.wrapCoord(player.surfaceU + correctedDx);

      // Cube surface wraps U (around 4 side faces) but CLAMPS V (bottom-to-top).
      // CubeSurface.moveOnSurface() clamps V to [epsilon, 1-epsilon] because
      // V=0 is bottom face center and V=1 is top face center (not periodic).
      // Previous code incorrectly listed 'cube' as wrapsInV, causing the player
      // to teleport between top and bottom faces when moving past V boundaries
      // (user reported as "stuck at origin" because player oscillates).
      const wrapsInV = surfaceType === 'torus' || surfaceType === 'pipe'
        || surfaceType === 'mobius' || surfaceType === 'cube-ring'
        || surfaceType === 'cube-tunnel';
      if (wrapsInV) {
        player.surfaceV = this.wrapCoord(player.surfaceV + dy);
      } else {
        // Clamp V: use 0.003 for cube (matching CubeSurface epsilon),
        // 0.05 for sphere-like (avoids pole singularity)
        const vMin = surfaceType === 'cube' ? 0.003 : 0.05;
        const vMax = surfaceType === 'cube' ? 0.997 : 0.95;
        player.surfaceV = Math.max(vMin, Math.min(vMax, player.surfaceV + dy));
      }

      // Handle shooting (continuous action, applied per tick)
      if (input.shooting) {
        this.tryShoot(player);
      }
    });
  }

  private tryShoot(player: PlayerState) {
    // Rate limit shooting (every 0.1 seconds)
    const now = this.state.gameTime;
    const lastShot = (player as unknown as { lastShotTime?: number }).lastShotTime || 0;
    if (now - lastShot < 0.1) return;

    (player as unknown as { lastShotTime: number }).lastShotTime = now;

    // Deduct ammo per shot (not per tick). Standard weapon has infinite ammo (-1).
    if (player.weaponAmmo > 0) {
      player.weaponAmmo--;
      if (player.weaponAmmo <= 0) {
        player.weaponType = 'standard';
        player.weaponAmmo = -1;
      }
    }

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

    // Apply player movement from stored inputs (60Hz consistent)
    this.applyPlayerMovement(dt);

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

    // Compute once per tick — same surface type check as applyPlayerMovement()
    const surfType = this.state.surfaceType;
    const isSphereLike = surfType === 'sphere' || surfType === 'sphere-tunnel'
      || surfType === 'icosahedron' || surfType === 'capsule' || surfType === 'peanut';

    this.state.bullets.forEach((bullet, index) => {
      bullet.age += dt;

      // Apply sin(phi) correction for sphere-like surfaces.
      // On a sphere, the arc length of a U-step at latitude V is proportional
      // to sin(phi) where phi = V * PI.  Without correction, bullets aimed
      // horizontally slow to a crawl near the poles (sin(phi)→0) while V-aimed
      // bullets travel at normal speed, making every shot appear to curve toward
      // the poles.  Dividing dirX by sin(phi) restores consistent world-space
      // bullet speed — the same correction applyPlayerMovement() already uses.
      let correctedDirX = bullet.dirX;
      if (isSphereLike) {
        const phi = bullet.y * Math.PI;
        const sinPhi = Math.sin(phi);
        const clampedSinPhi = Math.max(sinPhi, 0.3);
        correctedDirX = bullet.dirX / clampedSinPhi;
      }

      // Move bullet
      bullet.x += correctedDirX * BULLET_SPEED * dt;
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
          // Wrap U, clamp V to same range as players to prevent
          // enemies from reaching pole singularities and becoming invisible.
          // Cube uses tighter bounds since V=0/1 are face centers (not poles).
          enemy.surfaceU = this.wrapCoord(enemy.surfaceU);
          const surfType = this.state.surfaceType;
          const enemyVMin = surfType === 'cube' ? 0.003 : 0.05;
          const enemyVMax = surfType === 'cube' ? 0.997 : 0.95;
          enemy.surfaceV = Math.max(enemyVMin, Math.min(enemyVMax, enemy.surfaceV));
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

    // Spawn at edge, but avoid exact 0/1 on V for sphere-like surfaces
    // (V=0 and V=1 are pole singularities → invisible enemies, stuck movement).
    // Use 0.05-0.95 range to match player V-clamp.
    const side = Math.floor(Math.random() * 4);
    const vMin = 0.05;
    const vMax = 0.95;
    const randomV = () => vMin + Math.random() * (vMax - vMin);
    switch (side) {
      case 0:
        enemy.surfaceU = Math.random();
        enemy.surfaceV = vMin;
        break;
      case 1:
        enemy.surfaceU = Math.random();
        enemy.surfaceV = vMax;
        break;
      case 2:
        enemy.surfaceU = 0;
        enemy.surfaceV = randomV();
        break;
      case 3:
        enemy.surfaceU = 1;
        enemy.surfaceV = randomV();
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
    // NOTE: Ammo deduction is handled in tryShoot() per shot fired,
    // not per tick. This prevents burning through ammo 6x faster than
    // shots actually fire (60Hz tick vs 10Hz fire rate).
  }

  private wrapCoord(v: number): number {
    return ((v % 1) + 1) % 1;
  }

  private clampCoord(v: number): number {
    return Math.max(0, Math.min(1, v));
  }
}

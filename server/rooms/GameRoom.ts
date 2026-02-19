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

/** Wave entry returned by generateServerWave() */
interface WaveEntry {
  type: string;
  count: number;
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

// Wave scheduling constants (mirrors WaveScheduler in src/core/)
const WAVE_FIRST_AT = 6.0;       // first wave at 6s
const WAVE_INTERVAL_BASE = 7.0;  // base interval between waves
const WAVE_INTERVAL_MIN = 2.0;   // minimum interval (hard floor)
const WAVE_INTERVAL_DECAY = 0.2; // seconds shorter per wave

// Enemy-count limits (indexed by playerCount-1, capped at 4 players)
const MAX_ENEMIES_BY_PLAYER_COUNT = [30, 50, 70, 90];

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

// ---------------------------------------------------------------------------
// Wave generation type pools (mirrors DifficultyScaling.ts)
// All names match what DifficultyScaling uses; WAVE_TYPE_REMAP translates
// any that are absent from network-main.ts SERVER_TO_SPAWNER_TYPE.
// ---------------------------------------------------------------------------
const BASIC_TYPES_WAVE = ['grunt', 'wanderer', 'duck'];
const MID_TYPES_WAVE = ['weaver', 'spinner', 'rocket', 'neutron', 'mayfly', 'helix', 'swarm', 'lurker', 'orbiter', 'approach_glow'];
const HARD_TYPES_WAVE = ['snake', 'repulsor', 'gravity_well', 'spawner', 'cluster', 'fractal', 'phaser', 'stealth_stalker'];
const ELITE_TYPES_WAVE = ['gate', 'virus', 'painter'];
const SPLITTING_TYPES_WAVE = ['giant_wanderer', 'giant_rocket', 'giant_snake', 'giant_neutron', 'titan_grunt', 'titan_spinner', 'titan_weaver', 'splitter'];

// Map DifficultyScaling types that are not in network-main.ts SERVER_TO_SPAWNER_TYPE
// to the nearest supported equivalent.  After remapping every type the server
// sends is handled by the client's SERVER_TO_SPAWNER_TYPE map.
const WAVE_TYPE_REMAP: Record<string, string> = {
  // MID types without client mapping
  helix: 'spinner',
  swarm: 'grunt',
  lurker: 'snake',
  orbiter: 'wanderer',
  approach_glow: 'arrow',
  // HARD types without client mapping
  gravity_well: 'blackhole',
  cluster: 'spawner',
  fractal: 'spinner',
  phaser: 'mayfly',
  stealth_stalker: 'snake',
  // Splitting / giant types without client mapping
  giant_wanderer: 'titan_grunt',
  giant_rocket: 'titan_spinner',
  giant_snake: 'titan_weaver',
  giant_neutron: 'titan_grunt',
  splitter: 'titan_weaver',
};

export class GameRoom extends Room<GameState> {
  private nextBulletId = 0;
  private nextEnemyId = 0;
  private nextGeomId = 0;
  private nextPickupId = 0;
  private waveNumber = 0;

  // Wave scheduling state
  private waveElapsed = 0;
  private nextWaveAt = WAVE_FIRST_AT;

  // Per-player invincibility timers (sessionId → seconds remaining)
  private playerInvincibility: Map<string, number> = new Map();

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

    // First player to join (no host assigned yet) becomes host.
    // Using hostId === '' is more explicit than players.size === 0 and handles
    // edge cases like host transfer: if hostId was transferred, new joiners
    // won't accidentally overwrite the current host.
    if (this.state.hostId === '') {
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
      this.playerInvincibility.delete(client.sessionId);
    }

    // If the host left, try to transfer host to another player.
    // Previously this always closed the room, which meant any host disconnect
    // (including brief network hiccups) would kick all other players.
    // Now: transfer host if others are present, close only if room is empty.
    if (client.sessionId === this.state.hostId) {
      let newHostId = '';
      this.state.players.forEach((_p, key) => {
        if (!newHostId) newHostId = key;
      });

      if (newHostId) {
        this.state.hostId = newHostId;
        const newHostPlayer = this.state.players.get(newHostId);
        console.log(`[GameRoom] Host transferred to: ${newHostPlayer?.name || newHostId}`);
        // Broadcast so clients can update UI immediately (state patch also carries hostId)
        this.broadcast('host_changed', { hostId: newHostId });
      } else {
        // No remaining players — close the room
        console.log('[GameRoom] Host left with no other players, closing room');
        this.broadcast('host_left');
        this.disconnect();
        return;
      }
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

    // Reset wave scheduling state
    this.waveElapsed = 0;
    this.nextWaveAt = WAVE_FIRST_AT;
    this.playerInvincibility.clear();

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

    // Wave-based enemy spawning (replaces old per-2s individual spawn)
    this.tickWaves(dt);

    // Drain per-player invincibility timers
    this.drainInvincibility(dt);

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
      wanderer: 0.06,
      duck: 0.05,
      weaver: 0.10,
      spinner: 0.06,
      rocket: 0.14,
      neutron: 0.10,
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
      virus: 0.09,
      spawner: 0.04,
      painter: 0.08,
      titan_grunt: 0.05,
      titan_spinner: 0.04,
      titan_weaver: 0.06,
    };
    return speeds[type] ?? 0.07;
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

    // Player-enemy collisions (with invincibility check)
    this.state.players.forEach((player) => {
      if (!player.alive) return;

      // Skip player if currently invincible
      const invincible = this.playerInvincibility.get(player.id) ?? 0;
      if (invincible > 0) return;

      this.state.enemies.forEach((enemy) => {
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
            // Respawn at center and grant 2s invincibility (matches SP behavior)
            player.surfaceU = 0.5;
            player.surfaceV = 0.5;
            this.playerInvincibility.set(player.id, 2.0);
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
      wanderer: 25,
      duck: 25,
      weaver: 50,
      spinner: 100,
      rocket: 75,
      neutron: 75,
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
      virus: 150,
      spawner: 200,
      painter: 100,
      titan_grunt: 150,
      titan_spinner: 200,
      titan_weaver: 175,
    };
    return scores[type] ?? 25;
  }

  // ---------------------------------------------------------------------------
  // Wave scheduling (replaces old per-2s spawnEnemy logic)
  // ---------------------------------------------------------------------------

  /** Dynamic enemy cap: scales with player count to keep co-op fair. */
  private getMaxEnemies(): number {
    const playerCount = Math.max(1, this.state.players.size);
    const idx = Math.min(MAX_ENEMIES_BY_PLAYER_COUNT.length - 1, playerCount - 1);
    return MAX_ENEMIES_BY_PLAYER_COUNT[idx];
  }

  /**
   * Called every tick. Advances the wave timer and spawns a new wave when due.
   * Mirrors WaveScheduler behavior from src/core/DifficultyScaling.ts.
   */
  private tickWaves(dt: number) {
    this.waveElapsed += dt;

    // Only spawn a new wave when timer is due AND there's room for enemies.
    // If at max enemies, wait until some are killed before starting next wave.
    if (this.waveElapsed < this.nextWaveAt) return;
    if (this.state.enemies.length >= this.getMaxEnemies()) return;

    this.waveNumber++;
    this.state.waveNumber = this.waveNumber;
    this.setMetadata({
      surface: this.state.surfaceType,
      status: 'playing',
      wave: this.waveNumber,
    });
    console.log(`[GameRoom] Wave ${this.waveNumber} started (difficulty ${this.computeDifficultyLevel().toFixed(2)})`);

    const wave = this.generateServerWave();
    this.spawnWave(wave);

    // Decrease interval over time (same formula as WaveScheduler)
    const nextInterval = Math.max(WAVE_INTERVAL_MIN, WAVE_INTERVAL_BASE - this.waveNumber * WAVE_INTERVAL_DECAY);
    this.nextWaveAt = this.waveElapsed + nextInterval;
  }

  /**
   * Compute a simple difficulty level from wave number and elapsed game time.
   * Avoids dependency on score/kills/combo (not reliably aggregated server-side).
   * Calibration: wave 1 = 0.0, wave 10 ≈ 2.7, wave 20 ≈ 5.4, wave 27+ = 8.0 cap.
   */
  private computeDifficultyLevel(): number {
    const waveContrib = Math.max(0, (this.waveNumber - 1) * 0.3);
    const timeContrib = this.state.gameTime / 600; // +1 level per 10 minutes
    return Math.min(8.0, waveContrib + timeContrib);
  }

  /**
   * Generate a wave of enemies based on current wave number and difficulty.
   * Ported from generateScaledEndlessWave() in src/core/DifficultyScaling.ts.
   * Types are returned as-is (pre-remap); spawnWave() does the remapping.
   */
  private generateServerWave(): WaveEntry[] {
    const waveNum = this.waveNumber;
    const difficultyLevel = this.computeDifficultyLevel();
    const activeCount = this.state.enemies.length;
    const entries: WaveEntry[] = [];

    // Entity count soft brake (mirrors DifficultyScaling entityBrake)
    const brakeFloor = difficultyLevel >= 8 ? 0.60 : 0.40;
    const entityBrake = activeCount > 200
      ? Math.max(brakeFloor, 200 / activeCount)
      : 1.0;

    // Base count grows with wave number and difficulty
    const difficultyCountBonus = Math.floor(difficultyLevel * 2.0);
    const baseCountCap = difficultyLevel >= 6 ? 40 : 30;
    const baseCount = Math.min(baseCountCap,
      Math.round((4 + Math.floor(Math.sqrt(waveNum) * 2) + difficultyCountBonus) * entityBrake));

    const maxTier = Math.min(4, Math.floor(difficultyLevel));

    // Basic enemies: always present
    const basicType = BASIC_TYPES_WAVE[waveNum % BASIC_TYPES_WAVE.length];
    const basicTier = difficultyLevel >= 1 ? Math.min(maxTier, Math.max(0, maxTier - 1)) : 0;
    entries.push({ type: basicType, count: baseCount });
    void basicTier; // tier info not used server-side (no health multiplier implemented)

    // Mid-tier from wave 2+
    if (waveNum >= 2) {
      const midType = MID_TYPES_WAVE[(waveNum - 2) % MID_TYPES_WAVE.length];
      entries.push({ type: midType, count: Math.min(Math.floor(baseCount * 0.7), 15) });
    }

    // Hard enemies from wave 4+
    if (waveNum >= 4) {
      const hardType = HARD_TYPES_WAVE[(waveNum - 4) % HARD_TYPES_WAVE.length];
      entries.push({ type: hardType, count: Math.min(Math.floor(baseCount * 0.5), 10) });
    }

    // Splitting enemies from wave 5+ and difficulty 0.8+
    if (waveNum >= 5 && difficultyLevel >= 0.8) {
      const splitType = SPLITTING_TYPES_WAVE[(waveNum - 5) % SPLITTING_TYPES_WAVE.length];
      entries.push({
        type: splitType,
        count: Math.min(Math.round((1 + Math.floor(difficultyLevel * 0.7)) * entityBrake), 7),
      });
    }

    // Elite enemies from wave 6+
    if (waveNum >= 6) {
      const eliteType = ELITE_TYPES_WAVE[(waveNum - 6) % ELITE_TYPES_WAVE.length];
      entries.push({ type: eliteType, count: Math.min(Math.floor(baseCount * 0.4), 6) });
    }

    // At difficulty 1.5+: tiered color-variant basic enemies
    if (difficultyLevel >= 1.5) {
      const variantType = BASIC_TYPES_WAVE[(waveNum + 1) % BASIC_TYPES_WAVE.length];
      entries.push({
        type: variantType,
        count: Math.min(Math.round((6 + Math.floor(difficultyLevel * 1.5)) * entityBrake), 20),
      });
    }

    // At difficulty 2.5+: second hard group
    if (difficultyLevel >= 2.5) {
      const hardType2 = HARD_TYPES_WAVE[(waveNum + 3) % HARD_TYPES_WAVE.length];
      entries.push({ type: hardType2, count: Math.min(Math.floor(baseCount * 0.4), 8) });
    }

    // At difficulty 3.0+: splitting swarm
    if (difficultyLevel >= 3.0) {
      const swarmType = SPLITTING_TYPES_WAVE[(waveNum + 2) % SPLITTING_TYPES_WAVE.length];
      entries.push({
        type: swarmType,
        count: Math.min(Math.round((2 + Math.floor(difficultyLevel - 2.5)) * entityBrake), 8),
      });
    }

    // At difficulty 4.0+: second elite group
    if (difficultyLevel >= 4.0) {
      const eliteType2 = ELITE_TYPES_WAVE[(waveNum + 1) % ELITE_TYPES_WAVE.length];
      entries.push({
        type: eliteType2,
        count: Math.min(Math.round((3 + Math.floor(difficultyLevel - 4)) * entityBrake), 6),
      });
    }

    // At difficulty 6.0+: third hard group + boss-like splitting
    if (difficultyLevel >= 6.0) {
      const hardType3 = HARD_TYPES_WAVE[(waveNum + 5) % HARD_TYPES_WAVE.length];
      entries.push({ type: hardType3, count: Math.min(Math.round((4 + Math.floor(difficultyLevel - 6)) * entityBrake), 8) });
      const megaSplit = SPLITTING_TYPES_WAVE[(waveNum + 4) % SPLITTING_TYPES_WAVE.length];
      entries.push({ type: megaSplit, count: Math.min(Math.round(Math.floor(difficultyLevel - 5) * entityBrake), 5) });
    }

    return entries;
  }

  /**
   * Spawn all enemies from a wave, applying:
   *   - Type remapping (DifficultyScaling names → server-supported names)
   *   - Player-count scaling (more enemies for more players)
   *   - Max-enemy cap (never exceed getMaxEnemies())
   */
  private spawnWave(wave: WaveEntry[]) {
    const playerCount = Math.max(1, this.state.players.size);
    // Scale enemy counts with player count:
    // 1 player: 1.0x, 2 players: 1.5x, 3 players: 2.0x, 4 players: 2.5x
    const countMultiplier = 1.0 + (playerCount - 1) * 0.5;
    const maxEnemies = this.getMaxEnemies();

    for (const entry of wave) {
      const resolvedType = WAVE_TYPE_REMAP[entry.type] ?? entry.type;
      const scaledCount = Math.round(entry.count * countMultiplier);

      for (let i = 0; i < scaledCount; i++) {
        // Respect the max-enemy cap even within a single wave
        if (this.state.enemies.length >= maxEnemies) break;
        this.spawnSingleEnemy(resolvedType);
      }
    }
  }

  /**
   * Spawn a single enemy of the given type at a random edge position.
   * The type must already be resolved (i.e., present in SERVER_TO_SPAWNER_TYPE).
   */
  private spawnSingleEnemy(type: string) {
    const enemy = new EnemyState();
    enemy.id = `e${this.nextEnemyId++}`;
    enemy.type = type;

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

    enemy.health = this.getEnemyHealth(type);
    enemy.alive = true;

    this.state.enemies.push(enemy);
  }

  private getEnemyHealth(type: string): number {
    const health: Record<string, number> = {
      grunt: 1,
      arrow: 1,
      wanderer: 1,
      duck: 1,
      weaver: 2,
      spinner: 3,
      rocket: 1,
      neutron: 2,
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
      virus: 3,
      spawner: 4,
      painter: 2,
      titan_grunt: 5,
      titan_spinner: 8,
      titan_weaver: 6,
    };
    return health[type] ?? 1;
  }

  /** Drain per-player invincibility timers by dt each tick. */
  private drainInvincibility(dt: number) {
    this.playerInvincibility.forEach((remaining, id) => {
      const newRemaining = remaining - dt;
      if (newRemaining <= 0) {
        this.playerInvincibility.delete(id);
      } else {
        this.playerInvincibility.set(id, newRemaining);
      }
    });
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

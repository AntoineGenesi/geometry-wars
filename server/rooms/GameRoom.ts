import { Room, Client } from 'colyseus';
import {
  GameState,
  PlayerState,
  BulletState,
  EnemyState,
  GeomState,
  WeaponPickupState,
} from '../schema/GameState';
import fs from 'fs';
import path from 'path';
import Logger from '../logger';
import { createHash } from 'crypto';
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
  boost?: boolean;
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
// How far in advance (ms) the server warns clients before spawning an enemy.
// Clients show a pulsing red ring for this duration before the enemy appears.
const PRE_SPAWN_WARNING_MS = 1500;
const VOTING_COUNTDOWN_SECS = 30;
// Movement speed in UV units per second.
// Co-op uses MeshWalker at 3.0 world units/s. Surface radius = 10 (DEFAULT_SURFACE_SCALE).
// V direction arc = pi * 10 ≈ 31.4 world units. So 3.0 / (pi*10) ≈ 0.095 UV/s.
// (Old comment said "radius 5" — this was a bug; actual radius has always been 10.)
const PLAYER_SPEED = 0.095;
// Boost (sprint) constants — must match client-side Player.ts values.
const BOOST_DURATION = 0.5;       // seconds the speed boost lasts
const BOOST_COOLDOWN = 5.0;       // seconds between boosts
const BOOST_SPEED_MULTIPLIER = 3.0; // speed multiplier during boost
// Bullet speed in UV/s. Co-op bullets move at 4.0 world units/s.
// On a sphere of radius 10: 4.0 / (pi*10) ≈ 0.127 UV/s.
const BULLET_SPEED = 0.13;
const BULLET_LIFETIME = 3.0;

// Wave scheduling constants (mirrors WaveScheduler in src/core/)
const WAVE_FIRST_AT = 6.0;       // first wave at 6s
const WAVE_INTERVAL_BASE = 7.0;  // base interval between waves
const WAVE_INTERVAL_MIN = 2.0;   // minimum interval (hard floor)
const WAVE_INTERVAL_DECAY = 0.2; // seconds shorter per wave

// Inactivity tracking constants (auto-pause and shutdown)
const INACTIVITY_PAUSE_THRESHOLD = 120;      // 2 minutes (120 seconds) before auto-pause
const INACTIVITY_SHUTDOWN_THRESHOLD = 900;   // 15 minutes (900 seconds) before auto-shutdown

// Enemy-count limits (indexed by playerCount-1, capped at 4 players)
const MAX_ENEMIES_BY_PLAYER_COUNT = [30, 50, 70, 90];

// Player colors
const PLAYER_COLORS = [0x00ffff, 0xff00ff, 0x00ff00, 0xffff00];

// Spawn positions (shared between onJoin initial placement and startGame round reset)
const SPAWN_OFFSETS = [
  { u: 0.5, v: 0.5 },
  { u: 0.6, v: 0.5 },
  { u: 0.4, v: 0.5 },
  { u: 0.5, v: 0.6 },
];

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
// Startup config hash helpers
// ---------------------------------------------------------------------------

/** Payload sent to clients so they can cache static game config. */
interface StartupConfigPayload {
  weaponConfigs: typeof WEAPON_CONFIGS;
  serverVersion: string;
}

/**
 * Compute a stable SHA-256 hash of the static startup config.
 * Keys are sorted before serialization to ensure determinism.
 */
function computeStartupConfigHash(payload: StartupConfigPayload): string {
  const stable = JSON.stringify(payload, Object.keys(payload).sort());
  return createHash('sha256').update(stable).digest('hex').slice(0, 16);
}

/** Build version identifier — use git commit from env or a fallback constant. */
const SERVER_VERSION = process.env.GIT_COMMIT?.slice(0, 8) ?? 'dev';

/** Static startup config payload (same for all rooms). */
const STARTUP_CONFIG_PAYLOAD: StartupConfigPayload = {
  weaponConfigs: WEAPON_CONFIGS,
  serverVersion: SERVER_VERSION,
};

/** Pre-computed hash — stable for the lifetime of this server process. */
const STARTUP_CONFIG_HASH = computeStartupConfigHash(STARTUP_CONFIG_PAYLOAD);

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

// Server-side AI state for each live enemy. Not synced to clients.
interface ServerEnemyAI {
  // Grunt: acceleration ramp
  currentSpeed?: number;
  // Wanderer / Neutron: direction vector + change timer
  directionU?: number;
  directionV?: number;
  directionChangeTimer?: number;
  nextDirectionChange?: number;
  // Rocket / Arrow: straight-line direction (set once on spawn, changes on bounce)
  rocketDirU?: number;
  rocketDirV?: number;
  // Mayfly: jitter offset + timer
  jitterOffsetU?: number;
  jitterOffsetV?: number;
  jitterTimer?: number;
  // Orbiter: orbit angle, radius, direction, reverse timer
  orbitAngle?: number;
  orbitRadius?: number;
  orbitDirection?: number;
  reverseTimer?: number;
  nextReverse?: number;
  // Weaver: momentum
  momentumU?: number;
  momentumV?: number;
}

export class GameRoom extends Room<GameState> {
  private nextBulletId = 0;
  private nextEnemyId = 0;
  private metricsLogPath: string | null = null;
  private hostIsLocal: boolean = false;
  /** True when the current host joined with requestHost=true (navigated from the start menu). */
  private hostRequestedHost: boolean = false;
  private logger = new Logger(path.join(process.cwd(), 'logs', 'colyseus-server.log'));
  /** Per-session locality: tracks whether each connected player is a localhost client. */
  private clientLocality: Map<string, boolean> = new Map();
  /** Per-session requestHost flag: tracks who joined with requestHost=true. */
  private clientRequestedHost: Map<string, boolean> = new Map();
  private nextGeomId = 0;
  private nextPickupId = 0;
  private waveNumber = 0;

  // Wave scheduling state
  private waveElapsed = 0;
  private nextWaveAt = WAVE_FIRST_AT;

  // Inactivity tracking state (auto-pause and shutdown)
  private lastActivityTime = Date.now(); // Track last player activity (input, movement, etc.)
  private autoPausedTime: number | null = null; // Tracks when room was auto-paused for shutdown logic

  /**
   * Count of enemies that have been warned to clients (pre_spawn sent) but
   * not yet added to this.state.enemies (their setTimeout hasn't fired yet).
   * Used to accurately enforce the max-enemy cap: without this, spawnWave()
   * sends warnings for far more enemies than the cap allows, resulting in
   * phantom red dots with no corresponding spawns.
   */
  private pendingEnemyCount = 0;

  /**
   * Incremented each time a game starts. SetTimeouts capture this value; if
   * it changes (game restarted) they abort rather than pushing stale enemies
   * into the new game's state and corrupting pendingEnemyCount.
   */
  private spawnGeneration = 0;

  // Per-player invincibility timers (sessionId → seconds remaining)
  private playerInvincibility: Map<string, number> = new Map();

  // Per-enemy AI state (server-side only — not synced to clients)
  private enemyAI: Map<string, ServerEnemyAI> = new Map();

  /**
   * Latest input state per player. Updated on message receipt, consumed
   * in tick(). This decouples input send rate from movement speed:
   * movement is applied every tick (60Hz) regardless of how often the
   * client sends input. Previously, movement was applied per-message,
   * meaning 30Hz input = half speed, 60Hz input = full speed.
   */
  private playerInputs: Map<string, PlayerInput> = new Map();

  /** Per-player boost (sprint) state: active, timer, cooldown, and prev key held. */
  private playerBoostStates: Map<string, { active: boolean; timer: number; cooldown: number; prevHeld: boolean }> = new Map();

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

    this.onMessage('start', (client) => {
      // Only the host can start the game
      if (client.sessionId !== this.state.hostId) {
        this.logger.log(`[GameRoom] Non-host ${client.sessionId} tried to start game (host=${this.state.hostId})`);
        return;
      }
      // Initial game start: lobby → playing
      if (this.state.roomPhase === 'lobby') {
        this.startGame();
      }
    });

    this.onMessage('vote', (client, data: { choice: string }) => {
      if (this.state.roomPhase !== 'voting') return;
      if (typeof data.choice === 'string' && data.choice.length > 0) {
        this.state.voteMap.set(client.sessionId, data.choice);
        this.logger.log(`[GameRoom] ${client.sessionId} voted: ${data.choice}`);
      }
    });

    this.onMessage('host_set_pick_mode', (client, data: { pickMode: boolean }) => {
      if (client.sessionId !== this.state.hostId) return;
      this.state.hostPickMode = data.pickMode;
      this.logger.log(`[GameRoom] Host set pick mode: ${data.pickMode}`);
    });

    this.onMessage('host_launch', (client, data: { choice: string }) => {
      if (client.sessionId !== this.state.hostId) return;
      if (this.state.roomPhase !== 'voting') return;
      this.startGameWithSettings(data.choice);
    });

    this.onMessage('pause', (client, data: { paused: boolean }) => {
      if (client.sessionId !== this.state.hostId) return;
      this.state.isPaused = data.paused;
      this.logger.log(`[GameRoom] Game ${data.paused ? 'paused' : 'resumed'} by host`);
    });

    this.onMessage('end_game', (client) => {
      if (client.sessionId !== this.state.hostId) return;
      this.logger.log('[GameRoom] Host ended the game');
      this.broadcast('game_ended');
      this.disconnect();
    });

    // Client reports whether it has the startup config cached.
    // If it's a cache miss, send the full config so the client can cache it.
    this.onMessage('startup_cache_ack', (client, data: { hit: boolean }) => {
      if (!data.hit) {
        client.send('startup_config', STARTUP_CONFIG_PAYLOAD);
        this.logger.log(`[GameRoom] startup_config sent to ${client.sessionId} (cache miss)`);
      } else {
        this.logger.log(`[GameRoom] ${client.sessionId} used cached startup config`);
      }
    });

    // Use Colyseus's built-in simulation interval (triggers state patch broadcasting)
    this.setSimulationInterval((dt) => this.tick(), 1000 / TICK_RATE);

    // Patch rate controls how often state changes are broadcast to clients.
    // Lower = more responsive but more bandwidth. On LAN, bandwidth is not a
    // concern so we match the simulation rate (60Hz) for minimum perceived latency.
    // Previously 33ms/30Hz — caused bullets and entities to stutter because the
    // client only received updates every other frame. See decisions/lan-deep-audit-2026-02-11.md #4.
    this.setPatchRate(16); // Send patches every ~16ms (~60Hz, matches TICK_RATE)

    this.onMessage('clientMetrics', (client, data: Record<string, unknown>) => {
      this.handleClientMetrics(client, data);
    });

    // Initialize session metrics log file
    try {
      const sessionDate = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
      const logsDir = path.join(process.cwd(), 'logs');
      fs.mkdirSync(logsDir, { recursive: true });
      this.metricsLogPath = path.join(logsDir, `mp-perf-${this.roomId}-${sessionDate}.jsonl`);
      const header = JSON.stringify({
        _type: 'session_start',
        sessionId: this.roomId,
        timestamp: new Date().toISOString(),
        surfaceType: this.state.surfaceType,
      });
      fs.appendFileSync(this.metricsLogPath, header + '\n');
      this.logger.log(`[GameRoom] Metrics log: ${this.metricsLogPath}`);
    } catch (err) {
      this.logger.error('[GameRoom] Failed to initialize metrics log:', err);
      this.metricsLogPath = null;
    }

    this.logger.log(`[GameRoom] Created with surface: ${this.state.surfaceType}`);
  }

  onJoin(client: Client, options: { name?: string; requestHost?: boolean }) {
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

    // Determine if this client is connecting from localhost.
    // The server host always runs locally, so localhost clients should take
    // priority over LAN clients for the host role. This prevents a race
    // condition where the LAN player (phone/tablet) connects slightly before
    // the localhost player (the PC running the server) and incorrectly gets
    // the host role.
    const remoteAddr = (client as unknown as { remoteAddress?: string }).remoteAddress ?? '';
    const isLocalClient = remoteAddr === '127.0.0.1' || remoteAddr === '::1' || remoteAddr === '::ffff:127.0.0.1';
    const didRequestHost = options.requestHost === true;

    // Track locality and creator intent for this session.
    // Used in onLeave to correctly set flags when host role transfers.
    this.clientLocality.set(client.sessionId, isLocalClient);
    this.clientRequestedHost.set(client.sessionId, didRequestHost);

    if (this.state.hostId === '') {
      // First joiner — becomes host
      this.state.hostId = client.sessionId;
      this.hostIsLocal = isLocalClient;
      this.hostRequestedHost = didRequestHost;
      this.logger.log(`[GameRoom] ${player.name} is the host (local=${isLocalClient}, requestHost=${didRequestHost})`);
    } else {
      // Determine whether to promote this client to host.
      // Two separate promotion paths:
      // (A) Game creator (requestHost=true) can displace a non-creator, non-localhost host at
      //     ANY room phase. This handles the case where mobile joined first and started the game
      //     before the real creator connected — without this, the creator could never reclaim host
      //     because roomPhase never returns to 'lobby' after the first game start.
      // (B) Localhost client can promote over a plain LAN first-joiner, but ONLY during lobby
      //     to avoid disrupting an in-progress game.
      // Priority hierarchy: creator > localhost > plain LAN (first creator/localhost keeps host).
      const creatorCanPromote = didRequestHost && !this.hostIsLocal && !this.hostRequestedHost;
      const localhostCanPromote = isLocalClient && !this.hostIsLocal && !this.hostRequestedHost && this.state.roomPhase === 'lobby';
      if (creatorCanPromote || localhostCanPromote) {
        const prev = this.state.hostId;
        this.state.hostId = client.sessionId;
        this.hostIsLocal = isLocalClient;
        this.hostRequestedHost = didRequestHost;
        this.logger.log(`[GameRoom] Host promoted to ${didRequestHost ? 'creator' : 'localhost'} player: ${player.name} (was ${prev}, phase=${this.state.roomPhase})`);
        this.broadcast('host_changed', { hostId: client.sessionId });
      }
    }

    // Spawn at different positions based on player count
    const spawnPos = SPAWN_OFFSETS[this.state.players.size % SPAWN_OFFSETS.length];
    player.surfaceU = spawnPos.u;
    player.surfaceV = spawnPos.v;

    this.state.players.set(client.sessionId, player);

    // Send startup config hash — client will check its localStorage cache and
    // reply with startup_cache_ack { hit: true/false }.  If miss, we send the
    // full config payload so the client can cache it for future sessions.
    client.send('startup_hash', { hash: STARTUP_CONFIG_HASH });

    this.logger.log(`[GameRoom] ${player.name} joined (${client.sessionId})`);
    this.logger.log(`[GameRoom] State after join: players.size=${this.state.players.size}, surfaceType=${this.state.surfaceType}, gameStarted=${this.state.gameStarted}`);
    this.state.players.forEach((p, k) => {
      this.logger.log(`[GameRoom]   player ${k}: name=${p.name}, alive=${p.alive}, lives=${p.lives}`);
    });
  }

  onLeave(client: Client, consented: boolean) {
    const player = this.state.players.get(client.sessionId);
    if (player) {
      this.logger.log(`[GameRoom] ${player.name} left`);
      this.state.players.delete(client.sessionId);
      this.playerInputs.delete(client.sessionId);
      this.playerInvincibility.delete(client.sessionId);
      this.playerBoostStates.delete(client.sessionId);
    }
    // Remove locality and creator-intent tracking for this session
    this.clientLocality.delete(client.sessionId);
    this.clientRequestedHost.delete(client.sessionId);

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
        // Set hostIsLocal and hostRequestedHost from actual tracked values of the new host.
        // Previously always set false ("reset for safety"), which caused the
        // localhost-priority logic to incorrectly re-promote the original host
        // if they rejoined mid-game (clientLocality.get would have returned true).
        this.hostIsLocal = this.clientLocality.get(newHostId) ?? false;
        this.hostRequestedHost = this.clientRequestedHost.get(newHostId) ?? false;
        const newHostPlayer = this.state.players.get(newHostId);
        this.logger.log(`[GameRoom] Host transferred to: ${newHostPlayer?.name || newHostId} (local=${this.hostIsLocal}, requestHost=${this.hostRequestedHost})`);
        // If the game was paused by the outgoing host, unpause so the new host
        // doesn't inherit a frozen game they didn't create and can't easily recover.
        if (this.state.isPaused) {
          this.state.isPaused = false;
          this.logger.log('[GameRoom] Unpaused game on host transfer');
        }
        // Broadcast so clients can update UI immediately (state patch also carries hostId)
        this.broadcast('host_changed', { hostId: newHostId });
      } else {
        // No remaining players — close the room
        this.logger.log('[GameRoom] Host left with no other players, closing room');
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
    if (this.metricsLogPath) {
      try {
        const footer = JSON.stringify({
          _type: 'session_end',
          sessionId: this.roomId,
          timestamp: new Date().toISOString(),
          gameTime: this.state.gameTime,
          waveNumber: this.waveNumber,
        });
        fs.appendFileSync(this.metricsLogPath, footer + '\n');
      } catch {
        // Ignore errors on dispose
      }
    }
    this.logger.log('[GameRoom] Disposed');
  }

  private handleClientMetrics(client: Client, data: Record<string, unknown>): void {
    if (!this.metricsLogPath) return;
    const player = this.state.players.get(client.sessionId);
    const entry = JSON.stringify({
      _type: 'metrics',
      sessionId: this.roomId,
      timestamp: new Date().toISOString(),
      playerId: client.sessionId,
      playerName: player?.name ?? 'unknown',
      mapSize: this.state.mapSize,
      ...data,
    });
    try {
      fs.appendFileSync(this.metricsLogPath, entry + '\n');
    } catch (err) {
      this.logger.error('[GameRoom] Failed to write metrics entry:', err);
      this.metricsLogPath = null;
    }
  }

  private startGameWithSettings(choice: string) {
    const parts = choice.split(':');
    const surface = parts[0] || this.state.surfaceType;
    // Safety guard: only accept implemented modes; fall back to 'waves' for unknown modes
    const VALID_MODES = ['waves'];
    const mode = VALID_MODES.includes(parts[1]) ? parts[1] : 'waves';
    const size = parts[2] || 'medium';
    this.state.surfaceType = surface;
    this.state.gameMode = mode;
    this.state.mapSize = size;
    this.startGame();
  }

  private startGame() {
    this.state.roomPhase = 'playing';
    this.state.gameStarted = true;   // backward compat
    this.state.gameOver = false;     // backward compat
    this.state.isPaused = false;     // always start unpaused (guards stale pause from previous round)
    this.state.waveNumber = 0;
    this.state.gameTime = 0;
    this.waveNumber = 0;

    // Reset wave scheduling state
    this.waveElapsed = 0;
    this.nextWaveAt = WAVE_FIRST_AT;
    this.playerInvincibility.clear();

    // Invalidate any pending spawn timeouts from the previous game.
    // Bumping spawnGeneration causes old setTimeouts to abort when they fire.
    this.spawnGeneration++;
    this.pendingEnemyCount = 0;

    // Reset all players
    let spawnIdx = 0;
    this.state.players.forEach((player) => {
      player.lives = 3;
      player.bombs = 3;
      player.score = 0;
      player.multiplier = 1;
      player.alive = true;
      player.weaponType = 'standard';
      player.weaponAmmo = -1;
      // Reset lastShotTime so the player can shoot immediately in the new game.
      // gameTime resets to 0 on new round; without this reset, lastShotTime from
      // the previous game (e.g. 45.6s) causes tryShoot() to block shots for the
      // entire duration of the new game (now - lastShot < 0 → never fires).
      (player as unknown as { lastShotTime?: number }).lastShotTime = undefined;
      // Reset position to spawn offsets so players don't start a new round at
      // their final position from the previous game (which could be near enemies
      // or off-screen, causing apparent teleportation at round start).
      const spawnPos = SPAWN_OFFSETS[spawnIdx % SPAWN_OFFSETS.length];
      player.surfaceU = spawnPos.u;
      player.surfaceV = spawnPos.v;
      spawnIdx++;
    });

    // Clear entities
    this.state.bullets.clear();
    this.state.enemies.clear();
    this.enemyAI.clear();
    this.state.geoms.clear();
    this.state.weaponPickups.clear();

    this.setMetadata({
      surface: this.state.surfaceType,
      status: 'playing',
      wave: 0,
    });

    this.logger.log('[GameRoom] Game started!');
  }

  private handleInput(client: Client, input: PlayerInput) {
    const player = this.state.players.get(client.sessionId);
    if (!player || !player.alive) return;

    // Update last activity timestamp — player provided input
    this.lastActivityTime = Date.now();
    // Clear auto-paused flag and resume game if it was auto-paused
    if (this.autoPausedTime !== null) {
      this.autoPausedTime = null;
      this.state.isPaused = false;
      this.logger.log('[GameRoom] Game resumed — player activity detected after auto-pause');
    }

    // Store the latest input. Movement will be applied in tick() at a
    // consistent 60Hz, decoupling movement speed from input send rate.
    this.playerInputs.set(client.sessionId, input);

    // Apply aim angle immediately (no movement dependency)
    player.aimAngle = input.aimAngle;

    // Handle bomb immediately (one-shot action, not continuous)
    if (input.bomb && player.bombs > 0) {
      this.useBomb(player);
    }

    // Boost: detect leading edge of Shift key and activate if cooldown ready.
    // Leading-edge detection prevents continuous activation while key is held.
    const boostState = this.playerBoostStates.get(client.sessionId)
      ?? { active: false, timer: 0, cooldown: 0, prevHeld: false };
    const boostHeld = input.boost ?? false;
    const boostJustPressed = boostHeld && !boostState.prevHeld;
    boostState.prevHeld = boostHeld;
    if (boostJustPressed && boostState.cooldown <= 0) {
      boostState.active = true;
      boostState.timer = BOOST_DURATION;
      boostState.cooldown = BOOST_COOLDOWN;
    }
    this.playerBoostStates.set(client.sessionId, boostState);
  }

  /**
   * Apply stored input as movement. Called once per tick (60Hz).
   * This ensures movement speed is consistent regardless of client input rate.
   */
  private applyPlayerMovement(dt: number) {
    this.playerInputs.forEach((input, clientId) => {
      const player = this.state.players.get(clientId);
      if (!player || !player.alive) return;

      // Tick boost timer and cooldown; apply speed multiplier while boost is active.
      const boostState = this.playerBoostStates.get(clientId);
      let speedMultiplier = 1.0;
      if (boostState) {
        if (boostState.active) {
          boostState.timer -= dt;
          if (boostState.timer <= 0) {
            boostState.active = false;
            boostState.timer = 0;
          } else {
            speedMultiplier = BOOST_SPEED_MULTIPLIER;
          }
        }
        if (boostState.cooldown > 0) {
          boostState.cooldown -= dt;
          if (boostState.cooldown < 0) boostState.cooldown = 0;
        }
      }

      const dx = input.moveX * PLAYER_SPEED * speedMultiplier * dt;
      const dy = input.moveY * PLAYER_SPEED * speedMultiplier * dt;

      // Apply metric corrections for sphere-like and peanut surfaces
      const surfaceType = this.state.surfaceType;
      const isSphereLike = surfaceType === 'sphere' || surfaceType === 'sphere-tunnel'
        || surfaceType === 'icosahedron' || surfaceType === 'capsule';

      let correctedDx = dx;
      let correctedDy = dy;
      if (isSphereLike) {
        const phi = player.surfaceV * Math.PI;
        const sinPhi = Math.sin(phi);
        const clampedSinPhi = Math.max(sinPhi, 0.3);
        correctedDx = dx / clampedSinPhi;
      } else if (surfaceType === 'peanut') {
        // Peanut: surface of revolution with r(phi) = R*(1 + waistDepth*cos(2*phi)).
        // Both U and V need metric corrections to maintain constant world-space speed.
        // U correction: dx / (rNorm * sinPhi)
        // V correction: dy / sqrt(rNorm^2 + drNorm^2)  (arc length along meridian)
        const PEANUT_WAIST_DEPTH = 0.4;
        const phi = player.surfaceV * Math.PI;
        const rNorm = 1 + PEANUT_WAIST_DEPTH * Math.cos(2 * phi);
        const drNorm = -2 * PEANUT_WAIST_DEPTH * Math.sin(2 * phi);
        const sinPhi = Math.sin(phi);
        correctedDx = dx / Math.max(rNorm * sinPhi, 0.1);
        correctedDy = dy / Math.max(Math.sqrt(rNorm * rNorm + drNorm * drNorm), 0.1);
      }
      // Torus: negate U-delta because TorusSurface uses negated tangentU for a right-handed
      // frame. Increasing U moves toward the old (left-handed) tangentU = camera left.
      // Negating corrects so moveX>0 (D key) moves player in camera-right direction.
      if (surfaceType === 'torus') {
        correctedDx = -correctedDx;
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
      } else if (surfaceType === 'sphere') {
        // Sphere poles: allow traversal by reflecting V through the pole.
        // When V goes below 0, the player crosses the north pole — reflect V and
        // shift U by 0.5 (continue to the antipodal longitude on the other side).
        // Same logic applies at the south pole (V > 1).
        let newV = player.surfaceV + dy;
        let newU = player.surfaceU; // already wrapped above
        if (newV < 0) {
          newV = -newV;
          newU = this.wrapCoord(newU + 0.5);
        } else if (newV > 1) {
          newV = 2 - newV;
          newU = this.wrapCoord(newU + 0.5);
        }
        // Keep V strictly inside (0, 1) to avoid degenerate tangent at exact pole
        player.surfaceV = Math.max(0.001, Math.min(0.999, newV));
        player.surfaceU = newU;
      } else {
        // Clamp V: use 0.003 for cube (matching CubeSurface epsilon),
        // 0.05 for other sphere-like (avoids pole singularity on non-sphere surfaces).
        // Use correctedDy for peanut (metric-corrected), dy for others.
        const vMin = surfaceType === 'cube' ? 0.003 : 0.05;
        const vMax = surfaceType === 'cube' ? 0.997 : 0.95;
        player.surfaceV = Math.max(vMin, Math.min(vMax, player.surfaceV + correctedDy));
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
        this.enemyAI.delete(enemy.id);
        enemiesToRemove.push(index);

        // Geoms removed (s27g-geons-point-pickups-remove-mp)
        // this.spawnGeom(enemy.surfaceU, enemy.surfaceV);

        // Add score
        player.score += 100 * player.multiplier;
      }
    });

    // Remove dead enemies (iterate in reverse)
    for (let i = enemiesToRemove.length - 1; i >= 0; i--) {
      this.state.enemies.splice(enemiesToRemove[i], 1);
    }

    this.logger.log(`[GameRoom] ${player.name} used bomb, killed ${enemiesToRemove.length} enemies`);
    // NOTE: Geoms are not spawned (removed in s27g-geons-point-pickups-remove-mp)
  }

  private tick() {
    // Check for inactivity and auto-pause/shutdown
    this.checkInactivity();

    if (this.state.roomPhase === 'playing' && !this.state.isPaused) {
      this.tickGame();
    } else if (this.state.roomPhase === 'voting' && !this.state.hostPickMode) {
      this.tickVoting();
    }
  }

  private tickGame() {
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

  private tickVoting() {
    const dt = 1 / TICK_RATE;

    // Auto-launch immediately when all connected players have voted
    const playerCount = this.state.players.size;
    if (playerCount > 0 && this.state.voteMap.size >= playerCount) {
      const choice = this.pickMostVoted();
      this.logger.log(`[GameRoom] All ${playerCount} players voted — auto-launching with: ${choice}`);
      this.startGameWithSettings(choice);
      return;
    }

    this.state.votingCountdown = Math.max(0, this.state.votingCountdown - dt);
    if (this.state.votingCountdown <= 0) {
      const choice = this.pickMostVoted();
      this.logger.log(`[GameRoom] Voting countdown ended — auto-launching with: ${choice}`);
      this.startGameWithSettings(choice);
    }
  }

  /** Pick the most-voted choice from voteMap. Falls back to current surface:waves:medium. */
  private pickMostVoted(): string {
    const counts = new Map<string, number>();
    this.state.voteMap.forEach((choice) => {
      counts.set(choice, (counts.get(choice) ?? 0) + 1);
    });

    if (counts.size === 0) {
      return `${this.state.surfaceType}:waves:medium`;
    }

    let bestChoice = '';
    let bestCount = 0;
    counts.forEach((count, choice) => {
      if (count > bestCount) {
        bestCount = count;
        bestChoice = choice;
      }
    });
    return bestChoice;
  }

  private updateBullets(dt: number) {
    const bulletsToRemove: number[] = [];

    // Compute once per tick — same surface type check as applyPlayerMovement()
    const surfType = this.state.surfaceType;
    // Note: 'peanut' removed from isSphereLike — gets separate 2-axis metric correction below.
    const isSphereLike = surfType === 'sphere' || surfType === 'sphere-tunnel'
      || surfType === 'icosahedron' || surfType === 'capsule';
    const isPeanut = surfType === 'peanut';

    this.state.bullets.forEach((bullet, index) => {
      bullet.age += dt;

      if (isPeanut) {
        // Peanut surface: 2-axis metric correction.
        // Profile: r(phi) = R*(1 + w*cos(2*phi)), where R=baseRadius, w=waistDepth.
        // Since server only has UV coords (not absolute scale), normalize by R:
        //   rNorm = 1 + w*cos(2*phi)  (profile radius relative to R)
        //   drNorm = -2*w*sin(2*phi)  (profile derivative relative to R)
        // U metric (arc length per unit theta change): rNorm * sin(phi)
        // V metric (arc length per unit phi change):  sqrt(rNorm^2 + drNorm^2)
        // Dividing each dir component by its metric gives equal world-space step size.
        const PEANUT_WAIST_DEPTH = 0.4;
        const phi = bullet.y * Math.PI;
        const rNorm = 1 + PEANUT_WAIST_DEPTH * Math.cos(2 * phi);
        const drNorm = -2 * PEANUT_WAIST_DEPTH * Math.sin(2 * phi);
        const sinPhi = Math.sin(phi);
        const metricU = Math.max(rNorm * sinPhi, 0.1);
        const metricV = Math.max(Math.sqrt(rNorm * rNorm + drNorm * drNorm), 0.1);
        bullet.x += (bullet.dirX / metricU) * BULLET_SPEED * dt;
        bullet.y += (bullet.dirY / metricV) * BULLET_SPEED * dt;
      } else {
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
      }

      // Wrap/clamp coordinates. U always wraps. V wraps on torus-like surfaces,
      // clamps on sphere-like surfaces (avoids pole singularity).
      bullet.x = this.wrapCoord(bullet.x);
      if (this.surfaceWrapsV()) {
        bullet.y = this.wrapCoord(bullet.y);
      } else {
        bullet.y = this.clampCoord(bullet.y);
      }

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
    const wrapsV = this.surfaceWrapsV();
    const surfType = this.state.surfaceType;

    this.state.enemies.forEach((enemy) => {
      if (!enemy.alive) return;

      const ai = this.enemyAI.get(enemy.id) ?? {};
      const nearestPlayer = this.findNearestPlayer(enemy.surfaceU, enemy.surfaceV);

      switch (enemy.type) {
        case 'grunt':
          this.updateGrunt(enemy, ai, nearestPlayer, dt, wrapsV, surfType);
          break;
        case 'wanderer':
          this.updateWanderer(enemy, ai, dt, wrapsV, surfType);
          break;
        case 'neutron':
          this.updateNeutron(enemy, ai, dt, wrapsV, surfType);
          break;
        case 'rocket':
        case 'arrow':
          this.updateRocket(enemy, ai, dt, wrapsV, surfType);
          break;
        case 'mayfly':
          this.updateMayfly(enemy, ai, nearestPlayer, dt, wrapsV, surfType);
          break;
        case 'weaver':
          this.updateWeaver(enemy, ai, nearestPlayer, dt, wrapsV, surfType);
          break;
        default:
          this.updateDefaultChase(enemy, ai, nearestPlayer, dt, wrapsV, surfType);
          break;
      }

      // Persist updated AI state
      this.enemyAI.set(enemy.id, ai);
    });
  }

  private findNearestPlayer(u: number, v: number): PlayerState | null {
    let nearest: PlayerState | null = null;
    let nearestDist = Infinity;
    this.state.players.forEach((p) => {
      if (!p.alive) return;
      const d = this.uvDistWrapped(u, v, p.surfaceU, p.surfaceV);
      if (d < nearestDist) { nearestDist = d; nearest = p; }
    });
    return nearest;
  }

  /** Grunt: accelerates toward nearest player over time */
  private updateGrunt(
    enemy: EnemyState, ai: ServerEnemyAI, player: PlayerState | null,
    dt: number, wrapsV: boolean, surfType: string
  ): void {
    ai.currentSpeed = Math.min(0.06, (ai.currentSpeed ?? 0.02) + 0.002 * dt);
    if (!player) return;
    const du = this.uvDelta(enemy.surfaceU, player.surfaceU, true);
    const dv = this.uvDelta(enemy.surfaceV, player.surfaceV, wrapsV);
    const dist = Math.sqrt(du * du + dv * dv);
    if (dist > 0.01) {
      enemy.surfaceU += (du / dist) * ai.currentSpeed * dt;
      enemy.surfaceV += (dv / dist) * ai.currentSpeed * dt;
      this.applyUVBounds(enemy, wrapsV, surfType);
    }
  }

  /** Wanderer: moves in random direction, bounces off UV boundaries, changes direction periodically */
  private updateWanderer(
    enemy: EnemyState, ai: ServerEnemyAI,
    dt: number, wrapsV: boolean, surfType: string
  ): void {
    // Initialize direction if not set
    if (ai.directionU === undefined || ai.directionV === undefined) {
      const angle = Math.random() * Math.PI * 2;
      ai.directionU = Math.cos(angle);
      ai.directionV = Math.sin(angle);
      ai.directionChangeTimer = 0;
      ai.nextDirectionChange = 1 + Math.random();
    }

    ai.directionChangeTimer = (ai.directionChangeTimer ?? 0) + dt;
    if (ai.directionChangeTimer >= (ai.nextDirectionChange ?? 1)) {
      const angle = Math.random() * Math.PI * 2;
      ai.directionU = Math.cos(angle);
      ai.directionV = Math.sin(angle);
      ai.directionChangeTimer = 0;
      ai.nextDirectionChange = 1 + Math.random();
    }

    const WANDER_SPEED = 0.04;
    enemy.surfaceU += ai.directionU * WANDER_SPEED * dt;
    enemy.surfaceV += ai.directionV * WANDER_SPEED * dt;

    // Bounce off U boundaries
    if (enemy.surfaceU <= 0) {
      enemy.surfaceU = 0;
      ai.directionU = Math.abs(ai.directionU);
    } else if (enemy.surfaceU >= 1) {
      enemy.surfaceU = 1;
      ai.directionU = -Math.abs(ai.directionU);
    }

    // Bounce off V boundaries (or wrap on torus-like surfaces)
    if (wrapsV) {
      enemy.surfaceV = this.wrapCoord(enemy.surfaceV);
    } else {
      if (enemy.surfaceV <= 0) {
        enemy.surfaceV = 0;
        ai.directionV = Math.abs(ai.directionV);
      } else if (enemy.surfaceV >= 1) {
        enemy.surfaceV = 1;
        ai.directionV = -Math.abs(ai.directionV);
      }
    }
  }

  /** Neutron: flies in straight line, bounces randomly off boundaries */
  private updateNeutron(
    enemy: EnemyState, ai: ServerEnemyAI,
    dt: number, wrapsV: boolean, surfType: string
  ): void {
    if (ai.directionU === undefined || ai.directionV === undefined) {
      const angle = Math.random() * Math.PI * 2;
      ai.directionU = Math.cos(angle);
      ai.directionV = Math.sin(angle);
    }

    const NEUTRON_SPEED = 0.05;
    enemy.surfaceU += ai.directionU * NEUTRON_SPEED * dt;
    enemy.surfaceV += ai.directionV * NEUTRON_SPEED * dt;

    let bounced = false;
    if (enemy.surfaceU <= 0) { enemy.surfaceU = 0; bounced = true; }
    else if (enemy.surfaceU >= 1) { enemy.surfaceU = 1; bounced = true; }

    if (wrapsV) {
      enemy.surfaceV = this.wrapCoord(enemy.surfaceV);
    } else {
      if (enemy.surfaceV <= 0) { enemy.surfaceV = 0; bounced = true; }
      else if (enemy.surfaceV >= 1) { enemy.surfaceV = 1; bounced = true; }
    }

    if (bounced) {
      const angle = Math.random() * Math.PI * 2;
      ai.directionU = Math.cos(angle);
      ai.directionV = Math.sin(angle);
    }
  }

  /** Rocket/Arrow: flies in straight line at high speed, reflects off boundaries */
  private updateRocket(
    enemy: EnemyState, ai: ServerEnemyAI,
    dt: number, wrapsV: boolean, surfType: string
  ): void {
    if (ai.rocketDirU === undefined || ai.rocketDirV === undefined) {
      const angle = Math.random() * Math.PI * 2;
      ai.rocketDirU = Math.cos(angle);
      ai.rocketDirV = Math.sin(angle);
    }

    const ROCKET_SPEED = 0.07;
    enemy.surfaceU += ai.rocketDirU * ROCKET_SPEED * dt;
    enemy.surfaceV += ai.rocketDirV * ROCKET_SPEED * dt;

    if (enemy.surfaceU <= 0) {
      enemy.surfaceU = 0;
      ai.rocketDirU = Math.abs(ai.rocketDirU);
    } else if (enemy.surfaceU >= 1) {
      enemy.surfaceU = 1;
      ai.rocketDirU = -Math.abs(ai.rocketDirU);
    }

    if (wrapsV) {
      enemy.surfaceV = this.wrapCoord(enemy.surfaceV);
    } else {
      if (enemy.surfaceV <= 0) {
        enemy.surfaceV = 0;
        ai.rocketDirV = Math.abs(ai.rocketDirV);
      } else if (enemy.surfaceV >= 1) {
        enemy.surfaceV = 1;
        ai.rocketDirV = -Math.abs(ai.rocketDirV);
      }
    }
  }

  /** Mayfly: chases player with periodic jitter offset (swarm effect) */
  private updateMayfly(
    enemy: EnemyState, ai: ServerEnemyAI, player: PlayerState | null,
    dt: number, wrapsV: boolean, surfType: string
  ): void {
    ai.jitterTimer = (ai.jitterTimer ?? 0) + dt;
    if (ai.jitterTimer >= 0.3) {
      ai.jitterOffsetU = (Math.random() - 0.5) * 0.1;
      ai.jitterOffsetV = (Math.random() - 0.5) * 0.1;
      ai.jitterTimer = 0;
    }

    if (!player) return;
    const targetU = player.surfaceU + (ai.jitterOffsetU ?? 0);
    const targetV = player.surfaceV + (ai.jitterOffsetV ?? 0);
    const du = this.uvDelta(enemy.surfaceU, targetU, true);
    const dv = this.uvDelta(enemy.surfaceV, targetV, wrapsV);
    const dist = Math.sqrt(du * du + dv * dv);
    if (dist > 0.001) {
      const MAYFLY_SPEED = 0.095;
      enemy.surfaceU += (du / dist) * MAYFLY_SPEED * dt;
      enemy.surfaceV += (dv / dist) * MAYFLY_SPEED * dt;
      this.applyUVBounds(enemy, wrapsV, surfType);
    }
  }

  /** Weaver: momentum-based chase with friction — overshoots and weaves */
  private updateWeaver(
    enemy: EnemyState, ai: ServerEnemyAI, player: PlayerState | null,
    dt: number, wrapsV: boolean, surfType: string
  ): void {
    ai.momentumU = ai.momentumU ?? 0;
    ai.momentumV = ai.momentumV ?? 0;

    if (player) {
      const du = this.uvDelta(enemy.surfaceU, player.surfaceU, true);
      const dv = this.uvDelta(enemy.surfaceV, player.surfaceV, wrapsV);
      const dist = Math.sqrt(du * du + dv * dv);
      if (dist > 0.01) {
        ai.momentumU += (du / dist) * 0.3 * dt;
        ai.momentumV += (dv / dist) * 0.3 * dt;
      }
    }

    // Apply friction
    ai.momentumU *= 0.92;
    ai.momentumV *= 0.92;

    // Cap speed
    const spd = Math.sqrt(ai.momentumU * ai.momentumU + ai.momentumV * ai.momentumV);
    if (spd > 0.04) {
      ai.momentumU = (ai.momentumU / spd) * 0.04;
      ai.momentumV = (ai.momentumV / spd) * 0.04;
    }

    enemy.surfaceU += ai.momentumU * dt;
    enemy.surfaceV += ai.momentumV * dt;
    this.applyUVBounds(enemy, wrapsV, surfType);
  }

  /** Default: flat-speed chase toward nearest player (used for snake, gate, blackhole, repulsor, etc.) */
  private updateDefaultChase(
    enemy: EnemyState, ai: ServerEnemyAI, player: PlayerState | null,
    dt: number, wrapsV: boolean, surfType: string
  ): void {
    if (!player) return;
    const du = this.uvDelta(enemy.surfaceU, player.surfaceU, true);
    const dv = this.uvDelta(enemy.surfaceV, player.surfaceV, wrapsV);
    const dist = Math.sqrt(du * du + dv * dv);
    if (dist > 0.01) {
      const speed = this.getEnemySpeed(enemy.type);
      enemy.surfaceU += (du / dist) * speed * dt;
      enemy.surfaceV += (dv / dist) * speed * dt;
      this.applyUVBounds(enemy, wrapsV, surfType);
    }
  }

  /** Apply UV boundary wrapping/clamping after movement */
  private applyUVBounds(enemy: EnemyState, wrapsV: boolean, surfType: string): void {
    enemy.surfaceU = this.wrapCoord(enemy.surfaceU);
    if (wrapsV) {
      enemy.surfaceV = this.wrapCoord(enemy.surfaceV);
    } else {
      const enemyVMin = surfType === 'cube' ? 0.003 : 0.05;
      const enemyVMax = surfType === 'cube' ? 0.997 : 0.95;
      enemy.surfaceV = Math.max(enemyVMin, Math.min(enemyVMax, enemy.surfaceV));
    }
  }

  /** Create initial AI state for a newly spawned enemy */
  private createEnemyAI(type: string): ServerEnemyAI {
    switch (type) {
      case 'grunt':
        return { currentSpeed: 0.02 };
      case 'wanderer': {
        const angle = Math.random() * Math.PI * 2;
        return {
          directionU: Math.cos(angle),
          directionV: Math.sin(angle),
          directionChangeTimer: 0,
          nextDirectionChange: 1 + Math.random(),
        };
      }
      case 'neutron': {
        const angle = Math.random() * Math.PI * 2;
        return {
          directionU: Math.cos(angle),
          directionV: Math.sin(angle),
        };
      }
      case 'rocket':
      case 'arrow': {
        const angle = Math.random() * Math.PI * 2;
        return {
          rocketDirU: Math.cos(angle),
          rocketDirV: Math.sin(angle),
        };
      }
      case 'mayfly':
        return {
          jitterOffsetU: (Math.random() - 0.5) * 0.1,
          jitterOffsetV: (Math.random() - 0.5) * 0.1,
          jitterTimer: 0,
        };
      case 'weaver':
        return { momentumU: 0, momentumV: 0 };
      default:
        return {};
    }
  }

  private getEnemySpeed(type: string): number {
    // Enemy speeds in UV/s. Scaled to match PLAYER_SPEED = 0.095.
    // Ratio: enemies should be somewhat slower than the player so the game
    // is playable. These values match the relative speeds from co-op.
    // All speeds halved from old values (old comment had wrong radius=5; actual=10).
    const speeds: Record<string, number> = {
      grunt: 0.035,
      arrow: 0.07,
      wanderer: 0.03,
      duck: 0.025,
      weaver: 0.05,
      spinner: 0.03,
      rocket: 0.07,
      neutron: 0.05,
      snake: 0.06,
      gate: 0.025,
      blackhole: 0.012,
      repulsor: 0.04,
      mayfly: 0.095,
      proton: 0.05,
      ufo: 0.025,
      mines: 0,
      mutator: 0.035,
      bubbles: 0.03,
      spawnlet: 0.06,
      virus: 0.045,
      spawner: 0.02,
      painter: 0.04,
      titan_grunt: 0.025,
      titan_spinner: 0.02,
      titan_weaver: 0.03,
    };
    return speeds[type] ?? 0.035;
  }

  private checkCollisions() {
    // Bullet-enemy collisions
    const bulletsToRemove: number[] = [];
    const enemiesToRemove: number[] = [];

    this.state.bullets.forEach((bullet, bIndex) => {
      this.state.enemies.forEach((enemy, eIndex) => {
        if (!enemy.alive) return;

        // Use wrap-aware UV distance so bullets crossing the U or V seam
        // still hit enemies on the other side (critical on torus where both axes wrap).
        const dist = this.uvDistWrapped(bullet.x, bullet.y, enemy.surfaceU, enemy.surfaceV);

        // S28b: UV-space hit threshold calibrated to match visual enemy size.
        // Sphere radius=10 → V arc length = π*10 ≈ 31.4 world units per UV unit.
        // Enemy visual radius ≈ 0.25 world units → 0.25 / 31.4 ≈ 0.008 UV.
        // Using 0.012 (1.5x) as tolerance for discrete bullet step size (~0.002 UV/tick).
        // Previous value 0.05 = ~1.57 world units = 6x visual size → enemies died from far away.
        if (dist < 0.012) {
          // Hit! Apply weapon damage multiplier
          const owner = this.state.players.get(bullet.ownerId);
          const weaponCfg = WEAPON_CONFIGS[owner?.weaponType ?? 'standard'] ?? WEAPON_CONFIGS.standard;
          const damage = Math.ceil(weaponCfg.damageMultiplier);
          enemy.health -= damage;

          if (enemy.health <= 0) {
            enemy.alive = false;
            this.enemyAI.delete(enemy.id);
            enemiesToRemove.push(eIndex);

            if (owner) {
              owner.score += this.getEnemyScore(enemy.type) * owner.multiplier;
            }

            // Geoms removed (s27g-geons-point-pickups-remove-mp)
            // this.spawnGeom(enemy.surfaceU, enemy.surfaceV);

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
    // hitEnemyIds: prevents one enemy from draining lives from multiple players
    // in the same tick. Each enemy can hit at most one player per tick.
    const hitEnemyIds = new Set<string>();

    this.state.players.forEach((player) => {
      if (!player.alive) return;

      // Skip player if currently invincible
      const invincible = this.playerInvincibility.get(player.id) ?? 0;
      if (invincible > 0) return;

      // Prevent multi-hit: only allow one enemy to hit this player per tick.
      // Without this flag, a player surrounded by enemies could lose all lives
      // in a single tick (e.g. 3 enemies → instant death from 3 lives), bypassing
      // the respawn-with-invincibility protection. wasHit ensures only the first
      // enemy collision per tick is processed; the rest are skipped.
      let wasHit = false;

      this.state.enemies.forEach((enemy) => {
        if (!enemy.alive) return;
        if (wasHit) return; // Only one hit per player per tick
        if (hitEnemyIds.has(enemy.id)) return; // Each enemy hits at most one player per tick

        // Use wrap-aware UV distance so collision works across seams on torus.
        const dist = this.uvDistWrapped(player.surfaceU, player.surfaceV, enemy.surfaceU, enemy.surfaceV);

        if (dist < 0.04) {
          // Player hit!
          wasHit = true;
          hitEnemyIds.add(enemy.id); // Mark enemy as spent for this tick
          player.lives--;
          player.multiplier = 1;

          if (player.lives <= 0) {
            player.alive = false;
            this.logger.log(`[GameRoom] ${player.name} died!`);
          } else {
            // Stay at hit location, grant 2s invincibility. No position teleport —
            // the +0.5 "opposite side" respawn was the primary cause of the
            // "players teleporting to arbitrary positions" bug (s31-mp-teleporting-randomly).
            // The invincibility window gives the player time to move away from enemies.
            this.playerInvincibility.set(player.id, 2.0);
            this.logger.log(`[GameRoom] ${player.name} hit, ${player.lives} lives remaining (invincible 2s)`);
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

        const dist = this.uvDistWrapped(player.surfaceU, player.surfaceV, geom.surfaceU, geom.surfaceV);

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

        const dist = this.uvDistWrapped(player.surfaceU, player.surfaceV, pickup.surfaceU, pickup.surfaceV);

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
    // Include pending (warned but not yet materialized) enemies in the count so
    // we don't fire a new wave whose warnings will all be phantom (no enemy).
    if (this.waveElapsed < this.nextWaveAt) return;
    if (this.state.enemies.length + this.pendingEnemyCount >= this.getMaxEnemies()) return;

    this.waveNumber++;
    this.state.waveNumber = this.waveNumber;
    this.setMetadata({
      surface: this.state.surfaceType,
      status: 'playing',
      wave: this.waveNumber,
    });
    this.logger.log(`[GameRoom] Wave ${this.waveNumber} started (difficulty ${this.computeDifficultyLevel().toFixed(2)})`);

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

    for (const entry of wave) {
      const resolvedType = WAVE_TYPE_REMAP[entry.type] ?? entry.type;
      const scaledCount = Math.round(entry.count * countMultiplier);

      for (let i = 0; i < scaledCount; i++) {
        // spawnSingleEnemy checks (enemies.length + pendingEnemyCount) >= cap
        // and returns early if over cap — no phantom warnings sent.
        if (!this.spawnSingleEnemy(resolvedType)) break;
      }
    }
  }

  /**
   * Choose a spawn UV position that is visible to at least one player (within
   * 0.25–0.45 UV units of the nearest player) while remaining far enough away
   * not to instantly hit them.  Avoids exact U=0/1 seam positions which map to
   * the "back" of the sphere and produce warning rings the player can never see.
   *
   * Falls back to a random safe position if no suitable player-relative position
   * is found in 20 attempts.
   */
  private getSpawnPosition(): { u: number; v: number } {
    const vMin = 0.05;
    const vMax = 0.95;
    const MIN_DIST = 0.25;
    const MAX_DIST = 0.45;

    // Collect alive player UV positions
    const players: Array<{ u: number; v: number }> = [];
    this.state.players.forEach((p) => {
      if (p.alive) players.push({ u: p.surfaceU, v: p.surfaceV });
    });

    if (players.length > 0) {
      // Spawn on a ring around a random player (MIN_DIST..MAX_DIST away in UV).
      // This keeps the ring in the player's "visible hemisphere" so they can
      // actually see the warning before the enemy arrives.
      for (let attempt = 0; attempt < 20; attempt++) {
        const target = players[Math.floor(Math.random() * players.length)];
        const angle = Math.random() * 2 * Math.PI;
        const dist = MIN_DIST + Math.random() * (MAX_DIST - MIN_DIST);

        // Wrap U, clamp V to avoid pole singularities
        const u = ((target.u + dist * Math.cos(angle)) % 1 + 1) % 1;
        const v = Math.max(vMin, Math.min(vMax, target.v + dist * Math.sin(angle)));

        // Confirm it is far enough from ALL players (one may have moved since target was picked)
        let farEnough = true;
        for (const p of players) {
          let du = Math.abs(u - p.u);
          if (du > 0.5) du = 1 - du;
          const dv = Math.abs(v - p.v);
          if (Math.sqrt(du * du + dv * dv) < MIN_DIST) {
            farEnough = false;
            break;
          }
        }
        if (farEnough) return { u, v };
      }
    }

    // Fallback: random safe position (no players alive yet, or 20 attempts exhausted)
    const u = 0.1 + Math.random() * 0.8;  // stay away from exact 0/1 seam
    const v = vMin + Math.random() * (vMax - vMin);
    return { u, v };
  }

  /**
   * Spawn a single enemy of the given type at a player-visible position.
   * Returns true if the enemy was queued (warning sent), false if the cap
   * would be exceeded (caller should stop spawning further enemies).
   * The type must already be resolved (i.e., present in SERVER_TO_SPAWNER_TYPE).
   */
  private spawnSingleEnemy(type: string): boolean {
    // Check effective enemy count: materialized + pending (warned but not yet added).
    // This is the core fix for phantom warning rings: we never send a warning for
    // an enemy that will be silently dropped by the cap check in the setTimeout.
    const maxEnemies = this.getMaxEnemies();
    if (this.state.enemies.length + this.pendingEnemyCount >= maxEnemies) {
      return false;
    }

    const enemy = new EnemyState();
    enemy.id = `e${this.nextEnemyId++}`;
    enemy.type = type;

    // Spawn at a position visible to the player (S27h fix).
    // Old logic spawned at U=0/1 (UV seam = back of sphere) which produced
    // warning rings the player could never see because they were occluded by
    // the sphere geometry.  getSpawnPosition() places enemies 0.25–0.45 UV
    // units from the nearest player so the ring is in their visible field.
    const pos = this.getSpawnPosition();
    enemy.surfaceU = pos.u;
    enemy.surfaceV = pos.v;

    enemy.health = this.getEnemyHealth(type);
    enemy.alive = true;

    // Initialize per-type AI state
    this.enemyAI.set(enemy.id, this.createEnemyAI(type));

    // Allocate this enemy in the pending count before broadcasting the warning.
    // This ensures any subsequent calls to spawnSingleEnemy (synchronous, same tick)
    // see the updated count and don't over-allocate.
    this.pendingEnemyCount++;
    const gen = this.spawnGeneration;

    // Broadcast pre-spawn warning to all clients so they can show a pulsing
    // red ring at this UV position before the enemy actually appears.
    this.broadcast('pre_spawn', { type, u: enemy.surfaceU, v: enemy.surfaceV });

    // Delay adding to state so clients have PRE_SPAWN_WARNING_MS to show
    // the warning ring before the enemy materialises.
    setTimeout(() => {
      // CRITICAL: check generation BEFORE decrementing pendingEnemyCount.
      // Old code decremented "regardless" — but if the game was restarted,
      // decrementing would corrupt the NEW game's pending count (allowing more
      // enemies than the cap) and produce phantom warning rings in the new round.
      if (this.spawnGeneration !== gen) return;

      this.pendingEnemyCount = Math.max(0, this.pendingEnemyCount - 1);

      // Only push if game is still in progress (phase check is a safety net).
      if (this.state.roomPhase === 'playing') {
        this.state.enemies.push(enemy);
      }
    }, PRE_SPAWN_WARNING_MS);

    return true;
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
      this.transitionToVoting();
    }
  }

  /** Transition from playing → voting. Starts countdown and clears previous votes. */
  private transitionToVoting() {
    this.state.roomPhase = 'voting';
    this.state.gameOver = true;  // backward compat: existing client code reads gameOver
    this.state.votingCountdown = VOTING_COUNTDOWN_SECS;
    this.state.voteMap.clear();
    this.setMetadata({
      surface: this.state.surfaceType,
      status: 'voting',
      wave: this.waveNumber,
    });
    this.logger.log('[GameRoom] Game Over — entering voting phase');
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

  /**
   * Whether the current surface wraps in the V direction.
   * Torus, pipe, mobius, and cube variants all wrap V.
   * Used for collision distance calculations and coordinate wrapping.
   */
  private surfaceWrapsV(): boolean {
    const st = this.state.surfaceType;
    return st === 'torus' || st === 'pipe' || st === 'mobius'
      || st === 'cube-ring' || st === 'cube-tunnel';
  }

  /**
   * Compute the shortest delta between two UV coordinates on a periodic axis.
   * @param a - First coordinate [0, 1)
   * @param b - Second coordinate [0, 1)
   * @param wraps - Whether this axis wraps (periodic)
   * @returns Signed shortest delta from a to b
   */
  private uvDelta(a: number, b: number, wraps: boolean): number {
    let d = b - a;
    if (wraps) {
      if (d > 0.5) d -= 1;
      else if (d < -0.5) d += 1;
    }
    return d;
  }

  /**
   * Compute the wrap-aware UV distance between two surface points.
   * U always wraps; V wraps only on torus-like surfaces.
   */
  private uvDistWrapped(u1: number, v1: number, u2: number, v2: number): number {
    const wrapsV = this.surfaceWrapsV();
    let du = Math.abs(u1 - u2);
    if (du > 0.5) du = 1 - du;
    let dv = Math.abs(v1 - v2);
    if (wrapsV && dv > 0.5) dv = 1 - dv;
    return Math.sqrt(du * du + dv * dv);
  }

  /**
   * Check for inactivity and auto-pause or shutdown the room.
   * - If idle > INACTIVITY_PAUSE_THRESHOLD: auto-pause
   * - If idle > INACTIVITY_SHUTDOWN_THRESHOLD: gracefully shutdown
   * - Resumes on any player activity (input message resets timer and resumes)
   */
  private checkInactivity() {
    // Only check during active game phases
    if (this.state.roomPhase !== 'playing' && this.state.roomPhase !== 'voting') {
      return;
    }

    // No players? No need to track inactivity
    if (this.state.players.size === 0) {
      return;
    }

    const now = Date.now();
    const inactiveMs = now - this.lastActivityTime;
    const inactiveSecs = inactiveMs / 1000;

    // Check for auto-shutdown (15 minutes of inactivity)
    if (inactiveSecs > INACTIVITY_SHUTDOWN_THRESHOLD) {
      this.logger.log(
        `[GameRoom] Server auto-shutdown triggered after ${inactiveSecs.toFixed(1)}s of inactivity`
      );
      this.broadcast('game_ended', { reason: 'server_shutdown_idle' });
      this.disconnect();
      return;
    }

    // Check for auto-pause (2 minutes of inactivity)
    if (inactiveSecs > INACTIVITY_PAUSE_THRESHOLD && !this.state.isPaused) {
      this.state.isPaused = true;
      this.autoPausedTime = now;
      this.logger.log(
        `[GameRoom] Server auto-paused after ${inactiveSecs.toFixed(1)}s of inactivity`
      );
    }
  }
}

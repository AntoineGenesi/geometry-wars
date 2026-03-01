import { Room, Client } from 'colyseus';
import {
  GameState,
  PlayerState,
  BulletState,
  EnemyState,
  GeomState,
  WeaponPickupState,
  SuperPickupState,
  BuffPickupState,
} from '../schema/GameState';
import fs from 'fs';
import path from 'path';
import Logger from '../logger';
import { createHash } from 'crypto';
import {
  WEAPON_CONFIGS,
  PLAYER_SPEED,
  BULLET_SPEED,
  BULLET_LIFETIME,
  WEAPON_DROP_CHANCE,
  WEAPON_PICKUP_LIFETIME,
  ENEMY_SPEEDS,
  ENEMY_SCORES,
  ENEMY_HEALTH,
  LEVEL_THRESHOLDS,
  LEVEL_DAMAGE_MULTIPLIERS,
  LEVEL_MOVE_SPEED_MULTIPLIERS,
  // LEVEL_FIRE_RATE_MULTIPLIERS: not applied server-side; fire rate is client-enforced.
} from '../shared/GameConstants';
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

/**
 * Rolling 30-second performance window for server-side DDA.
 * Reset every 30s; DDA level computed from the completed window.
 */
interface PlayerPerfWindow {
  kills: number;
  deaths: number;
  windowStart: number; // gameTime when window started
}

// Constants
const TICK_RATE = 60;
// How far in advance (ms) the server warns clients before spawning an enemy.
// Clients show a pulsing red ring for this duration before the enemy appears.
const PRE_SPAWN_WARNING_MS = 1500;
const VOTING_COUNTDOWN_SECS = 30;
// PLAYER_SPEED, BULLET_SPEED, BULLET_LIFETIME imported from ../shared/GameConstants
// Boost (sprint) constants — must match client-side Player.ts values.
const BOOST_DURATION = 0.5;       // seconds the speed boost lasts
const BOOST_COOLDOWN = 5.0;       // seconds between boosts
const BOOST_SPEED_MULTIPLIER = 3.0; // speed multiplier during boost

// Wave scheduling constants (mirrors WaveScheduler in src/core/)
const WAVE_FIRST_AT = 3.0;       // first wave at 3s (reduced from 6s to speed up MP start, s44-05)
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

// WEAPON_CONFIGS, WEAPON_DROP_CHANCE, WEAPON_PICKUP_LIFETIME imported from ../shared/GameConstants
const WEAPON_TYPES = Object.keys(WEAPON_CONFIGS).filter(t => t !== 'standard');

// Buff pickup constants (Phase D: damage-affecting buffs only)
// TODO: ShockAura, Magnetism, Afterburner, ToughTimes require physics effects — future phase
const BUFF_PICKUP_TYPES = ['hot_hands', 'trigger_happy', 'incendiary_rounds', 'volatile'] as const;
const BUFF_PICKUP_DROP_CHANCE = 0.15;  // 15% chance per enemy kill
const BUFF_PICKUP_LIFETIME = 20.0;     // same as WEAPON_PICKUP_LIFETIME
const BUFF_STACK_MAX = 8;              // max stacks per buff type per player

// Super pickup constants
// Bomb resupply spawns every SUPER_PICKUP_WAVE_INTERVAL waves (e.g. wave 5, 10, 15...).
// Lifetime of 30s gives players time to travel and collect before it despawns.
const SUPER_PICKUP_LIFETIME = 30;
const SUPER_PICKUP_WAVE_INTERVAL = 5;

/**
 * Returns the map size scale factor matching client-side getMapSizeScaleFactor().
 * Used to scale UV-space collision thresholds inversely: larger maps have bigger
 * world distances per UV unit, so the same UV threshold would feel too large.
 * Dividing by scaleFactor keeps collisions consistent in world space.
 */
function getMapScaleFactor(mapSize: string): number {
  switch (mapSize) {
    case 'tiny':   return 0.5;
    case 'small':  return 0.75;
    case 'medium': return 1.0;
    case 'large':  return 1.5;
    case 'huge':   return 2.0;
    default:       return 1.0;
  }
}

/**
 * Compute great-circle arc distance between two UV points on a sphere.
 *
 * Root cause of S38b MP hit detection bug:
 *   UV Euclidean distance on sphere is non-uniform. 0.04 UV ≈ 1.26 world units
 *   in the V direction on sphere R=10 — 3× too large vs visual collision size
 *   (player 0.15 + enemy 0.30 = 0.45 world units). Near poles, U is compressed
 *   further, making the hitbox asymmetric and wildly wrong.
 *
 * Solution: For sphere-like surfaces, compute great-circle distance directly.
 * This naturally handles pole wrap-around without seam discontinuities.
 *
 * UV parameterisation on sphere:
 *   V = polar angle / π  (0 = north pole, 1 = south pole)
 *   U = azimuthal angle / (2π)  (wraps 0–1)
 *
 * @param u1,v1  UV of entity 1
 * @param u2,v2  UV of entity 2
 * @param R      sphere radius (world units) = 10 * mapScaleFactor
 * @returns      arc distance in world units
 */
export function sphereGreatCircleDist(
  u1: number, v1: number,
  u2: number, v2: number,
  R: number,
): number {
  const phi1 = v1 * Math.PI;
  const phi2 = v2 * Math.PI;
  const theta1 = u1 * 2 * Math.PI;
  const theta2 = u2 * 2 * Math.PI;
  // Dot product of unit position vectors
  const dot = Math.sin(phi1) * Math.cos(theta1) * Math.sin(phi2) * Math.cos(theta2)
            + Math.sin(phi1) * Math.sin(theta1) * Math.sin(phi2) * Math.sin(theta2)
            + Math.cos(phi1) * Math.cos(phi2);
  // Clamp for numerical safety at coincident/antipodal points
  return R * Math.acos(Math.max(-1, Math.min(1, dot)));
}

// ---------------------------------------------------------------------------
// S43-07: 3D chord distance helpers for surfaces with distorted UV mapping
// ---------------------------------------------------------------------------
// Problem: UV Euclidean distance is non-uniform on torus-like and peanut surfaces.
//   - Torus V direction (around big ring, R=6): 0.04 UV ≈ 1.51 world units (3× too large)
//   - Cube ring U direction (around big ring, R=6): 0.04 UV ≈ 1.51 world units (3× too large)
//   - Peanut U direction (around bulge, r≈8.4): 0.04 UV ≈ 2.11 world units (5× too large)
// Solution: Compute 3D Euclidean chord distance from UV coordinates — this matches
// SP's CollisionSystem.ts which uses mesh.position.distanceTo(enemy.position).

/** Peanut: surface of revolution. r(v) = B*(1 - W*cos(2*v*π)), v∈[0,1] = pole→pole. */
const PEANUT_BASE_RADIUS = 6;
const PEANUT_WAIST_DEPTH = 0.4;
function peanutChordDist(u1: number, v1: number, u2: number, v2: number, scaleFactor: number): number {
  const B = PEANUT_BASE_RADIUS * scaleFactor;
  const W = PEANUT_WAIST_DEPTH;
  const phi1 = v1 * Math.PI, theta1 = u1 * 2 * Math.PI;
  const r1 = B * (1 - W * Math.cos(2 * phi1));
  const phi2 = v2 * Math.PI, theta2 = u2 * 2 * Math.PI;
  const r2 = B * (1 - W * Math.cos(2 * phi2));
  const dx = r1 * Math.sin(phi1) * Math.cos(theta1) - r2 * Math.sin(phi2) * Math.cos(theta2);
  const dy = r1 * Math.cos(phi1) - r2 * Math.cos(phi2);
  const dz = r1 * Math.sin(phi1) * Math.sin(theta1) - r2 * Math.sin(phi2) * Math.sin(theta2);
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/** Torus: U = around tube (minor, r=2), V = around ring (major, R=6). */
const TORUS_MAJOR_R = 6;
const TORUS_MINOR_R = 2;
function torusChordDist(u1: number, v1: number, u2: number, v2: number, scaleFactor: number): number {
  const R = TORUS_MAJOR_R * scaleFactor;
  const r = TORUS_MINOR_R * scaleFactor;
  const theta1 = u1 * 2 * Math.PI, phi1 = v1 * 2 * Math.PI;
  const theta2 = u2 * 2 * Math.PI, phi2 = v2 * 2 * Math.PI;
  const dx = (R + r * Math.cos(theta1)) * Math.cos(phi1) - (R + r * Math.cos(theta2)) * Math.cos(phi2);
  const dy = r * Math.sin(theta1) - r * Math.sin(theta2); // sign irrelevant for distance
  const dz = (R + r * Math.cos(theta1)) * Math.sin(phi1) - (R + r * Math.cos(theta2)) * Math.sin(phi2);
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/**
 * Cube ring: U = around big ring (major, R=6), V = around square cross-section.
 * Profile approximates the 4 flat faces; ignores bevel arcs (error ≤ bevelRadius=0.4 world units
 * at corners only — far better than the 1.5+ world unit error from UV distance).
 * Face layout: v∈[0, 0.25) outer (r=+H), [0.25, 0.5) top (y=+H),
 *              [0.5, 0.75) inner (r=-H), [0.75, 1.0) bottom (y=-H).
 */
const CUBE_RING_MAJOR_R = 6;
const CUBE_RING_HALF_SIDE = 1.5; // crossSection/2 = 3/2
function cubeRingChordDist(u1: number, v1: number, u2: number, v2: number, scaleFactor: number): number {
  const R = CUBE_RING_MAJOR_R * scaleFactor;
  const H = CUBE_RING_HALF_SIDE * scaleFactor;
  function profile(v: number): { r: number; y: number } {
    const t = ((v % 1) + 1) % 1;
    const q = t * 4;
    if (q < 1) return { r: H,  y: (q - 0.5) * 2 * H };   // outer face
    if (q < 2) return { r: (1.5 - q) * 2 * H, y: H };     // top face
    if (q < 3) return { r: -H, y: (2.5 - q) * 2 * H };    // inner face
    return         { r: (q - 3.5) * 2 * H,    y: -H };     // bottom face
  }
  const phi1 = u1 * 2 * Math.PI;
  const { r: r1, y: y1 } = profile(v1);
  const phi2 = u2 * 2 * Math.PI;
  const { r: r2, y: y2 } = profile(v2);
  const dx = (R + r1) * Math.cos(phi1) - (R + r2) * Math.cos(phi2);
  const dz = (R + r1) * Math.sin(phi1) - (R + r2) * Math.sin(phi2);
  const dy = y1 - y2;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/**
 * Dispatch to the appropriate world-space distance function for a given surface.
 * Returns Euclidean 3D chord distance in world units — matches SP CollisionSystem.
 */
function surfaceWorldDist(
  surfaceType: string,
  u1: number, v1: number, u2: number, v2: number,
  scaleFactor: number, sphereR: number,
): number {
  if (surfaceType === 'peanut')    return peanutChordDist(u1, v1, u2, v2, scaleFactor);
  if (surfaceType === 'torus')     return torusChordDist(u1, v1, u2, v2, scaleFactor);
  if (surfaceType === 'cube-ring') return cubeRingChordDist(u1, v1, u2, v2, scaleFactor);
  return sphereGreatCircleDist(u1, v1, u2, v2, sphereR); // sphere, capsule, icosahedron, sphere-tunnel
}

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
const MID_TYPES_WAVE = ['weaver', 'spinner', 'rocket', 'neutron', 'mayfly', 'helix', 'swarm', 'lurker', 'approach_glow'];
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
  giant_neutron: 'titan_grunt',
  splitter: 'titan_weaver',
};

// Server-side AI state for each live enemy. Not synced to clients.
interface ServerEnemyAI {
  // Grunt / Swarm / ApproachGlow: acceleration ramp (maxSpeed stored per-type)
  currentSpeed?: number;
  maxSpeed?: number;
  // Wanderer / Neutron / Painter: direction vector + change timer
  directionU?: number;
  directionV?: number;
  directionChangeTimer?: number;
  nextDirectionChange?: number;
  // Rocket / Arrow: straight-line direction (set once on spawn, changes on bounce)
  rocketDirU?: number;
  rocketDirV?: number;
  // Mayfly / Spinner: jitter offset + timer
  jitterOffsetU?: number;
  jitterOffsetV?: number;
  jitterTimer?: number;
  // Orbiter: orbit angle, radius, direction, reverse timer
  orbitAngle?: number;
  orbitRadius?: number;
  orbitDirection?: number;
  reverseTimer?: number;
  nextReverse?: number;
  // Weaver / TitanWeaver: momentum
  momentumU?: number;
  momentumV?: number;
  // Duck: cardinal direction (0=up, 1=right, 2=down, 3=left) + change timer
  duckDirection?: number;
  duckTimer?: number;
  // Lurker: state machine (0=idle, 1=charging, 2=dashing, 3=cooldown) + timer + dash dir
  lurkerState?: number;
  stateTimer?: number;
  dashDirU?: number;
  dashDirV?: number;
  // Repulsor: phase (0=lock, 1=charge, 2=recovery) + phase timer + charge target
  repulsorPhase?: number;
  phaseTimer?: number;
  chargeTargetU?: number;
  chargeTargetV?: number;
  // Helix: corkscrew phase for perpendicular wobble
  corkscrewPhase?: number;
  // Spawner: timer for periodic spawnlet spawning
  spawnTimer?: number;
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
  private nextSuperPickupId = 0;
  private nextBuffPickupId = 0;
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

  /**
   * Per-player V-axis direction flip state for pole traversal.
   * Toggles each time a player crosses a sphere/capsule/peanut pole boundary.
   * Without this, the player oscillates at the pole because the input direction
   * (dy from W/S keys) doesn't automatically reverse after crossing a pole.
   * The flip makes "W = forward" continue to mean "forward" past the pole.
   */
  private playerVFlip: Map<string, boolean> = new Map();

  // Server-side DDA state
  /** Rolling 30s kill/death window per player (keyed by sessionId) */
  private playerPerfWindows: Map<string, PlayerPerfWindow> = new Map();
  /** Seconds until next DDA evaluation (fires every 5s) */
  private ddaUpdateTimer: number = 0;
  /**
   * Hysteresis counter for DDA level decrease.
   * Difficulty decreases only every 2 DDA updates (not every 1).
   * Map: sessionId → pending decrease ticks (0 or 1).
   */
  private ddaDecreaseCounters: Map<string, number> = new Map();

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

    this.onMessage('ready_up', (client) => {
      if (this.state.roomPhase !== 'voting') return;
      this.state.readyMap.set(client.sessionId, true);
      const playerCount = this.state.players.size;
      this.logger.log(`[GameRoom] ${client.sessionId} ready (${this.state.readyMap.size}/${playerCount})`);
      if (playerCount > 0 && this.state.readyMap.size >= playerCount) {
        const choice = this.pickMostVoted();
        this.logger.log(`[GameRoom] All players ready — launching with: ${choice}`);
        this.startGameWithSettings(choice);
      }
    });

    this.onMessage('pause_countdown', (client, data: { paused: boolean }) => {
      if (client.sessionId !== this.state.hostId) return;
      if (this.state.roomPhase !== 'voting') return;
      this.state.countdownPaused = data.paused;
      this.logger.log(`[GameRoom] Countdown ${data.paused ? 'paused' : 'resumed'} by host`);
    });

    this.onMessage('pause', (client, data: { paused: boolean }) => {
      if (client.sessionId !== this.state.hostId) return;
      this.state.isPaused = data.paused;
      this.logger.log(`[GameRoom] Game ${data.paused ? 'paused' : 'resumed'} by host`);
    });

    this.onMessage('exit_to_voting', (client) => {
      if (client.sessionId !== this.state.hostId) return;
      if (this.state.roomPhase !== 'playing') return;
      this.logger.log('[GameRoom] Host exited to voting screen');
      this.transitionToVoting();
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
      // Creator (requestHost=true from URL param) always displaces a non-creator host.
      // Do NOT check hostIsLocal — through the Vite proxy, ALL clients appear as localhost,
      // so isLocalClient/hostIsLocal is unreliable. The requestHost flag is the ONLY
      // reliable signal for "I am the game creator."
      const creatorCanPromote = didRequestHost && !this.hostRequestedHost;
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

    this.playerVFlip.set(client.sessionId, false);
    // Initialize DDA performance window for new player
    this.playerPerfWindows.set(client.sessionId, { kills: 0, deaths: 0, windowStart: 0 });
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
      this.playerVFlip.delete(client.sessionId);
      this.playerPerfWindows.delete(client.sessionId);
      this.ddaDecreaseCounters.delete(client.sessionId);
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
    // Reset per-player V-flip state so all players start with unflipped direction
    this.playerVFlip.forEach((_, id) => this.playerVFlip.set(id, false));

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
      player.playerLevel = 0;
      player.playerKills = 0;
      // Reset buff stacks so each round starts clean
      player.buffStacks.clear();
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
      player.ddaLevel = 0;
      spawnIdx++;
    });

    // Reset DDA state for new game
    this.playerPerfWindows.clear();
    this.ddaUpdateTimer = 0;
    this.ddaDecreaseCounters.clear();

    // Clear entities
    this.state.bullets.clear();
    this.state.enemies.clear();
    this.enemyAI.clear();
    this.state.geoms.clear();
    this.state.weaponPickups.clear();
    this.state.superPickups.clear();
    this.state.buffPickups.clear();

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
      // Apply level-based speed multiplier (SP parity: PlayerLevel.ts LEVEL_MOVE_SPEED_MULTIPLIERS)
      const levelSpeedMult = LEVEL_MOVE_SPEED_MULTIPLIERS[Math.min(player.playerLevel, LEVEL_MOVE_SPEED_MULTIPLIERS.length - 1)] ?? 1.0;
      let speedMultiplier = levelSpeedMult;
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
        correctedDx = dx / Math.max(rNorm * sinPhi, 0.3);  // matches sphere clamp — prevents pole oscillation
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
      } else if (isSphereLike || surfaceType === 'peanut') {
        // Sphere/capsule/icosahedron/peanut poles: allow pole traversal by reflecting V.
        // When V goes below 0, the player crosses the north pole — reflect V and
        // shift U by 0.5 (continue to the antipodal longitude on the other side).
        // Same logic applies at the south pole (V > 1).
        //
        // Key fix for oscillation (s40-06): without vFlip, the player holds W
        // (constant dy) and oscillates at the pole — dy pushes V past the pole,
        // reflection puts them back, repeat. The vFlip flag tracks whether the
        // player has crossed an odd number of poles, flipping the effective dy
        // sign so "forward" continues to mean "forward" past each pole crossing.
        const vFlip = this.playerVFlip.get(clientId) ?? false;
        // Use correctedDy for peanut (metric-corrected), dy for sphere-like
        const effectiveDy = (surfaceType === 'peanut' ? correctedDy : dy) * (vFlip ? -1 : 1);
        let newV = player.surfaceV + effectiveDy;
        let newU = player.surfaceU; // already wrapped above
        if (newV < 0) {
          newV = -newV;
          newU = this.wrapCoord(newU + 0.5);
          this.playerVFlip.set(clientId, !vFlip);
        } else if (newV > 1) {
          newV = 2 - newV;
          newU = this.wrapCoord(newU + 0.5);
          this.playerVFlip.set(clientId, !vFlip);
        }
        // Keep V strictly inside (0, 1) to avoid degenerate tangent at exact pole
        player.surfaceV = Math.max(0.001, Math.min(0.999, newV));
        player.surfaceU = newU;
      } else {
        // Clamp V for cube and other surfaces that don't have pole traversal.
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
    // S35 negated tangentU in TorusSurface.ts and correctedDx for player movement,
    // but forgot to negate bullet.dirX. Server tracks bullets in UV-space using
    // +U = tangentU_natural (camera-left), but client renders using tangentU_negated
    // (camera-right). Negate dirX here so server collision matches visual direction.
    if (this.state.surfaceType === 'torus') {
      bullet.dirX = -bullet.dirX;
    }
    bullet.age = 0;

    this.state.bullets.push(bullet);
  }

  private useBomb(player: PlayerState) {
    player.bombs--;

    // Bombs are instant kills (enemy.alive = false), so the levelDamageMult from the
    // bullet damage formula does not affect the kill mechanism — bombs always kill regardless
    // of level. Level progression (playerKills + playerLevel) is still tracked below.
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

    // Track kills for level progression (bomb kills count)
    if (enemiesToRemove.length > 0) {
      player.playerKills += enemiesToRemove.length;
      const newLevel = this.getPlayerLevel(player.playerKills);
      if (newLevel > player.playerLevel) {
        player.playerLevel = newLevel;
        this.broadcast('player_level_up', { playerId: player.id, newLevel, playerName: player.name });
      }
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

    // Update super pickups (age + despawn)
    this.updateSuperPickups(dt);

    // Update buff pickups (age + despawn)
    this.updateBuffPickups(dt);

    // Wave-based enemy spawning (replaces old per-2s individual spawn)
    this.tickWaves(dt);

    // Drain per-player invincibility timers
    this.drainInvincibility(dt);

    // Update server-side DDA (runs every 5s)
    this.updateDDA(dt);

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

    // Skip countdown decrement when host has paused it
    if (!this.state.countdownPaused) {
      this.state.votingCountdown = Math.max(0, this.state.votingCountdown - dt);
    }
    if (this.state.votingCountdown <= 0 && !this.state.countdownPaused) {
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
    const isTorus = surfType === 'torus' || surfType === 'torus-tunnel';

    this.state.bullets.forEach((bullet, index) => {
      bullet.age += dt;

      if (isPeanut) {
        // Peanut surface: parallel transport + 2-axis metric correction.
        // Profile: r(phi) = R*(1 + w*cos(2*phi)), normalized (R=1).
        //   rNorm = 1 + w*cos(2*phi)
        //   drNorm = -2*w*sin(2*phi)
        const PEANUT_WAIST_DEPTH = 0.4;
        const phi = bullet.y * Math.PI;
        const rNorm = 1 + PEANUT_WAIST_DEPTH * Math.cos(2 * phi);
        const drNorm = -2 * PEANUT_WAIST_DEPTH * Math.sin(2 * phi);
        const sinPhi = Math.sin(phi);
        const cosPhi = Math.cos(phi);
        const metricU = Math.max(rNorm * sinPhi, 0.1);
        const metricV = Math.max(Math.sqrt(rNorm * rNorm + drNorm * drNorm), 0.1);

        // Parallel transport: rotate direction using Christoffel symbols for peanut
        const cotPhi = cosPhi / Math.max(Math.abs(sinPhi), 0.01);
        const g_vv = rNorm * rNorm + drNorm * drNorm;
        const Gamma_u_uv = (drNorm / Math.max(rNorm, 0.01)) + cotPhi;
        const Gamma_v_uu = -rNorm * sinPhi * (rNorm * cosPhi + drNorm * sinPhi) / Math.max(g_vv, 0.01);
        const step = BULLET_SPEED * dt;
        const prevDirXPeanut = bullet.dirX;
        bullet.dirX += -2 * Gamma_u_uv * bullet.dirX * bullet.dirY * step;
        bullet.dirY += -Gamma_v_uu * prevDirXPeanut * prevDirXPeanut * step;
        const peanutLen = Math.sqrt(bullet.dirX * bullet.dirX + bullet.dirY * bullet.dirY);
        if (peanutLen > 0.001) { bullet.dirX /= peanutLen; bullet.dirY /= peanutLen; }

        bullet.x += (bullet.dirX / metricU) * BULLET_SPEED * dt;
        bullet.y += (bullet.dirY / metricV) * BULLET_SPEED * dt;
      } else if (isSphereLike) {
        // Sphere: parallel transport + metric correction for u-axis.
        // Geodesic equations for sphere: Γ^u_uv = cot(phi), Γ^v_uu = -sin(phi)*cos(phi)
        const phi = bullet.y * Math.PI;
        const sinPhi = Math.sin(phi);
        const cosPhi = Math.cos(phi);
        const clampedSinPhi = Math.max(Math.abs(sinPhi), 0.1);

        // Parallel transport: rotate direction using Christoffel symbols
        const cotPhi = cosPhi / Math.max(Math.abs(sinPhi), 0.01);
        const step = BULLET_SPEED * dt;
        const prevDirX = bullet.dirX;
        bullet.dirX += -2 * cotPhi * bullet.dirX * bullet.dirY * step;
        bullet.dirY += sinPhi * cosPhi * prevDirX * prevDirX * step;
        const sphereLen = Math.sqrt(bullet.dirX * bullet.dirX + bullet.dirY * bullet.dirY);
        if (sphereLen > 0.001) { bullet.dirX /= sphereLen; bullet.dirY /= sphereLen; }

        // Move bullet with metric correction for u (arc-length preserving)
        bullet.x += (bullet.dirX / clampedSinPhi) * BULLET_SPEED * dt;
        bullet.y += bullet.dirY * BULLET_SPEED * dt;

        // Pole crossing: when bullet passes through north (v<0) or south (v>1) pole,
        // it emerges on the opposite side of the sphere. In UV space this means:
        //   - v reflects: north v → -v, south v → 2-v  (back into [0,1])
        //   - u shifts by 0.5 (antipodal longitude on the other side of the pole)
        //   - Both direction components flip (east/south reverse at antipodal longitude)
        // This replaces the hard clamp that caused bullets to get stuck at poles.
        // Geometrically correct: at (u+0.5) near pole, the local east/south basis
        // vectors are the 3D-opposite of the basis vectors at (u).
        if (bullet.y < 0) {
          bullet.y = -bullet.y;
          bullet.x = this.wrapCoord(bullet.x + 0.5);
          bullet.dirX = -bullet.dirX;
          bullet.dirY = -bullet.dirY;
        } else if (bullet.y > 1) {
          bullet.y = 2 - bullet.y;
          bullet.x = this.wrapCoord(bullet.x + 0.5);
          bullet.dirX = -bullet.dirX;
          bullet.dirY = -bullet.dirY;
        }
      } else if (isTorus) {
        // Torus: parallel transport + 2-axis metric correction.
        // Normalized radii R=1, r=3/8 (preserves game's 8:3 aspect ratio).
        // Christoffel symbols: Γ^u_uv = -r*sinV/rho, Γ^v_uu = rho*sinV/r
        const TORUS_r = 0.375; // minor radius (normalized: r/R = 3/8)
        const v = bullet.y * 2 * Math.PI;
        const cosV = Math.cos(v);
        const sinV = Math.sin(v);
        const rho = Math.max(1 + TORUS_r * cosV, 0.1); // major + minor*cos(v)

        // Parallel transport
        const Gamma_u_uv = -TORUS_r * sinV / rho;
        const Gamma_v_uu = rho * sinV / TORUS_r;
        const step = BULLET_SPEED * dt;
        const prevDirX = bullet.dirX;
        bullet.dirX += -2 * Gamma_u_uv * bullet.dirX * bullet.dirY * step;
        bullet.dirY += -Gamma_v_uu * prevDirX * prevDirX * step;
        const torusLen = Math.sqrt(bullet.dirX * bullet.dirX + bullet.dirY * bullet.dirY);
        if (torusLen > 0.001) { bullet.dirX /= torusLen; bullet.dirY /= torusLen; }

        // Move bullet with metric correction (constant arc-length speed)
        bullet.x += (bullet.dirX / rho) * BULLET_SPEED * dt;
        bullet.y += (bullet.dirY / TORUS_r) * BULLET_SPEED * dt;
      } else {
        // Flat / other surfaces (cube, plane, pipe, mobius) — straight-line UV motion.
        bullet.x += bullet.dirX * BULLET_SPEED * dt;
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
        case 'duck':
          this.updateDuck(enemy, ai, nearestPlayer, dt, wrapsV, surfType);
          break;
        case 'spinner':
          this.updateSpinner(enemy, ai, nearestPlayer, dt, wrapsV, surfType);
          break;
        case 'swarm':
        case 'approach_glow':
          this.updateAcceleratingChaser(enemy, ai, nearestPlayer, dt, wrapsV, surfType);
          break;
        case 'orbiter':
          this.updateOrbiter(enemy, ai, nearestPlayer, dt, wrapsV, surfType);
          break;
        case 'helix':
          this.updateHelix(enemy, ai, nearestPlayer, dt, wrapsV, surfType);
          break;
        case 'lurker':
          this.updateLurker(enemy, ai, nearestPlayer, dt, wrapsV, surfType);
          break;
        case 'repulsor':
          this.updateRepulsor(enemy, ai, nearestPlayer, dt, wrapsV, surfType);
          break;
        case 'spawner':
          this.updateSpawner(enemy, ai, nearestPlayer, dt, wrapsV, surfType);
          break;
        case 'painter':
          this.updatePainter(enemy, ai, dt, wrapsV, surfType);
          break;
        case 'giant_wanderer':
          this.updateGiantWanderer(enemy, ai, dt, wrapsV, surfType);
          break;
        case 'giant_rocket':
          this.updateGiantRocket(enemy, ai, dt, wrapsV, surfType);
          break;
        case 'giant_neutron':
          this.updateGiantNeutron(enemy, ai, dt, wrapsV, surfType);
          break;
        case 'titan_grunt':
          this.updateTitanGrunt(enemy, ai, nearestPlayer, dt, wrapsV, surfType);
          break;
        case 'titan_spinner':
          this.updateTitanSpinner(enemy, ai, nearestPlayer, dt, wrapsV, surfType);
          break;
        case 'titan_weaver':
          this.updateTitanWeaver(enemy, ai, nearestPlayer, dt, wrapsV, surfType);
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
    } else if (surfType === 'sphere' || surfType === 'sphere-tunnel'
        || surfType === 'icosahedron' || surfType === 'capsule' || surfType === 'peanut') {
      // Sphere-like: reflect through poles (continuous traversal instead of hard bounce)
      if (enemy.surfaceV < 0) {
        enemy.surfaceV = -enemy.surfaceV;
        enemy.surfaceU = this.wrapCoord(enemy.surfaceU + 0.5);
        ai.directionV = Math.abs(ai.directionV ?? 0);
      } else if (enemy.surfaceV > 1) {
        enemy.surfaceV = 2 - enemy.surfaceV;
        enemy.surfaceU = this.wrapCoord(enemy.surfaceU + 0.5);
        ai.directionV = -Math.abs(ai.directionV ?? 0);
      }
      enemy.surfaceV = Math.max(0.001, Math.min(0.999, enemy.surfaceV));
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
    } else if (surfType === 'sphere' || surfType === 'sphere-tunnel'
        || surfType === 'icosahedron' || surfType === 'capsule' || surfType === 'peanut') {
      // Sphere-like: reflect through poles instead of bouncing with random direction
      if (enemy.surfaceV < 0) {
        enemy.surfaceV = -enemy.surfaceV;
        enemy.surfaceU = this.wrapCoord(enemy.surfaceU + 0.5);
        ai.directionV = Math.abs(ai.directionV ?? 0);
      } else if (enemy.surfaceV > 1) {
        enemy.surfaceV = 2 - enemy.surfaceV;
        enemy.surfaceU = this.wrapCoord(enemy.surfaceU + 0.5);
        ai.directionV = -Math.abs(ai.directionV ?? 0);
      }
      enemy.surfaceV = Math.max(0.001, Math.min(0.999, enemy.surfaceV));
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
    } else if (surfType === 'sphere' || surfType === 'sphere-tunnel'
        || surfType === 'icosahedron' || surfType === 'capsule' || surfType === 'peanut') {
      // Sphere-like: reflect through poles (continuous traversal)
      if (enemy.surfaceV < 0) {
        enemy.surfaceV = -enemy.surfaceV;
        enemy.surfaceU = this.wrapCoord(enemy.surfaceU + 0.5);
        ai.rocketDirV = Math.abs(ai.rocketDirV ?? 0);
      } else if (enemy.surfaceV > 1) {
        enemy.surfaceV = 2 - enemy.surfaceV;
        enemy.surfaceU = this.wrapCoord(enemy.surfaceU + 0.5);
        ai.rocketDirV = -Math.abs(ai.rocketDirV ?? 0);
      }
      enemy.surfaceV = Math.max(0.001, Math.min(0.999, enemy.surfaceV));
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

  /** Duck: moves in cardinal directions, biased toward player, changes direction every 0.5s */
  private updateDuck(
    enemy: EnemyState, ai: ServerEnemyAI, player: PlayerState | null,
    dt: number, wrapsV: boolean, surfType: string
  ): void {
    const DUCK_SPEED = 0.025;
    const DIRECTION_INTERVAL = 0.5;

    // Initialize duck state
    if (ai.duckDirection === undefined) {
      ai.duckDirection = Math.floor(Math.random() * 4);
      ai.duckTimer = 0;
    }

    ai.duckTimer = (ai.duckTimer ?? 0) + dt;
    if (ai.duckTimer >= DIRECTION_INTERVAL) {
      ai.duckTimer = 0;

      if (player && Math.random() >= 0.2) {
        // Bias toward player: pick cardinal direction that reduces distance most
        const du = player.surfaceU - enemy.surfaceU;
        const dv = player.surfaceV - enemy.surfaceV;
        if (Math.abs(du) > Math.abs(dv)) {
          ai.duckDirection = du > 0 ? 1 : 3; // right or left
        } else {
          ai.duckDirection = dv > 0 ? 0 : 2; // up or down
        }
      } else {
        // Random direction
        ai.duckDirection = Math.floor(Math.random() * 4);
      }
    }

    // Move in current cardinal direction
    switch (ai.duckDirection) {
      case 0: enemy.surfaceV += DUCK_SPEED * dt; break;  // up
      case 1: enemy.surfaceU += DUCK_SPEED * dt; break;  // right
      case 2: enemy.surfaceV -= DUCK_SPEED * dt; break;  // down
      case 3: enemy.surfaceU -= DUCK_SPEED * dt; break;  // left
    }

    this.applyUVBounds(enemy, wrapsV, surfType);
  }

  /** Spinner: chases player with per-frame random wobble (less precise homing) */
  private updateSpinner(
    enemy: EnemyState, ai: ServerEnemyAI, player: PlayerState | null,
    dt: number, wrapsV: boolean, surfType: string
  ): void {
    if (!player) return;

    const SPINNER_SPEED = 0.05;
    const WOBBLE_AMOUNT = 0.15;

    const wobbleU = (Math.random() - 0.5) * WOBBLE_AMOUNT;
    const wobbleV = (Math.random() - 0.5) * WOBBLE_AMOUNT;
    const targetU = player.surfaceU + wobbleU;
    const targetV = player.surfaceV + wobbleV;

    const du = this.uvDelta(enemy.surfaceU, targetU, true);
    const dv = this.uvDelta(enemy.surfaceV, targetV, wrapsV);
    const dist = Math.sqrt(du * du + dv * dv);

    if (dist > 0.01) {
      enemy.surfaceU += (du / dist) * SPINNER_SPEED * dt;
      enemy.surfaceV += (dv / dist) * SPINNER_SPEED * dt;
      this.applyUVBounds(enemy, wrapsV, surfType);
    }
  }

  /** Swarm / ApproachGlow: accelerates toward nearest player (magnet feel), capped at maxSpeed */
  private updateAcceleratingChaser(
    enemy: EnemyState, ai: ServerEnemyAI, player: PlayerState | null,
    dt: number, wrapsV: boolean, surfType: string
  ): void {
    const maxSpeed = ai.maxSpeed ?? 0.055;
    ai.currentSpeed = Math.min(maxSpeed, (ai.currentSpeed ?? 0.02) + 0.002 * dt);
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

  /** Orbiter: maintains orbit around player, reverses direction periodically */
  private updateOrbiter(
    enemy: EnemyState, ai: ServerEnemyAI, player: PlayerState | null,
    dt: number, wrapsV: boolean, surfType: string
  ): void {
    const ORBIT_SPEED = 2.5; // radians/sec
    const ORBIT_RADIUS = ai.orbitRadius ?? 0.15;

    // Reverse direction periodically
    ai.reverseTimer = (ai.reverseTimer ?? 0) + dt;
    if (ai.reverseTimer >= (ai.nextReverse ?? 4)) {
      ai.orbitDirection = -(ai.orbitDirection ?? 1);
      ai.reverseTimer = 0;
      ai.nextReverse = 3 + Math.random() * 2;
    }

    // Advance orbit angle
    ai.orbitAngle = (ai.orbitAngle ?? 0) + ORBIT_SPEED * (ai.orbitDirection ?? 1) * dt;

    if (!player) return;

    // Calculate target orbit position around player
    const orbitU = player.surfaceU + Math.cos(ai.orbitAngle) * ORBIT_RADIUS;
    const orbitV = player.surfaceV + Math.sin(ai.orbitAngle) * ORBIT_RADIUS;

    // Chase toward the orbit position at fixed speed
    const du = this.uvDelta(enemy.surfaceU, orbitU, true);
    const dv = this.uvDelta(enemy.surfaceV, orbitV, wrapsV);
    const dist = Math.sqrt(du * du + dv * dv);
    if (dist > 0.001) {
      const ORBIT_CHASE_SPEED = 0.07;
      enemy.surfaceU += (du / dist) * ORBIT_CHASE_SPEED * dt;
      enemy.surfaceV += (dv / dist) * ORBIT_CHASE_SPEED * dt;
      this.applyUVBounds(enemy, wrapsV, surfType);
    }
  }

  /** Helix: chases player with sinusoidal perpendicular wobble */
  private updateHelix(
    enemy: EnemyState, ai: ServerEnemyAI, player: PlayerState | null,
    dt: number, wrapsV: boolean, surfType: string
  ): void {
    if (!player) return;

    const HELIX_SPEED = 0.07;
    const WOBBLE_AMPLITUDE = 0.05; // perpendicular UV units
    const CORKSCREW_RATE = Math.PI * 4; // 2 Hz = 2 * 2π rad/s

    // Advance corkscrew phase
    ai.corkscrewPhase = (ai.corkscrewPhase ?? 0) + CORKSCREW_RATE * dt;

    const du = this.uvDelta(enemy.surfaceU, player.surfaceU, true);
    const dv = this.uvDelta(enemy.surfaceV, player.surfaceV, wrapsV);
    const dist = Math.sqrt(du * du + dv * dv);

    if (dist > 0.001) {
      const dirU = du / dist;
      const dirV = dv / dist;
      // Perpendicular direction (90° rotation)
      const perpU = -dirV;
      const perpV = dirU;
      const wobble = Math.sin(ai.corkscrewPhase) * WOBBLE_AMPLITUDE;

      enemy.surfaceU += (dirU + perpU * wobble) * HELIX_SPEED * dt;
      enemy.surfaceV += (dirV + perpV * wobble) * HELIX_SPEED * dt;
      this.applyUVBounds(enemy, wrapsV, surfType);
    }
  }

  /** Lurker: state machine — idle (still) → charging (1s windup) → dashing (fast) → cooldown */
  private updateLurker(
    enemy: EnemyState, ai: ServerEnemyAI, player: PlayerState | null,
    dt: number, wrapsV: boolean, surfType: string
  ): void {
    ai.stateTimer = (ai.stateTimer ?? 0) + dt;

    switch (ai.lurkerState ?? 0) {
      case 0: { // Idle: stays still, waits 2-3s then begins charging
        if (ai.stateTimer >= (ai.nextDirectionChange ?? 2.5) && player) {
          ai.lurkerState = 1; // → charging
          ai.stateTimer = 0;
        }
        break;
      }
      case 1: { // Charging: 1s windup, tracks player and locks dash direction
        if (player) {
          const du = this.uvDelta(enemy.surfaceU, player.surfaceU, true);
          const dv = this.uvDelta(enemy.surfaceV, player.surfaceV, wrapsV);
          const dist = Math.sqrt(du * du + dv * dv);
          if (dist > 0.001) {
            ai.dashDirU = du / dist;
            ai.dashDirV = dv / dist;
          }
        }
        if (ai.stateTimer >= 1.0) {
          ai.lurkerState = 2; // → dashing
          ai.stateTimer = 0;
        }
        break;
      }
      case 2: { // Dashing: 3× normal speed toward locked direction for 0.5s
        const DASH_SPEED = 0.105; // 3 × normal lurker speed (~0.035)
        enemy.surfaceU += (ai.dashDirU ?? 0) * DASH_SPEED * dt;
        enemy.surfaceV += (ai.dashDirV ?? 0) * DASH_SPEED * dt;
        this.applyUVBounds(enemy, wrapsV, surfType);
        if (ai.stateTimer >= 0.5) {
          ai.lurkerState = 3; // → cooldown
          ai.stateTimer = 0;
        }
        break;
      }
      case 3: { // Cooldown: waits 1.5s then returns to idle
        if (ai.stateTimer >= 1.5) {
          ai.lurkerState = 0; // → idle
          ai.stateTimer = 0;
          ai.nextDirectionChange = 2 + Math.random(); // new random idle duration
        }
        break;
      }
    }
  }

  /** Repulsor: state machine — lock (slow approach) → charge (AWAY from player) → recovery */
  private updateRepulsor(
    enemy: EnemyState, ai: ServerEnemyAI, player: PlayerState | null,
    dt: number, wrapsV: boolean, surfType: string
  ): void {
    ai.phaseTimer = (ai.phaseTimer ?? 0) + dt;

    switch (ai.repulsorPhase ?? 0) {
      case 0: { // Lock: moves slowly toward player, picks charge direction after 2s
        if (player) {
          const du = this.uvDelta(enemy.surfaceU, player.surfaceU, true);
          const dv = this.uvDelta(enemy.surfaceV, player.surfaceV, wrapsV);
          const dist = Math.sqrt(du * du + dv * dv);
          if (dist > 0.01) {
            const LOCK_SPEED = 0.03;
            enemy.surfaceU += (du / dist) * LOCK_SPEED * dt;
            enemy.surfaceV += (dv / dist) * LOCK_SPEED * dt;
            this.applyUVBounds(enemy, wrapsV, surfType);
          }
          if (ai.phaseTimer >= 2.0) {
            // Charge direction: AWAY from player (enemy - player direction)
            const awayU = this.uvDelta(player.surfaceU, enemy.surfaceU, true);
            const awayV = this.uvDelta(player.surfaceV, enemy.surfaceV, wrapsV);
            const awayDist = Math.sqrt(awayU * awayU + awayV * awayV);
            if (awayDist > 0.001) {
              ai.chargeTargetU = awayU / awayDist; // normalized direction
              ai.chargeTargetV = awayV / awayDist;
            } else {
              const angle = Math.random() * Math.PI * 2;
              ai.chargeTargetU = Math.cos(angle);
              ai.chargeTargetV = Math.sin(angle);
            }
            ai.repulsorPhase = 1; // → charge
            ai.phaseTimer = 0;
          }
        }
        break;
      }
      case 1: { // Charge: blasts AWAY from player at high speed for 0.8s
        const CHARGE_SPEED = 0.18;
        enemy.surfaceU += (ai.chargeTargetU ?? 0) * CHARGE_SPEED * dt;
        enemy.surfaceV += (ai.chargeTargetV ?? 0) * CHARGE_SPEED * dt;
        this.applyUVBounds(enemy, wrapsV, surfType);
        if (ai.phaseTimer >= 0.8) {
          ai.repulsorPhase = 2; // → recovery
          ai.phaseTimer = 0;
        }
        break;
      }
      case 2: { // Recovery: stationary pause for 1s then back to lock
        if (ai.phaseTimer >= 1.0) {
          ai.repulsorPhase = 0; // → lock
          ai.phaseTimer = 0;
        }
        break;
      }
    }
  }

  /** Spawner: slow drift toward player, periodically spawns 2–3 spawnlets */
  private updateSpawner(
    enemy: EnemyState, ai: ServerEnemyAI, player: PlayerState | null,
    dt: number, wrapsV: boolean, surfType: string
  ): void {
    // Very slow drift toward player (0.02 UV/s)
    if (player) {
      const du = this.uvDelta(enemy.surfaceU, player.surfaceU, true);
      const dv = this.uvDelta(enemy.surfaceV, player.surfaceV, wrapsV);
      const dist = Math.sqrt(du * du + dv * dv);
      if (dist > 0.01) {
        const SPAWNER_DRIFT = 0.02;
        enemy.surfaceU += (du / dist) * SPAWNER_DRIFT * dt;
        enemy.surfaceV += (dv / dist) * SPAWNER_DRIFT * dt;
        this.applyUVBounds(enemy, wrapsV, surfType);
      }
    }

    // Spawn timer: every 8 seconds, spawn 2–3 spawnlet enemies
    ai.spawnTimer = (ai.spawnTimer ?? 0) + dt;
    if (ai.spawnTimer >= 8.0) {
      ai.spawnTimer = 0;
      const count = 2 + Math.floor(Math.random() * 2); // 2 or 3
      for (let i = 0; i < count; i++) {
        this.spawnEnemyNearPosition('spawnlet', enemy.surfaceU, enemy.surfaceV);
      }
    }
  }

  /** Painter: random walk with frequent direction changes */
  private updatePainter(
    enemy: EnemyState, ai: ServerEnemyAI,
    dt: number, wrapsV: boolean, surfType: string
  ): void {
    if (ai.directionU === undefined || ai.directionV === undefined) {
      const angle = Math.random() * Math.PI * 2;
      ai.directionU = Math.cos(angle);
      ai.directionV = Math.sin(angle);
      ai.directionChangeTimer = 0;
      ai.nextDirectionChange = 0.5 + Math.random() * 1.5;
    }
    ai.directionChangeTimer = (ai.directionChangeTimer ?? 0) + dt;
    if (ai.directionChangeTimer >= (ai.nextDirectionChange ?? 1)) {
      const angle = Math.random() * Math.PI * 2;
      ai.directionU = Math.cos(angle);
      ai.directionV = Math.sin(angle);
      ai.directionChangeTimer = 0;
      ai.nextDirectionChange = 0.5 + Math.random() * 1.5;
    }
    const PAINTER_SPEED = 0.04;
    enemy.surfaceU += ai.directionU * PAINTER_SPEED * dt;
    enemy.surfaceV += ai.directionV * PAINTER_SPEED * dt;
    this.applyUVBounds(enemy, wrapsV, surfType);
  }

  /** GiantWanderer: slow wanderer with longer direction intervals */
  private updateGiantWanderer(
    enemy: EnemyState, ai: ServerEnemyAI,
    dt: number, wrapsV: boolean, surfType: string
  ): void {
    if (ai.directionU === undefined || ai.directionV === undefined) {
      const angle = Math.random() * Math.PI * 2;
      ai.directionU = Math.cos(angle);
      ai.directionV = Math.sin(angle);
      ai.directionChangeTimer = 0;
      ai.nextDirectionChange = 2 + Math.random() * 2;
    }
    ai.directionChangeTimer = (ai.directionChangeTimer ?? 0) + dt;
    if (ai.directionChangeTimer >= (ai.nextDirectionChange ?? 2)) {
      const angle = Math.random() * Math.PI * 2;
      ai.directionU = Math.cos(angle);
      ai.directionV = Math.sin(angle);
      ai.directionChangeTimer = 0;
      ai.nextDirectionChange = 2 + Math.random() * 2;
    }
    const GIANT_WANDER_SPEED = 0.025;
    enemy.surfaceU += ai.directionU * GIANT_WANDER_SPEED * dt;
    enemy.surfaceV += ai.directionV * GIANT_WANDER_SPEED * dt;
    this.applyUVBounds(enemy, wrapsV, surfType);
  }

  /** GiantRocket: straight-line trajectory (reuses rocket logic) */
  private updateGiantRocket(
    enemy: EnemyState, ai: ServerEnemyAI,
    dt: number, wrapsV: boolean, surfType: string
  ): void {
    // Giant variant uses same trajectory as rocket but getEnemySpeed handles the difference
    this.updateRocket(enemy, ai, dt, wrapsV, surfType);
  }

  /** GiantNeutron: straight-line bounce (reuses neutron logic) */
  private updateGiantNeutron(
    enemy: EnemyState, ai: ServerEnemyAI,
    dt: number, wrapsV: boolean, surfType: string
  ): void {
    this.updateNeutron(enemy, ai, dt, wrapsV, surfType);
  }

  /** TitanGrunt: heavy, faster-accelerating grunt */
  private updateTitanGrunt(
    enemy: EnemyState, ai: ServerEnemyAI, player: PlayerState | null,
    dt: number, wrapsV: boolean, surfType: string
  ): void {
    ai.currentSpeed = Math.min(0.08, (ai.currentSpeed ?? 0.03) + 0.003 * dt);
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

  /** TitanSpinner: larger wobble radius, faster chase than regular spinner */
  private updateTitanSpinner(
    enemy: EnemyState, ai: ServerEnemyAI, player: PlayerState | null,
    dt: number, wrapsV: boolean, surfType: string
  ): void {
    if (!player) return;
    const TITAN_SPINNER_SPEED = 0.045;
    const WOBBLE_AMOUNT = 0.12;
    const wobbleU = (Math.random() - 0.5) * WOBBLE_AMOUNT;
    const wobbleV = (Math.random() - 0.5) * WOBBLE_AMOUNT;
    const targetU = player.surfaceU + wobbleU;
    const targetV = player.surfaceV + wobbleV;
    const du = this.uvDelta(enemy.surfaceU, targetU, true);
    const dv = this.uvDelta(enemy.surfaceV, targetV, wrapsV);
    const dist = Math.sqrt(du * du + dv * dv);
    if (dist > 0.01) {
      enemy.surfaceU += (du / dist) * TITAN_SPINNER_SPEED * dt;
      enemy.surfaceV += (dv / dist) * TITAN_SPINNER_SPEED * dt;
      this.applyUVBounds(enemy, wrapsV, surfType);
    }
  }

  /** TitanWeaver: momentum-based chase with higher speed cap than regular weaver */
  private updateTitanWeaver(
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
        ai.momentumU += (du / dist) * 0.4 * dt;
        ai.momentumV += (dv / dist) * 0.4 * dt;
      }
    }
    ai.momentumU *= 0.90;
    ai.momentumV *= 0.90;
    const spd = Math.sqrt(ai.momentumU * ai.momentumU + ai.momentumV * ai.momentumV);
    const MAX_SPEED = 0.06;
    if (spd > MAX_SPEED) {
      ai.momentumU = (ai.momentumU / spd) * MAX_SPEED;
      ai.momentumV = (ai.momentumV / spd) * MAX_SPEED;
    }
    enemy.surfaceU += ai.momentumU * dt;
    enemy.surfaceV += ai.momentumV * dt;
    this.applyUVBounds(enemy, wrapsV, surfType);
  }

  /**
   * Spawn an enemy of the given type near a specific UV position.
   * Used by the Spawner enemy to create spawnlets around itself.
   * Does not send a pre_spawn warning (spawnlets appear immediately).
   */
  private spawnEnemyNearPosition(type: string, u: number, v: number): void {
    const maxEnemies = this.getMaxEnemies();
    if (this.state.enemies.length + this.pendingEnemyCount >= maxEnemies) return;
    if (this.state.roomPhase !== 'playing') return;

    const enemy = new EnemyState();
    enemy.id = `e${this.nextEnemyId++}`;
    enemy.type = type;
    // Small random offset from spawner position
    const offsetU = (Math.random() - 0.5) * 0.06;
    const offsetV = (Math.random() - 0.5) * 0.06;
    enemy.surfaceU = Math.max(0.05, Math.min(0.95, u + offsetU));
    enemy.surfaceV = Math.max(0.05, Math.min(0.95, v + offsetV));
    enemy.health = this.getEnemyHealth(type);
    enemy.alive = true;
    this.enemyAI.set(enemy.id, this.createEnemyAI(type));
    this.state.enemies.push(enemy);
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
    } else if (surfType === 'sphere' || surfType === 'sphere-tunnel'
        || surfType === 'icosahedron' || surfType === 'capsule' || surfType === 'peanut') {
      // Sphere-like surfaces have poles at V=0 and V=1. Reflect through them
      // instead of clamping so enemies can cross poles to chase players.
      // Without this, enemies cluster at the pole boundary (V=0.05/0.95)
      // and cannot reach players on the other side.
      if (enemy.surfaceV < 0) {
        enemy.surfaceV = -enemy.surfaceV;
        enemy.surfaceU = this.wrapCoord(enemy.surfaceU + 0.5);
      } else if (enemy.surfaceV > 1) {
        enemy.surfaceV = 2 - enemy.surfaceV;
        enemy.surfaceU = this.wrapCoord(enemy.surfaceU + 0.5);
      }
      enemy.surfaceV = Math.max(0.001, Math.min(0.999, enemy.surfaceV));
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
      case 'duck':
        return {
          duckDirection: Math.floor(Math.random() * 4),
          duckTimer: 0,
        };
      case 'spinner':
        return {
          jitterOffsetU: (Math.random() - 0.5) * 0.15,
          jitterOffsetV: (Math.random() - 0.5) * 0.15,
          jitterTimer: 0,
        };
      case 'swarm':
        return { currentSpeed: 0.03, maxSpeed: 0.055 };
      case 'approach_glow':
        return { currentSpeed: 0.02, maxSpeed: 0.055 };
      case 'lurker':
        return {
          lurkerState: 0,
          stateTimer: 0,
          dashDirU: 0,
          dashDirV: 0,
          nextDirectionChange: 2 + Math.random(), // idle duration: 2-3s
        };
      case 'orbiter':
        return {
          orbitAngle: Math.random() * Math.PI * 2,
          orbitRadius: 0.15,
          orbitDirection: Math.random() < 0.5 ? 1 : -1,
          reverseTimer: 0,
          nextReverse: 3 + Math.random() * 2,
        };
      case 'helix':
        return { corkscrewPhase: 0 };
      case 'repulsor':
        return { repulsorPhase: 0, phaseTimer: 0 };
      case 'spawner':
        return { spawnTimer: 0 };
      case 'painter':
      case 'giant_wanderer': {
        const angle = Math.random() * Math.PI * 2;
        return {
          directionU: Math.cos(angle),
          directionV: Math.sin(angle),
          directionChangeTimer: 0,
          nextDirectionChange: 1 + Math.random() * 2,
        };
      }
      case 'giant_rocket':
      case 'giant_neutron': {
        const angle = Math.random() * Math.PI * 2;
        return {
          rocketDirU: Math.cos(angle),
          rocketDirV: Math.sin(angle),
        };
      }
      case 'titan_grunt':
        return { currentSpeed: 0.03 };
      case 'titan_weaver':
        return { momentumU: 0, momentumV: 0 };
      default:
        return {};
    }
  }

  private getEnemySpeed(type: string): number {
    return ENEMY_SPEEDS[type] ?? 0.035;
  }

  private checkCollisions() {
    const scaleFactor = getMapScaleFactor(this.state.mapSize || 'medium');
    const surfaceType = this.state.surfaceType;

    // S43-07: Surfaces that use 3D world-space chord/arc distance for player-enemy collision.
    // UV Euclidean distance is badly distorted on these:
    //   - sphere/capsule/icosahedron: U metric shrinks at poles (up to 3× error)
    //   - peanut: same spherical UV distortion as sphere (up to 5× error at bulge)
    //   - torus: V direction (around big ring, R=6) → 0.04 UV ≈ 1.51 world units (3× error)
    //   - cube-ring: U direction (around big ring, R=6) → 0.04 UV ≈ 1.51 world units (3× error)
    const isSphereLike = surfaceType === 'sphere' || surfaceType === 'sphere-tunnel'
      || surfaceType === 'capsule' || surfaceType === 'icosahedron';
    const usesWorldDist = isSphereLike
      || surfaceType === 'peanut'
      || surfaceType === 'torus'
      || surfaceType === 'cube-ring';
    const sphereR = 10 * scaleFactor;

    // --- World-space thresholds (surfaces using 3D chord/arc distance, in world units) ---
    // S43-07: Reduced ENEMY_HIT_WORLD from 0.5 → 0.4 to match SP CollisionSystem.ts:
    //   hitRadius = player.mesh.scale.x * 0.1 + enemy.radius = 0.1 + 0.3 = 0.4 world units.
    //   The previous 0.5 was ~25% too large, causing early deaths on sphere, peanut, etc.
    // Entity sizes do NOT scale with map size, so these are fixed world-unit values.
    const ENEMY_HIT_WORLD   = 0.4;   // matches SP: player(0.1) + enemy(0.3) = 0.4
    const GEOM_WORLD        = 0.7;   // geoms: generous collection radius
    const PICKUP_WORLD      = 0.6;   // matches client-side PICKUP_WORLD_RADIUS

    // --- UV thresholds (remaining surfaces without exact 3D formula) ---
    // Bullet-enemy: 0.015 (up from 0.012) for anti-tunneling margin — unchanged.
    // Enemy-player: 0.04 remains for surfaces not in usesWorldDist (cube, pill, mobius, etc.)
    //   For torus and cube-ring, these are now handled by torusChordDist/cubeRingChordDist above.
    const BULLET_HIT_RADIUS = 0.015 / scaleFactor;
    const ENEMY_HIT_RADIUS  = 0.04  / scaleFactor;  // UV-space fallback for misc surfaces
    const GEOM_RADIUS       = 0.025 / scaleFactor;  // was 0.05
    const PICKUP_RADIUS     = 0.02  / scaleFactor;  // was 0.04

    // Bullet-enemy collisions
    const bulletsToRemove: number[] = [];
    const enemiesToRemove: number[] = [];
    // S43-02: Track consumed bullets to prevent one bullet hitting multiple enemies.
    // Without this, a bullet near two enemies applies damage to both AND pushes the
    // same index twice into bulletsToRemove, causing an unrelated bullet to be removed.
    const hitBullets = new Set<number>();

    this.state.bullets.forEach((bullet, bIndex) => {
      if (hitBullets.has(bIndex)) return; // Already consumed by an earlier enemy hit

      this.state.enemies.forEach((enemy, eIndex) => {
        if (!enemy.alive) return;
        if (hitBullets.has(bIndex)) return; // Already consumed within this bullet's loop

        // Use wrap-aware UV distance so bullets crossing the U or V seam
        // still hit enemies on the other side (critical on torus where both axes wrap).
        const dist = this.uvDistWrapped(bullet.x, bullet.y, enemy.surfaceU, enemy.surfaceV);

        // S28b: UV-space hit threshold calibrated to match visual enemy size.
        // Sphere radius=10 → V arc length = π*10 ≈ 31.4 world units per UV unit.
        // Enemy visual radius ≈ 0.25 world units → 0.25 / 31.4 ≈ 0.008 UV.
        // Using 0.015 (up from 0.012) for anti-tunneling margin; scaled by map size.
        // Previous value 0.05 = ~1.57 world units = 6x visual size → enemies died from far away.
        if (dist < BULLET_HIT_RADIUS) {
          hitBullets.add(bIndex);
          // Hit! Apply weapon damage with full damage formula:
          //   finalDamage = baseDamage × levelDamageMult × buffDamageMult × masteryDamageMult
          // NOTE: SP also multiplies by scorePowerMult (kill-streak multiplier) but in MP
          // player.multiplier is an integer used for SCORE only — it is NOT applied to damage here
          // to avoid wildly inflated damage at high multipliers.
          const owner = this.state.players.get(bullet.ownerId);
          const weaponCfg = WEAPON_CONFIGS[owner?.weaponType ?? 'standard'] ?? WEAPON_CONFIGS.standard;
          const baseDamage = weaponCfg.damage;
          const levelIdx = Math.min(owner?.playerLevel ?? 0, LEVEL_DAMAGE_MULTIPLIERS.length - 1);
          const levelDamageMult = LEVEL_DAMAGE_MULTIPLIERS[levelIdx];
          const buffDamageMult = owner ? this.calculateBuffDamageMult(owner) : 1.0;
          const masteryDamageMult = 1.0; // TODO: weapon mastery damage multiplier
          const finalDamage = baseDamage * levelDamageMult * buffDamageMult * masteryDamageMult;
          enemy.health -= finalDamage;

          if (enemy.health <= 0) {
            enemy.alive = false;
            this.enemyAI.delete(enemy.id);
            enemiesToRemove.push(eIndex);

            if (owner) {
              owner.score += this.getEnemyScore(enemy.type) * owner.multiplier;
              owner.playerKills++;
              const newLevel = this.getPlayerLevel(owner.playerKills);
              if (newLevel > owner.playerLevel) {
                owner.playerLevel = newLevel;
                this.broadcast('player_level_up', { playerId: owner.id, newLevel, playerName: owner.name });
              }
              // DDA: track kill for this player
              this.trackDDAKill(bullet.ownerId);
            }

            // Geoms removed (s27g-geons-point-pickups-remove-mp)
            // this.spawnGeom(enemy.surfaceU, enemy.surfaceV);

            // Chance to spawn weapon pickup
            if (Math.random() < WEAPON_DROP_CHANCE) {
              this.spawnWeaponPickup(enemy.surfaceU, enemy.surfaceV);
            }

            // Chance to spawn a damage-affecting buff pickup
            if (Math.random() < BUFF_PICKUP_DROP_CHANCE) {
              this.spawnBuffPickup(enemy.surfaceU, enemy.surfaceV);
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

        // S43-07: Use 3D world-space chord distance for surfaces with UV distortion.
        // sphere/capsule/icosahedron: great-circle arc distance (S38b fix, spherical UV).
        // peanut/torus/cube-ring: exact chord distance via parametric formula (S43-07 fix).
        // Other surfaces: wrap-aware UV Euclidean distance unchanged.
        const dist = usesWorldDist
          ? surfaceWorldDist(surfaceType, player.surfaceU, player.surfaceV, enemy.surfaceU, enemy.surfaceV, scaleFactor, sphereR)
          : this.uvDistWrapped(player.surfaceU, player.surfaceV, enemy.surfaceU, enemy.surfaceV);
        const hitThreshold = usesWorldDist ? ENEMY_HIT_WORLD : ENEMY_HIT_RADIUS;

        if (dist < hitThreshold) {
          // Player hit!
          wasHit = true;
          hitEnemyIds.add(enemy.id); // Mark enemy as spent for this tick
          player.lives--;

          // If player had a meaningful multiplier, spawn a multiplier_boost pickup
          // at the death spot so surviving players can capitalize on it.
          if (player.multiplier > 5) {
            this.spawnSuperPickup('multiplier_boost');
            this.logger.log(`[GameRoom] Spawned multiplier_boost (player had ×${player.multiplier})`);
          }
          player.multiplier = 1;
          // DDA: track death event for this player
          this.trackDDADeath(player.id);

          // Reset buff stacks on any hit (lose buffs on death, same as SP)
          player.buffStacks.clear();

          if (player.lives <= 0) {
            player.alive = false;
            this.logger.log(`[GameRoom] ${player.name} died!`);
          } else {
            // S41-03: Respawn at a random location away from death spot and enemies.
            // Old S31 fix kept player at hit location; user now explicitly wants
            // respawn elsewhere so they don't get immediately killed again.
            const deathU = player.surfaceU;
            const deathV = player.surfaceV;
            const respawnPos = this.getPlayerRespawnPosition(deathU, deathV);
            player.surfaceU = respawnPos.u;
            player.surfaceV = respawnPos.v;
            this.playerInvincibility.set(player.id, 2.0);
            this.logger.log(`[GameRoom] ${player.name} hit, ${player.lives} lives remaining — respawned at (${respawnPos.u.toFixed(2)}, ${respawnPos.v.toFixed(2)}) (invincible 2s)`);
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

        const dist = usesWorldDist
          ? surfaceWorldDist(surfaceType, player.surfaceU, player.surfaceV, geom.surfaceU, geom.surfaceV, scaleFactor, sphereR)
          : this.uvDistWrapped(player.surfaceU, player.surfaceV, geom.surfaceU, geom.surfaceV);
        const geomThreshold = usesWorldDist ? GEOM_WORLD : GEOM_RADIUS;

        if (dist < geomThreshold) {
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

        const dist = usesWorldDist
          ? surfaceWorldDist(surfaceType, player.surfaceU, player.surfaceV, pickup.surfaceU, pickup.surfaceV, scaleFactor, sphereR)
          : this.uvDistWrapped(player.surfaceU, player.surfaceV, pickup.surfaceU, pickup.surfaceV);
        const pickupThreshold = usesWorldDist ? PICKUP_WORLD : PICKUP_RADIUS;

        if (dist < pickupThreshold) {
          pickup.active = false;
          pickupsToRemove.push(index);

          const cfg = WEAPON_CONFIGS[pickup.weaponType] ?? WEAPON_CONFIGS.standard;
          player.weaponType = pickup.weaponType;
          player.weaponAmmo = cfg.ammo;
        }
      });
    });

    // Player-buffPickup collisions
    const buffPickupsToRemove: number[] = [];
    this.state.players.forEach((player) => {
      if (!player.alive) return;

      this.state.buffPickups.forEach((pickup, index) => {
        if (!pickup.active) return;

        const dist = usesWorldDist
          ? surfaceWorldDist(surfaceType, player.surfaceU, player.surfaceV, pickup.surfaceU, pickup.surfaceV, scaleFactor, sphereR)
          : this.uvDistWrapped(player.surfaceU, player.surfaceV, pickup.surfaceU, pickup.surfaceV);
        const threshold = usesWorldDist ? PICKUP_WORLD : PICKUP_RADIUS;

        if (dist < threshold) {
          pickup.active = false;
          buffPickupsToRemove.push(index);

          const current = player.buffStacks.get(pickup.buffType) ?? 0;
          player.buffStacks.set(pickup.buffType, Math.min(current + 1, BUFF_STACK_MAX));
          this.logger.log(`[GameRoom] ${player.name} collected ${pickup.buffType} buff (now ${player.buffStacks.get(pickup.buffType)}×)`);
        }
      });
    });

    // Player-superPickup collisions
    const superPickupsToRemove: number[] = [];
    this.state.players.forEach((player) => {
      if (!player.alive) return;

      this.state.superPickups.forEach((pickup, index) => {
        if (!pickup.active) return;

        const dist = usesWorldDist
          ? surfaceWorldDist(surfaceType, player.surfaceU, player.surfaceV, pickup.surfaceU, pickup.surfaceV, scaleFactor, sphereR)
          : this.uvDistWrapped(player.surfaceU, player.surfaceV, pickup.surfaceU, pickup.surfaceV);
        const threshold = usesWorldDist ? PICKUP_WORLD : PICKUP_RADIUS;

        if (dist < threshold) {
          pickup.active = false;
          superPickupsToRemove.push(index);

          if (pickup.pickupType === 'bomb_resupply') {
            player.bombs = Math.min(player.bombs + 2, 5);
          } else if (pickup.pickupType === 'multiplier_boost') {
            player.multiplier = Math.min(player.multiplier + 10, 150);
          }
          this.logger.log(`[GameRoom] Player ${player.id} collected ${pickup.pickupType} super pickup`);
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
    for (let i = superPickupsToRemove.length - 1; i >= 0; i--) {
      this.state.superPickups.splice(superPickupsToRemove[i], 1);
    }
    for (let i = buffPickupsToRemove.length - 1; i >= 0; i--) {
      this.state.buffPickups.splice(buffPickupsToRemove[i], 1);
    }
  }

  private getEnemyScore(type: string): number {
    return ENEMY_SCORES[type] ?? 25;
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

    // Every SUPER_PICKUP_WAVE_INTERVAL waves, spawn a bomb resupply super pickup.
    // This gives players a periodic reward for surviving and adds MP tension (race to collect).
    if (this.waveNumber % SUPER_PICKUP_WAVE_INTERVAL === 0) {
      this.spawnSuperPickup('bomb_resupply');
      this.logger.log(`[GameRoom] Spawned bomb_resupply super pickup at wave ${this.waveNumber}`);
    }

    // Decrease interval over time (same formula as WaveScheduler)
    const nextInterval = Math.max(WAVE_INTERVAL_MIN, WAVE_INTERVAL_BASE - this.waveNumber * WAVE_INTERVAL_DECAY);
    this.nextWaveAt = this.waveElapsed + nextInterval;
  }

  /**
   * Compute the player level (0–9) from total kills.
   * Mirrors getLevel() logic in src/core/PlayerLevel.ts.
   */
  private getPlayerLevel(kills: number): number {
    let level = 0;
    for (let i = 1; i < LEVEL_THRESHOLDS.length; i++) {
      if (kills >= LEVEL_THRESHOLDS[i]) level = i;
      else break;
    }
    return level;
  }

  /**
   * Compute a simple difficulty level from wave number, elapsed game time, and player count.
   * Avoids dependency on score/kills/combo (not reliably aggregated server-side).
   *
   * Calibration (1 player):
   *   wave 1 = 0.0, wave 10 ≈ 2.7, wave 20 ≈ 5.4, wave 27+ = 8.0 cap
   *
   * Player count bonus: each additional player adds +0.3 difficulty levels.
   *   1p → +0.0, 2p → +0.3, 3p → +0.6, 4p → +0.9
   * Rationale: co-op groups kill enemies faster, so harder types must arrive sooner.
   * Note: enemy COUNT scaling is handled separately in spawnWave() (1.0x / 1.5x / 2.0x / 2.5x).
   */
  private computeDifficultyLevel(): number {
    const waveContrib = Math.max(0, (this.waveNumber - 1) * 0.3);
    const timeContrib = this.state.gameTime / 600; // +1 level per 10 minutes
    const playerCount = Math.max(1, this.state.players.size);
    const playerCountBonus = (playerCount - 1) * 0.3; // matches DifficultyScaling.ts formula
    return Math.min(8.0, waveContrib + timeContrib + playerCountBonus);
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

    // DDA wave size reduction: if any player is struggling (ddaLevel >= 2),
    // reduce base wave count by 20% to give them a chance to recover.
    let ddaWaveMultiplier = 1.0;
    this.state.players.forEach((player) => {
      if (player.ddaLevel >= 2) ddaWaveMultiplier = 0.8;
    });

    // Base count grows with wave number and difficulty
    const difficultyCountBonus = Math.floor(difficultyLevel * 2.0);
    const baseCountCap = difficultyLevel >= 6 ? 40 : 30;
    const baseCount = Math.min(baseCountCap,
      Math.round((4 + Math.floor(Math.sqrt(waveNum) * 2) + difficultyCountBonus) * entityBrake * ddaWaveMultiplier));

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

    // Orbiter: late-game specialist (wave 8+, difficulty 1.5+)
    // Removed from mid-wave rotation — orbits player at high speed, too dangerous early.
    if (waveNum >= 8 && difficultyLevel >= 1.5) {
      entries.push({
        type: 'orbiter',
        count: Math.min(Math.round((1 + Math.floor((difficultyLevel - 1.5) * 0.5)) * entityBrake), 4),
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
    // Struggling players (ddaLevel >= 2) get a larger exclusion zone so enemies
    // don't spawn near them, giving them more time to react.
    const DDA_MIN_DIST = 0.35;

    // Collect alive player UV positions, flagging struggling ones
    const normalPlayers: Array<{ u: number; v: number }> = [];
    const strugglingPlayers: Array<{ u: number; v: number }> = [];
    this.state.players.forEach((p) => {
      if (!p.alive) return;
      if (p.ddaLevel >= 2) {
        strugglingPlayers.push({ u: p.surfaceU, v: p.surfaceV });
      } else {
        normalPlayers.push({ u: p.surfaceU, v: p.surfaceV });
      }
    });

    // Prefer to target non-struggling players when possible; fall back to struggling if no others
    const targetPool = normalPlayers.length > 0 ? normalPlayers : strugglingPlayers;

    if (targetPool.length > 0) {
      // Spawn on a ring around a random non-struggling player (MIN_DIST..MAX_DIST away in UV).
      // This keeps the ring in the player's "visible hemisphere" so they can
      // actually see the warning before the enemy arrives.
      for (let attempt = 0; attempt < 20; attempt++) {
        const target = targetPool[Math.floor(Math.random() * targetPool.length)];
        const angle = Math.random() * 2 * Math.PI;
        const dist = MIN_DIST + Math.random() * (MAX_DIST - MIN_DIST);

        // Wrap U, clamp V to avoid pole singularities
        const u = ((target.u + dist * Math.cos(angle)) % 1 + 1) % 1;
        const v = Math.max(vMin, Math.min(vMax, target.v + dist * Math.sin(angle)));

        // Confirm it is far enough from ALL players.
        // Normal players use MIN_DIST; struggling players use DDA_MIN_DIST.
        let farEnough = true;
        for (const p of normalPlayers) {
          let du = Math.abs(u - p.u);
          if (du > 0.5) du = 1 - du;
          const dv = Math.abs(v - p.v);
          if (Math.sqrt(du * du + dv * dv) < MIN_DIST) {
            farEnough = false;
            break;
          }
        }
        if (farEnough) {
          for (const p of strugglingPlayers) {
            let du = Math.abs(u - p.u);
            if (du > 0.5) du = 1 - du;
            const dv = Math.abs(v - p.v);
            if (Math.sqrt(du * du + dv * dv) < DDA_MIN_DIST) {
              farEnough = false;
              break;
            }
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
   * Pick a respawn position for a player that just lost a life (S41-03).
   * Returns a UV position that is at least MIN_RESPAWN_DIST away from the
   * death position and clears active enemies by ENEMY_CLEAR_DIST.
   * Falls back to an offset from the death position if 20 attempts fail.
   */
  private getPlayerRespawnPosition(deathU: number, deathV: number): { u: number; v: number } {
    const vMin = 0.05;
    const vMax = 0.95;
    const MIN_RESPAWN_DIST = 0.3;  // at least 0.3 UV units from death position
    const ENEMY_CLEAR_DIST = 0.1;  // stay at least 0.1 UV units from enemies

    for (let attempt = 0; attempt < 20; attempt++) {
      const u = 0.1 + Math.random() * 0.8;
      const v = vMin + Math.random() * (vMax - vMin);

      // Wrap-aware distance from death position
      let du = Math.abs(u - deathU);
      if (du > 0.5) du = 1 - du;
      const dv = Math.abs(v - deathV);
      if (Math.sqrt(du * du + dv * dv) < MIN_RESPAWN_DIST) continue;

      // Stay clear of all alive enemies
      let clearOfEnemies = true;
      this.state.enemies.forEach((enemy) => {
        if (!enemy.alive) return;
        let edu = Math.abs(u - enemy.surfaceU);
        if (edu > 0.5) edu = 1 - edu;
        const edv = Math.abs(v - enemy.surfaceV);
        if (Math.sqrt(edu * edu + edv * edv) < ENEMY_CLEAR_DIST) {
          clearOfEnemies = false;
        }
      });
      if (!clearOfEnemies) continue;

      return { u, v };
    }

    // Fallback: place 0.4–0.5 UV units away in U direction, random V
    const fallbackU = ((deathU + 0.4 + Math.random() * 0.1) % 1 + 1) % 1;
    const fallbackV = vMin + Math.random() * (vMax - vMin);
    return { u: fallbackU, v: fallbackV };
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
    return ENEMY_HEALTH[type] ?? 1;
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

  // ---------------------------------------------------------------------------
  // Server-side DDA (Dynamic Difficulty Adjustment)
  // ---------------------------------------------------------------------------

  /** Record a kill for the player that owns the given sessionId. */
  private trackDDAKill(sessionId: string) {
    const window = this.playerPerfWindows.get(sessionId);
    if (window) window.kills++;
  }

  /** Record a life-loss (hit) for the player with the given sessionId. */
  private trackDDADeath(sessionId: string) {
    const window = this.playerPerfWindows.get(sessionId);
    if (window) window.deaths++;
  }

  /**
   * Update DDA levels every 5 seconds.
   * Evaluates each player's kill/death window and adjusts ddaLevel:
   *   - Increase: recentDeaths >= 3 AND recentKills < 5  → +1 (fast, every update)
   *   - Decrease: recentDeaths == 0 AND recentKills >= 10 → -1 (slow, every 2 updates)
   * Hysteresis: levels increase every evaluation, but decrease only every other.
   */
  private updateDDA(dt: number) {
    this.ddaUpdateTimer += dt;
    if (this.ddaUpdateTimer < 5.0) return;
    this.ddaUpdateTimer -= 5.0;

    const currentTime = this.state.gameTime;

    this.state.players.forEach((player, sessionId) => {
      // Get or init perf window
      let perfWindow = this.playerPerfWindows.get(sessionId);
      if (!perfWindow) {
        perfWindow = { kills: 0, deaths: 0, windowStart: currentTime };
        this.playerPerfWindows.set(sessionId, perfWindow);
      }

      const { kills, deaths } = perfWindow;

      // Evaluate thresholds
      const isStruggling = deaths >= 3 && kills < 5;
      const isExcelling = deaths === 0 && kills >= 10;

      if (isStruggling) {
        // Increase difficulty aid (lower is easier — level 3 = most help)
        player.ddaLevel = Math.min(3, player.ddaLevel + 1);
        this.logger.log(`[DDA] ${player.name}: struggling (${deaths}d/${kills}k) → level ${player.ddaLevel}`);
      } else if (isExcelling) {
        // Decrease difficulty aid slowly (hysteresis: only every 2 evaluations)
        const counter = (this.ddaDecreaseCounters.get(sessionId) ?? 0) + 1;
        this.ddaDecreaseCounters.set(sessionId, counter);
        if (counter >= 2) {
          player.ddaLevel = Math.max(0, player.ddaLevel - 1);
          this.ddaDecreaseCounters.set(sessionId, 0);
          this.logger.log(`[DDA] ${player.name}: excelling (${deaths}d/${kills}k) → level ${player.ddaLevel}`);
        }
      } else {
        // Reset decrease counter when neither condition holds
        this.ddaDecreaseCounters.set(sessionId, 0);
      }

      // Reset 30s window (windowStart tracks elapsed time; we reset every 5s evaluation
      // but the task spec calls for a 30s rolling window — so accumulate over 6 evaluations.
      // Simpler: reset each 30s by checking elapsed time).
      if (currentTime - perfWindow.windowStart >= 30.0) {
        perfWindow.kills = 0;
        perfWindow.deaths = 0;
        perfWindow.windowStart = currentTime;
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
    this.state.isPaused = false; // clear any in-game pause so voting screen shows cleanly
    this.state.votingCountdown = VOTING_COUNTDOWN_SECS;
    this.state.voteMap.clear();
    this.state.readyMap.clear();
    this.state.countdownPaused = false;
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

  /**
   * Calculate combined buff damage multiplier for a player.
   * Called every bullet hit — must be pure and fast.
   * Phase D: only 4 damage-affecting buffs. TriggerHappy affects fire rate, not damage (skipped here).
   * TODO: ShockAura, Magnetism, Afterburner, ToughTimes require physics effects — future phase
   */
  private calculateBuffDamageMult(player: PlayerState): number {
    let mult = 1.0;
    const hotHands = player.buffStacks.get('hot_hands') ?? 0;
    if (hotHands > 0) mult *= 1 + hotHands * 0.06;
    const volatile_ = player.buffStacks.get('volatile') ?? 0;
    if (volatile_ > 0) mult *= 1 + volatile_ * 0.08;
    const incendiary = player.buffStacks.get('incendiary_rounds') ?? 0;
    if (incendiary > 0) mult *= 1 + incendiary * 0.04;
    return Math.min(mult, 5.0); // cap at 5× to prevent exploits
  }

  private spawnBuffPickup(u: number, v: number) {
    const pickup = new BuffPickupState();
    pickup.id = `bp${this.nextBuffPickupId++}`;
    pickup.surfaceU = u + (Math.random() - 0.5) * 0.04;
    pickup.surfaceV = v + (Math.random() - 0.5) * 0.04;
    pickup.buffType = BUFF_PICKUP_TYPES[Math.floor(Math.random() * BUFF_PICKUP_TYPES.length)];
    pickup.active = true;
    pickup.age = 0;
    this.state.buffPickups.push(pickup);
  }

  private updateBuffPickups(dt: number) {
    const toRemove: number[] = [];
    this.state.buffPickups.forEach((pickup, index) => {
      if (!pickup.active) {
        toRemove.push(index);
        return;
      }
      pickup.age += dt;
      if (pickup.age > BUFF_PICKUP_LIFETIME) {
        pickup.active = false;
        toRemove.push(index);
      }
    });
    for (let i = toRemove.length - 1; i >= 0; i--) {
      this.state.buffPickups.splice(toRemove[i], 1);
    }
  }

  /**
   * Spawn a super pickup at a random UV position at least 0.3 away from all players.
   * Falls back to a random position if no safe location is found after 20 attempts.
   */
  private spawnSuperPickup(type: 'bomb_resupply' | 'multiplier_boost') {
    const MIN_DIST = 0.3; // minimum UV distance from any player
    let u = Math.random();
    let v = Math.max(0.05, Math.min(0.95, Math.random())); // clamp away from poles

    for (let attempt = 0; attempt < 20; attempt++) {
      const candidateU = Math.random();
      const candidateV = Math.max(0.05, Math.min(0.95, Math.random()));
      let tooClose = false;
      this.state.players.forEach((player) => {
        if (tooClose) return;
        const du = Math.abs(candidateU - player.surfaceU);
        const dv = Math.abs(candidateV - player.surfaceV);
        if (Math.sqrt(du * du + dv * dv) < MIN_DIST) tooClose = true;
      });
      if (!tooClose) {
        u = candidateU;
        v = candidateV;
        break;
      }
    }

    const pickup = new SuperPickupState();
    pickup.id = `sp${this.nextSuperPickupId++}`;
    pickup.surfaceU = u;
    pickup.surfaceV = v;
    pickup.pickupType = type;
    pickup.active = true;
    pickup.age = 0;
    this.state.superPickups.push(pickup);
  }

  private updateSuperPickups(dt: number) {
    const toRemove: number[] = [];
    this.state.superPickups.forEach((pickup, index) => {
      if (!pickup.active) {
        toRemove.push(index);
        return;
      }
      pickup.age += dt;
      if (pickup.age > SUPER_PICKUP_LIFETIME) {
        pickup.active = false;
        toRemove.push(index);
      }
    });
    for (let i = toRemove.length - 1; i >= 0; i--) {
      this.state.superPickups.splice(toRemove[i], 1);
    }
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
   * - If paused > INACTIVITY_SHUTDOWN_THRESHOLD: gracefully shutdown
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

    // If game is paused, check if it's been paused too long for shutdown
    if (this.state.isPaused && this.autoPausedTime !== null) {
      const pausedMs = now - this.autoPausedTime;
      const pausedSecs = pausedMs / 1000;

      // Check for auto-shutdown (15 minutes of pause)
      if (pausedSecs > INACTIVITY_SHUTDOWN_THRESHOLD) {
        this.logger.log(
          `[GameRoom] Server auto-shutdown triggered after ${pausedSecs.toFixed(1)}s of pause`
        );
        this.broadcast('game_ended', { reason: 'server_shutdown_idle' });
        this.disconnect();
        return;
      }
    } else {
      // Game is not paused, check if we should auto-pause due to inactivity
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
}

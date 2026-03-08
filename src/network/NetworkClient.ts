import { Client, Room } from 'colyseus.js';
import type { GameSettings } from '../../server/shared/GameSettings';

/** Player state from server */
export interface NetworkPlayerState {
  id: string;
  name: string;
  surfaceU: number;
  surfaceV: number;
  aimAngle: number;
  lives: number;
  bombs: number;
  score: number;
  multiplier: number;
  alive: boolean;
  shooting: boolean;
  color: number;
  weaponType: string;
  weaponAmmo: number;
  playerLevel: number;
  playerKills: number;
  /** PvP kill count: times this player killed another player. */
  kills?: number;
  /** PvP death count: times this player was killed by another player. */
  deaths?: number;
  /** PvPvE enemy kill count: enemies killed by this player (for leaderboard). */
  enemyKills?: number;
  /** Current health in PvP mode (0–maxHealth). */
  health?: number;
  /** Maximum health in PvP mode (synced for HUD display). */
  maxHealth?: number;
  /** Total damage dealt to other players this match (PvP mode). */
  totalDamageDealt?: number;
  /** Zone time in seconds: KotH (time in zone) or Claustrophobia (time inside boundary). */
  zoneTime?: number;
  /** Maps buff type → stack count. Present when server has Phase D enabled. */
  buffStacks?: { get(key: string): number | undefined; forEach(cb: (val: number, key: string) => void): void };
  /** Companion drone counts — synced so all clients render other players' drones (s44r2-04). */
  guardianCount?: number;
  hunterCount?: number;
  protectorCount?: number;
  // World-space position from ServerMeshWalker (Phase 4 — s44-epic-06)
  wx?: number; wy?: number; wz?: number;
  // Surface normal (world-space)
  nx?: number; ny?: number; nz?: number;
  // Tangent frame: tangent (surface "right") and bitangent (surface "forward"/camera upHint)
  tx?: number; ty?: number; tz?: number;
  bx?: number; by?: number; bz?: number;
  /** Face index under the walker (for telemetry/debugging) */
  walkerFaceIndex?: number;
}

/** Bullet state from server */
export interface NetworkBulletState {
  id: string;
  ownerId: string;
  x: number;
  y: number;
  z: number;
  dirX: number;
  dirY: number;
  dirZ: number;
  age: number;
  /** Weapon type that fired this bullet — set by server for dual-fire visual routing. */
  weaponType?: string;
}

/** Enemy state from server */
export interface NetworkEnemyState {
  id: string;
  type: string;
  surfaceU: number;
  surfaceV: number;
  health: number;
  alive: boolean;
}

/** Geom state from server */
export interface NetworkGeomState {
  id: string;
  surfaceU: number;
  surfaceV: number;
  active: boolean;
}

/** Weapon pickup state from server */
export interface NetworkWeaponPickupState {
  id: string;
  surfaceU: number;
  surfaceV: number;
  weaponType: string;
  age: number;
  active: boolean;
}

export interface NetworkSuperPickupState {
  id: string;
  surfaceU: number;
  surfaceV: number;
  /** 'bomb_resupply' | 'multiplier_boost' */
  pickupType: string;
  active: boolean;
  age: number;
}

/** Buff pickup state from server (Phase D: damage-affecting buffs) */
export interface NetworkBuffPickupState {
  id: string;
  surfaceU: number;
  surfaceV: number;
  /** e.g. 'hot_hands', 'trigger_happy', 'incendiary_rounds', 'volatile' */
  buffType: string;
  active: boolean;
  age: number;
}

/** Health pickup state from server (PvP mode — spawns near damaged players) */
export interface NetworkHealthPickupState {
  id: string;
  surfaceU: number;
  surfaceV: number;
  active: boolean;
  age: number;
}

/**
 * An array-like collection that supports forEach iteration.
 * Colyseus ArraySchema<T> is NOT a plain T[] but supports .forEach().
 * This type is used instead of T[] so we don't need `as unknown as T[]`
 * casts when passing ArraySchema objects directly (avoiding Array.from()
 * copies that caused ~30 allocations/sec at 30Hz state sync).
 */
export interface ForEachable<T> {
  forEach(callback: (item: T, index: number) => void): void;
}

/** Full game state from server */
export interface NetworkGameState {
  players: Map<string, NetworkPlayerState>;
  bullets: ForEachable<NetworkBulletState>;
  enemies: ForEachable<NetworkEnemyState>;
  geoms: ForEachable<NetworkGeomState>;
  weaponPickups: ForEachable<NetworkWeaponPickupState>;
  superPickups: ForEachable<NetworkSuperPickupState>;
  buffPickups: ForEachable<NetworkBuffPickupState>;
  healthPickups: ForEachable<NetworkHealthPickupState>;
  surfaceType: string;
  waveNumber: number;
  gameTime: number;
  gameStarted: boolean;
  gameOver: boolean;
  hostId: string;
  isPaused: boolean;
  // Lobby voting state machine fields (Phase 1 server additions)
  /** Canonical room phase: 'lobby' | 'playing' | 'voting' */
  roomPhase: string;
  /** Maps sessionId → choice string ('surface:mode:size') */
  voteMap: Map<string, string>;
  /** Voting countdown in seconds */
  votingCountdown: number;
  /** When true, host picks directly via host_launch */
  hostPickMode: boolean;
  /** Current game mode (e.g. 'waves') */
  gameMode: string;
  /** Current map size (e.g. 'medium') */
  mapSize: string;
  /** Maps sessionId → ready boolean for ready-up system */
  readyMap: Map<string, boolean>;
  /** When true, host has paused the voting countdown */
  countdownPaused: boolean;
  /** PvP sub-mode: '' (co-op), 'pvp' (all vs all), 'pvpve' (players vs enemies + each other) */
  pvpMode: string;
  /** Win condition type: 'none', 'kills', 'time', 'lives' */
  winCondition: string;
  /** Target kill count for 'kills' win condition */
  killTarget: number;
  /** Lives count per player for 'lives' win condition */
  livesCount: number;
  /** Number of lives each player starts with (1-9, default: 3) */
  initialLives?: number;
  /** When true, lives never deplete on death */
  infiniteLives?: boolean;
  /** When true, player-to-player bullet damage is active (PvP mode). */
  pvpEnabled?: boolean;
  /** Controls whose health bars are visible: 'all' | 'friendly' | 'enemy' | 'none' */
  healthBarVisibility?: string;
  // Full GameSettings fields synced for client display (s44j-settings-16f)
  difficultyMultiplier?: number;
  enemyCountCap?: number;
  enemySpawnRateMultiplier?: number;
  healingFrequency?: number;
  healingAmount?: number;
  friendlyFire?: boolean;
  pvpWinCondition?: string;
  pvpKillLimit?: number;
  startingWeapon?: string;
  timeLimit?: number;
  /** True when the host has queued settings to apply at the next wave boundary. */
  hasPendingSettings?: boolean;
  /** Time limit in seconds for 'time' win condition — s44p-06 */
  timeLimitSeconds?: number;
  /** Remaining seconds for time-limit countdown — s44p-06 */
  timeRemaining?: number;
  /** Kill goal for 'kills' win condition — s44p-06 */
  killGoal?: number;
  // ── Portals (PvP/PvPvE only) ──────────────────────────────────────────────
  /** When true, portals are active this match. */
  portalsActive?: boolean;
  /** Portal A UV position (0-1). */
  portalAU?: number;
  portalAV?: number;
  /** Portal B UV position (0-1). */
  portalBU?: number;
  portalBV?: number;
}

/** Input to send to server */
export interface NetworkInput {
  moveX: number;
  moveY: number;
  aimAngle: number;
  shooting: boolean;
  bomb: boolean;
  boost?: boolean;
  weaponSwap?: boolean;
  // Camera axes (world space) for server-side camera-relative movement.
  // Optional for backward compatibility.
  camRightX?: number; camRightY?: number; camRightZ?: number;
  camUpX?: number; camUpY?: number; camUpZ?: number;
}

/** Client performance/DDA metrics sent to server every ~10s for persistent logging */
export interface ClientMetricsPayload {
  /** Game time in seconds (from server state) */
  time: number;
  /** Current FPS */
  fps: number;
  /** Average frame time in milliseconds (1000/fps, rounded to 2dp) */
  frameTime?: number;
  /** Active enemy count */
  enemyCount: number;
  /** Active bullet count */
  bulletCount: number;
  /** Current player score */
  score: number;
  /** Player lives remaining */
  lives: number;
  /** Current wave number */
  waveNumber: number;
  /** DDA difficulty level (0-3, fractional) */
  ddaLevel: number;
  /** Player power level (kill-based) */
  playerPowerLevel: number;
  /** Active weapon type name */
  activeWeapon: string;
  /** Total kills this match */
  kills?: number;
  /** Total deaths this match */
  deaths?: number;
  /** Active buffs as compact string (e.g. "hot_hands:3,shock_aura:1") */
  activeBuffs?: string;
  /** Current surface type (e.g. "sphere", "torus") */
  surfaceName?: string;
  /** Current game mode (e.g. "waves") */
  gameMode?: string;
}

/** Startup config payload from server (mirrors GameRoom.ts StartupConfigPayload) */
export interface NetworkStartupConfig {
  weaponConfigs: Record<string, { ammo: number; damageMultiplier: number }>;
  serverVersion: string;
}

/** Event callbacks */
export interface NetworkCallbacks {
  onStateChange?: (state: NetworkGameState) => void;
  onPlayerJoin?: (player: NetworkPlayerState) => void;
  onPlayerLeave?: (playerId: string) => void;
  onEnemySpawn?: (enemy: NetworkEnemyState) => void;
  onEnemyDeath?: (enemyId: string) => void;
  onBulletSpawn?: (bullet: NetworkBulletState) => void;
  onGeomSpawn?: (geom: NetworkGeomState) => void;
  onGeomCollect?: (geomId: string) => void;
  onGameStart?: () => void;
  onGameOver?: () => void;
  /** Fired when the server is about to spawn an enemy (1.5s warning). */
  onPreSpawn?: (data: { type: string; u: number; v: number }) => void;
  onHostLeft?: () => void;
  onHostChanged?: (newHostId: string) => void;
  onGameEnded?: () => void;
  onError?: (error: Error) => void;
  /** Fired when the WebSocket connection to the server closes (any reason). */
  onDisconnected?: (code: number) => void;
  /**
   * Fired when the server sends its startup config hash.
   * The handler should check localStorage and call sendStartupCacheAck().
   */
  onStartupHash?: (hash: string) => void;
  /**
   * Fired when the server sends the full startup config (cache miss path).
   * The handler should cache this data in localStorage.
   */
  onStartupConfig?: (config: NetworkStartupConfig) => void;
  /** Fired when a player levels up (server-authoritative). */
  onPlayerLevelUp?: (data: { playerId: string; newLevel: number; playerName: string }) => void;
  /**
   * Fired when a PvP kill occurs. Broadcast to ALL clients.
   * streakCount = consecutive kills the killer has made without dying.
   */
  onPvpKill?: (data: { killerId: string; killerName: string; victimId: string; victimName: string; streakCount: number }) => void;
  /**
   * Fired when the server explicitly tells the client the current game phase on join.
   * Allows immediate routing to the correct screen (e.g. voting) without waiting
   * for the polling interval. (s44j-14)
   */
  onPhaseSync?: (data: { phase: string; isPaused: boolean }) => void;
  /**
   * Fired when the host broadcasts updated lobby settings to all clients.
   * Non-host players use this to display read-only settings. (s44j-settings-16c)
   */
  onLobbySettings?: (settings: GameSettings) => void;
  /**
   * Fired when the host triggers "Restart Round". All players see the countdown.
   * (s44j-settings-16d)
   */
  onRoundRestarting?: (data: { countdown: number; message: string }) => void;
  /** Fired when a player is killed (lives reached 0). */
  onPlayerKilled?: (data: { killer: string; victimId: string; victimName: string; timestamp: number }) => void;
  /** Fired when a player takes a hit (lives reduced but not 0). */
  onPlayerHit?: (data: { victimId: string; victimName: string; enemyType: string; livesRemaining: number; timestamp: number }) => void;
}

// Network debug logging: enabled when ?debug=true is in the URL.
// The LAN E2E test suite (tests/lan/run-lan-tests.mjs) relies on these
// [Network] prefixed logs to diagnose connection issues. In production
// (no ?debug flag), these are silenced to keep the console clean.
const _networkDebug = typeof window !== 'undefined'
  && new URLSearchParams(window.location.search).has('debug');

function netLog(...args: unknown[]): void {
  if (_networkDebug) {
    console.log(...args);
  }
}

/**
 * Network client for connecting to Colyseus game server
 */
export class NetworkClient {
  private client: Client;
  private room: Room | null = null;
  private callbacks: NetworkCallbacks = {};
  private localPlayerId: string = '';
  private connected = false;

  // Debounce onStateChange to prevent multiple rapid-fire calls from
  // onAdd/listen/onStateChange all triggering simultaneously. Uses
  // requestAnimationFrame to coalesce into a single call per frame.
  private stateChangePending = false;

  /** The primary server URL this client was constructed with. */
  private serverUrl: string;
  /** Optional fallback URL to try if the primary URL fails. */
  private fallbackUrl: string | null;

  constructor(serverUrl: string = 'ws://localhost:2567', fallbackUrl: string | null = null) {
    this.serverUrl = serverUrl;
    this.fallbackUrl = fallbackUrl;
    this.client = new Client(serverUrl);
  }

  /**
   * Connect to the game server and join a room.
   * Tries the primary URL first; if it fails and a fallback URL was provided,
   * retries once with the fallback (e.g. direct port 2567 if proxy fails).
   * After all URL attempts fail, automatically retries once after a brief delay
   * to handle mobile network stabilization (screen-off/screen-on race condition).
   *
   * @param options.autoRetryDelayMs - Delay in ms before the automatic retry (default: 700).
   * @param options.onRetrying - Called just before the auto-retry so the UI can show "Reconnecting...".
   */
  async connect(options: {
    name?: string;
    surfaceType?: string;
    requestHost?: boolean;
    mapSize?: string;
    /** Delay before the automatic retry attempt. Default: 700ms. */
    autoRetryDelayMs?: number;
    /** Called immediately before the auto-retry so callers can update status UI. */
    onRetrying?: () => void;
  } = {}): Promise<void> {
    const joinOpts = {
      name: options.name || `Player ${Math.floor(Math.random() * 1000)}`,
      surfaceType: options.surfaceType || 'sphere',
      requestHost: options.requestHost ?? false,
      mapSize: options.mapSize || 'medium',
    };

    // Attempt 1: primary URL
    console.log(`[Network] Connecting to: ${this.serverUrl}`);
    try {
      await this.attemptConnect(joinOpts);
      return;
    } catch (primaryError) {
      if (!this.fallbackUrl) {
        // No fallback — fall through to auto-retry below
        console.warn(`[Network] Primary URL failed (${this.serverUrl}), will auto-retry`);
      } else {
        console.warn(`[Network] Primary URL failed (${this.serverUrl}), trying fallback: ${this.fallbackUrl}`);

        // Attempt 2: fallback URL (e.g. direct ws://host:2567)
        this.client = new Client(this.fallbackUrl);
        console.log(`[Network] Connecting to fallback: ${this.fallbackUrl}`);
        try {
          await this.attemptConnect(joinOpts);
          return;
        } catch {
          // Fallback also failed — fall through to auto-retry below
          console.warn(`[Network] Fallback URL also failed, will auto-retry`);
        }
      }
    }

    // Auto-retry: wait briefly for the network to stabilize.
    // On mobile, turning the screen back on can leave WiFi in a transitional
    // state for ~500ms. The first connection attempt fails; the retry succeeds.
    const retryDelayMs = options.autoRetryDelayMs ?? 700;
    options.onRetrying?.();
    console.log(`[Network] Auto-retrying in ${retryDelayMs}ms...`);
    await new Promise<void>(resolve => setTimeout(resolve, retryDelayMs));
    this.client = new Client(this.serverUrl);
    console.log(`[Network] Auto-retry: connecting to ${this.serverUrl}`);
    await this.attemptConnect(joinOpts); // Final attempt — throws on failure
  }

  private async attemptConnect(joinOpts: { name: string; surfaceType: string; requestHost: boolean; mapSize: string }): Promise<void> {
    try {
      this.room = await this.client.joinOrCreate('game', joinOpts);

      this.localPlayerId = this.room.sessionId;
      this.connected = true;

      console.log(`[Network] Connected as ${this.localPlayerId}`);

      // Set up state change listeners.
      // IMPORTANT: If setupListeners() throws (e.g. state schema not yet decoded),
      // we must call room.leave() BEFORE rethrowing. Without this, the server has
      // already created a player in onJoin for this session. If connect() then retries
      // with the fallback URL, a second joinOrCreate creates a SECOND player entry —
      // the root cause of ghost spawns from one connection.
      try {
        this.setupListeners();
      } catch (setupError) {
        console.error('[Network] setupListeners failed — leaving room to prevent ghost player:', setupError);
        this.room.leave();
        this.room = null;
        this.localPlayerId = '';
        this.connected = false;
        throw setupError;
      }

      // The initial onStateChange fires DURING joinOrCreate (before our handler
      // is registered), and since the game hasn't started, the server tick does
      // nothing = no more state changes. We need to poll until state is decoded
      // and fire the callback manually.
      const room = this.room;
      let pollCount = 0;
      const pollInterval = setInterval(() => {
        pollCount++;
        if (!room.state || pollCount > 20) {
          clearInterval(pollInterval);
          return;
        }
        // Check if state has been populated (players should contain at least us)
        const players = (room.state as Record<string, unknown>).players as { size?: number };
        if (players && players.size && players.size > 0) {
          clearInterval(pollInterval);
          netLog(`[Network] State ready after ${pollCount * 100}ms, players=${players.size}`);
          const state = this.convertState(room.state);
          this.callbacks.onStateChange?.(state);
        }
      }, 100);
    } catch (error) {
      // Colyseus connection failures often surface as raw ProgressEvent objects
      // (from XMLHttpRequest) which are unhelpful. Provide a clear message.
      const isProgressEvent = error && typeof error === 'object' && 'isTrusted' in (error as Record<string, unknown>);
      const settings = this.client['settings'];
      const actualUrl = settings
        ? `${settings.secure ? 'https' : 'http'}://${settings.hostname}:${settings.port}${settings.pathname}`
        : 'unknown';
      let friendlyError: Error;
      if (isProgressEvent) {
        friendlyError = new Error(
          `Cannot reach game server at ${actualUrl}/matchmake/joinOrCreate/game. ` +
          `Is the server running? Check that the port is accessible from this device.`
        );
      } else {
        friendlyError = error instanceof Error ? error : new Error(String(error));
      }
      console.error('[Network] Connection failed:', friendlyError.message);
      this.callbacks.onError?.(friendlyError);
      throw friendlyError;
    }
  }

  /**
   * Schedule a debounced onStateChange call. Multiple triggers within the same
   * frame (onStateChange + onAdd + listen) are coalesced into a single call
   * via requestAnimationFrame. This prevents the massive redundant work that
   * caused lag-out when player 2 joined (3-4 full state conversions + full
   * entity sync iterations firing simultaneously).
   */
  private scheduleStateChange(): void {
    if (this.stateChangePending) return; // Already scheduled for this frame
    this.stateChangePending = true;
    requestAnimationFrame(() => {
      this.stateChangePending = false;
      if (!this.room?.state || !this.callbacks.onStateChange) return;
      const gameState = this.convertState(this.room.state);
      this.callbacks.onStateChange(gameState);
    });
  }

  private setupListeners(): void {
    if (!this.room) return;

    // Full state updates - debounced to prevent multiple calls per frame.
    // Colyseus fires onStateChange at patch rate (~30Hz), but onAdd/listen
    // callbacks can also trigger in the same frame, causing 3-4x redundant work.
    this.room.onStateChange(() => {
      this.scheduleStateChange();
    });

    // Player events - schedule a state refresh (debounced, won't double-fire
    // if onStateChange already scheduled this frame)
    this.room.state.players.onAdd((player: unknown, key: string) => {
      const p = player as NetworkPlayerState;
      netLog(`[Network] Player joined: ${p.name} (${key})`);
      this.callbacks.onPlayerJoin?.(p);
      this.scheduleStateChange();
    });

    this.room.state.players.onRemove((_player: unknown, key: string) => {
      netLog(`[Network] Player left: ${key}`);
      this.callbacks.onPlayerLeave?.(key);
      // Trigger immediate reconciliation so ghost entities are removed
      // in the same frame rather than waiting for the next state patch.
      this.scheduleStateChange();
    });

    // Enemy events
    this.room.state.enemies.onAdd((enemy: unknown) => {
      this.callbacks.onEnemySpawn?.(enemy as NetworkEnemyState);
    });

    this.room.state.enemies.onRemove((enemy: unknown) => {
      const e = enemy as NetworkEnemyState;
      this.callbacks.onEnemyDeath?.(e.id);
    });

    // Bullet events
    this.room.state.bullets.onAdd((bullet: unknown) => {
      this.callbacks.onBulletSpawn?.(bullet as NetworkBulletState);
    });

    // Geom events
    this.room.state.geoms.onAdd((geom: unknown) => {
      this.callbacks.onGeomSpawn?.(geom as NetworkGeomState);
    });

    this.room.state.geoms.onRemove((geom: unknown) => {
      const g = geom as NetworkGeomState;
      this.callbacks.onGeomCollect?.(g.id);
    });

    // Game state events - use debounced state refresh instead of immediate
    this.room.state.listen('gameStarted', (value: boolean) => {
      netLog(`[Network] gameStarted changed to ${value}`);
      if (value) {
        // Do NOT fire onGameStart when roomPhase is already 'voting'.
        // During voting, gameStarted stays true from the previous game — this
        // listen fires for the initial state sync on rejoin, not a real game start.
        // Calling onGameStart() here would hide the voting screen. (s44j-14)
        const curPhase = (this.room?.state as { roomPhase?: string })?.roomPhase ?? 'lobby';
        if (curPhase !== 'voting') {
          this.callbacks.onGameStart?.();
        }
      }
      this.scheduleStateChange();
    });

    this.room.state.listen('gameOver', (value: boolean) => {
      netLog(`[Network] gameOver changed to ${value}`);
      if (value) {
        this.callbacks.onGameOver?.();
      }
      this.scheduleStateChange();
    });

    // Room phase transitions — canonical replacement for gameStarted/gameOver flags
    // in the voting lobby flow. Fires onGameOver when entering voting, onGameStart
    // when transitioning back to playing after a vote completes.
    let prevRoomPhase = 'lobby';
    this.room.state.listen('roomPhase', (value: string) => {
      netLog(`[Network] roomPhase changed: ${prevRoomPhase} → ${value}`);
      if (value === 'voting' && prevRoomPhase === 'playing') {
        this.callbacks.onGameOver?.();
      } else if (value === 'playing' && prevRoomPhase === 'voting') {
        this.callbacks.onGameStart?.();
      }
      prevRoomPhase = value;
      this.scheduleStateChange();
    });

    // Pre-spawn warning: server fires this 1.5s before adding an enemy to state
    this.room.onMessage('pre_spawn', (data: { type: string; u: number; v: number }) => {
      this.callbacks.onPreSpawn?.(data);
    });

    // Phase sync: server sends this on join when game is in voting/playing phase.
    // Allows the client to immediately route to the correct screen. (s44j-14)
    // isPaused added in s44j-21 so joining clients can show the pause overlay immediately.
    this.room.onMessage('phase_sync', (data: { phase: string; isPaused?: boolean }) => {
      netLog(`[Network] Received phase_sync: phase=${data.phase} isPaused=${data.isPaused}`);
      this.callbacks.onPhaseSync?.({ phase: data.phase, isPaused: data.isPaused ?? false });
      // Also schedule a state refresh so onStateChange runs with fresh state
      this.scheduleStateChange();
    });

    // Server lifecycle messages
    this.room.onMessage('host_left', () => {
      netLog('[Network] Host left the game');
      this.callbacks.onHostLeft?.();
    });

    this.room.onMessage('host_changed', (data: { hostId: string }) => {
      netLog(`[Network] Host changed to: ${data.hostId}`);
      this.callbacks.onHostChanged?.(data.hostId);
      // Also schedule a state refresh so onStateChange picks up the new hostId
      this.scheduleStateChange();
    });

    this.room.onMessage('game_ended', () => {
      netLog('[Network] Host ended the game');
      this.callbacks.onGameEnded?.();
    });

    // Startup config caching: server sends hash on join, client checks localStorage,
    // then acknowledges (hit/miss). On miss the server sends the full config.
    this.room.onMessage('startup_hash', (data: { hash: string }) => {
      netLog(`[Network] Received startup_hash: ${data.hash}`);
      this.callbacks.onStartupHash?.(data.hash);
    });

    this.room.onMessage('startup_config', (config: NetworkStartupConfig) => {
      netLog('[Network] Received startup_config (cache miss — caching now)');
      this.callbacks.onStartupConfig?.(config);
    });

    // Player level-up (server-authoritative kill tracking)
    this.room.onMessage('player_level_up', (data: { playerId: string; newLevel: number; playerName: string }) => {
      netLog(`[Network] player_level_up: ${data.playerName} reached level ${data.newLevel}`);
      this.callbacks.onPlayerLevelUp?.(data);
    });

    // PvP kill event (broadcast to all clients)
    this.room.onMessage('pvp_kill', (data: { killerId: string; killerName: string; victimId: string; victimName: string; streakCount: number }) => {
      netLog(`[Network] pvp_kill: ${data.killerName} killed ${data.victimName} (streak: ${data.streakCount})`);
      this.callbacks.onPvpKill?.(data);
    });

    // Lobby settings broadcast (host → server → all clients, s44j-settings-16c)
    this.room.onMessage('lobby_settings', (data: { settings: GameSettings }) => {
      netLog('[Network] Received lobby_settings update');
      this.callbacks.onLobbySettings?.(data.settings);
    });

    // Round restart countdown (host triggered, s44j-settings-16d)
    this.room.onMessage('round_restarting', (data: { countdown: number; message: string }) => {
      netLog(`[Network] Round restarting in ${data.countdown}s`);
      this.callbacks.onRoundRestarting?.(data);
    });

    // Player killed — lost all lives (for kill feed)
    this.room.onMessage('player_killed', (data: { killer: string; victimId: string; victimName: string; timestamp: number }) => {
      netLog(`[Network] player_killed: ${data.victimName} killed by ${data.killer}`);
      this.callbacks.onPlayerKilled?.(data);
    });

    // Player hit — lost a life but still alive (for damage numbers)
    this.room.onMessage('player_hit', (data: { victimId: string; victimName: string; enemyType: string; livesRemaining: number; timestamp: number }) => {
      netLog(`[Network] player_hit: ${data.victimName} hit by ${data.enemyType}, ${data.livesRemaining} lives remaining`);
      this.callbacks.onPlayerHit?.(data);
    });

    // Disconnection
    this.room.onLeave((code) => {
      netLog(`[Network] Left room with code: ${code}`);
      this.connected = false;
      this.callbacks.onDisconnected?.(code);
    });

    // Errors
    this.room.onError((code, message) => {
      console.error(`[Network] Room error ${code}: ${message}`);
      this.callbacks.onError?.(new Error(`Room error ${code}: ${message}`));
    });
  }

  private convertState(state: unknown): NetworkGameState {
    const s = state as {
      players: Map<string, NetworkPlayerState>;
      bullets: ForEachable<NetworkBulletState>;
      enemies: ForEachable<NetworkEnemyState>;
      geoms: ForEachable<NetworkGeomState>;
      weaponPickups: ForEachable<NetworkWeaponPickupState>;
      superPickups: ForEachable<NetworkSuperPickupState>;
      buffPickups: ForEachable<NetworkBuffPickupState>;
      healthPickups: ForEachable<NetworkHealthPickupState>;
      surfaceType: string;
      waveNumber: number;
      gameTime: number;
      gameStarted: boolean;
      gameOver: boolean;
      hostId: string;
      isPaused: boolean;
      roomPhase: string;
      voteMap: Map<string, string>;
      votingCountdown: number;
      hostPickMode: boolean;
      gameMode: string;
      mapSize: string;
      readyMap: Map<string, boolean>;
      countdownPaused: boolean;
      pvpMode: string;
      winCondition: string;
      killTarget: number;
      livesCount: number;
      initialLives?: number;
      infiniteLives?: boolean;
      pvpEnabled?: boolean;
      healthBarVisibility?: string;
      difficultyMultiplier?: number;
      enemyCountCap?: number;
      enemySpawnRateMultiplier?: number;
      healingFrequency?: number;
      healingAmount?: number;
      friendlyFire?: boolean;
      pvpWinCondition?: string;
      pvpKillLimit?: number;
      startingWeapon?: string;
      timeLimit?: number;
      hasPendingSettings?: boolean;
      timeLimitSeconds?: number;
      timeRemaining?: number;
      killGoal?: number;
      portalsActive?: boolean;
      portalAU?: number;
      portalAV?: number;
      portalBU?: number;
      portalBV?: number;
    };

    // Pass Colyseus ArraySchema/MapSchema objects directly instead of creating
    // copies with Array.from(). The onStateChange handler only reads them via
    // .forEach(), which works on both ArraySchema and plain arrays. This avoids
    // 4 array allocations + copies per state change (was ~30 allocations/sec).
    //
    // The empty-array fallback handles the brief window during initial state
    // decode when Colyseus hasn't populated the schema fields yet.
    const emptyArray: ForEachable<never> = { forEach() {} };
    const emptyMap = new Map<string, string>();
    const emptyBoolMap = new Map<string, boolean>();
    return {
      players: s.players,
      bullets: s.bullets || emptyArray,
      enemies: s.enemies || emptyArray,
      geoms: s.geoms || emptyArray,
      weaponPickups: s.weaponPickups || emptyArray,
      superPickups: s.superPickups || emptyArray,
      buffPickups: s.buffPickups || emptyArray,
      healthPickups: s.healthPickups || emptyArray,
      surfaceType: s.surfaceType,
      waveNumber: s.waveNumber,
      gameTime: s.gameTime,
      gameStarted: s.gameStarted,
      gameOver: s.gameOver,
      hostId: s.hostId,
      isPaused: s.isPaused,
      roomPhase: s.roomPhase || 'lobby',
      voteMap: s.voteMap || emptyMap,
      votingCountdown: s.votingCountdown ?? 0,
      hostPickMode: s.hostPickMode ?? false,
      gameMode: s.gameMode || 'waves',
      mapSize: s.mapSize || 'medium',
      readyMap: s.readyMap || emptyBoolMap,
      countdownPaused: s.countdownPaused ?? false,
      pvpMode: s.pvpMode || '',
      winCondition: s.winCondition || 'none',
      killTarget: s.killTarget ?? 10,
      livesCount: s.livesCount ?? 3,
      initialLives: s.initialLives ?? 3,
      infiniteLives: s.infiniteLives ?? false,
      pvpEnabled: s.pvpEnabled ?? false,
      healthBarVisibility: s.healthBarVisibility ?? 'all',
      difficultyMultiplier: s.difficultyMultiplier,
      enemyCountCap: s.enemyCountCap,
      enemySpawnRateMultiplier: s.enemySpawnRateMultiplier,
      healingFrequency: s.healingFrequency,
      healingAmount: s.healingAmount,
      friendlyFire: s.friendlyFire,
      pvpWinCondition: s.pvpWinCondition,
      pvpKillLimit: s.pvpKillLimit,
      startingWeapon: s.startingWeapon,
      timeLimit: s.timeLimit,
      hasPendingSettings: s.hasPendingSettings ?? false,
      timeLimitSeconds: s.timeLimitSeconds ?? 0,
      timeRemaining: s.timeRemaining ?? 0,
      killGoal: s.killGoal ?? 0,
      portalsActive: s.portalsActive ?? false,
      portalAU: s.portalAU ?? 0.25,
      portalAV: s.portalAV ?? 0.25,
      portalBU: s.portalBU ?? 0.75,
      portalBV: s.portalBV ?? 0.75,
    };
  }

  /**
   * Send input to server
   */
  sendInput(input: NetworkInput): void {
    if (!this.room || !this.connected) return;
    this.room.send('input', input);
  }

  /**
   * Send performance/DDA metrics to server for persistent logging.
   * Called every 500ms during active gameplay.
   */
  sendMetrics(metrics: ClientMetricsPayload): void {
    if (!this.room || !this.connected) return;
    this.room.send('clientMetrics', metrics);
  }

  /**
   * Request game start
   * @param choice Optional 'surface:mode:size' string (e.g. 'sphere:king:medium')
   * @param settings Optional game settings (s44j-settings-16c); server application in 16e
   */
  startGame(choice?: string, settings?: GameSettings): void {
    if (!this.room || !this.connected) return;
    if (choice || settings) {
      this.room.send('start', { ...(choice ? { choice } : {}), ...(settings ? { settings } : {}) });
    } else {
      this.room.send('start', undefined);
    }
  }

  /**
   * Request game start with win condition options (host only, lobby phase only).
   */
  startGameWithOptions(options: {
    pvpMode: string;
    winCondition: string;
    killTarget: number;
    timeLimit: number;
    livesCount: number;
  }): void {
    if (!this.room || !this.connected) return;
    this.room.send('start_with_options', options);
  }

  /**
   * Send pause/resume command (host only)
   */
  sendPause(paused: boolean): void {
    if (!this.room || !this.connected) return;
    this.room.send('pause', { paused });
  }

  /**
   * Send end game command (host only)
   */
  sendEndGame(): void {
    if (!this.room || !this.connected) return;
    this.room.send('end_game');
  }

  /**
   * Queue settings to apply at the next wave boundary (host only). (s44j-settings-16d)
   */
  sendApplySettings(settings: GameSettings): void {
    if (!this.room || !this.connected) return;
    this.room.send('applySettings', { settings });
  }

  /**
   * Restart the current round with new settings (host only). (s44j-settings-16d)
   * Server broadcasts a 5s countdown then performs a soft restart.
   */
  sendRestartRound(settings: GameSettings): void {
    if (!this.room || !this.connected) return;
    this.room.send('restartRound', { settings });
  }

  /**
   * Sync local player's companion drone counts to the server so all other clients
   * can render visual companions around this player (s44r2-04).
   */
  sendCompanionUpdate(guardian: number, hunter: number, protector: number): void {
    if (!this.room || !this.connected) return;
    this.room.send('companion_update', { guardian, hunter, protector });
  }

  /**
   * Report a companion bullet hit on an enemy so the server can apply damage.
   * Guardian/Hunter companions fire client-side bullets that never enter the
   * server-synced bulletPool, so collision is detected client-side and forwarded here.
   */
  sendCompanionHit(enemyId: string): void {
    if (!this.room || !this.connected) return;
    this.room.send('companion_hit', { enemyId });
  }

  /**
   * Report a player bullet hit on an enemy (client-authoritative bullet-enemy collision).
   * The client has exact world-space bullet positions; the server trusts this and applies damage.
   * See s44r-04-02 for why server-side UV collision is disabled on non-sphere surfaces.
   */
  sendBulletHit(data: { bulletId: string; enemyId: string; weaponType: string; ownerId: string }): void {
    if (!this.room || !this.connected) return;
    this.room.send('bullet_hit', data);
  }

  /**
   * Client-authoritative pickup collection: player detects proximity in world space
   * and notifies server to apply the effect and remove the pickup from state.
   * Server trusts this message (no UV-based re-check) to avoid sphere-approx errors.
   */
  sendCollectPickup(
    pickupType: 'weapon' | 'buff' | 'super' | 'health',
    pickupId: string,
  ): void {
    if (!this.room || !this.connected) return;
    this.room.send('collect_pickup', { pickupType, pickupId });
  }

  /**
   * Send exit-to-voting command (host only).
   * Ends the current match and transitions all players to the voting screen.
   */
  sendExitToVoting(): void {
    if (!this.room || !this.connected) return;
    this.room.send('exit_to_voting');
  }

  /**
   * Send a vote for the next game configuration.
   * choice format: 'surface:mode:size' e.g. 'sphere:waves:medium'
   */
  sendVote(choice: string): void {
    if (!this.room || !this.connected) return;
    this.room.send('vote', { choice });
  }

  /**
   * Toggle host pick mode (host only).
   * When true, host picks directly via sendHostLaunch instead of vote countdown.
   */
  sendHostSetPickMode(pickMode: boolean): void {
    if (!this.room || !this.connected) return;
    this.room.send('host_set_pick_mode', { pickMode });
  }

  /**
   * Launch next game with a specific choice (host only, used in host pick mode).
   * choice format: 'surface:mode:size' e.g. 'sphere:waves:medium'
   * @param settings Optional game settings (s44j-settings-16c); server application in 16e
   */
  sendHostLaunch(choice: string, settings?: GameSettings): void {
    if (!this.room || !this.connected) return;
    this.room.send('host_launch', { choice, ...(settings ? { settings } : {}) });
  }

  /**
   * Broadcast current lobby settings from host to all clients (display only).
   * Server relays this to all connected clients so non-hosts can see settings.
   * Settings are NOT applied by the server until 16e.
   */
  sendLobbySettings(settings: GameSettings): void {
    if (!this.room || !this.connected) return;
    this.room.send('lobby_settings', { settings });
  }

  /**
   * Acknowledge the startup config hash the server sent.
   * Call after checking localStorage: hit=true means client has fresh cached data.
   * If hit=false the server will send the full startup_config payload.
   */
  sendStartupCacheAck(hit: boolean): void {
    if (!this.room || !this.connected) return;
    this.room.send('startup_cache_ack', { hit });
  }

  /** Signal that this player is ready to start (voting phase) */
  sendReadyUp(): void {
    if (!this.room || !this.connected) return;
    this.room.send('ready_up');
  }

  /** Host: pause or resume the voting countdown */
  sendPauseCountdown(paused: boolean): void {
    if (!this.room || !this.connected) return;
    this.room.send('pause_countdown', { paused });
  }

  /** Host: resume the game timer (starts countdown from paused state) */
  sendResumeTimer(): void {
    if (!this.room || !this.connected) return;
    this.room.send('resume_timer');
  }

  /**
   * Set event callbacks
   */
  setCallbacks(callbacks: NetworkCallbacks): void {
    this.callbacks = { ...this.callbacks, ...callbacks };
  }

  /**
   * Get local player ID
   */
  getLocalPlayerId(): string {
    return this.localPlayerId;
  }

  /**
   * Get the server's authoritative surface type from the room state.
   * Must be called after connect() resolves.
   */
  getServerSurfaceType(): string {
    if (!this.room?.state) return 'sphere';
    return (this.room.state as { surfaceType?: string }).surfaceType || 'sphere';
  }

  /**
   * Fire onStateChange immediately with the current room state.
   * Call after setCallbacks() to ensure the correct screen (lobby/voting/playing)
   * is shown without waiting for the 100ms polling interval. (s44j-14)
   */
  triggerInitialSync(): void {
    if (!this.room?.state || !this.callbacks.onStateChange) return;
    const state = this.convertState(this.room.state);
    this.callbacks.onStateChange(state);
  }

  /**
   * Get the host player's session ID from the room state.
   * Must be called after connect() resolves.
   */
  getServerHostId(): string {
    if (!this.room?.state) return '';
    return (this.room.state as { hostId?: string }).hostId || '';
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.connected;
  }

  /**
   * Disconnect from server
   */
  disconnect(): void {
    if (this.room) {
      this.room.leave();
      this.room = null;
    }
    this.connected = false;
    netLog('[Network] Disconnected');
  }
}

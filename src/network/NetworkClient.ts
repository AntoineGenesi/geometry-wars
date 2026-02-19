import { Client, Room } from 'colyseus.js';

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
  surfaceType: string;
  waveNumber: number;
  gameTime: number;
  gameStarted: boolean;
  gameOver: boolean;
  hostId: string;
  isPaused: boolean;
}

/** Input to send to server */
export interface NetworkInput {
  moveX: number;
  moveY: number;
  aimAngle: number;
  shooting: boolean;
  bomb: boolean;
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
  onHostLeft?: () => void;
  onHostChanged?: (newHostId: string) => void;
  onGameEnded?: () => void;
  onError?: (error: Error) => void;
  /** Fired when the WebSocket connection to the server closes (any reason). */
  onDisconnected?: (code: number) => void;
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

  constructor(serverUrl: string = 'ws://localhost:2567') {
    this.client = new Client(serverUrl);
  }

  /**
   * Connect to the game server and join a room
   */
  async connect(options: { name?: string; surfaceType?: string } = {}): Promise<void> {
    try {
      this.room = await this.client.joinOrCreate('game', {
        name: options.name || `Player ${Math.floor(Math.random() * 1000)}`,
        surfaceType: options.surfaceType || 'sphere',
      });

      this.localPlayerId = this.room.sessionId;
      this.connected = true;

      netLog(`[Network] Connected as ${this.localPlayerId}`);

      // Set up state change listeners
      this.setupListeners();

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
      const serverUrl = this.client['settings']?.hostname || 'unknown';
      let friendlyError: Error;
      if (isProgressEvent) {
        friendlyError = new Error(
          `Cannot reach game server. Is the Colyseus server running? ` +
          `(Tried: ${serverUrl}:2567/matchmake/joinOrCreate/game)`
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
        this.callbacks.onGameStart?.();
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
      surfaceType: string;
      waveNumber: number;
      gameTime: number;
      gameStarted: boolean;
      gameOver: boolean;
      hostId: string;
      isPaused: boolean;
    };

    // Pass Colyseus ArraySchema/MapSchema objects directly instead of creating
    // copies with Array.from(). The onStateChange handler only reads them via
    // .forEach(), which works on both ArraySchema and plain arrays. This avoids
    // 4 array allocations + copies per state change (was ~30 allocations/sec).
    //
    // The empty-array fallback handles the brief window during initial state
    // decode when Colyseus hasn't populated the schema fields yet.
    const emptyArray: ForEachable<never> = { forEach() {} };
    return {
      players: s.players,
      bullets: s.bullets || emptyArray,
      enemies: s.enemies || emptyArray,
      geoms: s.geoms || emptyArray,
      weaponPickups: s.weaponPickups || emptyArray,
      surfaceType: s.surfaceType,
      waveNumber: s.waveNumber,
      gameTime: s.gameTime,
      gameStarted: s.gameStarted,
      gameOver: s.gameOver,
      hostId: s.hostId,
      isPaused: s.isPaused,
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
   * Request game start
   */
  startGame(): void {
    if (!this.room || !this.connected) return;
    this.room.send('start');
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

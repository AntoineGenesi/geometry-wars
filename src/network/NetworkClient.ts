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

/** Full game state from server */
export interface NetworkGameState {
  players: Map<string, NetworkPlayerState>;
  bullets: NetworkBulletState[];
  enemies: NetworkEnemyState[];
  geoms: NetworkGeomState[];
  weaponPickups: NetworkWeaponPickupState[];
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
  onGameEnded?: () => void;
  onError?: (error: Error) => void;
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

      console.log(`[Network] Connected as ${this.localPlayerId}`);

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
          console.log(`[Network] State ready after ${pollCount * 100}ms, players=${players.size}`);
          const state = this.convertState(room.state);
          this.callbacks.onStateChange?.(state);
        }
      }, 100);
    } catch (error) {
      console.error('[Network] Connection failed:', error);
      this.callbacks.onError?.(error as Error);
      throw error;
    }
  }

  private setupListeners(): void {
    if (!this.room) return;

    // Full state updates
    this.room.onStateChange((state) => {
      const gameState = this.convertState(state);
      this.callbacks.onStateChange?.(gameState);
    });

    // Player events - also fire a full state refresh so UI updates
    this.room.state.players.onAdd((player: unknown, key: string) => {
      const p = player as NetworkPlayerState;
      console.log(`[Network] Player joined: ${p.name} (${key})`);
      this.callbacks.onPlayerJoin?.(p);
      // Force full state refresh since onStateChange might have been missed
      if (this.room?.state) {
        const gameState = this.convertState(this.room.state);
        this.callbacks.onStateChange?.(gameState);
      }
    });

    this.room.state.players.onRemove((_player: unknown, key: string) => {
      console.log(`[Network] Player left: ${key}`);
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

    // Game state events - also force a full state refresh on these
    // since onStateChange may not fire if it was registered late
    this.room.state.listen('gameStarted', (value: boolean) => {
      console.log(`[Network] gameStarted changed to ${value}`);
      if (value) {
        this.callbacks.onGameStart?.();
      }
      // Force full state refresh
      if (this.room?.state) {
        const gameState = this.convertState(this.room.state);
        this.callbacks.onStateChange?.(gameState);
      }
    });

    this.room.state.listen('gameOver', (value: boolean) => {
      console.log(`[Network] gameOver changed to ${value}`);
      if (value) {
        this.callbacks.onGameOver?.();
      }
      // Force full state refresh
      if (this.room?.state) {
        const gameState = this.convertState(this.room.state);
        this.callbacks.onStateChange?.(gameState);
      }
    });

    // Server lifecycle messages
    this.room.onMessage('host_left', () => {
      console.log('[Network] Host left the game');
      this.callbacks.onHostLeft?.();
    });

    this.room.onMessage('game_ended', () => {
      console.log('[Network] Host ended the game');
      this.callbacks.onGameEnded?.();
    });

    // Disconnection
    this.room.onLeave((code) => {
      console.log(`[Network] Left room with code: ${code}`);
      this.connected = false;
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
      bullets: NetworkBulletState[];
      enemies: NetworkEnemyState[];
      geoms: NetworkGeomState[];
      weaponPickups: NetworkWeaponPickupState[];
      surfaceType: string;
      waveNumber: number;
      gameTime: number;
      gameStarted: boolean;
      gameOver: boolean;
      hostId: string;
      isPaused: boolean;
    };

    return {
      players: s.players,
      bullets: Array.from(s.bullets || []),
      enemies: Array.from(s.enemies || []),
      geoms: Array.from(s.geoms || []),
      weaponPickups: Array.from(s.weaponPickups || []),
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
    console.log('[Network] Disconnected');
  }
}

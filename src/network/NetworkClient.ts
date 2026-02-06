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

/** Full game state from server */
export interface NetworkGameState {
  players: Map<string, NetworkPlayerState>;
  bullets: NetworkBulletState[];
  enemies: NetworkEnemyState[];
  geoms: NetworkGeomState[];
  surfaceType: string;
  waveNumber: number;
  gameTime: number;
  gameStarted: boolean;
  gameOver: boolean;
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

    // Player events
    this.room.state.players.onAdd((player: unknown, key: string) => {
      const p = player as NetworkPlayerState;
      console.log(`[Network] Player joined: ${p.name} (${key})`);
      this.callbacks.onPlayerJoin?.(p);
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

    // Game state events
    this.room.state.listen('gameStarted', (value: boolean) => {
      if (value) {
        console.log('[Network] Game started!');
        this.callbacks.onGameStart?.();
      }
    });

    this.room.state.listen('gameOver', (value: boolean) => {
      if (value) {
        console.log('[Network] Game over!');
        this.callbacks.onGameOver?.();
      }
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
      surfaceType: string;
      waveNumber: number;
      gameTime: number;
      gameStarted: boolean;
      gameOver: boolean;
    };

    return {
      players: s.players,
      bullets: Array.from(s.bullets || []),
      enemies: Array.from(s.enemies || []),
      geoms: Array.from(s.geoms || []),
      surfaceType: s.surfaceType,
      waveNumber: s.waveNumber,
      gameTime: s.gameTime,
      gameStarted: s.gameStarted,
      gameOver: s.gameOver,
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

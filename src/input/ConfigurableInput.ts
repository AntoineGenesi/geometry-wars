/**
 * Configurable input system for 2-4 player local co-op.
 *
 * Each player has rebindable keys for movement, shoot, and bomb.
 * Player 1 uses mouse aim by default; others use auto-aim (movement direction).
 * Bindings persist to localStorage.
 */

import type { PlayerInputState } from './MultiplayerInput';

export { type PlayerInputState };

export interface PlayerBindings {
  up: string;
  down: string;
  left: string;
  right: string;
  shoot: string;
  bomb: string;
  weaponSwap: string;
  aimMode: 'mouse' | 'movement';
}

const STORAGE_KEY = 'gw3d-keybindings';

const DEFAULT_BINDINGS: PlayerBindings[] = [
  // P1: WASD + mouse + click + space + Q to swap weapon
  { up: 'w', down: 's', left: 'a', right: 'd', shoot: 'MouseLeft', bomb: ' ', weaponSwap: 'q', aimMode: 'mouse' },
  // P2: IJKL + auto-aim + O + P + U to swap weapon
  { up: 'i', down: 'k', left: 'j', right: 'l', shoot: 'o', bomb: 'p', weaponSwap: 'u', aimMode: 'movement' },
  // P3: Arrows + auto-aim + Enter + RShift + . to swap weapon
  { up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight', shoot: 'Enter', bomb: 'Shift', weaponSwap: '.', aimMode: 'movement' },
  // P4: Numpad + auto-aim + Numpad0 + Numpad. + NumpadEnter to swap weapon
  { up: '8', down: '5', left: '4', right: '6', shoot: '0', bomb: '.', weaponSwap: 'Enter', aimMode: 'movement' },
];

export class ConfigurableInput {
  private bindings: PlayerBindings[];
  private readonly playerCount: number;

  // Per-player state
  private readonly keysDown: Set<string>[] = [];
  private readonly keysJustPressed: Set<string>[] = [];
  private readonly lastMoveDir: Array<{ x: number; y: number }> = [];

  // Mouse state (for mouse-aim players)
  private mouseX = 0;
  private mouseY = 0;
  private mouseDown = false;

  // Viewport bounds for mouse-aim in split-screen
  private viewportBounds: Array<{ x: number; y: number; w: number; h: number }> = [];

  // Bound handlers for cleanup
  private readonly onKeyDown: (e: KeyboardEvent) => void;
  private readonly onKeyUp: (e: KeyboardEvent) => void;
  private readonly onMouseMove: (e: MouseEvent) => void;
  private readonly onMouseDown: (e: MouseEvent) => void;
  private readonly onMouseUp: (e: MouseEvent) => void;
  private readonly onContextMenu: (e: Event) => void;

  constructor(playerCount: 2 | 3 | 4) {
    this.playerCount = playerCount;
    this.bindings = this.loadBindings();

    for (let i = 0; i < playerCount; i++) {
      this.keysDown.push(new Set());
      this.keysJustPressed.push(new Set());
      this.lastMoveDir.push({ x: 0, y: -1 });
      this.viewportBounds.push({ x: 0, y: 0, w: window.innerWidth, h: window.innerHeight });
    }

    // Build a lookup: key -> which player indices use it
    this.onKeyDown = (e: KeyboardEvent) => {
      const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      for (let p = 0; p < this.playerCount; p++) {
        const b = this.bindings[p];
        if (this.matchesKey(key, b.up) || this.matchesKey(key, b.down) ||
            this.matchesKey(key, b.left) || this.matchesKey(key, b.right) ||
            this.matchesKey(key, b.shoot) || this.matchesKey(key, b.bomb) ||
            this.matchesKey(key, b.weaponSwap)) {
          if (!this.keysDown[p].has(key)) {
            this.keysJustPressed[p].add(key);
          }
          this.keysDown[p].add(key);
          e.preventDefault();
        }
      }
    };

    this.onKeyUp = (e: KeyboardEvent) => {
      const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      for (let p = 0; p < this.playerCount; p++) {
        this.keysDown[p].delete(key);
      }
    };

    this.onMouseMove = (e: MouseEvent) => {
      this.mouseX = e.clientX;
      this.mouseY = e.clientY;
    };

    this.onMouseDown = (e: MouseEvent) => {
      if (e.button === 0) this.mouseDown = true;
    };

    this.onMouseUp = (e: MouseEvent) => {
      if (e.button === 0) this.mouseDown = false;
    };

    this.onContextMenu = (e: Event) => e.preventDefault();

    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('mousemove', this.onMouseMove);
    window.addEventListener('mousedown', this.onMouseDown);
    window.addEventListener('mouseup', this.onMouseUp);
    window.addEventListener('contextmenu', this.onContextMenu);
  }

  private matchesKey(pressed: string, binding: string): boolean {
    if (binding === 'MouseLeft') return false; // mouse handled separately
    // Normalize single chars to lowercase for comparison
    const normalizedBinding = binding.length === 1 ? binding.toLowerCase() : binding;
    return pressed === normalizedBinding;
  }

  private isKeyHeld(playerIndex: number, binding: string): boolean {
    if (binding === 'MouseLeft') return false;
    const normalizedBinding = binding.length === 1 ? binding.toLowerCase() : binding;
    return this.keysDown[playerIndex].has(normalizedBinding);
  }

  private wasKeyJustPressed(playerIndex: number, binding: string): boolean {
    if (binding === 'MouseLeft') return false;
    const normalizedBinding = binding.length === 1 ? binding.toLowerCase() : binding;
    return this.keysJustPressed[playerIndex].has(normalizedBinding);
  }

  /** Set pixel-space viewport bounds for a player (for mouse aim calculation). */
  setViewportBounds(playerIndex: number, x: number, y: number, w: number, h: number): void {
    this.viewportBounds[playerIndex] = { x, y, w, h };
  }

  getPlayerState(playerIndex: number): PlayerInputState {
    const b = this.bindings[playerIndex];
    if (!b) {
      return { moveX: 0, moveY: 0, aimX: 0, aimY: 0, shooting: false, bomb: false, weaponSwap: false };
    }

    // Movement
    let mx = 0;
    let my = 0;
    if (this.isKeyHeld(playerIndex, b.left)) mx -= 1;
    if (this.isKeyHeld(playerIndex, b.right)) mx += 1;
    if (this.isKeyHeld(playerIndex, b.up)) my -= 1;
    if (this.isKeyHeld(playerIndex, b.down)) my += 1;

    const moveLen = Math.sqrt(mx * mx + my * my);
    if (moveLen > 1) {
      mx /= moveLen;
      my /= moveLen;
    }

    // Aim
    let ax = 0;
    let ay = 0;
    if (b.aimMode === 'mouse') {
      // Mouse aim relative to viewport center
      const vp = this.viewportBounds[playerIndex];
      const cx = vp.x + vp.w / 2;
      const cy = vp.y + vp.h / 2;
      const halfMin = Math.min(vp.w, vp.h) / 2;
      ax = (this.mouseX - cx) / halfMin;
      ay = (this.mouseY - cy) / halfMin;
      const aimLen = Math.sqrt(ax * ax + ay * ay);
      if (aimLen > 1) {
        ax /= aimLen;
        ay /= aimLen;
      }
    } else {
      // Auto-aim: shoot in movement direction
      if (moveLen > 0.1) {
        ax = mx;
        ay = my;
        this.lastMoveDir[playerIndex] = { x: mx, y: my };
      } else {
        ax = this.lastMoveDir[playerIndex].x;
        ay = this.lastMoveDir[playerIndex].y;
      }
    }

    // Shoot
    let shooting = false;
    if (b.shoot === 'MouseLeft') {
      shooting = this.mouseDown;
    } else {
      shooting = this.isKeyHeld(playerIndex, b.shoot);
    }

    // Bomb
    const bomb = this.wasKeyJustPressed(playerIndex, b.bomb);

    // Weapon swap
    const weaponSwap = this.wasKeyJustPressed(playerIndex, b.weaponSwap);

    return { moveX: mx, moveY: my, aimX: ax, aimY: ay, shooting, bomb, weaponSwap };
  }

  endFrame(): void {
    for (let i = 0; i < this.playerCount; i++) {
      this.keysJustPressed[i].clear();
    }
  }

  getBindings(playerIndex: number): PlayerBindings {
    return { ...this.bindings[playerIndex] };
  }

  setBindings(playerIndex: number, bindings: PlayerBindings): void {
    this.bindings[playerIndex] = { ...bindings };
    this.saveBindings();
  }

  resetDefaults(): void {
    this.bindings = DEFAULT_BINDINGS.map(b => ({ ...b }));
    this.saveBindings();
  }

  getPlayerCount(): number {
    return this.playerCount;
  }

  private loadBindings(): PlayerBindings[] {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored) as PlayerBindings[];
        if (Array.isArray(parsed) && parsed.length >= 4) {
          // Merge with defaults to handle new fields (e.g. weaponSwap)
          return parsed.map((b, i) => ({
            ...DEFAULT_BINDINGS[i],
            ...b,
          }));
        }
      }
    } catch {
      // Fall through to defaults
    }
    return DEFAULT_BINDINGS.map(b => ({ ...b }));
  }

  private saveBindings(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.bindings));
    } catch {
      // localStorage may be unavailable
    }
  }

  /** Check for key conflicts across players. Returns array of conflict descriptions. */
  getConflicts(): string[] {
    const conflicts: string[] = [];
    const allKeys = new Map<string, number[]>();

    for (let p = 0; p < this.playerCount; p++) {
      const b = this.bindings[p];
      for (const key of [b.up, b.down, b.left, b.right, b.shoot, b.bomb, b.weaponSwap]) {
        if (key === 'MouseLeft') continue;
        const existing = allKeys.get(key) ?? [];
        existing.push(p + 1);
        allKeys.set(key, existing);
      }
    }

    for (const [key, players] of allKeys) {
      if (players.length > 1) {
        conflicts.push(`"${key}" used by P${players.join(' & P')}`);
      }
    }
    return conflicts;
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('mousemove', this.onMouseMove);
    window.removeEventListener('mousedown', this.onMouseDown);
    window.removeEventListener('mouseup', this.onMouseUp);
    window.removeEventListener('contextmenu', this.onContextMenu);
  }
}

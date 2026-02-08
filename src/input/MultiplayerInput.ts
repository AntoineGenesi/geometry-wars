/**
 * Multiplayer input system for local splitscreen play.
 *
 * Player 1: WASD movement + mouse aim + left click to shoot + space for bomb
 * Player 2: IJKL movement + shoots in movement direction (auto-aim) + O for shoot + P for bomb
 */

export interface PlayerInputState {
  moveX: number;
  moveY: number;
  aimX: number;
  aimY: number;
  shooting: boolean;
  bomb: boolean;
  weaponSwap: boolean;
}

export class MultiplayerInputManager {
  // Player 1 state (WASD + mouse)
  private readonly p1KeysDown: Set<string> = new Set();
  private readonly p1KeysJustPressed: Set<string> = new Set();
  private p1MouseX = 0;
  private p1MouseY = 0;
  private p1MouseDown = false;

  // Player 2 state (IJKL + auto-aim)
  private readonly p2KeysDown: Set<string> = new Set();
  private readonly p2KeysJustPressed: Set<string> = new Set();
  private p2LastMoveX = 0;
  private p2LastMoveY = -1; // Default facing "forward"

  // Viewport
  private viewportW = 1;
  private viewportH = 1;

  // Bound handlers
  private readonly onKeyDown: (e: KeyboardEvent) => void;
  private readonly onKeyUp: (e: KeyboardEvent) => void;
  private readonly onMouseMove: (e: MouseEvent) => void;
  private readonly onMouseDown: (e: MouseEvent) => void;
  private readonly onMouseUp: (e: MouseEvent) => void;
  private readonly onResize: () => void;
  private readonly onContextMenu: (e: Event) => void;

  constructor() {
    this.viewportW = window.innerWidth;
    this.viewportH = window.innerHeight;

    this.onKeyDown = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();

      // Player 1 keys (WASD + space)
      if (['w', 'a', 's', 'd', ' '].includes(key)) {
        if (!this.p1KeysDown.has(key)) {
          this.p1KeysJustPressed.add(key);
        }
        this.p1KeysDown.add(key);
        e.preventDefault();
      }

      // Player 2 keys (IJKL + O + P)
      if (['i', 'j', 'k', 'l', 'o', 'p'].includes(key)) {
        if (!this.p2KeysDown.has(key)) {
          this.p2KeysJustPressed.add(key);
        }
        this.p2KeysDown.add(key);
        e.preventDefault();
      }
    };

    this.onKeyUp = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      this.p1KeysDown.delete(key);
      this.p2KeysDown.delete(key);
    };

    this.onMouseMove = (e: MouseEvent) => {
      this.p1MouseX = e.clientX;
      this.p1MouseY = e.clientY;
    };

    this.onMouseDown = (e: MouseEvent) => {
      if (e.button === 0) {
        this.p1MouseDown = true;
      }
    };

    this.onMouseUp = (e: MouseEvent) => {
      if (e.button === 0) {
        this.p1MouseDown = false;
      }
    };

    this.onContextMenu = (e: Event) => {
      e.preventDefault();
    };

    this.onResize = () => {
      this.viewportW = window.innerWidth;
      this.viewportH = window.innerHeight;
    };

    // Register listeners
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('mousemove', this.onMouseMove);
    window.addEventListener('mousedown', this.onMouseDown);
    window.addEventListener('mouseup', this.onMouseUp);
    window.addEventListener('contextmenu', this.onContextMenu);
    window.addEventListener('resize', this.onResize);
  }

  /**
   * Get Player 1's input state (WASD + mouse aim).
   */
  getPlayer1State(): PlayerInputState {
    let mx = 0;
    let my = 0;
    if (this.p1KeysDown.has('a')) mx -= 1;
    if (this.p1KeysDown.has('d')) mx += 1;
    if (this.p1KeysDown.has('w')) my -= 1;
    if (this.p1KeysDown.has('s')) my += 1;

    // Normalize diagonal
    const moveLen = Math.sqrt(mx * mx + my * my);
    if (moveLen > 1) {
      mx /= moveLen;
      my /= moveLen;
    }

    // Mouse aim (relative to screen center)
    const cx = this.viewportW / 2;
    const cy = this.viewportH / 2;
    const halfMin = Math.min(cx, cy);
    let ax = (this.p1MouseX - cx) / halfMin;
    let ay = (this.p1MouseY - cy) / halfMin;
    const aimLen = Math.sqrt(ax * ax + ay * ay);
    if (aimLen > 1) {
      ax /= aimLen;
      ay /= aimLen;
    }

    return {
      moveX: mx,
      moveY: my,
      aimX: ax,
      aimY: ay,
      shooting: this.p1MouseDown,
      bomb: this.p1KeysJustPressed.has(' '),
      weaponSwap: this.p1KeysJustPressed.has('e'),
    };
  }

  /**
   * Get Player 2's input state (IJKL + auto-aim in movement direction).
   */
  getPlayer2State(): PlayerInputState {
    let mx = 0;
    let my = 0;
    if (this.p2KeysDown.has('j')) mx -= 1;
    if (this.p2KeysDown.has('l')) mx += 1;
    if (this.p2KeysDown.has('i')) my -= 1;
    if (this.p2KeysDown.has('k')) my += 1;

    // Normalize diagonal
    const moveLen = Math.sqrt(mx * mx + my * my);
    if (moveLen > 1) {
      mx /= moveLen;
      my /= moveLen;
    }

    // Auto-aim: shoot in movement direction, or last movement direction
    let ax = mx;
    let ay = my;
    if (moveLen > 0.1) {
      this.p2LastMoveX = mx;
      this.p2LastMoveY = my;
    } else {
      ax = this.p2LastMoveX;
      ay = this.p2LastMoveY;
    }

    return {
      moveX: mx,
      moveY: my,
      aimX: ax,
      aimY: ay,
      shooting: this.p2KeysDown.has('o'),
      bomb: this.p2KeysJustPressed.has('p'),
      weaponSwap: this.p2KeysJustPressed.has('u'),
    };
  }

  /**
   * Clear per-frame flags at end of frame.
   */
  endFrame(): void {
    this.p1KeysJustPressed.clear();
    this.p2KeysJustPressed.clear();
  }

  /**
   * Clean up event listeners.
   */
  dispose(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('mousemove', this.onMouseMove);
    window.removeEventListener('mousedown', this.onMouseDown);
    window.removeEventListener('mouseup', this.onMouseUp);
    window.removeEventListener('contextmenu', this.onContextMenu);
    window.removeEventListener('resize', this.onResize);
  }
}

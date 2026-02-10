/**
 * Unified input system supporting keyboard+mouse and gamepad.
 *
 * Produces a single InputState each frame regardless of input source.
 * Keyboard uses WASD for movement and mouse position (relative to screen
 * centre) for aim.  Gamepad uses left stick for movement and right stick
 * for aim, with auto-fire when the right stick is deflected.
 */

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface InputState {
  /** Horizontal movement axis, -1 (left) to 1 (right). */
  moveX: number;
  /** Vertical movement axis, -1 (up/forward) to 1 (down/back). */
  moveY: number;
  /** Horizontal aim axis, -1 to 1. */
  aimX: number;
  /** Vertical aim axis, -1 to 1. */
  aimY: number;
  /** True while the fire action is held. */
  shooting: boolean;
  /** True on the frame the bomb action is pressed. */
  bomb: boolean;
  /** True while the boost action is held. */
  boost: boolean;
  /** True on the frame the weapon swap key is pressed. */
  weaponSwap: boolean;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEAD_ZONE = 0.15;

// ---------------------------------------------------------------------------
// InputManager
// ---------------------------------------------------------------------------

export class InputManager {
  // -- Keyboard state -------------------------------------------------------
  private readonly keysDown: Set<string> = new Set();
  private readonly keysJustPressed: Set<string> = new Set();

  // -- Mouse state ----------------------------------------------------------
  /** Mouse position in pixels, relative to the viewport. */
  private mouseX = 0;
  private mouseY = 0;
  /** Viewport dimensions (updated on resize). */
  private viewportW = 1;
  private viewportH = 1;
  /** Whether the left mouse button is currently held. */
  private mouseLeftDown = false;

  // -- Gamepad --------------------------------------------------------------
  /** Index of the connected gamepad, or -1 if none. */
  private gamepadIndex = -1;

  // -- Bound handlers (stored so we can remove them in dispose) -------------
  private readonly onKeyDown: (e: KeyboardEvent) => void;
  private readonly onKeyUp: (e: KeyboardEvent) => void;
  private readonly onMouseMove: (e: MouseEvent) => void;
  private readonly onMouseDown: (e: MouseEvent) => void;
  private readonly onMouseUp: (e: MouseEvent) => void;
  private readonly onGamepadConnected: (e: GamepadEvent) => void;
  private readonly onGamepadDisconnected: (e: GamepadEvent) => void;
  private readonly onResize: () => void;
  private readonly onContextMenu: (e: Event) => void;

  constructor() {
    // Capture initial viewport size.
    this.viewportW = window.innerWidth;
    this.viewportH = window.innerHeight;

    // -- Keyboard -----------------------------------------------------------
    this.onKeyDown = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      if (!this.keysDown.has(key)) {
        this.keysJustPressed.add(key);
      }
      this.keysDown.add(key);
      // Prevent default for game-relevant keys so the browser does not scroll.
      if (['w', 'a', 's', 'd', ' ', 'shift', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(key)) {
        e.preventDefault();
      }
    };

    this.onKeyUp = (e: KeyboardEvent) => {
      this.keysDown.delete(e.key.toLowerCase());
    };

    // -- Mouse --------------------------------------------------------------
    this.onMouseMove = (e: MouseEvent) => {
      this.mouseX = e.clientX;
      this.mouseY = e.clientY;
    };

    this.onMouseDown = (e: MouseEvent) => {
      if (e.button === 0) {
        this.mouseLeftDown = true;
      }
    };

    this.onMouseUp = (e: MouseEvent) => {
      if (e.button === 0) {
        this.mouseLeftDown = false;
      }
    };

    this.onContextMenu = (e: Event) => {
      e.preventDefault();
    };

    // -- Gamepad ------------------------------------------------------------
    this.onGamepadConnected = (e: GamepadEvent) => {
      this.gamepadIndex = e.gamepad.index;
    };

    this.onGamepadDisconnected = (e: GamepadEvent) => {
      if (e.gamepad.index === this.gamepadIndex) {
        this.gamepadIndex = -1;
      }
    };

    // -- Resize -------------------------------------------------------------
    this.onResize = () => {
      this.viewportW = window.innerWidth;
      this.viewportH = window.innerHeight;
    };

    // Register all listeners.
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('mousemove', this.onMouseMove);
    window.addEventListener('mousedown', this.onMouseDown);
    window.addEventListener('mouseup', this.onMouseUp);
    window.addEventListener('contextmenu', this.onContextMenu);
    window.addEventListener('gamepadconnected', this.onGamepadConnected);
    window.addEventListener('gamepaddisconnected', this.onGamepadDisconnected);
    window.addEventListener('resize', this.onResize);
  }

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  /** Returns true if `key` (lower-case) is currently held. */
  isKeyDown(key: string): boolean {
    return this.keysDown.has(key);
  }

  /**
   * Sample all input sources and return a unified InputState.
   * Should be called once per frame.
   */
  getState(): InputState {
    const kbState = this.getKeyboardMouseState();
    const gpState = this.getGamepadState();

    // Gamepad takes priority when a stick is deflected; otherwise use KB+M.
    const useGpMove =
      Math.abs(gpState.moveX) > 0 || Math.abs(gpState.moveY) > 0;
    const useGpAim =
      Math.abs(gpState.aimX) > 0 || Math.abs(gpState.aimY) > 0;

    return {
      moveX: useGpMove ? gpState.moveX : kbState.moveX,
      moveY: useGpMove ? gpState.moveY : kbState.moveY,
      aimX: useGpAim ? gpState.aimX : kbState.aimX,
      aimY: useGpAim ? gpState.aimY : kbState.aimY,
      shooting: kbState.shooting || gpState.shooting,
      bomb: kbState.bomb || gpState.bomb,
      boost: kbState.boost || gpState.boost,
      weaponSwap: kbState.weaponSwap || gpState.weaponSwap,
    };
  }

  /**
   * Must be called at the END of each frame to clear per-frame flags
   * (e.g. "just pressed" keys).
   */
  endFrame(): void {
    this.keysJustPressed.clear();
  }

  /** Remove all event listeners.  Call when tearing down the game. */
  dispose(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('mousemove', this.onMouseMove);
    window.removeEventListener('mousedown', this.onMouseDown);
    window.removeEventListener('mouseup', this.onMouseUp);
    window.removeEventListener('contextmenu', this.onContextMenu);
    window.removeEventListener('gamepadconnected', this.onGamepadConnected);
    window.removeEventListener(
      'gamepaddisconnected',
      this.onGamepadDisconnected,
    );
    window.removeEventListener('resize', this.onResize);
  }

  // -----------------------------------------------------------------------
  // Private -- keyboard + mouse
  // -----------------------------------------------------------------------

  private getKeyboardMouseState(): InputState {
    // Movement from WASD or Arrow keys
    let mx = 0;
    let my = 0;
    if (this.keysDown.has('a') || this.keysDown.has('arrowleft')) mx -= 1;
    if (this.keysDown.has('d') || this.keysDown.has('arrowright')) mx += 1;
    if (this.keysDown.has('w') || this.keysDown.has('arrowup')) my -= 1;
    if (this.keysDown.has('s') || this.keysDown.has('arrowdown')) my += 1;

    // Normalise diagonal movement so it is not faster.
    const moveLen = Math.sqrt(mx * mx + my * my);
    if (moveLen > 1) {
      mx /= moveLen;
      my /= moveLen;
    }

    // Aim direction: mouse position relative to screen centre, normalised
    // to -1..1 range.  We normalise by the smaller half-dimension so the
    // magnitude saturates at 1 when the cursor is at the edge of the
    // shorter axis.
    const cx = this.viewportW / 2;
    const cy = this.viewportH / 2;
    const halfMin = Math.min(cx, cy);
    let ax = (this.mouseX - cx) / halfMin;
    let ay = (this.mouseY - cy) / halfMin;
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
      shooting: this.mouseLeftDown,
      bomb: this.keysJustPressed.has(' '),
      boost: this.keysDown.has('shift'),
      weaponSwap: this.keysJustPressed.has('q'),
    };
  }

  // -----------------------------------------------------------------------
  // Private -- gamepad
  // -----------------------------------------------------------------------

  private getGamepadState(): InputState {
    const empty: InputState = {
      moveX: 0,
      moveY: 0,
      aimX: 0,
      aimY: 0,
      shooting: false,
      bomb: false,
      boost: false,
      weaponSwap: false,
    };

    if (this.gamepadIndex < 0) return empty;

    const gp = navigator.getGamepads()[this.gamepadIndex];
    if (!gp) return empty;

    // Left stick -- axes 0 (X) and 1 (Y).
    const rawMoveX = gp.axes[0] ?? 0;
    const rawMoveY = gp.axes[1] ?? 0;
    const [moveX, moveY] = applyDeadZone(rawMoveX, rawMoveY);

    // Right stick -- axes 2 (X) and 3 (Y).
    const rawAimX = gp.axes[2] ?? 0;
    const rawAimY = gp.axes[3] ?? 0;
    const [aimX, aimY] = applyDeadZone(rawAimX, rawAimY);

    // Auto-fire when the right stick is deflected beyond the dead zone.
    const rightStickActive = Math.abs(aimX) > 0 || Math.abs(aimY) > 0;

    // Right trigger (axis 5 on many controllers, or button 7).
    const triggerValue = gp.buttons[7]?.value ?? 0;
    const shooting = rightStickActive || triggerValue > 0.5;

    // Left bumper (button 4) = bomb.
    const bomb = gp.buttons[4]?.pressed ?? false;

    // A button (button 0) = boost.
    const boost = gp.buttons[0]?.pressed ?? false;

    // Y button (button 3) = weapon swap.
    const weaponSwap = gp.buttons[3]?.pressed ?? false;

    return { moveX, moveY, aimX, aimY, shooting, bomb, boost, weaponSwap };
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Apply a radial dead zone to a 2-axis input.  If the magnitude is below
 * the threshold the output is (0, 0).  Otherwise the range is rescaled
 * so that values just outside the dead zone start from 0.
 */
function applyDeadZone(x: number, y: number): [number, number] {
  const mag = Math.sqrt(x * x + y * y);
  if (mag < DEAD_ZONE) return [0, 0];

  const scale = (mag - DEAD_ZONE) / (1 - DEAD_ZONE) / mag;
  const outX = x * scale;
  const outY = y * scale;

  // Clamp to unit circle.
  const outMag = Math.sqrt(outX * outX + outY * outY);
  if (outMag > 1) {
    return [outX / outMag, outY / outMag];
  }
  return [outX, outY];
}

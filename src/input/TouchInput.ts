/**
 * Virtual joystick touch input system for mobile devices.
 *
 * Provides dual virtual joysticks:
 * - LEFT joystick (bottom-left quadrant) for movement
 * - RIGHT joystick (bottom-right quadrant) for aiming
 * - Auto-fires when the right joystick is active
 * - Tap top-center area for bomb / special ability
 *
 * Renders semi-transparent joystick circles as an HTML overlay.
 * Produces the same InputState interface as InputManager so it
 * can be used as a drop-in replacement.
 */

import type { InputState } from './InputManager';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/** Maximum distance (px) the thumb can move from the joystick center. */
const JOYSTICK_RADIUS = 60;

/** Dead zone as a fraction of JOYSTICK_RADIUS. */
const DEAD_ZONE_FRACTION = 0.15;

/** Size of the base circle visual (px). */
const BASE_SIZE = 120;

/** Size of the thumb indicator (px). */
const THUMB_SIZE = 50;

/** Duration to register a bomb tap (ms). */
const BOMB_TAP_DURATION = 300;

// ---------------------------------------------------------------------------
// TouchInput
// ---------------------------------------------------------------------------

export class TouchInput {
  // -- DOM --
  private overlay: HTMLDivElement;

  // -- Left joystick state (movement) --
  private leftActive = false;
  private leftTouchId: number | null = null;
  private leftOriginX = 0;
  private leftOriginY = 0;
  private leftDeltaX = 0;
  private leftDeltaY = 0;
  private leftBase: HTMLDivElement;
  private leftThumb: HTMLDivElement;

  // -- Right joystick state (aim) --
  private rightActive = false;
  private rightTouchId: number | null = null;
  private rightOriginX = 0;
  private rightOriginY = 0;
  private rightDeltaX = 0;
  private rightDeltaY = 0;
  private rightBase: HTMLDivElement;
  private rightThumb: HTMLDivElement;

  // -- Bomb tap state --
  private bombTriggered = false;
  private bombTapStart = 0;
  private bombTouchId: number | null = null;

  // -- Weapon swap button --
  private weaponSwapTriggered = false;
  private weaponSwapBtn: HTMLDivElement;

  // -- Camera tilt buttons --
  private tiltUpBtn: HTMLDivElement;
  private tiltDownBtn: HTMLDivElement;
  /** Tilt delta per second (radians). Applied while button is held. */
  private tiltUpHeld = false;
  private tiltDownHeld = false;
  private readonly TILT_SPEED = 0.8; // radians per second

  // -- Pause button --
  private pauseBtn: HTMLDivElement;

  /** Called when the pause button is tapped. */
  onPause: (() => void) | null = null;

  /** Called when camera tilt buttons are held. delta is radians/second to apply. */
  onCameraTilt: ((delta: number) => void) | null = null;

  // -- Game paused flag (disables touch routing to joysticks when menu is open) --
  private gamePaused = false;

  // -- Bound handlers --
  private readonly onTouchStart: (e: TouchEvent) => void;
  private readonly onTouchMove: (e: TouchEvent) => void;
  private readonly onTouchEnd: (e: TouchEvent) => void;

  constructor() {
    // Create overlay container
    this.overlay = document.createElement('div');
    this.overlay.id = 'touch-controls-overlay';
    this.applyOverlayStyles();

    // Create joystick elements
    this.leftBase = this.createJoystickBase();
    this.leftThumb = this.createJoystickThumb();
    this.rightBase = this.createJoystickBase();
    this.rightThumb = this.createJoystickThumb();

    this.leftBase.appendChild(this.leftThumb);
    this.rightBase.appendChild(this.rightThumb);
    this.overlay.appendChild(this.leftBase);
    this.overlay.appendChild(this.rightBase);

    // Both hidden initially
    this.leftBase.style.display = 'none';
    this.rightBase.style.display = 'none';

    // Pause button (top-right corner) — direct body child, NOT inside the
    // pointer-events:none overlay, to guarantee touch events reach it on all
    // mobile browsers (some browsers don't propagate to auto children of none parents).
    this.pauseBtn = this.createPauseButton();
    document.body.appendChild(this.pauseBtn);

    // Weapon swap button (top-left corner)
    this.weaponSwapBtn = this.createWeaponSwapButton();
    this.overlay.appendChild(this.weaponSwapBtn);

    // Camera tilt buttons (right side, above aim joystick area)
    this.tiltUpBtn = this.createTiltButton('▲', true);
    this.tiltDownBtn = this.createTiltButton('▼', false);
    this.overlay.appendChild(this.tiltUpBtn);
    this.overlay.appendChild(this.tiltDownBtn);

    document.body.appendChild(this.overlay);

    // Touch event handlers
    this.onTouchStart = (e: TouchEvent) => this.handleTouchStart(e);
    this.onTouchMove = (e: TouchEvent) => this.handleTouchMove(e);
    this.onTouchEnd = (e: TouchEvent) => this.handleTouchEnd(e);

    window.addEventListener('touchstart', this.onTouchStart, { passive: false });
    window.addEventListener('touchmove', this.onTouchMove, { passive: false });
    window.addEventListener('touchend', this.onTouchEnd, { passive: false });
    window.addEventListener('touchcancel', this.onTouchEnd, { passive: false });
  }

  // -----------------------------------------------------------------------
  // Public API (matches InputManager interface)
  // -----------------------------------------------------------------------

  /** Sample touch state and return a unified InputState. */
  getState(): InputState {
    const moveX = this.applyDeadZone(this.leftDeltaX / JOYSTICK_RADIUS);
    const moveY = this.applyDeadZone(this.leftDeltaY / JOYSTICK_RADIUS);
    const aimX = this.applyDeadZone(this.rightDeltaX / JOYSTICK_RADIUS);
    const aimY = this.applyDeadZone(this.rightDeltaY / JOYSTICK_RADIUS);

    // Auto-fire when right stick is active
    const rightStickActive = Math.abs(aimX) > 0 || Math.abs(aimY) > 0;

    return {
      moveX: this.clamp(moveX, -1, 1),
      moveY: this.clamp(moveY, -1, 1),
      aimX: this.clamp(aimX, -1, 1),
      aimY: this.clamp(aimY, -1, 1),
      shooting: rightStickActive,
      bomb: this.bombTriggered,
      boost: false,
      weaponSwap: this.weaponSwapTriggered,
    };
  }

  /** Clear per-frame flags (bomb tap, weapon swap). Called at end of frame. */
  endFrame(): void {
    this.bombTriggered = false;
    this.weaponSwapTriggered = false;
  }

  /**
   * Apply camera tilt based on held tilt buttons.
   * Should be called once per frame with the frame delta time (seconds).
   * No-op when the game is paused.
   */
  applyTilt(dt: number): void {
    if (!this.onCameraTilt || this.gamePaused) return;
    if (this.tiltUpHeld) this.onCameraTilt(-this.TILT_SPEED * dt);
    if (this.tiltDownHeld) this.onCameraTilt(this.TILT_SPEED * dt);
  }

  /** Remove all listeners and DOM elements. */
  dispose(): void {
    window.removeEventListener('touchstart', this.onTouchStart);
    window.removeEventListener('touchmove', this.onTouchMove);
    window.removeEventListener('touchend', this.onTouchEnd);
    window.removeEventListener('touchcancel', this.onTouchEnd);
    this.overlay.remove();
    // pauseBtn is a direct body child (not inside overlay) — remove separately.
    this.pauseBtn.remove();
  }

  /** Show/hide the touch overlay. */
  setVisible(visible: boolean): void {
    this.overlay.style.display = visible ? 'block' : 'none';
    // Keep pause button in sync with overlay visibility.
    this.pauseBtn.style.display = visible ? 'flex' : 'none';
  }

  /**
   * Notify TouchInput whether the game is paused.
   * When paused, all touch events are passed through without preventDefault()
   * so that pause menu buttons receive click events normally.
   * Also hides any active joystick visuals immediately.
   */
  setGamePaused(paused: boolean): void {
    this.gamePaused = paused;
    if (paused) {
      this.resetJoystickState();
    }
  }

  private resetJoystickState(): void {
    this.leftActive = false;
    this.leftTouchId = null;
    this.leftDeltaX = 0;
    this.leftDeltaY = 0;
    this.leftBase.style.display = 'none';

    this.rightActive = false;
    this.rightTouchId = null;
    this.rightDeltaX = 0;
    this.rightDeltaY = 0;
    this.rightBase.style.display = 'none';

    this.bombTouchId = null;
    this.tiltUpHeld = false;
    this.tiltDownHeld = false;
  }

  // -----------------------------------------------------------------------
  // Touch event handlers
  // -----------------------------------------------------------------------

  private handleTouchStart(e: TouchEvent): void {
    // When the game is paused, the pause menu is open.
    // Do NOT call preventDefault() so the browser can generate click events
    // on pause menu buttons. Return immediately to prevent joystick activation.
    if (this.gamePaused) return;

    e.preventDefault();
    const w = window.innerWidth;
    const h = window.innerHeight;

    for (let i = 0; i < e.changedTouches.length; i++) {
      const touch = e.changedTouches[i];
      const x = touch.clientX;
      const y = touch.clientY;

      // Top center strip = bomb tap zone (top 20%, middle 60%)
      if (y < h * 0.2 && x > w * 0.2 && x < w * 0.8) {
        this.bombTouchId = touch.identifier;
        this.bombTapStart = performance.now();
        continue;
      }

      // Bottom half of screen for joysticks
      if (y > h * 0.35) {
        if (x < w * 0.5) {
          // Left half = movement joystick
          if (!this.leftActive) {
            this.leftActive = true;
            this.leftTouchId = touch.identifier;
            this.leftOriginX = x;
            this.leftOriginY = y;
            this.leftDeltaX = 0;
            this.leftDeltaY = 0;
            this.showJoystick(this.leftBase, this.leftThumb, x, y, 0, 0);
          }
        } else {
          // Right half = aim joystick
          if (!this.rightActive) {
            this.rightActive = true;
            this.rightTouchId = touch.identifier;
            this.rightOriginX = x;
            this.rightOriginY = y;
            this.rightDeltaX = 0;
            this.rightDeltaY = 0;
            this.showJoystick(this.rightBase, this.rightThumb, x, y, 0, 0);
          }
        }
      }
    }
  }

  private handleTouchMove(e: TouchEvent): void {
    if (this.gamePaused) return;
    e.preventDefault();

    for (let i = 0; i < e.changedTouches.length; i++) {
      const touch = e.changedTouches[i];

      if (touch.identifier === this.leftTouchId && this.leftActive) {
        const rawDx = touch.clientX - this.leftOriginX;
        const rawDy = touch.clientY - this.leftOriginY;
        const { dx, dy } = this.clampJoystick(rawDx, rawDy);
        this.leftDeltaX = dx;
        this.leftDeltaY = dy;
        this.updateJoystickVisual(this.leftBase, this.leftThumb, this.leftOriginX, this.leftOriginY, dx, dy);
      }

      if (touch.identifier === this.rightTouchId && this.rightActive) {
        const rawDx = touch.clientX - this.rightOriginX;
        const rawDy = touch.clientY - this.rightOriginY;
        const { dx, dy } = this.clampJoystick(rawDx, rawDy);
        this.rightDeltaX = dx;
        this.rightDeltaY = dy;
        this.updateJoystickVisual(this.rightBase, this.rightThumb, this.rightOriginX, this.rightOriginY, dx, dy);
      }
    }
  }

  private handleTouchEnd(e: TouchEvent): void {
    if (this.gamePaused) return;
    for (let i = 0; i < e.changedTouches.length; i++) {
      const touch = e.changedTouches[i];

      if (touch.identifier === this.leftTouchId) {
        this.leftActive = false;
        this.leftTouchId = null;
        this.leftDeltaX = 0;
        this.leftDeltaY = 0;
        this.leftBase.style.display = 'none';
      }

      if (touch.identifier === this.rightTouchId) {
        this.rightActive = false;
        this.rightTouchId = null;
        this.rightDeltaX = 0;
        this.rightDeltaY = 0;
        this.rightBase.style.display = 'none';
      }

      if (touch.identifier === this.bombTouchId) {
        const elapsed = performance.now() - this.bombTapStart;
        if (elapsed < BOMB_TAP_DURATION) {
          this.bombTriggered = true;
        }
        this.bombTouchId = null;
      }
    }
  }

  // -----------------------------------------------------------------------
  // Joystick math
  // -----------------------------------------------------------------------

  private clampJoystick(rawDx: number, rawDy: number): { dx: number; dy: number } {
    const dist = Math.sqrt(rawDx * rawDx + rawDy * rawDy);
    if (dist <= JOYSTICK_RADIUS) {
      return { dx: rawDx, dy: rawDy };
    }
    const scale = JOYSTICK_RADIUS / dist;
    return { dx: rawDx * scale, dy: rawDy * scale };
  }

  private applyDeadZone(value: number): number {
    const abs = Math.abs(value);
    if (abs < DEAD_ZONE_FRACTION) return 0;
    const sign = value > 0 ? 1 : -1;
    return sign * (abs - DEAD_ZONE_FRACTION) / (1 - DEAD_ZONE_FRACTION);
  }

  private clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
  }

  // -----------------------------------------------------------------------
  // Joystick visuals
  // -----------------------------------------------------------------------

  private showJoystick(base: HTMLDivElement, thumb: HTMLDivElement, cx: number, cy: number, dx: number, dy: number): void {
    base.style.display = 'block';
    base.style.left = `${cx - BASE_SIZE / 2}px`;
    base.style.top = `${cy - BASE_SIZE / 2}px`;
    thumb.style.left = `${BASE_SIZE / 2 - THUMB_SIZE / 2 + dx}px`;
    thumb.style.top = `${BASE_SIZE / 2 - THUMB_SIZE / 2 + dy}px`;
  }

  private updateJoystickVisual(base: HTMLDivElement, thumb: HTMLDivElement, cx: number, cy: number, dx: number, dy: number): void {
    base.style.left = `${cx - BASE_SIZE / 2}px`;
    base.style.top = `${cy - BASE_SIZE / 2}px`;
    thumb.style.left = `${BASE_SIZE / 2 - THUMB_SIZE / 2 + dx}px`;
    thumb.style.top = `${BASE_SIZE / 2 - THUMB_SIZE / 2 + dy}px`;
  }

  // -----------------------------------------------------------------------
  // DOM creation
  // -----------------------------------------------------------------------

  private applyOverlayStyles(): void {
    const s = this.overlay.style;
    s.position = 'fixed';
    s.top = '0';
    s.left = '0';
    s.right = '0';
    s.bottom = '0';
    s.pointerEvents = 'none';
    s.zIndex = '500';
    s.touchAction = 'none';
  }

  private createPauseButton(): HTMLDivElement {
    const el = document.createElement('div');
    el.id = 'touch-pause-btn';
    el.style.cssText = `
      position: fixed;
      top: max(12px, env(safe-area-inset-top, 0px));
      right: max(12px, env(safe-area-inset-right, 0px));
      width: 44px;
      height: 44px;
      border-radius: 8px;
      background: rgba(0, 0, 0, 0.55);
      border: 1px solid rgba(0, 255, 255, 0.4);
      display: flex;
      align-items: center;
      justify-content: center;
      pointer-events: auto;
      cursor: pointer;
      z-index: 600;
      font-size: 20px;
      color: rgba(0, 255, 255, 0.85);
      text-shadow: 0 0 8px rgba(0, 255, 255, 0.5);
      user-select: none;
      -webkit-user-select: none;
      touch-action: manipulation;
    `;
    el.textContent = '⏸';
    el.addEventListener('touchstart', (e) => {
      e.stopPropagation();
      e.preventDefault();
      if (this.onPause) this.onPause();
    }, { passive: false });
    return el;
  }

  private createJoystickBase(): HTMLDivElement {
    const el = document.createElement('div');
    const s = el.style;
    s.position = 'absolute';
    s.width = `${BASE_SIZE}px`;
    s.height = `${BASE_SIZE}px`;
    s.borderRadius = '50%';
    s.background = 'radial-gradient(circle, rgba(0,255,255,0.1) 0%, rgba(0,255,255,0.05) 100%)';
    s.border = '2px solid rgba(0,255,255,0.3)';
    s.pointerEvents = 'none';
    return el;
  }

  private createJoystickThumb(): HTMLDivElement {
    const el = document.createElement('div');
    const s = el.style;
    s.position = 'absolute';
    s.width = `${THUMB_SIZE}px`;
    s.height = `${THUMB_SIZE}px`;
    s.borderRadius = '50%';
    s.background = 'radial-gradient(circle, rgba(0,255,255,0.6) 0%, rgba(0,255,255,0.2) 100%)';
    s.border = '2px solid rgba(0,255,255,0.5)';
    s.boxShadow = '0 0 10px rgba(0,255,255,0.3)';
    s.pointerEvents = 'none';
    return el;
  }

  private createWeaponSwapButton(): HTMLDivElement {
    const el = document.createElement('div');
    el.style.cssText = `
      position: absolute;
      top: 12px;
      left: 12px;
      width: 44px;
      height: 44px;
      border-radius: 8px;
      background: rgba(0, 0, 0, 0.55);
      border: 1px solid rgba(255, 200, 0, 0.5);
      display: flex;
      align-items: center;
      justify-content: center;
      pointer-events: auto;
      cursor: pointer;
      z-index: 600;
      font-size: 18px;
      color: rgba(255, 200, 0, 0.9);
      text-shadow: 0 0 8px rgba(255, 200, 0, 0.5);
      user-select: none;
      -webkit-user-select: none;
    `;
    el.textContent = '⇄';
    el.title = 'Swap Weapon';
    el.addEventListener('touchstart', (e) => {
      e.stopPropagation();
      e.preventDefault();
      this.weaponSwapTriggered = true;
      // Brief visual feedback
      el.style.background = 'rgba(255, 200, 0, 0.3)';
      setTimeout(() => { el.style.background = 'rgba(0, 0, 0, 0.55)'; }, 150);
    }, { passive: false });
    return el;
  }

  private createTiltButton(symbol: string, isUp: boolean): HTMLDivElement {
    const el = document.createElement('div');
    el.style.cssText = `
      position: absolute;
      right: 66px;
      ${isUp ? 'bottom: 110px' : 'bottom: 60px'};
      width: 40px;
      height: 40px;
      border-radius: 8px;
      background: rgba(0, 0, 0, 0.45);
      border: 1px solid rgba(0, 200, 255, 0.35);
      display: flex;
      align-items: center;
      justify-content: center;
      pointer-events: auto;
      cursor: pointer;
      z-index: 600;
      font-size: 16px;
      color: rgba(0, 200, 255, 0.75);
      user-select: none;
      -webkit-user-select: none;
    `;
    el.textContent = symbol;

    el.addEventListener('touchstart', (e) => {
      e.stopPropagation();
      e.preventDefault();
      if (isUp) this.tiltUpHeld = true;
      else this.tiltDownHeld = true;
      el.style.background = 'rgba(0, 200, 255, 0.2)';
    }, { passive: false });

    const stopTilt = () => {
      if (isUp) this.tiltUpHeld = false;
      else this.tiltDownHeld = false;
      el.style.background = 'rgba(0, 0, 0, 0.45)';
    };

    el.addEventListener('touchend', stopTilt, { passive: true });
    el.addEventListener('touchcancel', stopTilt, { passive: true });

    return el;
  }
}

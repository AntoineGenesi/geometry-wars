/**
 * Virtual joystick touch input system for mobile devices.
 *
 * Provides dual virtual joysticks:
 * - LEFT joystick (bottom-left quadrant) for movement
 * - RIGHT joystick (bottom-right quadrant) for aiming
 * - Auto-fires when the right joystick is active
 * - Tap top-center area for bomb / special ability
 *
 * Also provides weapon change and pause buttons:
 * - Weapon change button: draggable, persists position in localStorage
 *   Tap → cycle weapon. Drag → reposition the button.
 * - Pause button: fixed top-right corner.
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

/** Normalized joystick output changes smaller than this are treated as held-thumb tremor. */
const OUTPUT_TREMOR_EPSILON = 0.12;

/** Per-sample convergence rate for tremor-sized same-direction refinements. */
const OUTPUT_TREMOR_LOW_PASS_ALPHA = 0.2;

/** Size of the base circle visual (px). */
const BASE_SIZE = 120;

/** Size of the thumb indicator (px). */
const THUMB_SIZE = 50;

/** Duration to register a bomb tap (ms). */
const BOMB_TAP_DURATION = 300;

/** Touch move distance (px) above which we treat a weapon-button touch as a drag rather than a tap. */
const WEAPON_BTN_DRAG_THRESHOLD = 8;

/** localStorage key for persisted weapon-button position. */
const WEAPON_BTN_STORAGE_KEY = 'gw-weapon-btn-pos';

/** Size of the weapon change button (px). Must be ≥ 44px per Apple HIG. */
const WEAPON_BTN_SIZE = 56;

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
  private leftOutputX = 0;
  private leftOutputY = 0;
  private leftBase: HTMLDivElement;
  private leftThumb: HTMLDivElement;

  // -- Right joystick state (aim) --
  private rightActive = false;
  private rightTouchId: number | null = null;
  private rightOriginX = 0;
  private rightOriginY = 0;
  private rightDeltaX = 0;
  private rightDeltaY = 0;
  private rightOutputX = 0;
  private rightOutputY = 0;
  private rightBase: HTMLDivElement;
  private rightThumb: HTMLDivElement;

  // -- Bomb tap state --
  private bombTriggered = false;
  private bombTapStart = 0;
  private bombTouchId: number | null = null;

  // -- Weapon change button (draggable, persists position) --
  private weaponSwapTriggered = false;
  private weaponSwapBtn: HTMLDivElement;
  /** Touch id currently tracked for weapon-button interaction (drag or tap). */
  private weaponBtnTouchId: number | null = null;
  /** Viewport-space X where the weapon-button touch started. */
  private weaponBtnTouchStartX = 0;
  /** Viewport-space Y where the weapon-button touch started. */
  private weaponBtnTouchStartY = 0;
  /** Whether the current weapon-button touch has exceeded the drag threshold. */
  private weaponBtnDragging = false;
  /** Button left position at the moment dragging started (px). */
  private weaponBtnDragOriginLeft = 0;
  /** Button top position at the moment dragging started (px). */
  private weaponBtnDragOriginTop = 0;

  // -- Pause button --
  private pauseBtn: HTMLDivElement;

  /** Called when the pause button is tapped. */
  onPause: (() => void) | null = null;

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

    // Weapon change button — also a direct body child for the same reason.
    // Draggable: tap cycles weapon, drag repositions.
    this.weaponSwapBtn = this.createWeaponSwapButton();
    document.body.appendChild(this.weaponSwapBtn);

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
    this.leftOutputX = this.filterJoystickOutput(
      this.applyDeadZone(this.leftDeltaX / JOYSTICK_RADIUS),
      this.leftOutputX,
    );
    this.leftOutputY = this.filterJoystickOutput(
      this.applyDeadZone(this.leftDeltaY / JOYSTICK_RADIUS),
      this.leftOutputY,
    );
    this.rightOutputX = this.filterJoystickOutput(
      this.applyDeadZone(this.rightDeltaX / JOYSTICK_RADIUS),
      this.rightOutputX,
    );
    this.rightOutputY = this.filterJoystickOutput(
      this.applyDeadZone(this.rightDeltaY / JOYSTICK_RADIUS),
      this.rightOutputY,
    );

    // Auto-fire when right stick is active
    const rightStickActive = Math.abs(this.rightOutputX) > 0 || Math.abs(this.rightOutputY) > 0;

    return {
      moveX: this.clamp(this.leftOutputX, -1, 1),
      moveY: this.clamp(this.leftOutputY, -1, 1),
      aimX: this.clamp(this.rightOutputX, -1, 1),
      aimY: this.clamp(this.rightOutputY, -1, 1),
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

  /** Remove all listeners and DOM elements. */
  dispose(): void {
    window.removeEventListener('touchstart', this.onTouchStart);
    window.removeEventListener('touchmove', this.onTouchMove);
    window.removeEventListener('touchend', this.onTouchEnd);
    window.removeEventListener('touchcancel', this.onTouchEnd);
    this.overlay.remove();
    // pauseBtn and weaponSwapBtn are direct body children — remove separately.
    this.pauseBtn.remove();
    this.weaponSwapBtn.remove();
  }

  /** Show/hide the touch overlay. */
  setVisible(visible: boolean): void {
    this.overlay.style.display = visible ? 'block' : 'none';
    // Keep pause button and weapon button in sync with overlay visibility.
    this.pauseBtn.style.display = visible ? 'flex' : 'none';
    this.weaponSwapBtn.style.display = visible ? 'flex' : 'none';
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

  get pausedForGame(): boolean {
    return this.gamePaused;
  }

  private resetJoystickState(): void {
    this.leftActive = false;
    this.leftTouchId = null;
    this.leftDeltaX = 0;
    this.leftDeltaY = 0;
    this.leftOutputX = 0;
    this.leftOutputY = 0;
    this.leftBase.style.display = 'none';

    this.rightActive = false;
    this.rightTouchId = null;
    this.rightDeltaX = 0;
    this.rightDeltaY = 0;
    this.rightOutputX = 0;
    this.rightOutputY = 0;
    this.rightBase.style.display = 'none';

    this.bombTouchId = null;
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
            this.leftOutputX = 0;
            this.leftOutputY = 0;
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
            this.rightOutputX = 0;
            this.rightOutputY = 0;
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

      // Weapon button drag handling
      if (touch.identifier === this.weaponBtnTouchId) {
        const dx = touch.clientX - this.weaponBtnTouchStartX;
        const dy = touch.clientY - this.weaponBtnTouchStartY;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (!this.weaponBtnDragging && dist > WEAPON_BTN_DRAG_THRESHOLD) {
          this.weaponBtnDragging = true;
          // Visual feedback: slightly scale up during drag
          this.weaponSwapBtn.style.transform = 'scale(1.1)';
          this.weaponSwapBtn.style.opacity = '0.8';
        }

        if (this.weaponBtnDragging) {
          const newLeft = this.clamp(
            this.weaponBtnDragOriginLeft + dx,
            0,
            window.innerWidth - WEAPON_BTN_SIZE,
          );
          const newTop = this.clamp(
            this.weaponBtnDragOriginTop + dy,
            0,
            window.innerHeight - WEAPON_BTN_SIZE,
          );
          this.weaponSwapBtn.style.left = `${newLeft}px`;
          this.weaponSwapBtn.style.top = `${newTop}px`;
        }
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
        this.leftOutputX = 0;
        this.leftOutputY = 0;
        this.leftBase.style.display = 'none';
      }

      if (touch.identifier === this.rightTouchId) {
        this.rightActive = false;
        this.rightTouchId = null;
        this.rightDeltaX = 0;
        this.rightDeltaY = 0;
        this.rightOutputX = 0;
        this.rightOutputY = 0;
        this.rightBase.style.display = 'none';
      }

      if (touch.identifier === this.bombTouchId) {
        const elapsed = performance.now() - this.bombTapStart;
        if (elapsed < BOMB_TAP_DURATION) {
          this.bombTriggered = true;
        }
        this.bombTouchId = null;
      }

      // Weapon button: tap triggers swap; drag just repositions
      if (touch.identifier === this.weaponBtnTouchId) {
        if (!this.weaponBtnDragging) {
          // It was a tap — cycle weapon
          this.weaponSwapTriggered = true;
          // Brief visual tap feedback
          this.weaponSwapBtn.style.background = 'rgba(255, 200, 0, 0.4)';
          setTimeout(() => {
            this.weaponSwapBtn.style.background = 'rgba(0, 0, 0, 0.6)';
          }, 150);
        } else {
          // Drag ended — persist new position
          this.saveWeaponBtnPosition();
        }
        // Restore visual
        this.weaponSwapBtn.style.transform = 'scale(1)';
        this.weaponSwapBtn.style.opacity = '1';
        this.weaponBtnTouchId = null;
        this.weaponBtnDragging = false;
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

  private filterJoystickOutput(next: number, previous: number): number {
    if (next === 0 || previous === 0) return next;
    if (Math.sign(next) !== Math.sign(previous)) return next;
    if (Math.abs(next - previous) <= OUTPUT_TREMOR_EPSILON) {
      return previous + (next - previous) * OUTPUT_TREMOR_LOW_PASS_ALPHA;
    }
    return next;
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

  // ---------------------------------------------------------------------------
  // Weapon button position helpers
  // ---------------------------------------------------------------------------

  /** Returns the weapon-button's current {left, top} pixel position. */
  private getWeaponBtnCurrentPos(): { left: number; top: number } {
    const left = parseFloat(this.weaponSwapBtn.style.left) || 0;
    const top = parseFloat(this.weaponSwapBtn.style.top) || 0;
    return { left, top };
  }

  /** Saves current button position as viewport percentages to localStorage. */
  private saveWeaponBtnPosition(): void {
    const { left, top } = this.getWeaponBtnCurrentPos();
    const pctX = (left + WEAPON_BTN_SIZE / 2) / window.innerWidth;
    const pctY = (top + WEAPON_BTN_SIZE / 2) / window.innerHeight;
    try {
      localStorage.setItem(WEAPON_BTN_STORAGE_KEY, JSON.stringify({ pctX, pctY }));
    } catch {
      // localStorage may be unavailable (private browsing etc.) — ignore silently
    }
  }

  /**
   * Returns the initial {left, top} pixel position for the weapon button.
   * Loads from localStorage if available; otherwise defaults to left-side center.
   */
  private loadWeaponBtnPosition(): { left: number; top: number } {
    try {
      const raw = localStorage.getItem(WEAPON_BTN_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as { pctX: number; pctY: number };
        if (
          typeof parsed.pctX === 'number' && parsed.pctX >= 0 && parsed.pctX <= 1 &&
          typeof parsed.pctY === 'number' && parsed.pctY >= 0 && parsed.pctY <= 1
        ) {
          return {
            left: this.clamp(
              parsed.pctX * window.innerWidth - WEAPON_BTN_SIZE / 2,
              0,
              window.innerWidth - WEAPON_BTN_SIZE,
            ),
            top: this.clamp(
              parsed.pctY * window.innerHeight - WEAPON_BTN_SIZE / 2,
              0,
              window.innerHeight - WEAPON_BTN_SIZE,
            ),
          };
        }
      }
    } catch {
      // Ignore parse/storage errors
    }
    // Default: left side, vertically centered
    return {
      left: 16,
      top: this.clamp(
        Math.round(window.innerHeight / 2) - WEAPON_BTN_SIZE / 2,
        0,
        window.innerHeight - WEAPON_BTN_SIZE,
      ),
    };
  }

  private createWeaponSwapButton(): HTMLDivElement {
    const { left, top } = this.loadWeaponBtnPosition();
    const el = document.createElement('div');
    el.id = 'touch-weapon-btn';
    el.style.cssText = `
      position: fixed;
      left: ${left}px;
      top: ${top}px;
      width: ${WEAPON_BTN_SIZE}px;
      height: ${WEAPON_BTN_SIZE}px;
      border-radius: 12px;
      background: rgba(0, 0, 0, 0.6);
      border: 1px solid rgba(255, 200, 0, 0.55);
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 2px;
      pointer-events: auto;
      cursor: pointer;
      z-index: 600;
      color: rgba(255, 200, 0, 0.95);
      text-shadow: 0 0 8px rgba(255, 200, 0, 0.5);
      user-select: none;
      -webkit-user-select: none;
      touch-action: none;
      transition: transform 100ms ease-out, opacity 100ms ease-out;
    `;
    // Icon
    const icon = document.createElement('span');
    icon.style.cssText = 'font-size: 20px; line-height: 1; pointer-events: none;';
    icon.textContent = '⇄';
    // Label
    const label = document.createElement('span');
    label.style.cssText = 'font-size: 9px; letter-spacing: 0.04em; opacity: 0.85; pointer-events: none; font-family: sans-serif;';
    label.textContent = 'WEAPON';
    el.appendChild(icon);
    el.appendChild(label);

    // Touchstart: begin tracking for tap-vs-drag discrimination
    el.addEventListener('touchstart', (e) => {
      e.stopPropagation();
      e.preventDefault();
      if (this.weaponBtnTouchId !== null) return; // already tracking a touch
      const touch = e.changedTouches[0];
      this.weaponBtnTouchId = touch.identifier;
      this.weaponBtnTouchStartX = touch.clientX;
      this.weaponBtnTouchStartY = touch.clientY;
      this.weaponBtnDragging = false;
      const pos = this.getWeaponBtnCurrentPos();
      this.weaponBtnDragOriginLeft = pos.left;
      this.weaponBtnDragOriginTop = pos.top;
    }, { passive: false });

    // Touchmove and touchend are handled by the global handlers in handleTouchMove /
    // handleTouchEnd so that drag continues even if the finger leaves the button element.

    return el;
  }

}

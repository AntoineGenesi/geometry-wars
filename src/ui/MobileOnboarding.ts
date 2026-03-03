/**
 * MobileOnboarding — one-time prompts for mobile players.
 *
 * Two prompts, both mobile-only (no-ops on desktop):
 *
 * 1. Orientation prompt — shown immediately when in portrait, auto-dismisses
 *    when device is rotated to landscape. Blocks gameplay briefly so players
 *    don't start in portrait mode.
 *
 * 2. Pinch-to-zoom hint — shown once after joining the lobby, tap to dismiss.
 *    Stored in localStorage so it only shows on first join.
 */

const PINCH_ZOOM_SEEN_KEY = 'gw3d-pinch-zoom-hint-seen';

// ---------------------------------------------------------------------------
// Orientation prompt
// ---------------------------------------------------------------------------

/**
 * Shows a "rotate your device" overlay when in portrait orientation.
 * Auto-dismisses when the device is rotated to landscape.
 * Returns a cleanup function (removes overlay + listener).
 *
 * No-op if already in landscape.
 */
export function showOrientationPrompt(): (() => void) | null {
  // Only show in portrait mode
  if (window.innerWidth >= window.innerHeight) return null;

  const overlay = document.createElement('div');
  overlay.id = 'mobile-orientation-prompt';
  overlay.style.cssText = [
    'position:fixed',
    'top:0',
    'left:0',
    'width:100%',
    'height:100%',
    'background:rgba(0,0,0,0.95)',
    'z-index:9999',
    'display:flex',
    'flex-direction:column',
    'align-items:center',
    'justify-content:center',
    'font-family:monospace',
    'color:#fff',
    'text-align:center',
    'padding:20px',
    'box-sizing:border-box',
    'user-select:none',
  ].join(';');

  overlay.innerHTML = `
    <div style="font-size:64px;margin-bottom:20px;animation:rotate-hint 1.5s ease-in-out infinite alternate;">📱</div>
    <div style="font-size:22px;font-weight:bold;letter-spacing:3px;color:#0ff;margin-bottom:12px;">ROTATE YOUR DEVICE</div>
    <div style="font-size:14px;color:#aaa;max-width:280px;line-height:1.6;">
      Geometry Wars 3D plays best in <span style="color:#0ff;">landscape</span> orientation.
    </div>
  `;

  // CSS keyframe for the rotation animation
  const style = document.createElement('style');
  style.id = 'mobile-orientation-prompt-style';
  style.textContent = `
    @keyframes rotate-hint {
      0%   { transform: rotate(0deg);   }
      100% { transform: rotate(90deg);  }
    }
  `;
  document.head.appendChild(style);
  document.body.appendChild(overlay);

  let dismissed = false;

  function checkOrientation() {
    if (window.innerWidth >= window.innerHeight) {
      dismiss();
    }
  }

  function dismiss() {
    if (dismissed) return;
    dismissed = true;
    overlay.style.transition = 'opacity 0.4s ease';
    overlay.style.opacity = '0';
    setTimeout(() => {
      overlay.remove();
    }, 400);
    const styleEl = document.getElementById('mobile-orientation-prompt-style');
    if (styleEl) styleEl.remove();
    window.removeEventListener('resize', checkOrientation);
    screen.orientation?.removeEventListener('change', checkOrientation);
  }

  window.addEventListener('resize', checkOrientation, { passive: true });
  screen.orientation?.addEventListener('change', checkOrientation);

  return dismiss;
}

// ---------------------------------------------------------------------------
// Pinch-to-zoom hint
// ---------------------------------------------------------------------------

/**
 * Shows a one-time "3-finger pinch to zoom" hint overlay.
 * Tap anywhere on the hint to dismiss it.
 * After the first dismiss, the hint is stored in localStorage and never shown again.
 *
 * Returns a cleanup function, or null if the hint has already been seen.
 */
export function showPinchZoomHint(): (() => void) | null {
  // Only show once
  try {
    if (localStorage.getItem(PINCH_ZOOM_SEEN_KEY) === '1') return null;
  } catch {
    // localStorage may be blocked — just show it anyway
  }

  const overlay = document.createElement('div');
  overlay.id = 'mobile-pinch-zoom-hint';
  overlay.style.cssText = [
    'position:fixed',
    'bottom:0',
    'left:0',
    'width:100%',
    'background:rgba(0,0,0,0.88)',
    'z-index:5000',
    'display:flex',
    'align-items:center',
    'justify-content:center',
    'gap:12px',
    'padding:16px 20px',
    'box-sizing:border-box',
    'font-family:monospace',
    'border-top:1px solid rgba(0,255,255,0.3)',
    'cursor:pointer',
    'animation:hint-slide-up 0.4s ease',
  ].join(';');

  overlay.innerHTML = `
    <div style="font-size:28px;">🤏</div>
    <div style="flex:1;min-width:0;">
      <div style="font-size:13px;font-weight:bold;color:#0ff;letter-spacing:2px;margin-bottom:4px;">PINCH TO ZOOM</div>
      <div style="font-size:11px;color:#aaa;line-height:1.5;">Use <span style="color:#fff;">3 fingers</span> to pinch and zoom the camera.</div>
    </div>
    <div style="font-size:11px;color:#555;flex-shrink:0;">TAP TO DISMISS</div>
  `;

  const style = document.createElement('style');
  style.id = 'mobile-pinch-zoom-hint-style';
  style.textContent = `
    @keyframes hint-slide-up {
      from { transform: translateY(100%); opacity: 0; }
      to   { transform: translateY(0);    opacity: 1; }
    }
  `;
  document.head.appendChild(style);
  document.body.appendChild(overlay);

  let dismissed = false;

  function dismiss() {
    if (dismissed) return;
    dismissed = true;
    try { localStorage.setItem(PINCH_ZOOM_SEEN_KEY, '1'); } catch { /* ok */ }
    overlay.style.transition = 'opacity 0.3s ease, transform 0.3s ease';
    overlay.style.opacity = '0';
    overlay.style.transform = 'translateY(20px)';
    setTimeout(() => overlay.remove(), 350);
    const styleEl = document.getElementById('mobile-pinch-zoom-hint-style');
    if (styleEl) styleEl.remove();
  }

  overlay.addEventListener('pointerdown', dismiss, { once: true });

  // Auto-dismiss after 8 seconds even if not tapped
  const autoTimer = setTimeout(dismiss, 8000);

  return () => {
    clearTimeout(autoTimer);
    dismiss();
  };
}

// ---------------------------------------------------------------------------
// Combined entry point
// ---------------------------------------------------------------------------

/**
 * Run all mobile onboarding prompts in sequence.
 * Call once after the game engine is initialised and the lobby UI is visible.
 *
 * Mobile-only: both functions are no-ops on desktop.
 *
 * @param onOrientationDismissed  Optional callback fired when orientation prompt dismisses.
 */
export function runMobileOnboarding(onOrientationDismissed?: () => void): void {
  // 1. Orientation prompt — must be in landscape before showing game content
  const dismissOrientation = showOrientationPrompt();
  if (dismissOrientation) {
    // Wait for orientation to be landscape before showing pinch hint
    const origDismiss = dismissOrientation;
    let pinchScheduled = false;

    function schedulePinchHint() {
      if (pinchScheduled) return;
      pinchScheduled = true;
      onOrientationDismissed?.();
      setTimeout(() => showPinchZoomHint(), 1500);
    }

    // Poll for orientation change (also fires from the auto-dismiss inside showOrientationPrompt)
    const orientationPoll = setInterval(() => {
      if (window.innerWidth >= window.innerHeight) {
        clearInterval(orientationPoll);
        schedulePinchHint();
      }
    }, 200);

    // Safety: if still portrait after 30s, stop polling
    setTimeout(() => clearInterval(orientationPoll), 30_000);
  } else {
    // Already in landscape — show pinch hint directly after a short delay
    setTimeout(() => showPinchZoomHint(), 1000);
  }
}

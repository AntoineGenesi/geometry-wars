/**
 * GameLoadingOverlay — manages the #loading-screen overlay.
 *
 * The overlay is defined in index.html and visible on page load.
 * StartMenu dismisses it when the menu is ready (removes the element from DOM).
 * When transitioning from StartMenu → game, we re-create and show it again.
 *
 * Usage:
 *   showGameLoading('STARTING GAME...')  — show/re-create overlay with status text
 *   updateGameLoadingStatus('...')       — update status text while visible
 *   hideGameLoading()                   — fade out and remove overlay
 */

function getOrCreateOverlay(): HTMLElement {
  let el = document.getElementById('loading-screen');
  if (el) {
    // Already exists — remove fade-out so it's visible again
    el.classList.remove('fade-out');
    return el;
  }

  // Re-create if removed by StartMenu (.remove() after fade-out)
  el = document.createElement('div');
  el.id = 'loading-screen';
  el.innerHTML = `
    <div class="loading-title">GEOMETRY WARS 3D</div>
    <div class="loading-spinner"></div>
    <div id="loading-status" class="loading-status"></div>
  `;
  document.body.appendChild(el);
  return el;
}

/** Show (or re-create) the full-screen loading overlay with optional status text. */
export function showGameLoading(status = ''): void {
  const el = getOrCreateOverlay();
  const statusEl = el.querySelector('#loading-status') as HTMLElement | null;
  if (statusEl) statusEl.textContent = status;
}

/** Update the status line text while the overlay is visible. */
export function updateGameLoadingStatus(status: string): void {
  const statusEl = document.getElementById('loading-status');
  if (statusEl) statusEl.textContent = status;
}

/** Fade out the loading overlay and remove it from DOM. */
export function hideGameLoading(): void {
  const el = document.getElementById('loading-screen');
  if (!el) return;
  el.classList.add('fade-out');
  el.addEventListener('transitionend', () => el.remove(), { once: true });
}

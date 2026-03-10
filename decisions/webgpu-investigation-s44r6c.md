# WebGPU Button Fix — Root Cause Investigation (s44r6c-07)

**Date:** 2026-03-10

## Problem

User's desktop PC detects WebGPU as available (adapter, features, SharedArrayBuffer all show as
available), but clicking "Enable WebGPU Renderer" does NOTHING. The active renderer is always
WebGL2 regardless of the button click or `?renderer=webgpu` in the URL. No console errors.

## Root Cause

Both entry points (`main.ts` and `network-main.ts`) called `new Game({...})` — the **synchronous
constructor** — instead of `await Game.create({...})` — the **async factory**.

The `Game` constructor (when called without `_renderer` in config) ALWAYS creates a
`new THREE.WebGLRenderer()`. It skips capability detection entirely:

```typescript
// Game constructor (synchronous) — does NOT check URL params or WebGPU
constructor(config: GameConfig = {}) {
  if (config._renderer) {
    this.renderer = config._renderer;  // Only if pre-built renderer provided
  } else {
    // Always creates WebGL2! No capability check, no URL param check.
    this.renderer = new THREE.WebGLRenderer({...});
  }
}
```

The `Game.create()` static async factory does the right thing:

```typescript
static async create(config: GameConfig = {}): Promise<Game> {
  const capabilities = await detectGPUCapabilities();   // Probes WebGPU hardware
  const { renderer, isWebGPU, backend } = await createRenderer(container, capabilities);
  // createRenderer checks ?renderer=webgpu, tries WebGPURenderer.init(), logs all outcomes
  return new Game({ ...config, _renderer: renderer, _capabilities: capabilities, ... });
}
```

## Why No Console Logs

All the verbose logging was in `createRenderer()` / `createWebGPURenderer()`. Since `new Game()`
bypassed `createRenderer()` entirely, none of that code ran. This is why the user saw no console
output at all — not because WebGPU initialization failed silently, but because it was never
attempted.

## Fix Applied

1. **`src/main.ts` line ~442:** `new Game({...})` → `await Game.create({...})`
2. **`src/network-main.ts` line ~538:** `new Game({...})` → `await Game.create({...})`

Both functions are already `async`, so `await Game.create()` works without other changes.

3. **`src/rendering/RendererFactory.ts`:** Added explicit verbose `console.log` at the start of
   `createRenderer()` showing: preference selected, URL param value, WebGPU capability. This
   ensures the console clearly shows what happened and why.

4. **`src/ui/SettingsMenu.ts`:** Added a third state to the WebGPU toggle section: when
   `?renderer=webgpu` is in the URL but the active renderer is still WebGL2, show "WebGPU
   initialization failed" with a diagnostic message (check console + update GPU driver).

## Auto-Selection Behavior After Fix

After the fix, `Game.create()` runs `detectGPUCapabilities()` which probes the WebGPU adapter and
device creation. If that succeeds (`capabilities.webgpu = true`), `resolveRendererPreference()`
auto-selects WebGPU **even without the `?renderer=webgpu` URL param**. The button becomes
redundant for users whose hardware supports WebGPU — the game will use it automatically.

The button remains useful for cases where:
- WebGPU detection previously failed (force retry with explicit URL param)
- User wants to switch back from WebGL2 to WebGPU after having switched away

## If WebGPU Still Fails After Fix

If the hardware truly cannot use WebGPU (e.g., outdated GPU driver), the `createWebGPURenderer()`
function will detect this via the `renderer.backend.constructor.name !== 'WebGPUBackend'` check or
a caught exception, log a detailed warning, and fall back to WebGL2 with a clean error message.

Common causes of WebGPU being available but unusable:
- GPU driver too old for WebGPU device features
- Chrome's GPU blocklist (check chrome://gpu)
- Three.js WebGPURenderer falling back to WebGL2 internally

Diagnostic: run `__webgpuDiagnostic()` in the browser console (installed by `installWebGPUDiagnostic()`).

## Files Changed

- `src/main.ts` — `new Game()` → `await Game.create()`
- `src/network-main.ts` — `new Game()` → `await Game.create()`
- `src/rendering/RendererFactory.ts` — verbose logging in `createRenderer()`
- `src/ui/SettingsMenu.ts` — "WebGPU failed" state when `?renderer=webgpu` but still WebGL2
- `src/rendering/RendererFactory.test.ts` — regression tests documenting expected behavior

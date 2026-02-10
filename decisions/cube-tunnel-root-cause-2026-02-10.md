## 2026-02-10 - Cube Tunnel: Why 3+ Fix Attempts Failed

**Context:** User reported cube tunnel as "too small" at least 3 times. Previous fixes increased `CubeWithTunnelSurface.ts` constructor default from 20 → 30 → 50 → 100. User said nothing changed.

**Root Cause:** `src/main.ts:635` passes `size: level.surfaceScale` (typically 8-12) to SurfaceFactory.create(), which **overrides the constructor default**. Every previous fix changed a default value that was never actually used by the game.

The constructor default (100) is only used when no `size` is passed — but the game ALWAYS passes `size: level.surfaceScale`.

**Fix Applied:** Added a surface-specific override in `main.ts` that sets `size: 80, wallThickness: 4.0, bevelRadius: 10.0, gridSegments: 20` when `surfaceType === 'cube-tunnel'`. This is 10x the level.surfaceScale value and dramatically larger.

**Why Previous Agents Missed This:**
1. Agents only looked at `CubeWithTunnelSurface.ts`, not how it's instantiated
2. The constructor default LOOKS like it controls the size, but `main.ts` overrides it
3. No agent traced the full code path from `main.ts` → `SurfaceFactory.create()` → constructor
4. Each fix was verified at Level 1 (TypeScript compiles) but never Level 4 (visual test)

**Lesson:** Always trace how a surface is INSTANTIATED, not just how it's DEFINED. The factory call in main.ts is the real source of truth.

**Verification Level:** 1 (TypeScript compiles, tests pass). User must verify visually.

**Reversibility:** Easy — remove the `if (surfaceType === 'cube-tunnel')` block in main.ts.

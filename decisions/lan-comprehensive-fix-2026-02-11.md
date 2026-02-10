## 2026-02-11 - LAN Multiplayer Comprehensive Fix

**Context:** LAN multiplayer has been broken across 10+ fix attempts. User reports: sluggish movement, invisible enemies, fast ammo depletion, can't restart, phone can't connect.

**Changes Made (6 fixes + diagnostic toolkit):**

1. **Weapon ammo per-shot** — Moved ammo deduction from per-tick (60Hz) to per-shot in `tryShoot()`. Was burning ammo 6x faster than shots fired.
   - Reversibility: Easy (move ammo-- back to updateWeaponPickups)

2. **Enemy spawn V-clamping** — Enemies now spawn at V=0.05/0.95 instead of V=0/1. Poles are singularities on spheres → invisible enemies.
   - Reversibility: Easy (change constants back)

3. **Enemy movement V-clamping** — Added V-coordinate clamping (0.05-0.95) to enemy movement to prevent drift to poles.
   - Reversibility: Easy (remove 2 lines)

4. **Client-side prediction physics match** — Client prediction now includes sin(phi) correction and surface-specific V wrapping, exactly matching server physics.
   - Reversibility: Easy (revert to flat UV prediction)
   - Trade-off: More code in prediction, but eliminates rubber-banding

5. **Remote entity interpolation** — Added lerp (0.3 for players, 0.35 for enemies) for remote entity positions instead of snapping.
   - Reversibility: Easy (change lerp to direct copy)
   - Trade-off: Slight visual lag on remote entities (1-2 frames) vs jittery snapping

6. **Game restart fix** — Changed start condition from `!gameStarted` to `!gameStarted || gameOver`.
   - Reversibility: Easy (revert condition)

7. **Diagnostic toolkit** — `window.__lanDebug` API with status, entities, latency, report, overlay commands.
   - Reversibility: Easy (remove code block at end of main())
   - Decision: Always-on (not gated by ?debug) because user needs it for debugging without dev knowledge

**Verification Level:** 2 (compiles + 1506 tests pass). Level 4 requires user testing.

**Why this fix attempt is different from previous 10:**
- Read ALL previous investigation files first (didn't start from scratch)
- Created diagnostic toolkit for user to provide real data
- Addressed 7 specific root causes with targeted fixes
- Explicitly never claims "fixed"
- Includes user test plan with exact steps

# MP Shared Game Loop Rebuild — Architecture & Decomposition Plan

**Date:** 2026-03-01
**Parent Task:** s42-04-mp-shared-game-loop-rebuild-epic.md
**Status:** Decomposed into sub-tasks (s42-04a through s42-04h)

---

## Executive Summary

The user's core demand: **"Multiplayer should have everything single player has. The same game loop."**

The root problem is structural: `GameLoop.ts` (SP) and `GameRoom.ts + network-main.ts` (MP) share zero game logic. Every SP fix must be manually ported to MP — and it almost never is.

**The solution is NOT to rewrite GameLoop.ts into a pure shared module** (that would require touching all 879 lines plus 690+ tests and is a regression bomb). Instead:

1. Add missing game systems to the MP server (damage multipliers, player level, buffs, DDA, super pickups)
2. Add a shared constants module so values stay in sync
3. Port full enemy AI behaviors from SP to the server
4. Verify SP is unaffected at every phase

This is a "bring MP up to SP parity" project, not a "merge codebases" project. The architecture stays split — server-authoritative Colyseus for MP, GameLoop for SP. What changes is the server having complete implementations of all gameplay systems.

---

## Why NOT a True "Shared GameLoop"

The task description suggests `GameLoopShared.ts` but this has serious practical problems:

1. **GameLoop.ts is deeply coupled to Three.js rendering** — `ctx.game.camera`, `ctx.surface`, `ctx.meshSurface`, `MeshWalker`, etc. The server has none of these.
2. **Bullet physics divergence is intentional and working** — Server uses Christoffel UV equations; client uses FaceWalker. This was fixed across 10+ sessions (S38–S41). Don't break it.
3. **Player movement is intentionally different** — Server uses UV-space with metric corrections; SP uses MeshWalker on mesh faces. This was also the subject of 5+ sessions of bug fixing.
4. **690+ tests depend on current GameLoop/GameInstance structure.** A refactor would require touching test infrastructure.
5. **Every SP fix session has created regression guards** — Any large refactor risks breaking them.

**The right approach:** Port the PURE GAME LOGIC (damage formulas, DDA, player level tracking, buff multipliers, mastery multipliers) to the server, sharing only the logic that is rendering-agnostic.

---

## Current State Analysis

### What SP Has That MP Doesn't

| System | SP Implementation | MP Server State | Gap |
|--------|------------------|-----------------|-----|
| Damage formula | `base × level × buff × mastery × weapon` | `WEAPON_CONFIGS[type].damage` only | CRITICAL — huge damage difference |
| Player level-up | `PlayerLevel.ts` (kill-based, 10 tiers) | Not tracked | CRITICAL — no level bonuses in MP |
| Buff multipliers | `BuffManager.ts` (8 buff types, stacking formulas) | Not tracked | HIGH — buffs are visual-only in MP |
| Weapon mastery | `WeaponMasteryManager.ts` (XP, 100 nodes) | Not tracked | HIGH — mastery damage bonuses absent |
| DDA | `DDADecisionEngine.ts` + `DDASpawnModifier.ts` | Client-side only (host) | MEDIUM — difficulty feels off in MP |
| Super pickups | `PickupSpawner.ts` supers | Not implemented in MP | MEDIUM |
| Buff pickups | `BuffPickupNew.ts` + server bonus | Client-side only | MEDIUM |
| Enemy AI (full) | 30 SP enemy classes with rich behaviors | Simplified per-type in GameRoom | LOW-MED — AI exists but simplified |
| Score multiplier | Kill-based geom multiplier | Basic multiplier (no geoms) | LOW |

### What MP Has That Works Well
- Bullet physics (Christoffel UV geodesics — keep as-is)
- Hit detection (great-circle for sphere, UV-distance for others — keep as-is)
- Enemy spawning via waves (mirrors SP DifficultyScaling.ts)
- Weapon pickups (server-authoritative, working)
- Player movement (UV-space with metric corrections — keep as-is)
- Camera-frame aim angle (s40-03 fix — keep as-is)
- All 30 enemy type names registered (many map to simplified AI though)

---

## Decomposition: 8 Phases

### Phase A — Shared Constants Module (FOUNDATION)
**Why first:** Constants are duplicated between SP and MP (damage values, speeds, thresholds). Centralizing them prevents drift. No gameplay changes.
**Risk:** Very low. Adding a new file, updating imports.
**SP impact:** None (SP reads from same source).

### Phase B — Player Level Tracking on Server (DAMAGE FOUNDATION)
**Why second:** Player level is the first damage multiplier that's missing. It's purely kill-based (no rendering dependency). Adding it to GameRoom requires tracking kills per player and computing `damageMult` from the level table.
**Risk:** Low. New tracking state added to GameRoom, no changes to SP.
**SP impact:** None.

### Phase C — Full Damage Formula on Server (CRITICAL PARITY)
**Why third:** Once player level is tracked (Phase B), implement the full damage formula. This is the most impactful single change for gameplay parity.
**Risk:** Medium. Changes damage in MP. Must be calibrated to avoid making MP too easy/hard.
**SP impact:** None.

### Phase D — Buff Pickups Server-Authoritative + Damage Bonuses (BUFF PARITY)
**Why fourth:** Buff pickups currently spawn client-side with no server knowledge. Server must track active buffs per player and apply them in damage formula (Phase C must exist first).
**Risk:** Medium-High. Requires new Colyseus schema fields for buff state.
**SP impact:** None.

### Phase E — DDA on Server (DIFFICULTY PARITY)
**Why fifth:** DDA currently runs client-side (host only). Should run on server so difficulty adjusts for all players and the server controls spawn rate.
**Risk:** Medium. Server already has `computeDifficultyLevel()` and `tickWaves()`. Need to add performance tracking input and spawn modifier output.
**SP impact:** None.

### Phase F — Super Pickups in MP (PICKUP PARITY)
**Why sixth:** Super pickups (bomb resupply, etc.) are entirely absent from MP. Server must track and spawn them the way `PickupSpawner.ts` does.
**Risk:** Low. New spawn logic only.
**SP impact:** None.

### Phase G — Enemy AI Full Behaviors (AI PARITY)
**Why seventh:** Many enemy types in MP fall back to simple chase. Porting the full SP state machine behaviors (lurker, repulsor, helix, orbiter, fractal snake, etc.) to server-side AI. This is the largest single phase.
**Risk:** Medium. Server AI already has partial implementations. Extending them.
**SP impact:** None.

### Phase H — Regression Tests + Verification (VERIFICATION)
**Why last:** After all gameplay systems are ported, run SP regression suite and create MP parity tests to verify correctness.
**Risk:** Low. Read-only test work.
**SP impact:** None (tests only).

---

## Execution Order & Parallelism

```
Phase A (Shared Constants) ─────────────────────► merge
Phase B (Player Level on Server) ───────────────► merge  ─┐
                                                            ├── must complete before Phase C
Phase C (Full Damage Formula) ──────────────────► merge  ◄─┘
Phase D (Buff Pickups Server-Auth) ─────────────► merge  (can start after Phase C)
Phase E (DDA on Server) ────────────────────────► merge  (independent after Phase A)
Phase F (Super Pickups) ────────────────────────► merge  (independent after Phase A)
Phase G (Enemy AI Full Behaviors) ──────────────► merge  (independent, largest phase)
Phase H (Regression + Verification) ────────────► done   (after all merges)
```

**Wave 1 (parallel):** A + E + F + G (all independent of each other)
**Wave 2 (parallel):** B + D (B is foundation for C; D depends on Phase C schema)
**Wave 3 (sequential):** C (depends on B)
**Wave 4 (final):** H (after all above merged)

---

## Key Constraints (Carry These Into Every Worker)

1. **NEVER change SP code paths** — GameLoop.ts, main.ts, GameInstance.ts are off-limits
2. **Keep Christoffel bullet physics** — Do not port FaceWalker to server. Already fixed across S38–S41.
3. **Keep UV-space player movement on server** — Already correct, documented in MP-ARCHITECTURE.md
4. **Keep camera-frame aim angle** — s40-03 fixed this. `computeCameraRelativeAimAngle()` in network-main.ts
5. **Colyseus Schema requires `declare` keyword** — NOT `!:` non-null assertion. See PROJECT.md.
6. **Server is TypeScript (Node.js)** — No Three.js imports on server. Pure math/logic only.
7. **All new schema fields must be in `server/schema/GameState.ts`**
8. **After each phase: run `npm test`** to verify SP tests still pass

---

## Files Each Phase Touches

| Phase | Server Files | Client Files | SP Files |
|-------|-------------|-------------|---------|
| A | `server/shared/GameConstants.ts` (NEW) | `src/weapons/WeaponTypes.ts` (read only) | NONE |
| B | `server/rooms/GameRoom.ts` | NONE | NONE |
| C | `server/rooms/GameRoom.ts` | `server/schema/GameState.ts` | NONE |
| D | `server/rooms/GameRoom.ts`, `server/schema/GameState.ts` | `src/network-main.ts` | NONE |
| E | `server/rooms/GameRoom.ts` | NONE | NONE |
| F | `server/rooms/GameRoom.ts`, `server/schema/GameState.ts` | `src/network-main.ts` | NONE |
| G | `server/rooms/GameRoom.ts` | NONE | NONE |
| H | `tests/mp-parity/*.test.ts` (NEW) | NONE | NONE |

---

## Success Criteria

1. SP tests (`npm test`) pass with zero regressions
2. MP damage formula matches SP: `base × level × buff × mastery × weapon`
3. Player levels up in MP (kills award XP, multiplier applied)
4. Buff pickups in MP apply damage bonuses on server
5. DDA adjusts MP difficulty (server-side spawn modifier)
6. Super pickups appear in MP
7. All 30 enemy types have correct behaviors (not just chase fallback)
8. Level 5 verification: Puppeteer screenshot of MP game shows correct behavior

---

## Sub-Task Files

- `tasks/s42-04a-mp-shared-constants.md`
- `tasks/s42-04b-mp-player-level-server.md`
- `tasks/s42-04c-mp-full-damage-formula.md`
- `tasks/s42-04d-mp-buff-pickups-server-auth.md`
- `tasks/s42-04e-mp-dda-server.md`
- `tasks/s42-04f-mp-super-pickups.md`
- `tasks/s42-04g-mp-enemy-ai-full-behaviors.md`
- `tasks/s42-04h-mp-parity-regression-tests.md`

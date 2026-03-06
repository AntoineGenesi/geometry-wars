# Failed Experiments & Known Dead Ends

> Short-form reference for workers. Before starting a new approach, check here to avoid re-traveling dead ends.
> **Format:** What was tried → Why it failed → What to do instead.

---

## [GAMEPLAY] Split-Screen Co-op

**Tried:** Full split-screen with per-viewport EffectComposer (bloom per viewport).
**Why it failed:** Multiple render targets + compositing = extreme complexity + perf cost for minor visual benefit. Implemented without EffectComposer (S8), then removed entirely in S38a after multiplayer went LAN-only. Code no longer in main path.
**What to do instead:** LAN multiplayer is the co-op path. Don't re-implement split-screen.
**Reference:** `archive/decisions/split-screen-coop.md`

---

## [ARCHITECTURE] Fixing PlaygroundGame.ts when the main game is broken

**Tried:** Session 19 spent 8+ hours editing `PlaygroundGame.ts` for every gameplay bug.
**Why it failed:** `src/main.ts` calls `GameLoop.ts` directly. `PlaygroundGame.ts` is a deprecated wrapper for tests/demos — it is NEVER called during normal gameplay. Every fix was invisible to the user.
**What to do instead:** Trace from `src/main.ts` first. The chain is: `main.ts → GameLoop.ts → Player.ts, EnemySpawner.ts`. Only edit `GameInstance.ts` / `PlaygroundGame.ts` when fixing test harness behavior. See `CLAUDE.md` "What NOT to Edit" section.
**Reference:** `PROJECT.md`, `.claude/rules/verify-code-is-called.md`

---

## [RENDERING] Rapier WASM for collision detection

**Tried:** Replacing the JS SpatialHash collision system with Rapier3D (WASM-based rigid body physics).
**Why it failed:** JS SpatialHash is faster than Rapier at all entity counts (1K–10K). Rapier's `world.step()` has fixed WASM-boundary-crossing overhead even with zero gravity. At 10K entities, SpatialHash wins ~5x.
**What to do instead:** Keep `SpatialHash` (`src/physics/SpatialHash.ts`). Rapier only becomes useful if physics constraints (joints, rigid bodies) are needed — not for simple circle-overlap queries.
**Reference:** `archive/decisions/rapier-collision-system-2026-02-09.md`

---

## [MULTIPLAYER] WebRTC P2P for distributed enemy AI computation

**Tried:** Offloading enemy AI computation to browser clients via WebRTC data channels to reduce server load.
**Why it failed:** WebRTC introduces security risk (clients can cheat AI), very high implementation complexity, and the gains are marginal compared to server-side worker threads. Node.js Worker Threads (server-side parallelism) achieve the same goals with lower complexity and zero security risk.
**What to do instead:** Node.js Worker Threads on the server (spawning sub-loops for collision detection). Client-computed non-authoritative AI is acceptable for visual polish (not game state). See distributed computation research.
**Reference:** `decisions/distributed-computation-feasibility-2026-02-21.md`

---

## [MULTIPLAYER] LAN quick-win patches

**Tried:** 10+ targeted fix attempts across sessions 4, 7, 8, 9, 11, 12, 15, 33, 38d, 41, 42 for LAN multiplayer. Each fixed specific symptoms (ammo drain, enemy poles, restart crash, lerp jitter) but the system remained fragile.
**Why it failed:** LAN multiplayer has deep architectural issues (server-authoritative 60 Hz loop, WSL2 NAT, Colyseus schema/ES2022 conflicts, client prediction mismatch). Individual patches don't address the root architecture.
**What to do instead:** Read ALL `decisions/lan-*.md` files before touching LAN code. The most comprehensive fix is `mp-rebuild-s42-plan.md`. Never say "fixed" for LAN — always say "changes made, here's what to test." Level 5 is the max verification Claude can achieve.
**Reference:** `decisions/mp-rebuild-s42-plan.md`, `decisions/lan-connectivity-wsl2-2026-02-21.md`, `archive/decisions/lan-deep-audit-2026-02-11.md`

---

## [RENDERING] PlaygroundGame camera spinning (fixed 3 times, kept regressing)

**Tried:** Fixing the weapon/visual playground spinning camera in sessions 9, 11, and 15 (tasks #51, #61, ~#90).
**Why it failed:** Two independent issues, BOTH required: (1) camera.up must use `bitangent`, not the surface normal — when up is parallel to the look direction, `lookAt()` produces degenerate roll; (2) camera-relative movement creates a feedback loop where movement changes camera orientation which changes movement direction.
**What to do instead:** When editing `PlaygroundGame.ts` camera code, check ALL 4 locations that set `camera.up` (constructor, `setSurface()`, `renderUpdate()`, `respawnPlayer()`). Use `walker.getTangentFrame().bitangent` for up vector everywhere.
**Reference:** `archive/decisions/playground-spinning-fix.md`

---

## [MAPS] Cube tunnel size — "fixed" 3+ times

**Tried:** Multiple mathematical fixes to cube tunnel dimensions across S8, S20, and S44l.
**Why it failed:** Each fix was verified mathematically (scale factors look correct) but the visual result was still "too small" when the user played. Mathematical correctness ≠ visual playability.
**What to do instead:** Always verify cube tunnel changes with a Puppeteer screenshot (Level 5) showing the actual gameplay view, not just the numbers. The user should see enemies filling the corridor. See `decisions/cube-tunnel-size-audit.md`.
**Reference:** `decisions/cube-tunnel-size-audit.md`, task `s44l-20-cube-tunnel-map-shooting-hit-detection.md`

---

## [PERFORMANCE] Opacity system via InstancedMesh per-instance color

**Tried:** Using `instanceColor` (RGB) to simulate transparency for entities.
**Why it failed:** `InstancedMesh` has no per-instance alpha — `instanceColor` is RGB-only. Changing R/G/B to darken an entity simulates "dimming" but cannot produce true transparency. The opacity audit found several systems assuming alpha was available via instanceColor.
**What to do instead:** For true transparency, use a custom shader with `instanceAlpha` attribute. For dimming (e.g., entity culling), RGB darkening via `instanceColor` is acceptable. Never assume `.setColorAt()` affects alpha.
**Reference:** `archive/decisions/opacity-audit-2026-02-10.md`

---

## [MULTIPLAYER] Using SP code paths for MP fixes

**Tried:** Multiple sessions fixed gameplay bugs (weapon mastery, map size scaling, pickup dimming) in `GameLoop.ts` (SP path) but assumed MP was also covered.
**Why it failed:** SP (`main.ts → GameLoop.ts`) and MP (`multiplayer-main.ts` / `network-main.ts`) are completely separate code paths. `GameLoop.ts` is NOT imported by MP. S41 audit found 3 critical SP features completely absent from MP.
**What to do instead:** After any SP gameplay fix, explicitly check: "Does this also apply to multiplayer-main.ts and network-main.ts?" If yes, apply separately. See `.claude/rules/merge-protocol.md` for the full checklist.
**Reference:** `docs/MP-ARCHITECTURE.md`, `reports/mp-architecture-audit.html`, `.claude/rules/merge-protocol.md`

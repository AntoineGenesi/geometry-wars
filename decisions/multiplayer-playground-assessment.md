## 2026-02-11 — Does Multiplayer Need PlaygroundGame Rewrite?

**User question:** "Will you have to rewrite the multiplayer and local splitscreen code because we have the PlaygroundGame object now?"

### Answer: NO — Leave as-is.

### Why

PlaygroundGame solves "how do we embed a game in a UI component" (weapon wiki, visual styles preview). Multiplayer solves "how do we render 4 players on one surface" or "how do we sync state across a network." These are fundamentally different problems.

**PlaygroundGame provides:** Single player + single camera + single input + simple game loop

**Multiplayer needs but PlaygroundGame doesn't have:**
- Multiple Player instances with per-player cameras
- SplitScreenRenderer (4-viewport layout)
- ConfigurableInput (per-player key bindings)
- Per-player weapon managers, super states, collision
- DDA system with per-player + zone-based tracking
- Per-viewport HUD (kill counts, weapons, stats)

**Network multiplayer also needs:**
- Server-authoritative state sync (Colyseus)
- Client-side input prediction
- Network entity creation/destruction
- Host detection and control

### Risk/Benefit

A rewrite would:
- Risk: ~3-5 hours refactoring + regression testing for marginal benefit
- Benefit: ~100 lines of shared boilerplate reduction
- Downside: Makes PlaygroundGame more complex (defeats its "simple embed" purpose)

### Optional Future: GameSetup Utilities

If the shared boilerplate becomes annoying, extract helpers:
- `createSurfaceWithMeshWalker(type, scale)` — used by all 3 entry points
- `createPlayerAtSpawn(bulletPool, color)` — common player setup
- `createWeaponManager(meshSurface)` — common weapon wiring

This is a LOW-risk utility extraction, not a rewrite. Do it only if maintenance burden justifies it.

### Reversibility: Easy — this is a "don't change" decision.

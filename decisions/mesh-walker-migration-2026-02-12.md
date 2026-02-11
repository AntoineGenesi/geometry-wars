## 2026-02-12 — Full Mesh Walker Migration Strategy

**Context:** User wants complete migration from UV-based surface walking to geodesic mesh walking for ALL entities (player + 30 enemy types). Current system has persistent issues with poles, seams, speed normalization. MeshWalker is already fully built and tested (bullets use it). User going to sleep, wants autonomous execution.

**Options Considered:**
1. **Big Bang** — Rip out UV, replace with mesh everywhere at once
   - Pros: Clean, no dual-code
   - Cons: Everything breaks at once, untestable intermediate states
2. **Selective (research recommendation)** — Player only, keep enemies on UV
   - Pros: Minimal risk
   - Cons: User explicitly rejected this ("surface architecture is bullshit")
3. **Dual-mode incremental** — Add MeshWalker to BaseEnemy alongside UV, migrate enemy types one by one
   - Pros: Tests stay green, can verify each type individually, rollback-friendly
   - Cons: Temporary dual code, slightly more complex BaseEnemy

**Decision:** Option 3 — Dual-mode incremental migration

**Implementation:**
1. BaseEnemy gets `walker: MeshWalker | null` property
2. New abstract method: `computeMovementDirection(dt, playerPos): Vector3`
3. Base `update()` checks if walker exists → uses mesh walking; otherwise UV fallback
4. Each enemy type implements `computeMovementDirection()` using world-space logic
5. Old `updateBehavior()` kept as fallback during migration
6. Once all types migrated, delete UV code paths

**Key Architectural Choices:**
- Enemies compute world-space DIRECTION (not UV deltas) — base class handles distance/speed
- Seeded RNG (xorshift128) for deterministic testing — all game randomness flows through it
- PlaygroundTestHarness enhanced with deterministic mode + entity tracking
- Visual regression: Puppeteer screenshots of known seeded scenarios

**Reversibility:** Easy — git revert to checkpoint commit `bbc103d`

**Phases:**
- Phase 0: SeededRandom + test framework enhancements
- Phase 1: Player mesh walker integration
- Phase 2: BaseEnemy dual-mode refactor
- Phase 3: Enemy type migrations (4 parallel batches)
- Phase 4: Game integration + collision migration
- Phase 5: Visual tests + skill updates

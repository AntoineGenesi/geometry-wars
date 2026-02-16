# GameInstance Refactor — Design Decision

**Date:** 2026-02-17
**Context:** Session 20 — Fix "invisible fixes" problem where changes to PlaygroundGame don't apply to main game
**Related Task:** tasks/s20-playground-refactor-game-instance.md

## Problem Statement

Session 19 spent an entire day fixing PlaygroundGame.ts (player movement, camera, gun direction) but the user plays via main.ts, so all fixes were invisible. The two code paths have duplicated game logic.

**Current Architecture:**
```
main.ts (1608 lines)
  ├─ new Game() — Three.js engine
  ├─ Manual setup of player, enemies, bullets, weapons (500+ lines)
  ├─ UI systems (menus, HUD, etc.) (500+ lines)
  ├─ GameLoop for fixed update
  └─ CameraController for camera

PlaygroundGame.ts (811 lines)
  ├─ new Game() — Three.js engine
  ├─ Built-in setup of player, enemies, bullets, weapons
  ├─ Built-in update loop
  └─ Built-in camera logic

Problem: Player movement/orientation logic is DUPLICATED
- GameLoop.ts lines 174-187: main game player orientation
- PlaygroundGame.orientPlayer(): demo player orientation
```

## Options Considered

### Option A: Extract Shared Modules Only
Create PlayerMovementController + CameraFollowController, both main.ts and PlaygroundGame use them.

**Pros:**
- Surgical fix, minimal disruption
- Shared movement logic in ONE place

**Cons:**
- Doesn't solve the broader duplication problem
- Still two separate game loops
- Future features need manual sync

**Decision:** REJECTED — Doesn't meet task requirements ("single GameInstance class")

### Option B: Consolidate Everything Into GameInstance
Create a single 2000-line GameInstance class that handles EVERYTHING.

**Pros:**
- True single source of truth
- Impossible to have divergent implementations

**Cons:**
- Massive class violates single responsibility
- Hard to test
- Hard to maintain
- Overkill for simple demos

**Decision:** REJECTED — Violates simplicity principle

### Option C: GameInstance as Coordinator (SELECTED)
Create GameInstance that owns core game systems (player, enemies, bullets, weapons, movement, camera).
UI systems (menus, HUD, etc.) stay in main.ts and wire to GameInstance.

**Structure:**
```typescript
class GameInstance {
  // Core engine
  readonly game: Game // Three.js scene/camera/renderer

  // Core game systems (always present)
  readonly player: Player
  readonly enemies: EnemySpawner
  readonly bullets: BulletPool
  readonly geoms: GeomPool
  readonly weapons: WeaponManager
  readonly particles: ParticleSystem
  readonly movement: PlayerMovementController // NEW: shared logic
  readonly camera: CameraController
  readonly input: InputManager
  readonly surface: Surface
  readonly meshSurface: MeshSurface

  // Optional systems (config-driven)
  readonly dda?: DDASystem
  readonly buffs?: BuffManager
  readonly companions?: CompanionManager
  readonly lod?: LODManager
  readonly adaptiveQuality?: AdaptiveQuality

  update(dt: number): void // Core update loop
  render(alpha: number): void // Render interpolation
}
```

**Usage:**
```typescript
// main.ts (simplified)
const gameInstance = new GameInstance({
  container: document.body,
  surface: 'pill',
  mode: 'adventure',
  features: { dda: true, buffs: true, companions: true }
})

// Add UI systems
const startMenu = new StartMenu()
const pauseMenu = new PauseMenu()
const weaponHUD = new WeaponHUD()
// ... etc

// Wire UI to game instance
weaponHUD.setWeaponManager(gameInstance.weapons)
pauseMenu.onResume(() => gameInstance.resume())

// Start
gameInstance.start()

// PlaygroundGame (deprecated or becomes thin wrapper)
const pg = new GameInstance({
  container: demoDiv,
  surface: 'sphere',
  mode: 'demo',
  features: {} // no DDA, no buffs, etc.
})
pg.start()
```

**Pros:**
- Core game logic in ONE place (movement, shooting, collision)
- UI stays separate (correct separation of concerns)
- Demos can use simple config (no DDA, no UI)
- Main game can use full config (DDA, buffs, UI)
- Fixes to GameInstance apply everywhere

**Cons:**
- Large refactor (~500 lines to move from main.ts to GameInstance)
- Need to carefully preserve all regression guards
- Need to test thoroughly after refactor

**Decision:** SELECTED

## Implementation Plan

### Phase 1: Create GameInstance Class
1. Create `src/core/GameInstance.ts`
2. Move core systems from PlaygroundGame into GameInstance
3. GameInstance constructor takes config object
4. GameInstance.update() consolidates GameLoop logic + PlaygroundGame logic
5. Extract PlayerMovementController (shared movement/orientation logic)

### Phase 2: Refactor PlaygroundGame
1. PlaygroundGame becomes thin wrapper around GameInstance
2. Or deprecate PlaygroundGame entirely (breaking change for demos)
3. Update tests to use GameInstance

### Phase 3: Refactor main.ts
1. Replace manual game setup with `new GameInstance()`
2. Keep UI systems in main.ts
3. Wire UI to gameInstance subsystems
4. Remove GameLoop (logic moves into GameInstance.update)
5. Verify all regression guards are preserved

### Phase 4: Verification
1. Run full test suite (1270+ tests)
2. TypeScript compile check
3. Visual test on pill map (movement oscillation)
4. Test embedded demos (VisualPlaygroundDemo, etc.)
5. Update HUMAN_TEST.md with manual test plan

## Risks & Mitigations

### Risk: Breaking existing tests
**Mitigation:** Keep PlaygroundGame as wrapper initially, update tests incrementally

### Risk: Losing regression guards
**Mitigation:** Grep for `// REGRESSION GUARD:` before moving code, verify each one

### Risk: Performance regression
**Mitigation:** Profile before/after, ensure zero-allocation pattern preserved

### Risk: Breaking embedded demos
**Mitigation:** Test VisualPlaygroundDemo, WeaponPlayground, etc. after refactor

## Success Criteria

- [ ] Single GameInstance class exists
- [ ] main.ts uses GameInstance
- [ ] PlaygroundGame uses GameInstance (or deprecated with migration guide)
- [ ] All 1270+ tests pass
- [ ] TypeScript compiles clean
- [ ] Player movement/orientation code in ONE place (GameInstance or shared module)
- [ ] All regression guards preserved
- [ ] No performance regression
- [ ] Embedded demos still work

## Reversibility

**Medium** — If this breaks things:
1. Revert commits
2. Keep GameInstance as experimental alternate entry point
3. Main game stays on manual setup until GameInstance is proven stable

## References

- Task: tasks/s20-playground-refactor-game-instance.md
- Session 19 failure: tasks/s19-*.md (movement fixes applied to wrong code)
- Regression guards: src/core/PlaygroundGame.ts (6 guards)
- verify-code-is-called.md: Documents the two code paths

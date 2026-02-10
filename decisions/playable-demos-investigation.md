## 2026-02-11 — Why Playable Demos Were Always Broken

### The User's Frustration (Repeated Across Multiple Sessions)

"Why the hell is it so impossible to create these new little maps? We should just spawn a sphere, have entities spawn, and the player is there. We already have the code that works for single player. Can't you copy-paste that code?"

"We should look at how it should be done. It should be plug-and-play. You take the entire thing that works, run it there, then just subtract."

### Root Cause: Missing Reusable Layer

The codebase had a structural gap:

```
Game.ts (527 lines)          →  Graphics-only shell
  - Scene, Camera, Renderer
  - Bloom, Composer
  - Game loop (start/stop/dispose)
  - NO Player, NO Enemies, NO Weapons, NO Input

main.ts (~2000 lines)        →  ALL gameplay wired inline
  - Player creation + MeshWalker
  - EnemySpawner + 30 enemy types
  - WeaponManager + 10 weapons
  - BulletPool + collision
  - Input handling
  - Camera follow logic
  - ALL of this inline, not in a reusable class
```

There was **no way to say** `new Game({surface: 'sphere', weapon: 'spreadshot'})` and get a playable game. You had to either:
- Use `Game.ts` and rebuild all gameplay from scratch (what agents kept doing)
- Copy large chunks of `main.ts` and try to adapt them (fragile, diverges)

### Why Agents Rebuilt From Scratch Every Time

When tasked with "make a playable demo," agents would:
1. Look at `Game.ts` — it only handles rendering, not gameplay
2. Look at `main.ts` — it's 2000 lines of inline code, not importable
3. Conclude "there's no reusable game class" and rebuild from scratch
4. Create 1,000-1,800 line files with custom rendering, custom collision, custom enemy AI, custom movement
5. These custom implementations diverged from the real game, causing bugs

This happened at least 3 times:
- **WeaponPlayground.ts** grew to 1,877 lines (10 custom weapon firing methods, custom scene setup, custom collision)
- **VisualPlaygroundDemo.ts** grew to 1,181 lines (custom enemy classes, custom projectiles, custom player movement)
- Both had inverted controls, wrong fire rates, broken collision compared to the real game

### The Fix: PlaygroundGame.ts (480 lines)

Created `src/core/PlaygroundGame.ts` — the missing reusable layer.

**What it does:**
- Composes REAL classes: Game, Player, BulletPool, GeomPool, EnemySpawner, MeshWalker, WeaponManager, ParticleSystem, InputManager
- Provides a clean config interface: `{ container, surface, weapon, enemyCount, lives, bloom, ... }`
- Game loop mirrors main.ts: MeshWalker geodesic movement, real weapon fire rates, real enemy AI, real collision
- Public API: `start()`, `stop()`, `dispose()`, `setWeapon()`, `setSurface()`, `resize()`, `getStats()`

**The "subtractive" approach the user wanted:**
- Take the full working game
- Apply constraints (lock weapon, specific surface, enemy count)
- Done. Behavior matches real game exactly.

### Refactoring Results

| File | Before | After | Reduction |
|------|--------|-------|-----------|
| WeaponPlayground.ts | 1,877 lines | 435 lines | 77% |
| VisualPlaygroundDemo.ts | 1,181 lines | 509 lines | 57% |

What each file keeps:
- **WeaponPlayground**: Focus/pause management, stats overlay, damage popups, hint overlay
- **VisualPlaygroundDemo**: Full-screen overlay, visual preset application (Sektori shader, bloom, materials), stats, close button

All gameplay code is delegated to PlaygroundGame.

### How To Add Future Playgrounds

```typescript
import { PlaygroundGame } from '../core/PlaygroundGame';

const pg = new PlaygroundGame({
  container: myDiv,
  width: 800,
  height: 600,
  surface: 'torus',
  weapon: 'spreadshot',    // or null for free weapon swaps
  enemyCount: 12,
  lives: 3,
  onGameOver: () => showGameOver(),
  onEnemyKill: (type) => updateKillCount(),
});

pg.start();
// ... later
pg.dispose();
```

It's truly plug-and-play now.

### Reversibility

**Easy** — PlaygroundGame is additive (new file). The old code was already replaced before this investigation documented the process. If needed, git history has the old implementations.

### Lessons Learned

1. When `main.ts` is a monolith, agents will reinvent it rather than reuse it. The fix is extracting a composable layer.
2. The "subtractive" approach (full game minus constraints) is always better than the "additive" approach (build up from scratch).
3. This pattern should be applied to any future mini-game, tutorial, or demo: always start from PlaygroundGame, never from Game alone.

# GameInstance.ts Evaluation — Keep, Kill, or Refactor

**Date:** 2026-03-11
**Task:** s44r7-09-surface-verification-real-game-instances
**Decision:** KEEP — GameInstance is NOT a "s___ simulation"

## Context

User suspected GameInstance might be a simulation that skips real game code. This evaluation traces what GameInstance actually does vs GameLoop.ts.

## Analysis

### What GameInstance uses (ALL real classes):
- `Game` — same Three.js scene/camera/renderer
- `Player` — same player entity
- `BulletPool` — same bullet physics
- `EnemySpawner` — same enemy spawning/movement
- `MeshWalker` — same geodesic face walking
- `CameraController` — same camera orbit/positioning
- `WeaponManager` — same weapon system
- `Surface` + `MeshSurface` — same surface math
- `DepthOcclusionSystem` — same visibility system
- `ParticleSystem` — same effects

### What's DIFFERENT from GameLoop.ts:
1. **Collision detection is inline and simpler:**
   - GameInstance `_checkBulletEnemyCollisions`: basic `distSq < 2 * radius²`
   - CollisionSystem (used by GameLoop): spatial hash + visual pos + on-surface fallback + cube-specific overlap tuning
   - GameInstance `_checkEnemyPlayerCollisions`: basic `distSq < hitRadiusSq` (no surface-specific tuning)
   - CollisionSystem: cube overlap margin (-0.1), Mobius on-surface fallback, shield handling
2. **No DDA system** (difficulty adjustment)
3. **No BuffManager/CompanionManager** integration
4. **No PickupSpawner** (geom/weapon/buff pickups)
5. **No game modes** (survival only, no KOTH/Rainbow/Sniper)
6. **Simpler death/respawn** (no death cam, no score persistence)

### Key Insight:
GameInstance uses the same PHYSICS (movement, bullets, surfaces) but has SIMPLER collision detection. This means:
- Tests passing on GameInstance prove surface math/movement work
- Tests passing on GameInstance do NOT prove hit detection thresholds are correct
- For collision verification, we MUST use RealGameTestHarness (which uses GameLoop + CollisionSystem)

## Decision

**KEEP GameInstance.** It serves a valid purpose:
1. Lightweight game runner for demos/playgrounds
2. Uses real classes — not reimplemented math
3. Programmable (tick-by-tick, embedded in DOM elements)

**For the verification framework, use RealGameTestHarness** which goes through GameLoop.ts + CollisionSystem — the actual code path users play through.

## Reversibility
Easy — this is a "keep existing code" decision. No changes needed.

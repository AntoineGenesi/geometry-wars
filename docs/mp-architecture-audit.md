# MP Architecture Deep Audit — S43

> **Purpose:** Comprehensive reference for AI workers. Read this BEFORE working on ANY multiplayer task.
> **Companion:** `docs/MP-ARCHITECTURE.md` (operational reference), `reports/mp-audit-s43.html` (visual report)
> **Updated:** 2026-03-01 (Session 43)

## TL;DR: Why MP Keeps Breaking

1. **Two separate implementations** — SP uses GameLoop.ts (879 lines). MP uses network-main.ts (4,656 lines) + GameRoom.ts (3,342 lines). No shared code.
2. **Different coordinate systems** — SP is 3D world-space (mesh triangles). MP is 2D UV-space (analytical equations). Same logic, completely different math.
3. **Fix interactions** — MP fixes affect each other. S42's pole-crossing fix broke controls on spawn. S42's damage rebuild didn't apply mastery multipliers.
4. **No MP integration tests** — All MP fixes are Level 2 (compiles + tests pass). No automated multiplayer gameplay testing exists.
5. **Incremental porting** — SP has 30 enemies, 10 weapons, 9 buffs, mastery, DDA, super pickups. MP gets them incrementally, always behind.

## Key Files (Exact Line References)

| File | Lines | Role | Key Sections |
|------|-------|------|-------------|
| `src/core/GameLoop.ts` | 879 | SP game loop | :202 player update, :460 pickups, :615 damage formula |
| `src/network-main.ts` | 4,656 | MP client | :3517 client prediction, :4065 remote interpolation, :4096 bullet FaceWalker |
| `server/rooms/GameRoom.ts` | 3,342 | MP server | :917 movement, :1210 bullets, :1342 enemy AI, :2312 hit detection, :2344 damage |
| `server/shared/GameConstants.ts` | ~80 | Shared constants | Weapon configs, speed, radius, drop rates |
| `server/schema/GameState.ts` | 359 | Colyseus schema | State sync types |
| `src/entities/Bullet.ts` | ~400 | SP bullets | :70 BulletPool, :224 geodesic movement |
| `src/entities/enemies/` | 30 files | SP enemies | Each enemy type is a separate class |

## System-by-System Parity Status

### 1. Bullets — PARTIALLY WORKING
| Aspect | SP | MP | Gap |
|--------|----|----|-----|
| Movement | 3D geodesic face-walking (MeshSurface) | UV Christoffel symbols (per-surface) | Different math; can diverge ~18° |
| Hit detection | World-space distance² | UV distance + great-circle (sphere) | Different distance metrics |
| Speed | 4.0 × levelMult × mapSizeMult | 0.13 UV/sec (fixed) | No level scaling, no map size |
| Lifetime | 6s × mapSizeScale | 3.0s fixed | Half the SP value |
| Visual | Same as physics | FaceWalker (visual only), server resyncs | Two separate systems |

### 2. Damage — INCOMPLETE
| Multiplier | SP (GameLoop.ts:615) | MP (GameRoom.ts:2344) | Status |
|------------|-----|----|----|
| Base weapon damage | WEAPON_CONFIGS | WEAPON_CONFIGS | Matched |
| Score power mult | scorePowerMultiplier | Excluded (score only) | By design |
| Level damage mult | playerLevel.damageMult | LEVEL_DAMAGE_MULTIPLIERS | S42-04c |
| Buff damage mult | buffManager (all 9) | calculateBuffDamageMult (4 of 9) | 5 buffs missing |
| Mastery mult | masteryMultiplier | `1.0 // TODO` | NOT IMPLEMENTED |
| Upgrade tree mult | upgradeTreeMult | Missing entirely | NOT IMPLEMENTED |

**Impact:** Without mastery and upgrade multipliers, late-game MP damage is ~40-60% of SP damage. This is likely why the user perceives "damage is still 0.1."

### 3. Enemy AI — 21 of 30+ PORTED
**Fully ported:** grunt, wanderer, neutron, rocket, mayfly, weaver, duck, spinner, swarm, approach_glow, orbiter, helix, lurker, repulsor, spawner, painter, giant_wanderer, giant_rocket, giant_neutron, titan_grunt, titan_spinner, titan_weaver

**Missing entirely:** FractalSnake (follower chain), GravityWell (physics pull), Phaser (invisibility), StealthStalker (stealth), Boss (boss tier), Gate (pass-through mechanic), Virus (viral spread)

**Remapped to approximations:** 12 types use WAVE_TYPE_REMAP (GameRoom.ts:307-325). These enemies appear but have wrong behavior (e.g., Cluster → Spawner, Phaser → Mayfly).

### 4. Controls/Movement — WORKING (after S43 fixes)
- SP: MeshWalker (3D geodesic) + camera-aligned input
- MP server: UV arithmetic + per-surface metric corrections (GameRoom.ts:917)
- MP client: Mirrors server UV math for prediction (network-main.ts:3517)
- **Gotcha:** CameraController sign-flip on first frame. S43-01 fixed this by skipping sign-flip protection on initial camera state.

### 5. Pickups — MIXED AUTHORITY
| Type | SP | MP | Authority |
|------|----|----|----------|
| Weapon | Client (PickupSpawner) | Server (GameRoom:3115) | Server-auth |
| Buff (new) | Client | Server (GameRoom:3143, S42-04d) | Server-auth |
| Super | Client (7 types) | Server (2 types: bomb, multiplier) | 5 types missing |
| Companion | Client | Client-only | Not synchronized |
| Score geom | Client | Removed (S27g) | N/A |

## The Fix History: What Was Tried, What Failed

### Hit Detection (7 attempts, S28-S43)
1. **S28a** — Reduce hit radius 0.05→0.012 UV. Helped but didn't fix sphere poles.
2. **S38b** — Great-circle distance for spheres. Fixed sphere, broke torus.
3. **S38b** — Wrap-aware UV lerp. Fixed wrapping artifacts.
4. **S40** — Replace FaceWalker with Christoffel. Fixed physics but broke visuals.
5. **S41** — Restore FaceWalker visual + keep Christoffel physics. Current architecture.
6. **S41** — Adjust collision radius to 0.04 for non-sphere. Fine-tuning.
7. **S43** — Duplicate bullet removal + damage parity. The "pass through" was actually low damage requiring 15+ hits.

**Lesson:** Hit detection has 3 interacting dimensions (distance metric, radius constant, damage amount). Each fix addressed one dimension and ignored the others.

### Aim/Controls (6 attempts, 1 revert, S35-S43)
1. **S35** — Torus right-hand tangent frame. Correct but surface-specific.
2. **S36** — Same fix re-reported. Was it merged? Unclear.
3. **S38d** — Remove mouseY negation. WRONG — inverted for most cases.
4. **S39** — Reverted S38d. Original formula was correct.
5. **S40** — Camera-frame projection using matrixWorld. CORRECT general solution.
6. **S43** — Skip sign-flip on first camera frame. Fixed S42 pole-crossing regression.

**Lesson:** Aim requires projecting 2D mouse coordinates through the camera's 3D orientation onto the surface tangent plane. Simple atan2 formulas don't account for camera rotation. The S40 fix (camera-frame projection) is the architecturally correct solution.

### Damage (8 attempts, S36-S43)
1. **S36** — Enable damage number display. Visual only.
2. **S38b** — Show weapon damage instead of -1. Fixed display.
3. **S38c** — ShockAura + killing-blow + calibrate 0.25 vs 1.0. Three separate fixes.
4. **S40** — Damage scaling parity. Applied level scaling.
5. **S42** — EPIC rebuild: full damage formula. Added level/buff multipliers.
6. **S43** — User says damage is STILL low. Mastery = 1.0, upgrade = missing.

**Lesson:** "Damage" has two aspects: display (the floating number) and calculation (the actual value). Display was fixed in S36-S38c. Calculation was incrementally improved but never reached full SP parity because mastery and upgrade multipliers are unimplemented.

## Common Failure Modes (For Future Workers)

### 1. "Fixed in SP, forgot MP"
Every gameplay change to GameLoop.ts needs a corresponding change in GameRoom.ts AND network-main.ts. There is no automatic propagation.
**Check:** Does your change touch GameLoop.ts? → Also check GameRoom.ts and network-main.ts.

### 2. "Fixed on sphere, broke on torus"
UV-space math is surface-dependent. Sphere has pole singularities. Torus wraps differently. Peanut has a waist pinch. Cube has face transitions.
**Check:** Does your MP fix use UV coordinates? → Test on at least sphere AND one non-sphere surface.

### 3. "Fix interacts with pole-crossing"
Poles (V=0 or V=1 on sphere-like surfaces) cause: UV singularities, camera sign flips, bullet direction reversals, enemy clustering.
**Check:** Does your fix touch movement, camera, or bullets? → Test at poles.

### 4. "Compiles but not wired in"
A module can be imported, instantiated, and still never called in the game loop. network-main.ts has 4,656 lines — new code can easily be "dead."
**Check:** Trace from `onFixedUpdate()`/`onRender()` to your code. Is there an unbroken call chain?

### 5. "Tests pass but gameplay broken"
Unit tests test isolated functions. MP bugs are usually integration issues (system A sends wrong value to system B).
**Check:** Spawn a visual test or Puppeteer verification after any MP change.

## Architecture Decision: Why Not a Shared Game Loop?

S42 planner explicitly rejected "GameLoopShared.ts" because:
1. **GameLoop.ts is tightly coupled to Three.js** — uses mesh.position, camera.quaternion, material references
2. **Server can't use Three.js** — no WebGL on Node.js, no mesh geometry
3. **UV vs world-space** — fundamental coordinate system difference makes shared math modules impractical
4. **Client prediction mirrors server** — network-main.ts must implement the same UV math as GameRoom.ts for responsiveness

**Decision:** Keep separate implementations, share CONSTANTS (via GameConstants.ts), test with parity regression tests.

## Constant Parity (GameConstants.ts vs Hardcoded)

S42-04a created `server/shared/GameConstants.ts` but it only covers ~20 constants. Many values are still hardcoded in both GameLoop.ts and GameRoom.ts independently. Known duplicates:
- Player speed: SP `PLAYER_MOVE_SPEED=3.0` vs MP `PLAYER_SPEED=0.095`
- Bullet speed: SP `BULLET_SPEED=4.0` vs MP `BULLET_SPEED=0.13`
- Bullet lifetime: SP `BULLET_LIFETIME=6` vs MP `BULLET_LIFETIME=3.0`
- Enemy collision radius: varies per surface (GameRoom has per-surface logic, SP uses world-space)

## Statistics

| Metric | Value |
|--------|-------|
| Total MP-related commits | 209 |
| Fix commits (41% of total) | 111 |
| Feature commits | 68 |
| Sessions with MP work | 11+ (S28-S43) |
| network-main.ts commits | 209 |
| GameRoom.ts commits | 95 |
| GameLoop.ts commits (SP comparison) | 53 |
| Reverted commits | 1 (S39-02 aim formula) |
| Re-reported bugs | 15+ (torus controls, damage numbers, hit detection...) |

## File Map for Common MP Tasks

| Task | Files to Edit |
|------|-------------|
| Fix MP movement | `GameRoom.ts:917` (server), `network-main.ts:3517` (client prediction) |
| Fix MP bullets | `GameRoom.ts:1210` (physics/hit), `network-main.ts:4096` (visual) |
| Fix MP damage | `GameRoom.ts:2344` (formula), `GameConstants.ts` (base values) |
| Fix MP hit detection | `GameRoom.ts:2312` (collision check) |
| Add MP enemy AI | `GameRoom.ts:1342` (switch/case), add to `ServerEnemyAI` interface |
| Fix MP controls | `network-main.ts:3517` (client), `GameRoom.ts:917` (server), `CameraController.ts` |
| Add MP pickup | `GameRoom.ts:3115` (server spawn), `network-main.ts` (client render) |
| Fix MP camera | `CameraController.ts` (shared), but test in MP context |

## Cross-References

- **Operational reference:** `docs/MP-ARCHITECTURE.md`
- **Visual report:** `reports/mp-audit-s43.html`
- **S42 EPIC plan:** `tasks/s42-04-mp-shared-game-loop-rebuild-epic.md`
- **S41 audit:** `tasks/s41-13-mp-architecture-deep-dive-audit.md`
- **Debug logs:** `decisions/debug-*.md`
- **Merge protocol:** `.claude/rules/merge-protocol.md`

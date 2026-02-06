# Gameplay Balance Decisions

## 2026-02-05 - Enemy Spawn and Speed Rebalance

**Context:** User reported enemies spawning directly on player (instant death), enemies too fast, player respawning at death location, enemies overlapping.

**Changes Made:**

### 1. Spawn Distance Protection
- Added `MIN_SPAWN_DISTANCE = 0.25` (UV space) from player
- Enemies now find valid positions away from player before spawning
- Fallback: spawn at opposite edge if no valid position found

### 2. Enemy Separation
- Added `MIN_ENEMY_SEPARATION = 0.05` between enemies at spawn
- Added `applySeparation()` force during update loop
- Enemies gently push apart if overlapping

### 3. Speed Reductions
| Enemy | Old Speed | New Speed | Notes |
|-------|-----------|-----------|-------|
| Grunt | 0.05 → 0.15 | 0.02 → 0.06 | Player is 0.08, so max < player |
| Mayfly | 0.05 | 0.03 | Swarm behavior, slower individual speed |

### 4. Safe Respawn
- Player now respawns at `(u+0.5, v+0.5)` - opposite side of surface
- Gives player time to orient before enemies arrive

**Reasoning:**
- Player speed is 0.08, so chasing enemies must be slower to allow escape
- Spawn distance prevents unfair instant deaths
- Separation prevents enemy "stacking" into death blobs

**Reversibility:** Easy - Constants at top of EnemySpawner.ts and individual enemy files

---

## 2026-02-05 - Cyan Blob Visual Artifact

**Context:** Cyan blob appears during movement, especially at pole camera angles.

**Decision:** Deferred as cosmetic issue.

**Reasoning:**
- Appears to be SwiftShader rendering artifact OR surface mesh transparency at certain angles
- Does not appear consistently in all cameras
- Gameplay is not blocked
- Would require deeper camera/surface investigation

**Next Steps (if prioritized):**
1. Reduce surface mesh opacity
2. Adjust camera handling near poles
3. Or accept as minor visual quirk

---

## 2026-02-05 - Player Spinning Fix and Visual Polish

**Context:** Player spun crazily when pressing A/D (sideways movement). Also: surface too transparent, bullets too small, UI hearts overflowing.

**Changes Made:**

### 1. Player Rotation Smoothing
- Added `ROTATION_SMOOTHING = 0.15` constant
- Added `smoothedQuaternion` field to Player class
- Changed `applySurfaceTransform()` to slerp toward target rotation
- Result: Smooth, stable rotation during sideways movement

### 2. Further Enemy Speed Reductions
| Enemy | Old Speed | New Speed |
|-------|-----------|-----------|
| Neutron | 0.1 | 0.04 |
| Weaver | 0.075 | 0.04 |
| Spinner | 0.0875 | 0.05 |
| Wanderer | 0.075 | 0.04 |
| Rocket | 0.125 | 0.05 |
| Repulsor | 0.75 | 0.06 |

### 3. Visual Improvements
- Surface opacity: 0.12 → 0.35 (more visible)
- Grid opacity: 0.4 → 0.5
- Bullet length: 0.12 → 0.25 (more visible)
- Bullet color: 0xcccc66 → 0xffff44 (brighter)

### 4. UI Fix
- Hearts now cap at 5, then show "♥ x99" format
- Same for bombs: cap at 5, then show "● x99"

**Deferred:**
- Enemy 3D depth (making enemies less flat) - visual polish, not blocking

**Reversibility:** Easy - Constants in respective files

---

## 2026-02-05 - Bullet Great Circle Fix

**Context:** Bullets were traveling in curved paths ending at sphere poles instead of straight lines on the sphere surface.

**Root Cause:**
- Old system moved bullets using UV coordinates + angle: `b.surfaceU += Math.sin(b.angle) * speed * dt`
- UV-based movement causes curved paths because UV coordinates are not linear on a sphere
- Bullets would curve toward poles (singularities in UV mapping)

**Solution:**
Changed bullet movement to use world-space great circles:

1. Move bullet in world space: `position += direction * speed * dt`
2. Project back onto sphere: `position.normalize().multiplyScalar(SPHERE_RADIUS)`
3. Update direction to remain tangent: subtract component pointing toward sphere center

**Code Changes in Bullet.ts:**
- Added `SPHERE_RADIUS = 8` constant (matches SphereSurface)
- Rewrote `update()` method:
  - Move in world space along cached direction vector
  - Normalize position to sphere radius after each step
  - Subtract normal component from direction to keep it tangent
- Made `applySurfaceProjection()` a no-op (projection now handled in update)

**Result:**
- Bullets now travel in straight lines (geodesics) on the sphere
- No more weird curved paths toward poles
- Bullets visually go where player aims

**Reversibility:** Moderate - would need to restore old UV-based movement code

---

## 2026-02-05 - Player-Centric Rotation Movement System

**Context:** User reported fundamental issues with UV-based movement:
- Player could go "behind" the sphere (hidden from camera)
- Movement got stuck at poles/equator due to UV coordinate singularities
- Controls felt disconnected from visual movement
- System was sphere-specific, not generalizable to other shapes

**Solution: "Hamster Ball" Rotation System**

Instead of moving the player on the surface, rotate the SURFACE under the player:
- Player stays at FIXED world position (always visible, always centered)
- Movement input rotates the sphere in the opposite direction
- Enemies/bullets are positioned on the rotated sphere (they move with rotation)
- No more "behind the sphere" issues - player is always at the front

**Implementation (GENERIC - works for ANY 3D shape):**

1. **Base `Surface` class** now has:
   - `worldRotation: THREE.Quaternion` - tracks total rotation
   - `rotateByInput(dx, dy, speed)` - applies trackball-style rotation
   - `getPlayerWorldPosition()` - returns fixed player position
   - `getPlayerVirtualUV()` - converts rotation to UV for compatibility
   - `applyWorldRotation(point)` - transforms local coords to world

2. **SphereSurface** simplified:
   - Uses base class rotation system
   - Just defines shape-specific `getPointLocal()` method

3. **main.ts** changes:
   - Player mesh position is FIXED: `(0, radius, 0)` - top of sphere
   - Movement calls `surface.rotateByInput()` instead of UV movement
   - Enemies track player via `surface.getPlayerVirtualUV()`

**Why This Is Shape-Agnostic:**
- Rotation works the same for ANY mesh (sphere, cube, torus, dodecahedron, custom mesh)
- Each shape just needs to define:
  - `createMesh()` - the visual mesh
  - `getPointLocal(u, v)` - how to position entities
- The rotation system handles the rest

**Other Fixes in This Commit:**
- Lives bug fixed: Changed `level.lives > 0 ? level.lives : 99` to default to 3 lives
- Bullet great circle paths: Bullets now move in world space and project to sphere

**Reversibility:** Would require significant refactor to go back to UV-based movement

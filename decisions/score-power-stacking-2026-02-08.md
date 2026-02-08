## 2026-02-08 - Score-Based Power & Weapon Stacking

**Context:** Two gameplay features requested: score increases bullet power, stacking same weapon pickup makes it stronger.

### Score Power (Task #18)
Added `getScorePowerMultiplier()` to ScoreManager:
- 0-10K: 1.0x damage
- 10K-50K: 1.25x damage
- 50K-200K: 1.5x damage
- 200K-500K: 2.0x damage
- 500K+: 2.5x damage

Applied to:
- Standard bullet damage (checkBulletEnemyCollisions)
- Weapon manager projectile damage (onEnemyDamage callback)
- Both single-player and multiplayer

### Weapon Stacking (Task #19)
Added stack tracking to WeaponManager:
- Picking up the same weapon you already have adds +1 stack (capped at 5)
- Each stack adds +25% damage (stack 1 = 1.0x, stack 5 = 2.0x)
- Applied via `getStackDamageMultiplier()` to all weapon types:
  - createProjectile (spread, homing, mortar, gravity gun)
  - firePiercing (instant beam)
  - fireChainLightning (instant arc)
- Switching to a different weapon preserves stacks (can come back to stacked weapon)

**Decision:** Stack cap at 5 (2.0x max) prevents excessive power creep. Combined with score power (2.5x at 500K), max total multiplier is 5.0x which feels significant without being game-breaking.

**Reversibility:** Easy - remove `stacks` map from WeaponManager, remove `getScorePowerMultiplier()` calls

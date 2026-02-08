## 2026-02-08 - Weapon Balance Overhaul (Task #27)

### Context
Weapons felt underpowered - ran out too fast, didn't travel far enough. Need to make every weapon pickup feel impactful.

### Changes Made

**Ammo Counts (approximately doubled):**
- Spread: 50 -> 100
- Piercing: 25 -> 50
- ChainLightning: 25 -> 50
- Homing: 20 -> 40
- PlasmaMortar: 15 -> 30
- GravityGun: 10 -> 20
- LaserBeam: 100 -> 200
- BlackHole: 3 -> 6
- TeslaCoil: 150 -> 300

**Projectile Range/Duration:**
- Bullet lifetime: 4s -> 6s
- Spread maxAge: 2.0 -> 4.0
- Homing maxAge: 4.0 -> 6.0
- GravityGun maxAge: 3.0 -> 5.0
- Mortar range: 5 -> 8
- Piercing beam length: 15 -> 25 (36 segments)
- Laser beam length: 20 -> 30 (45 segments)
- BlackHole duration: 2.0 -> 3.0
- Tesla duration: 5.0 -> 8.0

**Buff Pickup System (NEW):**
- `BuffPickup.ts` - 3 buff types: ExtendedRange, RapidFire, DurationPlus
- ExtendedRange: 1.75x projectile range for 15s
- RapidFire: 2x fire rate for 10s
- DurationPlus: 2x ammo efficiency for 20s (probabilistic consumption)
- 5% drop rate from enemy deaths
- Diamond-shaped pickups (distinct from octahedron weapon pickups)
- Buffs stack with base stats, applied in WeaponManager

### Decision: Buff Application
- RapidFire modifies cooldown in `canFire()`
- DurationPlus uses probabilistic ammo consumption (50% chance to consume at 2x multiplier)
- ExtendedRange multiplies maxAge in `createProjectile()` and beam length in `firePiercing`/`fireLaser`

### Reversibility
Easy - revert file changes. All changes are stat tuning + new pickup class.

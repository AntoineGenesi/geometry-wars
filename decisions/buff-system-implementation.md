## 2026-02-09 - Buff System Phase 2: First 8 Buffs Implementation

**Context:** Implemented the core stackable buff system infrastructure and first 8 buffs as specified in buff-upgrade-system-design.md.

**Options Considered:**
1. Merge new buff system into existing WeaponManager buff handling
2. Create separate BuffManager alongside existing system

**Decision:** Option 2 - Separate BuffManager. The existing WeaponManager buff system (ExtendedRange, RapidFire, DurationPlus) handles weapon-specific timed buffs. The new BuffManager handles permanent stackable buffs (Risk-of-Rain-style). Both coexist: old buffs are temporary weapon modifiers, new buffs are permanent run-scaling power.

**Reasoning:**
- Old buff system is tightly coupled to WeaponManager (fire rate, ammo, range modifiers)
- New system is fundamentally different: permanent stacks, proc chains, DOTs, on-death effects
- Replacing old system would break existing weapon buff pickups
- Both systems multiply together (stacking multiplicatively as per design doc)

**Key Implementation Decisions:**

1. **Multiplier composition**: BuffManager multipliers compose multiplicatively with PlayerLevel multipliers. `finalDamage = base * playerLevel.damageMultiplier * buffManager.getDamageMultiplier()`. This creates the exponential scaling that makes high-stack runs feel amazing.

2. **Proc coefficient**: Player bullets use procCoefficient=1.0, weapon system damage uses 0.3. DOT and shock aura damage cannot trigger on-hit procs (coefficient=0). This prevents infinite proc chains.

3. **Stat refresh timing**: `applyStatMultipliers()` is called every frame during fixed update to immediately reflect buff changes. This is cheap (a few multiplications) and ensures no stale multipliers.

4. **New pickup entity**: BuffPickupNew (hexagonal prism) is separate from old BuffPickup (diamond cube). Both drop independently with their own chance rolls. Old system remains functional.

5. **Shock aura ticks**: Damage applied every 0.5s (not per-frame) to avoid excessive takeDamage calls. Visual arcs refresh each tick with random jitter for a lightning effect.

6. **Volatile chain reactions**: Volatile explosions can kill enemies, but killed enemies don't trigger volatile again (no infinite cascading). This is because onEnemyDeath is only called from the bullet collision handler and weapon damage handler, not from BuffManager's own damage.

**Reversibility:** Easy - remove 4 imports from main.ts, remove BuffManager/BuffHUD/ShockArcRenderer creation and all references. Old buff system is untouched.

## Files Created
- `src/buffs/BuffManager.ts` (382 lines) - Core manager with 8 buff definitions, stacking formulas, proc logic
- `src/buffs/BuffHUD.ts` (197 lines) - DOM-based icon bar with stack counts and glow animations
- `src/buffs/BuffPickupNew.ts` (217 lines) - Hexagonal pickup entity with rarity rings
- `src/buffs/ShockArcRenderer.ts` (102 lines) - Pre-allocated lightning arc renderer for Shock Aura

## Files Modified
- `src/main.ts` - Added imports, created instances, wired into all collision/damage/pickup/HUD systems

# Weapon Mastery Bonus Accuracy Audit (s44r18-10)

## Date: 2026-03-15

## Context

User asked to verify accuracy of the "Passive Bonus Earned!" notification shown after each SP game when a weapon mastery level is reached. E.g. "Plasma Mortar: +15% damage always".

## Findings

### Two separate mastery systems (important distinction)

1. **Cross-game persistent mastery** (`MasteryStore.ts`): XP-based, levels 0-5, persists in localStorage. This is what the notification covers.
2. **In-session buff stacks** (`BuffManager.getMasteryMultiplier`): Per-game pickup stacks, reset each game. Not shown in this notification.

### Levels 1-4 were already accurate

Both `getBonusDescription` and `computeBonus` use the identical formula:
`t = (level-1)/4; dmg = dmgL1 + t*(dmgL5-dmgL1)`. The displayed "+X% damage" matched the actual multiplier applied in gameplay via `weaponManager.setMasteryMultiplierFn()`. No fix needed for levels 1-4.

### Level 5 "special" descriptions were inaccurate

Only 4 weapons have `isMasteryMaxLevel()` Final Form code in `WeaponManager.ts`:
- **Standard** ("Twin Stream"): fires 2 additional bullets at ±15°
- **Spread** ("Mega Fan"): 9 pellets at 45° instead of 5 at 30°
- **Homing** ("Seeking Swarm"): fires 3 missiles simultaneously in V-formation
- **BlackHole** ("Event Horizon"): +50% duration, stronger pull, AoE explosion on expiry

The remaining 6 weapons (Piercing, ChainLightning, PlasmaMortar, GravityGun, LaserBeam, TeslaCoil) had `special` strings in `BONUS_TABLE` that described **unimplemented features** ("+50% AoE radius", "+2 chain targets", etc.). Players were being told they unlocked features that don't exist.

Additionally, the old `getBonusDescription` at level 5 showed ONLY the special string, hiding the actual damage % bonus that was still applied.

### MP mastery gap (out of scope)

`GameRoom.ts` line 4486: `const masteryDamageMult = 1.0; // TODO: weapon mastery damage multiplier` — mastery not applied server-side. The notification only shows after SP games, so this doesn't affect the notification's accuracy. Tracked separately.

## Decision

**Fix the `special` strings to match actual implemented behavior, and remove specials for unimplemented features.**

Options considered:
1. **Implement the missing 6 features** — too much scope for an accuracy audit; deferred
2. **Remove false specials, fix inaccurate ones** — minimal, accurate, immediately correct ✓
3. **Add a disclaimer** — ugly UX

**Chosen:** Option 2. Also changed `getBonusDescription` to always include damage % at all levels (including level 5), so players always see the real numeric bonus.

## Changes Made

### `src/systems/MasteryStore.ts`

**BONUS_TABLE `special` strings:**
| Weapon | Before | After |
|---|---|---|
| Standard | `'+1 extra bullet'` | `'+2 extra bullets (twin stream)'` |
| Spread | `'+2 extra pellets'` | `'9-pellet mega fan'` |
| Piercing | `'+50% beam length'` | *(removed — not implemented)* |
| ChainLightning | `'+2 chain targets'` | *(removed — not implemented)* |
| Homing | `'Tighter tracking'` | `'Seeking Swarm: 3 simultaneous missiles'` |
| PlasmaMortar | `'+50% AoE radius'` | *(removed — not implemented)* |
| GravityGun | `'+50% pull radius'` | *(removed — not implemented)* |
| LaserBeam | `'Continuous ramp'` | *(removed — not implemented)* |
| BlackHole | `'+duration +shots'` | `'Event Horizon: longer duration + AoE explosion'` |
| TeslaCoil | `'+radius +DPS'` | *(removed — not implemented)* |

**`getBonusDescription` behavior change:**
- Before: at level 5 with special, showed ONLY special (e.g. "Plasma Mortar: +50% AoE radius"), hiding the actual damage bonus
- After: always shows damage %, adds fire rate % when non-zero, appends special when present
- Example level 5 Standard: "Blaster: +50% damage, +20% fire rate, +2 extra bullets (twin stream)"
- Example level 5 PlasmaMortar: "Plasma Mortar: +60% damage, +10% fire rate"

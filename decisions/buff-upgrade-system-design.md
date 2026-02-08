# Buff & Upgrade System Design

## Date: 2026-02-09

**Context:** Design a comprehensive stackable buff system inspired by Muck and Risk of Rain (1 & 2), integrated into the existing Geometry Wars 3D clone. Buffs should stack to make the player feel incredibly powerful, encouraging aggressive play and rewarding skilled runs.

---

## 1. Research Findings

### Muck's Powerup System

Muck (by Dani) uses a chest-based acquisition system with three rarity tiers: Common (white), Uncommon (blue), and Rare (yellow). Powerups are obtained from loot chests (costing coins from green chests), battle totems, and boss drops. Every powerup stacks up to 69 times.

**Key mechanics:**
- **Inverse exponential stacking** for percentage-based effects: `value = (1 - e^(-stacks * scaleSpeed)) * maxValue`. This means early stacks are impactful and later stacks have diminishing returns, but the power ceiling stays tantalizing.
- **Linear stacking** for flat bonuses (e.g., Red Pill adds +10 HP per stack).
- **Synergy combos** are encouraged: Wings of Glory + Jetpack (air damage + flight), Berserk + Adrenaline (low HP = massive damage), Enforcer + Sneakers (speed = damage).
- The **satisfying loop**: open chest, see powerup appear, immediately feel the stat boost. Simple, fast, no menu friction.

**What makes it feel good:**
- Instant gratification on pickup - no configuration needed
- Visible power scaling - you can *feel* 10 stacks of Dumbbell
- Stacking the same buff over and over is a valid strategy
- Max stack cap (69) is high enough that you never feel capped in normal play

### Risk of Rain 1 & 2 Item System

Risk of Rain 2 features ~183 items across multiple rarity tiers: Common (white), Uncommon (green), Legendary (red), Boss (yellow), Lunar (blue), Void (purple), and Equipment (orange, active use). Items stack infinitely with different scaling models.

**Three stacking models:**
1. **Linear:** Each stack adds the same flat bonus. Paul's Goat Hoof: +14% move speed per stack. 30 stacks = +420% speed. Simple, powerful, no cap.
2. **Hyperbolic:** Uses `f(x) = 1 - 1/(1 + a*x)` to create diminishing returns. Tougher Times (block chance): 1 stack = 13%, 5 stacks = 43%, 10 stacks = 60%, 20 stacks = 75%. Asymptotically approaches but never reaches 100%.
3. **Multiplicative:** Multipliers from different sources multiply together, same-source adds. Creates exponential power spikes when combining different item types.

**The proc chain system** is Risk of Rain 2's most iconic mechanic:
- On-hit items can trigger other on-hit items, creating cascading damage chains
- Each item has a **proc coefficient** (0.0 to 1.0) that scales trigger chance
- A given item can only activate once per chain (prevents infinite loops)
- This creates emergent synergies: Ukulele (chain lightning) triggers ATG Missile (homing rocket) which triggers Sticky Bomb, etc.

**Most iconic items:**
- **Ukulele** (25% chance: chain lightning to 3 nearby enemies, +2 per stack)
- **ATG Missile Mk. 1** (10% chance: fire homing missile for 300% damage, +300% per stack)
- **Tougher Times** (15% chance to block damage)
- **Soldier's Syringe** (+15% attack speed per stack)
- **Lens-Maker's Glasses** (+10% crit chance per stack)
- **Will-o'-the-Wisp** (enemies explode on kill for 350% damage, +280% per stack)
- **57 Leaf Clover** (all random effects roll +1 time per stack, picking best result)

### Key Design Principles That Make These Systems Amazing

1. **Immediate feedback loop:** Pick up item, immediately see/feel the effect. No configuration, no menus.
2. **Visible power escalation:** The player should notice they're stronger after every buff. Small numbers early, absurd numbers late.
3. **Multiplicative potential:** The most satisfying moment is when two buffs combine to create something greater than the sum of parts.
4. **No useless items:** Every buff should have a use case. Even "bad" buffs should have synergies that make them good.
5. **Stack-chasing dopamine:** Seeing "x5" next to a buff icon creates a desire to find more. The stack counter itself is addictive.
6. **Emergent gameplay:** Players should discover combos, not be told about them. "Wait, if I stack shock aura with chain lightning weapon..."
7. **Risk/reward decisions:** Some buffs should be situational, creating interesting choices.
8. **Power fantasy fulfillment:** By late game, the player should be an unstoppable force. That's the *point*.

---

## 2. Buff Categories

### Category A: Offensive
Buffs that increase raw damage output, fire rate, bullet properties. Color theme: **Red/Orange**.

### Category B: Defensive
Buffs that protect the player - shields, damage reduction, extra lives, invincibility frames. Color theme: **Blue/Cyan**.

### Category C: Utility
Buffs that improve quality of life - move speed, collection radius, score multiplier, cooldown reduction. Color theme: **Green/Yellow**.

### Category D: Elemental / Proc
Buffs that add on-hit effects and area-of-effect procs - shock chains, fire DoT, ice slow, gravity wells. Color theme: **Purple/Magenta**. These are the "build-defining" buffs that create the most dramatic synergies.

### Category E: Legendary
Rare, powerful buffs that fundamentally change how the player plays. Only one can be active at a time (replaces previous legendary). Color theme: **Gold/White**.

---

## 3. Specific Buff Designs

### OFFENSIVE BUFFS (Red/Orange)

#### 1. Hot Hands
- **Icon:** Two flame symbols
- **Stack 1:** +15% bullet damage
- **Stacking:** Linear. +15% per stack (additive). Stack 10 = +150% damage.
- **Max stack:** Uncapped
- **Synergies:** Multiplicative with Elemental procs (fire DoT scales with base damage)
- **Rarity:** Common
- **Feeling:** The bread and butter. Every stack is noticeable. At 20+ stacks, enemies melt.

#### 2. Trigger Happy
- **Icon:** Three horizontal speed lines
- **Stack 1:** +12% fire rate
- **Stacking:** Linear. +12% per stack. Stack 10 = +120% fire rate.
- **Max stack:** Uncapped
- **Synergies:** More shots = more proc chances for elemental buffs. Incredible with Ukulele-style chain procs.
- **Rarity:** Common
- **Feeling:** The screen fills with more and more bullets. At high stacks, it's a bullet hose.

#### 3. Armor Piercing
- **Icon:** Arrow through a shield
- **Stack 1:** Bullets ignore 20% of enemy damage resistance
- **Stacking:** Hyperbolic. `1 - 1/(1 + 0.25 * stacks)`. Stack 5 = 56%, Stack 10 = 71%.
- **Max stack:** Uncapped (asymptotic to 100%)
- **Synergies:** Makes all damage buffs more effective against armored enemies
- **Rarity:** Uncommon
- **Feeling:** Tough enemies that used to be bullet sponges start dying fast.

#### 4. Overkill
- **Icon:** Skull with explosion lines
- **Stack 1:** When killing an enemy, excess damage splashes to nearest enemy within 2 units (50% of excess)
- **Stacking:** +0.5 unit splash radius and +10% excess damage transfer per stack. Stack 5 = 4.5 units, 100% transfer.
- **Max stack:** 10 (radius caps at 7 units, transfer caps at 150%)
- **Synergies:** Incredible with high single-target damage (Piercing weapon, Hot Hands stacks). Creates chain kills.
- **Rarity:** Uncommon
- **Feeling:** Kill one enemy and the splash cascades through a group. At high stacks, one well-aimed shot can clear a cluster.

#### 5. Glass Cannon
- **Icon:** Cracked crystal with lightning
- **Stack 1:** +40% damage, but -15% max shield/health
- **Stacking:** Linear damage (+40% per stack), hyperbolic health loss. Stack 3 = +120% damage, -35% health. Stack 5 = +200% damage, -50% health.
- **Max stack:** 7
- **Synergies:** Pairs with defensive buffs to offset the health loss. High risk, high reward.
- **Rarity:** Rare
- **Feeling:** You hit like a truck but live on the edge. Forces you to play well.

#### 6. Critical Mass
- **Icon:** Crosshair with spark
- **Stack 1:** +8% critical hit chance. Crits deal 2x damage.
- **Stacking:** Linear chance (+8% per stack). Crit multiplier: +0.15x per stack. Stack 5 = 40% crit, 2.6x multiplier. Stack 12 = 96% crit, 2.8x multiplier.
- **Max stack:** Uncapped
- **Synergies:** Every damage buff benefits from crits. Proc effects trigger on crit for bonus effects.
- **Rarity:** Common
- **Feeling:** The satisfying *crack* of a crit. At high stacks, nearly every shot crits.

### DEFENSIVE BUFFS (Blue/Cyan)

#### 7. Tough Times
- **Icon:** Shield with checkmark
- **Stack 1:** 12% chance to block incoming damage entirely
- **Stacking:** Hyperbolic. `1 - 1/(1 + 0.15 * stacks)`. Stack 5 = 43%, Stack 10 = 60%.
- **Max stack:** Uncapped (never reaches 100%)
- **Synergies:** Works with all survival buffs. More time alive = more proc triggers.
- **Rarity:** Common
- **Feeling:** Enemies hit you and... nothing happens. Increasingly reliable as stacks grow.

#### 8. Regeneration Field
- **Icon:** Heart with circular arrows
- **Stack 1:** Recover 1 shield point per 5 seconds
- **Stacking:** Linear. +1 point per 5s per stack. Stack 5 = 5 points per 5s (1/sec).
- **Max stack:** Uncapped
- **Synergies:** Pairs with Tough Times (blocks buy time to regen). Glass Cannon (offsets health loss over time).
- **Rarity:** Common
- **Feeling:** Subtle at first, life-saving at high stacks. You can take hits and recover.

#### 9. Repulsion Field
- **Icon:** Expanding rings
- **Stack 1:** Enemies within 1.5 units are pushed away (gentle knockback)
- **Stacking:** +0.5 unit radius and +30% push force per stack. Stack 5 = 3.5 unit radius, strong push.
- **Max stack:** 8
- **Synergies:** Creates space for Shock Aura and Tesla-style effects. Keeps melee enemies at bay.
- **Rarity:** Uncommon
- **Feeling:** Enemies bounce off your personal space. At high stacks, they can barely get close.

#### 10. Second Wind
- **Icon:** Feather with clock
- **Stack 1:** On death, 25% chance to revive with 1 second of invincibility instead of losing a life
- **Stacking:** Hyperbolic chance. `1 - 1/(1 + 0.35 * stacks)`. Stack 3 = 51%, Stack 5 = 64%.
- **Max stack:** Uncapped
- **Synergies:** Glass Cannon (die more but survive more). Extends run length dramatically.
- **Rarity:** Rare
- **Feeling:** That clutch moment where you should have died but didn't. Addictive.

### UTILITY BUFFS (Green/Yellow)

#### 11. Afterburner
- **Icon:** Rocket exhaust trail
- **Stack 1:** +10% movement speed
- **Stacking:** Linear. +10% per stack.
- **Max stack:** Uncapped
- **Synergies:** Velocity Damage (below) scales with speed. Better dodging = more time for procs.
- **Rarity:** Common
- **Feeling:** Nimble at first, then blazing fast. Dodging enemy swarms becomes effortless.

#### 12. Magnetism
- **Icon:** Horseshoe magnet
- **Stack 1:** Geom collection radius increased by 1.5 units (from base ~0.5)
- **Stacking:** Linear. +1.0 unit per stack. Stack 5 = base + 6.5 units.
- **Max stack:** Uncapped
- **Synergies:** More geoms = higher multiplier = higher score. Pairs with any kill-focused build.
- **Rarity:** Common
- **Feeling:** Geoms fly toward you from across the surface. At high stacks, you vacuum the entire area.

#### 13. Multiplier Shield
- **Icon:** "x" symbol inside a bubble
- **Stack 1:** On death, retain 25% of your score multiplier instead of losing it all
- **Stacking:** Linear. +15% retention per stack. Stack 5 = 100% retention.
- **Max stack:** 5
- **Synergies:** Essential for high-score runs. Pairs with Second Wind.
- **Rarity:** Uncommon
- **Feeling:** Death doesn't reset your entire progress. Removes the most punishing mechanic.

#### 14. Cooldown Reduction
- **Icon:** Clock with downward arrow
- **Stack 1:** Super ability and bomb cooldowns reduced by 10%
- **Stacking:** Hyperbolic. `1 - 1/(1 + 0.12 * stacks)`. Stack 5 = 38%, Stack 10 = 55%.
- **Max stack:** Uncapped (asymptotic, never reaches 100%)
- **Synergies:** More bombs = more emergency options. More supers = more burst damage.
- **Rarity:** Uncommon
- **Feeling:** Bombs and supers feel like regular abilities instead of emergency buttons.

#### 15. Velocity Damage
- **Icon:** Lightning bolt through speedometer
- **Stack 1:** Deal bonus damage equal to 5% of your current move speed as flat damage per bullet
- **Stacking:** Linear. +5% per stack.
- **Max stack:** Uncapped
- **Synergies:** Scales with Afterburner. Encourages constant movement (which you should be doing anyway).
- **Rarity:** Uncommon
- **Feeling:** Moving fast makes you deadly. Standing still is suboptimal. Rewards skill.

### ELEMENTAL / PROC BUFFS (Purple/Magenta)

#### 16. Shock Aura
- **Icon:** Lightning bolts radiating from center
- **Stack 1:** Enemies within 2 units of the player receive shock damage (0.5 DPS). 30% chance per second for shock to chain to one nearby enemy within 3 units.
- **Stacking:** Per stack: +0.3 DPS, +8% chain chance, +1 max chain target. Stack 5 = 2.0 DPS, 70% chain chance, chains to 6 targets. Stack 10 = 3.5 DPS, 100% chain guaranteed, 11 chain targets.
- **Max stack:** Uncapped
- **Synergies:** Combined with the Chain Lightning weapon, creates a devastating electrical storm. Critical Mass makes shock crits possible. Trigger Happy increases the proc rate of chained shocks.
- **Rarity:** Uncommon
- **Feeling:** You walk through enemies and they die. At high stacks, just existing near enemies is lethal. The chain lightning visual cascading across enemy groups is deeply satisfying.

#### 17. Incendiary Rounds
- **Icon:** Bullet with flame tail
- **Stack 1:** 15% chance on hit to ignite enemies. Burning enemies take 1 damage/sec for 3 seconds.
- **Stacking:** +5% chance per stack, +0.5 DPS per stack, +0.5 sec duration per stack. Stack 5 = 40% chance, 3.5 DPS, 5.5 sec. Stack 10 = 65% chance, 6 DPS, 8 sec.
- **Max stack:** Uncapped
- **Synergies:** Overkill (burning enemies that die splash). Will-o-Wisp effect with Volatile (below). More hits from Trigger Happy = more ignitions.
- **Rarity:** Common
- **Feeling:** Enemies catch fire and burn. At high stacks, every shot sets the battlefield ablaze.

#### 18. Cryo Shots
- **Icon:** Snowflake crystal
- **Stack 1:** 20% chance on hit to slow enemy by 30% for 2 seconds
- **Stacking:** +5% chance per stack, +5% slow per stack (capped at 80% slow). Stack 5 = 45% chance, 55% slow. Stack 10 = 70% chance, 80% slow.
- **Max stack:** Uncapped (chance uncapped, slow capped at 80%)
- **Synergies:** Slowed enemies are easier to hit (helps Homing, Chain Lightning). Frozen enemies take 1.5x damage from all sources. Shock Aura + Cryo = "Superconductor" combo (see synergies).
- **Rarity:** Common
- **Feeling:** Enemies slow to a crawl. Combined with other procs, they're helpless.

#### 19. Volatile
- **Icon:** Unstable atom symbol
- **Stack 1:** Enemies explode on death, dealing 50% of their max HP as damage in a 1.5 unit radius
- **Stacking:** +15% explosion damage per stack, +0.3 unit radius per stack. Stack 5 = 125% HP damage, 3.0 unit radius.
- **Max stack:** 10
- **Synergies:** Overkill chains into Volatile explosions. Incendiary + Volatile = enemies are time bombs. In dense swarms, one kill cascades.
- **Rarity:** Uncommon
- **Feeling:** Enemies become the weapon. Kill one in a group and watch the chain reaction. At high stacks, it's a fireworks display of destruction.

#### 20. Gravity Well
- **Icon:** Spiral vortex
- **Stack 1:** Every 5 seconds, pull all enemies within 4 units slightly toward the player (gentle, 0.5 unit pull)
- **Stacking:** +1 unit range per stack, +0.3 unit pull strength per stack, -0.5s cooldown per stack (min 2s). Stack 5 = 9 units, 2.0 pull, every 2.5s.
- **Max stack:** 8
- **Synergies:** Clusters enemies for Shock Aura, Volatile explosions, PlasmaMortar. Pairs with Repulsion Field for a "push-pull" that juggles enemies.
- **Rarity:** Rare
- **Feeling:** Enemies helplessly drift toward you, only to be annihilated by your aura/weapons. Crowd control mastery.

#### 21. Ricochet
- **Icon:** Arrow bouncing between points
- **Stack 1:** Bullets that kill an enemy bounce to the nearest enemy within 3 units (60% damage)
- **Stacking:** +1 bounce per stack, +10% retained damage per stack. Stack 3 = 4 bounces, 90% damage. Stack 5 = 6 bounces, 110% damage (gaining power!).
- **Max stack:** 8
- **Synergies:** Trigger Happy (more bullets = more ricochets). Critical Mass (crits bounce too). In dense groups, one bullet kills many.
- **Rarity:** Rare
- **Feeling:** Watching a single bullet ping between 6 enemies and kill them all. At high stacks, every bullet is a mini chain reaction.

### LEGENDARY BUFFS (Gold/White)

#### 22. Orbital Cannon
- **Icon:** Satellite with beam
- **Stack 1:** Every 8 seconds, a devastating beam strikes the densest cluster of enemies on the surface, dealing 50 damage in a 3-unit radius.
- **Stacking:** -1.5s cooldown per stack, +15 damage per stack, +0.5 unit radius per stack. Stack 3 = every 3.5s, 80 damage, 4.5 unit radius.
- **Max stack:** 5
- **Synergies:** Gravity Well (clusters enemies for the beam). Volatile (beam kills cause chain explosions). Cooldown Reduction stacks with internal cooldown.
- **Rarity:** Legendary
- **Feeling:** A massive beam of light descends from above and obliterates a cluster. The surface deforms. Devastating and cinematic.

#### 23. Time Dilation
- **Icon:** Hourglass with fracture
- **Stack 1:** Enemies within 5 units move and attack at 70% speed. Player is unaffected.
- **Stacking:** +2 unit radius, -10% enemy speed per stack (min 30% speed). Stack 3 = 11 units, 40% enemy speed.
- **Max stack:** 5
- **Synergies:** Everything is easier when enemies are slow. Cryo Shots + Time Dilation = near-frozen enemies. Shock Aura has more time to chain.
- **Rarity:** Legendary
- **Feeling:** The world slows down around you. You're operating at a different speed than everything else. Absolute control.

#### 24. Singularity Core
- **Icon:** Black hole with particle ring
- **Stack 1:** On kill, 5% chance to spawn a micro black hole at the enemy's position that lasts 2 seconds, pulling and damaging nearby enemies (radius 2, 3 DPS).
- **Stacking:** +3% chance per stack, +0.5s duration per stack, +1 DPS per stack. Stack 5 = 20% chance, 4s duration, 8 DPS.
- **Max stack:** 7
- **Synergies:** Volatile (pulled enemies explode on death, pulling more). Gravity Well (double crowd control). High kill rate from Trigger Happy = more singularities.
- **Rarity:** Legendary
- **Feeling:** Micro black holes bloom across the battlefield, swallowing enemy groups. The surface warps and deforms. Absolute chaos.

#### 25. Berserker Protocol
- **Icon:** Clenched fist with energy aura
- **Stack 1:** After killing 5 enemies within 3 seconds, enter Berserk mode for 4 seconds: +50% damage, +30% fire rate, +20% move speed, invulnerable.
- **Stacking:** -1 kill threshold per stack (min 2), +1s duration per stack, +10% damage bonus per stack. Stack 3 = 2 kills to trigger, 7s duration, +80% damage.
- **Max stack:** 5
- **Synergies:** Everything. This is the "I'm unstoppable" buff. Trigger Happy helps reach the kill threshold. Volatile chain kills count.
- **Rarity:** Legendary
- **Feeling:** You go Super Saiyan. Screen tints, music intensifies, everything dies. The ultimate power fantasy.

---

## 4. Acquisition System

### Drop Sources

**Enemy Kills (Primary)**
- Each enemy kill has a base chance to drop a buff pickup
- Drop chance scales with enemy tier:
  - Basic enemies: 2% chance
  - Tracking enemies: 4% chance
  - Swarm/Splitting: 3% chance (per unit)
  - Defensive/Evasive: 6% chance
  - Dangerous: 8% chance
  - Boss-tier: 100% chance (guaranteed 1-3 buffs)

**Score Milestones**
- Every 50,000 points: 1 random buff pickup spawns near the player
- Every 200,000 points: 1 guaranteed Uncommon or better buff
- Every 500,000 points: 1 guaranteed Rare or better buff
- Every 1,000,000 points: 1 guaranteed Legendary buff

**Wave Completion Bonus**
- Completing a wave without taking damage: bonus buff drop
- Completing a wave under par time: bonus buff drop
- These bonuses encourage skilled play

**Combo Rewards**
- 25-kill combo: 1 random buff
- 50-kill combo: 1 Uncommon+ buff
- 100-kill combo: 1 Rare+ buff

### Drop Rates by Rarity

When a buff drop occurs, rarity is rolled:
| Rarity | Base Chance | With Luck Scaling |
|---|---|---|
| Common | 60% | Decreases over time |
| Uncommon | 28% | Stable |
| Rare | 10% | Increases slightly |
| Legendary | 2% | Increases slightly |

**Luck scaling:** As the player's score increases, the rarity table shifts. At 500K+ score, Common drops to 45%, Uncommon stays 28%, Rare rises to 20%, Legendary rises to 7%. This ensures late-game runs feel rewarding.

### Buff Pickup Visual Design

All buff pickups share a base design language (distinct from weapon pickups and geoms):

- **Shape:** Hexagonal prism (6-sided, flat top/bottom) - visually distinct from weapon octahedrons and geom diamonds
- **Size:** Slightly smaller than weapon pickups
- **Animation:** Gentle float + slow rotation + color pulse
- **Category glow:** Inner core color matches category (Red/Blue/Green/Purple/Gold)
- **Rarity ring:** Outer ring color indicates rarity:
  - Common: White wireframe
  - Uncommon: Green wireframe
  - Rare: Red wireframe with subtle particle trail
  - Legendary: Gold wireframe with bright particle trail + screen edge indicator

**Rarity visual escalation:**
- Common: Simple hex, gentle glow
- Uncommon: Hex with orbiting particle
- Rare: Hex with 2 orbiting particles + glow trail
- Legendary: Hex with spinning particle ring + pulsing light + minimap indicator + subtle screen flash on spawn

### Lifetime and Behavior

- Common/Uncommon pickups last 12 seconds before fading
- Rare pickups last 20 seconds
- Legendary pickups last 30 seconds and show a screen-edge directional indicator
- All pickups emit a subtle audio cue when spawned (pitch rises with rarity)

---

## 5. Stacking Mechanics

### Scaling Formula Reference

Three formulas used, matching Risk of Rain 2's proven approach:

**Linear:** `value = base + (stacks - 1) * increment`
- Used for: Flat stat bonuses (damage, speed, fire rate)
- Feels: Consistent, predictable, always rewarding
- Risk: Can become absurd at very high stacks (which is the point)

**Hyperbolic:** `value = 1 - 1/(1 + coefficient * stacks)`
- Used for: Percentage-based effects that must not reach 100% (block chance, armor penetration, cooldown reduction)
- Feels: Impactful early, gradually diminishing, never "done"
- Risk: Players may feel diminishing returns are unfair (mitigated by showing actual value in tooltip)

**Inverse Exponential (Muck-style):** `value = (1 - e^(-stacks * scaleSpeed)) * maxValue`
- Used for: Effects that should plateau (slow percentage, damage reduction)
- Feels: Fast ramp then plateau. Good for effects that would break at 100%.
- Curve is slightly more aggressive than hyperbolic (reaches effective cap faster)

### Interaction with PlayerLevel Multipliers

Buff multipliers and PlayerLevel multipliers stack **multiplicatively**:

```
finalDamage = baseDamage
  * playerLevel.damageMultiplier      // 1.0 - 1.6 (from kill-based leveling)
  * (1 + hotHandsStacks * 0.15)       // Hot Hands buff
  * (1 + glassCannon * 0.40)          // Glass Cannon buff
  * critMultiplier                     // 1.0 or 2.0+ on crit
  * scoreManager.scorePowerMultiplier  // 1.0 - 2.5 (from score thresholds)
  * auraBuff.damageMultiplier          // 1.0 - 1.6 (from multiplayer aura)
```

This multiplicative stacking is intentional. It means each buff source amplifies all others, creating the exponential power curve that makes high-stack runs feel amazing.

### Proc Interaction Rules

Inspired by Risk of Rain 2's proc coefficient system:

1. **Player bullets** have proc coefficient 1.0 (full chance to trigger on-hit effects)
2. **Proc-generated damage** (shock chains, ricochet bounces, volatile explosions) has proc coefficient 0.3 (reduced chance to re-trigger)
3. **DOT damage** (fire, shock aura passive) has proc coefficient 0.0 (cannot trigger on-hit effects)
4. **Each proc type can only trigger once per chain** (prevents infinite loops)

This means:
- Bullet hits enemy -> can trigger Shock, Fire, Cryo, Ricochet, Volatile
- Ricochet bullet hits second enemy -> 30% effective proc chance for Shock/Fire/Cryo (but NOT another Ricochet)
- Fire DOT tick -> cannot trigger anything

### Stack Display Math

Tooltips show the actual computed value, not just the stack count:
- "Hot Hands x7: +105% bullet damage"
- "Tough Times x4: 37.5% block chance"
- "Shock Aura x6: 2.3 DPS, 78% chain chance, 7 chain targets"

---

## 6. Synergy System

### Named Synergy Combos

When specific buff combinations are active, a named combo appears on the HUD with bonus effects:

#### "Superconductor" - Shock Aura (3+) + Cryo Shots (3+)
- **Bonus:** Shocked + frozen enemies take 2x damage from all sources. Shock chains have +50% range against frozen targets.
- **Visual:** Enemies hit by both effects crackle with blue-white electricity.

#### "Meltdown" - Incendiary Rounds (3+) + Volatile (3+)
- **Bonus:** Burning enemies that explode from Volatile deal fire damage to all enemies caught in the blast (stacking the burn). Chain reaction potential.
- **Visual:** Explosions are orange-red instead of white. Fire particles everywhere.

#### "Glass Storm" - Glass Cannon (2+) + Berserker Protocol (1+)
- **Bonus:** Berserk mode damage bonus is doubled. Berserk trigger threshold reduced by 1. Risk amplified but reward is insane.
- **Visual:** Player ship turns bright red during Berserk.

#### "Bullet Hell" - Trigger Happy (5+) + Ricochet (3+) + Critical Mass (3+)
- **Bonus:** Ricochet bullets that crit gain +1 bounce. The screen fills with bouncing, critting projectiles.
- **Visual:** Crit ricochets leave bright trails.

#### "Event Horizon" - Gravity Well (3+) + Singularity Core (1+) + Volatile (2+)
- **Bonus:** Singularity black holes pull 50% harder. Volatile explosions inside a singularity's radius deal 2x damage. Enemies are pulled in, explode, pull more in.
- **Visual:** Black hole effects have visible distortion rings.

#### "Immortal" - Tough Times (5+) + Second Wind (2+) + Regeneration Field (5+)
- **Bonus:** Block chance from Tough Times applies to the "should I lose a life" check too (separate roll). Effectively double-dipping on survival.
- **Visual:** Player has a subtle blue shield shimmer.

### Emergent Synergies (Not Named, But Powerful)

These are not explicitly called out in the UI but players will discover them:

- **Afterburner + Velocity Damage:** Move speed becomes damage. Sprint to kill.
- **Magnetism + high kill rate:** Geoms auto-collect, multiplier skyrockets, score milestones trigger more drops.
- **Overkill + any high-damage single-hit weapon (Piercing, PlasmaMortar):** Excess damage cascades through groups.
- **Cooldown Reduction + Orbital Cannon:** Beam fires every few seconds, carpet-bombing the surface.
- **Repulsion Field + Shock Aura:** Push enemies to the edge of shock range, keeping them in the damage zone but away from you.

---

## 7. UI Design

### Buff Bar Layout

```
+--------------------------------------------------+
|  SCORE: 1,234,567    x42    LEVEL 7 JUGGERNAUT   |
|  [=====SUPER=====]  BOMBS: 3   SPREAD x3 (87)    |
|                                                    |
|  Buffs:                                           |
|  [HOT x5] [TRG x3] [SHK x7] [CRY x2] [VLT x4] |
|  [TGH x2] [AFT x6] [MAG x4] [CDR x1]           |
|                                                    |
|                    (game area)                     |
|                                                    |
|  Combo: SUPERCONDUCTOR active!                    |
+--------------------------------------------------+
```

### Buff Icon Design

Each buff icon is a small square (24x24 pixels at 1080p) with:
- **Background:** Category-colored gradient (darker at edges)
- **Symbol:** 2-3 character abbreviation or small icon
- **Stack count:** Bold white number in bottom-right corner
- **Border:** Rarity color (white/green/red/gold)
- **Pulse:** Icons pulse briefly when a new stack is gained

### Positioning

- **Single player:** Top-left, below the score/weapon HUD
- **Splitscreen:** Each player's buff bar appears in their viewport quadrant
  - P1 (left half): Top-left of left viewport
  - P2 (right half): Top-left of right viewport
- **Network multiplayer:** Same as single player (each client shows own buffs)

### Tooltip System

- **On pause menu:** Hovering over a buff icon shows full details:
  - Name, description, current stack count
  - Current computed value (e.g., "Block chance: 43%")
  - Active synergies this buff participates in
- **On pickup:** Brief floating text shows buff name and stack count (e.g., "+1 Shock Aura (x7)")

### Active Synergy Display

When a named synergy combo is active:
- Small text appears below the buff bar: "SUPERCONDUCTOR" in the combo's color
- Gentle glow effect on the relevant buff icons
- Notification on first activation: "SYNERGY: Superconductor Activated!"

### New Buff Notification

When picking up a buff:
1. Icon flies from pickup location to its position in the buff bar
2. Stack counter increments with a satisfying "tick" animation
3. If first time getting this buff: name and description flash briefly center-screen
4. Audio: ascending chime (pitch scales with rarity)

---

## 8. Implementation Priority

### Phase 1: Core Infrastructure (Build First)

**Files to create:**
1. `src/buffs/BuffTypes.ts` - Enum, interfaces, config data for all buffs
2. `src/buffs/BuffManager.ts` - Central manager: tracks active buffs, handles stacking, computes values, manages proc chains
3. `src/buffs/BuffPickupNew.ts` - New pickup entity (hexagonal, rarity-aware) replacing current simple BuffPickup
4. `src/buffs/BuffHUD.ts` - DOM-based HUD for buff display (icons, stacks, tooltips)

**Integration points:**
- `WeaponManager.ts` - Query BuffManager for damage/fire rate/range multipliers (replace current 3-buff system)
- `PlayerLevel.ts` - Multiplicative stacking with buff multipliers
- `ScoreManager.ts` - Score milestones trigger buff drops
- `EnemySpawner.ts` - Enemy death triggers buff drop chance roll
- `main.ts` game loop - BuffManager.update() each frame, proc chain processing

### Phase 2: First 8 Buffs (Core Gameplay Loop)

Implement these first to establish the stacking feel:

| Priority | Buff | Why First |
|---|---|---|
| 1 | **Hot Hands** | Simplest buff. Linear damage. Validates the stacking system works. |
| 2 | **Trigger Happy** | Second simplest. Fire rate. Tests that fire rate stacking integrates with WeaponManager. |
| 3 | **Afterburner** | Move speed. Tests integration with player movement (MeshWalker speed multiplier). |
| 4 | **Magnetism** | Collection radius. Tests integration with geom collection. Immediately rewarding. |
| 5 | **Tough Times** | First defensive buff. Tests damage blocking integration with player hit detection. |
| 6 | **Shock Aura** | First elemental proc. Tests the proc system, AoE damage, chain mechanic. The user's specific request. |
| 7 | **Incendiary Rounds** | Second elemental. Tests DOT system. Validates proc coefficient rules work. |
| 8 | **Volatile** | Tests on-death effects. Validates that chain reactions work (kill -> explode -> kill -> explode). |

### Phase 3: Remaining Common/Uncommon Buffs
- Critical Mass, Armor Piercing, Overkill, Regeneration Field, Repulsion Field, Cryo Shots, Cooldown Reduction, Velocity Damage, Multiplier Shield, Gravity Well, Ricochet

### Phase 4: Rare/Legendary Buffs + Synergy System
- Glass Cannon, Second Wind, Orbital Cannon, Time Dilation, Singularity Core, Berserker Protocol
- Named synergy combo detection and display

### Phase 5: Polish
- Full tooltip system on pause
- Buff pickup visual effects (particle trails, screen flash for legendary)
- Audio cues for pickups, synergy activation, proc triggers
- Balance tuning (numbers will need extensive playtesting)

### Estimated Complexity

| Component | Estimated Lines | Difficulty |
|---|---|---|
| BuffTypes.ts | ~200 | Low - data definitions |
| BuffManager.ts | ~400 | Medium - stacking logic, proc chains |
| BuffPickupNew.ts | ~150 | Low - extends existing pickup pattern |
| BuffHUD.ts | ~250 | Medium - DOM layout, animations |
| Integration (5+ files) | ~200 | Medium - wiring into existing systems |
| Per-buff logic (25 buffs) | ~800 total | Varies - some are trivial, procs are complex |
| Synergy system | ~200 | Medium - combo detection |
| **Total** | **~2,200** | **Manageable in phases** |

---

## Appendix: Integration Architecture

```
BuffManager (singleton)
  |
  |-- buffStacks: Map<BuffId, number>         // how many of each buff
  |-- buffConfigs: Map<BuffId, BuffConfig>     // static data
  |-- procState: ProcChainState               // prevents infinite proc loops
  |
  |-- getMultiplier(stat): number             // computed from all relevant buffs
  |-- onEnemyHit(enemy, damage, source): void // proc chain entry point
  |-- onEnemyKill(enemy, source): void        // volatile, overkill, singularity
  |-- onPlayerHit(): boolean                  // tough times block check
  |-- onPlayerDeath(): boolean                // second wind check
  |-- update(dt): void                        // tick DOTs, auras, cooldowns
  |
  |-- Reads from: PlayerLevel, ScoreManager
  |-- Writes to: WeaponManager (multipliers), Player (speed, collection radius)
  |-- Events: onBuffGained, onBuffProc, onSynergyActivated
```

### Migration Path from Current BuffPickup System

The existing `BuffType` enum (ExtendedRange, RapidFire, DurationPlus) and `BuffPickup` class should be **kept functional during migration** and eventually folded into the new system:

- ExtendedRange -> becomes a stack of a new "Extended Range" buff (keep same behavior)
- RapidFire -> becomes a stack of Trigger Happy (same effect, new name)
- DurationPlus -> becomes a stack of a new "Ammo Efficiency" buff

The old `WeaponManager.applyBuff()` / `hasBuff()` / `getBuffMultiplier()` methods become thin wrappers that query `BuffManager` instead of maintaining their own state.

---

## Research Sources

- [Powerups - Muck Wiki](https://muck.fandom.com/wiki/Powerups)
- [Muck All Powerups Guide](https://www.magicgameworld.com/muck-all-powerups-and-their-effects-guide/)
- [Item Stacking - Risk of Rain 2 Wiki](https://riskofrain2.fandom.com/wiki/Item_Stacking)
- [ROR2 Formulas Guide - How Item Stacking Actually Works](https://deltiasgaming.com/risk-of-rain-2-ror2-formulas-guide-how-item-stacking-actually-works/)
- [Proc Coefficient - Risk of Rain 2 Wiki](https://riskofrain2.fandom.com/wiki/Proc_Coefficient)
- [Items - Risk of Rain 2 Wiki](https://riskofrain2.fandom.com/wiki/Items)
- [Ukulele - Risk of Rain 2 Wiki](https://riskofrain2.fandom.com/wiki/Ukulele)
- [Muck Powerups with Numbers](https://gamepretty.com/muck-all-powerups-with-numbers/)
- [Muck Powerups - Muckencyclopedia](https://muckencyclopedia.fandom.com/wiki/Powerups)
- [Risk of Rain 2 Item Synergies Guide](https://steamcommunity.com/sharedfiles/filedetails/?id=1940344201)
- [Roguelike Item and Monster Design Revisited - Game Developer](https://www.gamedeveloper.com/design/roguelike-item-and-monster-design-revisited)

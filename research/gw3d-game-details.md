# Geometry Wars 3: Dimensions - Complete Game Reference

**Date:** 2026-02-08
**Status:** Reference research — game design and mechanics. No codebase-specific references.

> Comprehensive research document for browser clone implementation.
> Sources: Geometry Wars Wiki (Fandom), Steam Community Guides, PlayStation Blog, various game reviews and community discussions.

---

## Table of Contents

1. [Enemy Types](#1-enemy-types)
2. [Maps / Surfaces](#2-maps--surfaces)
3. [Game Modes](#3-game-modes)
4. [Weapons & Drones](#4-weapons--drones)
5. [Supers (Special Abilities)](#5-supers-special-abilities)
6. [Super States (Temporary Power-ups)](#6-super-states-temporary-power-ups)
7. [Scoring System](#7-scoring-system)
8. [Spawning System](#8-spawning-system)
9. [Level Progression (Adventure Mode)](#9-level-progression-adventure-mode)
10. [Visual Effects](#10-visual-effects)
11. [Power-ups & Pickups](#11-power-ups--pickups)
12. [Player Ship & Controls](#12-player-ship--controls)
13. [Multiplayer Modes](#13-multiplayer-modes)
14. [Boss Encounters](#14-boss-encounters)

---

## 1. Enemy Types

Enemies in GW3D are divided into categories based on behavior: Passive (don't directly chase), Hostile (chase the player), Endgame (high-threat), Special/Mode-specific, and Utility objects. All enemies kill on contact.

### 1.1 Passive Enemies

| Name | Also Known As | Shape/Color | Behavior | Health | Score | Geoms | Special |
|------|--------------|-------------|----------|--------|-------|-------|---------|
| **Wanderer** | Pinwheel, Fan | Purple spinning fan/pinwheel (slightly blue tint in GW3D) | Wanders randomly at moderate speed, bounces off walls. Only alters direction toward player very slightly. Highly predictable. | 1 hit | 5 | 2 | Easiest enemy. Speed increases near active Gravity Wells. |
| **Duck** | Pink Square, Paper, Doubles | Pink square that flips its sprite | Moves 1 square per cardinal direction; slowly follows player diagonally. Bounces off walls. | 1 hit | 5 | 2 | Very slow (~1 sq/s). |
| **Rocket** | Arrow, Airplane | Pointed arrow shape with orange trail | Travels in a fixed straight direction at high speed (~10 sq/s). Reverses direction at walls. Leaves a trail. | 1 hit | 15 | 4 | Non-tracking. Predictable linear path. |
| **Neutron** | Top, Gyroscope, Deflector | Spinning top / heptagonal shape | Spawns with random direction, moves in a straight line reflecting perfectly off walls at ~8 sq/s. Essentially an upgraded Wanderer. | 1 hit | 10 | 2 | Perfect wall reflections. |
| **Golden Gear** | Yellow Cross | Spinning yellow cross shape | Wanders slowly until geoms appear on field. Pursues and consumes geoms. After consuming enough, accelerates and explodes. | 1 hit | 10 | 1 | Eats geoms (reduces player multiplier income). |
| **NUFO** | Yellow Circle, Diamond | Yellow circle / fast-moving shape | Spawns in hordes outside the map. Travels straight across at high speed with minor position shuffling. Exits map if not killed. Does not return. | 1 hit | 300 | 0 | One-way transit. No geoms dropped. Appears and disappears quickly. |

### 1.2 Hostile Enemies (Chase Player)

| Name | Also Known As | Shape/Color | Behavior | Health | Score | Geoms | Special |
|------|--------------|-------------|----------|--------|-------|-------|---------|
| **Grunt** | Blue Diamond, Rhombus | Blue diamond shape (stretches as it moves) | Directly pursues player. Starts slow (~4 sq/s) but accelerates over time. After 1 min: matches player speed (~9.5 sq/s). After 2 min: exceeds double player speed (~20 sq/s). | 1 hit | 10 | 2 | Gets progressively faster. Most dangerous in large swarms at high time. The only enemy in classic Pacifism. |
| **Mayfly** | Jacks, Tiny Triangle, Dorito | Small orange/tiny triangular pyramids | Spawn in hordes. Track the player but "tilt" while moving, creating erratic trajectories. Slow and sporadic movement. | 1 hit | 5 | 2 | Very small (hard to see). Overlapping collision allows single bullet to kill multiple stacked mayflies. |
| **Weaver** | Green Diamond, Green Square, Dodger | Green diamond-like shape | Pursues player at ~0.8x player speed (up to 10 sq/s). **Dodges incoming bullets** by weaving side-to-side. Moves faster in GW3D than prior games. Strong wall bounces. | 1 hit | 25 | 2 | Bullet-dodging is the key mechanic. Corner them against walls to prevent dodging. Don't bunch up as tightly in GW3D. |
| **Spinner** | Pink Box, Pink Octahedron | Pink 3D octahedral box | High-speed pursuit with inertia (slows on turns). ~11 sq/s. Similar to Weaver but more exaggerated movement. **Spawns 3 smaller spinners on death.** | 1 hit (parent) | 25 (parent), 10 (child) | 2 (parent), 1 (child) | Children explode outward up to 3 squares and orbit quickly in trinary system pattern. Total: 75 score + 5 geoms if all killed. |
| **Proton** | Black Hole Spawn, Blue Springs | Small spherical/spring shape, blue | Spawned in groups of 6-9 from Gravity Well explosions. Swift pursuit (~28.5 sq/s top speed) with slower turning radius. | 1 hit | 10 | 1 | Only spawned by Gravity Wells. Very fast but poor turning. |
| **UFO** | Flying Saucer | Flying saucer shape | Straight-line pursuit toward player at extreme speed (~38 sq/s). Disappears if it misses (exits map). | 1 hit | 2,800 | 20 | Extremely rare, extremely fast, extremely high value. |

### 1.3 Special Behavior Enemies

| Name | Also Known As | Shape/Color | Behavior | Health | Score | Geoms | Special |
|------|--------------|-------------|----------|--------|-------|-------|---------|
| **Snake** | Worm | Segmented worm with blue head, body segments in other colors | S-shaped sinusoidal motion toward player. Coils at walls. Body segments absorb all fire. **Only the blue head is vulnerable.** | 1 hit (head only) | 35 | 7 | Body segments block stray bullets, protecting other enemies behind them. Very dangerous in groups. |
| **Repulsor** | Rhino, Charger, Dasher, Hornet | Orange-tipped front (invulnerable), blue rear section (vulnerable) | Locks onto player, charges at >4x player speed (~38 sq/s) for 2 seconds. Then reorients and repeats. **Only blue rear is killable; orange front is invulnerable.** | 1 hit (blue section) | 425 | 8 | Strongest wall bounce. Must shoot from behind or side. One of the most dangerous enemies. |
| **Battenberg** | Leaf, Two-part diamond | Rounded diamond comprising 2 purple diamonds + 2 yellow circles | Travels in straight lines, reflects off surfaces. **When shot, splits into 4 parts**: 2 purple Tracking Darts (chase player at high speed, wide turning circle) and 2 yellow Blockers (hover slowly near split location). | 1 hit (triggers split) | Unknown (multi-part) | Unknown | Introduced in GW3D. Composite enemy requiring strategic approach. Purple parts aggressive, yellow parts passive obstacles. |
| **Spawner** | Large geometric structure | Circular shape, alternates red (indestructible) and green (destructible) | Red phase: spawns enemies, cannot be killed. Green phase: stops spawning, can be killed. If not killed in green phase, returns to red and spawns MORE enemies than before. | Kill in green phase | Unknown | Unknown | Cyclical invulnerability. Escalating threat if ignored. Only in "Spawn" and "Spawners Revenge" levels. |
| **Gravity Well** | Black Hole | Blue circle with multiple layers (GW3D) | Inactive: hovers slowly toward player. Activated when hit by bullet: begins sucking in enemies and warping gravity. Bullets curve around it. Requires sustained close-range fire to destroy. If too many enemies sucked in, it explodes releasing a swarm of Protons. | Multiple hits | 500+ (scales with consumed enemies) | Variable (scales) | More enemies consumed = more score + geoms. Kills player on collision in both states. Bends bullet trajectories. |

### 1.4 Mode-Specific Enemies

| Name | Shape/Color | Behavior | Mode |
|------|-------------|----------|------|
| **Gate (Small)** | Two orange pointed tips with white passage line between them | Slowly moves and rotates. Lethal if player touches tips. Player must pass through the white line between tips to trigger explosion killing nearby enemies. Yellow variant gives higher rewards. | Pacifism, general |
| **Gate (Large/Stationary)** | Fixed larger gate | Same as gate but does not move or rotate. | Ultimate |
| **Golden Gate** | Enhanced gate variant, golden | Same as gate with higher rewards. Disappears after 7 seconds. | General |
| **Mine Layer** | Mobile mine-dropping unit | Moves in random step-based directions. Drops mines that activate on player contact. Mines explode in radius killing enemies and chain-reacting other mines. | General |
| **Cell Mass / Virus** | Green pentagons (virus) + giant with orange core (cell) | Viruses multiply at 1 pentagon/second. Cells are giant enemies that absorb bullets; must target orange core. Viruses don't drop geoms. | Specific levels |
| **Painter** | Geometric form | Spawns randomly, paints the ground orange as it moves. Game ends if too much ground is painted or player touches painter. | Rainbow mode only |
| **Red Cube** | Various-sized red cubes | Moves very slowly. Blocks bullets. Cannot be killed. Lethal on contact. | Specific levels |
| **Red Wall** | Permanent geometric barriers | Static structures. Kill on touch. | Specific levels |
| **Cannon** | Stationary weapon form | Stands still, shoots bullets toward the player. | Ultimate/Hardcore only |
| **Clone Spawner** | Mobile enemy replicator | Chases player and spawns clones of currently alive enemy types. | Ultimate/Hardcore only |
| **Clones** | Enemy duplicates with yellow cells/black background | Chase player at very high speed. Generated by Clone Spawners. | Ultimate/Hardcore only |
| **Cheeseburger** | Smallest enemies in game | Spawn in large hordes that pile into a ball. Each hit removes only one unit. Requires bullets equal to group size. | Ultimate/Hardcore only |
| **Credit** | Geometric form | Moves upward when spawned. Non-aggressive but lethal on contact. | Bonus credits level |

### 1.5 Enemy Score/Geom Summary Table

| Enemy | Base Score | Geoms Dropped | Notes |
|-------|-----------|--------------|-------|
| Wanderer | 5 | 2 | |
| Duck | 5 | 2 | |
| Mayfly | 5 | 2 | |
| Grunt | 10 | 2 | |
| Neutron/Deflector | 10 | 2 | |
| Golden Gear | 10 | 1 | |
| Proton | 10 | 1 | |
| Rocket | 15 | 4 | |
| Weaver | 25 | 2 | |
| Spinner (parent) | 25 | 2 | +3 children at 10 pts / 1 geom each |
| Snake | 35 | 7 | Head only |
| Gate | 50 | 6 | Pass through to activate |
| Spinner (total) | 55 | 5 | Parent + 3 children |
| NUFO | 300 | 0 | No geoms |
| Repulsor | 425 | 8 | Rear only |
| Golden Gate | 500 | 20 | |
| Gravity Well | 500+ | Variable | Scales with consumed enemies |
| UFO | 2,800 | 20 | Extremely rare |

---

## 2. Maps / Surfaces

GW3D introduced 3D surfaces as playable arenas, replacing the traditional flat rectangular grid. The game features **15 3D grids** (10 original + 5 added in Evolved update). Players traverse the surface of these geometric shapes.

### 2.1 Confirmed Surface Types

| # | Shape | Description | Visual | Notes |
|---|-------|-------------|--------|-------|
| 1 | **Flat Plane** | Traditional 2D rectangular grid (classic style) | Blue/cyan grid on dark background | Used in Classic mode and some Adventure levels |
| 2 | **Sphere** | Full 3D sphere surface | Grid-wrapped sphere | Most iconic GW3D surface. 360-degree play. Bullets travel great circles. |
| 3 | **Cube** | Six-faced cube surface | Grid on each face | Players traverse all 6 faces. Creates blind spots on other sides. |
| 4 | **Cylinder** | Tube/barrel shape | Grid wrapped around cylinder | Players can loop around. Open or capped ends vary by level. |
| 5 | **Torus** | Donut shape | Grid on donut surface | Continuous loop in both directions. Complex curvature. |
| 6 | **Peanut / Dumbbell** | Two bulbous ends connected by narrow neck | Hourglass/peanut grid | Level 11: "Peanut Dreams". Narrow passage creates chokepoints. |
| 7 | **Capsule / Sausage / Hot Dog** | Cylinder with rounded hemispherical caps | Elongated pill shape | Level 6: "Sausage Smash". Smooth surface transition at caps. |
| 8 | **Plus / Cross** | Plus-sign shaped surface | Cross-shaped flat grid with extensions | Creates corridors and intersections. |
| 9 | **Cone** | Conical surface | Grid on cone | Narrows toward apex. |
| 10 | **Flower / Star** | Multi-lobed organic shape | Petal-like surface extensions | Complex curvature with multiple lobes. |
| 11 | **Icosahedron** | 20-faced polyhedron | Faceted spherical grid | More angular than sphere. |
| 12 | **Dome / Hemisphere** | Half-sphere surface | Open bowl shape | Level 33: "Dome of Doom". Edge boundaries. |
| 13 | **Hexagonal Prism** | Six-sided column | Hexagonal cross-section tube | |
| 14 | **Barrel / Rounded Cube** | Cube with rounded edges | Smooth transitions between faces | |
| 15 | **Twisted / Mobius-like** | Twisted band surface | Distorted grid | Level 3: "Twisted Blister" |

### 2.2 Surface Common Features

- **Grid pattern**: All surfaces display a visible grid that deforms with gameplay events
- **Neon aesthetic**: Cyan/blue primary grid color with dark background
- **Deformation**: Grid warps on enemy deaths, bomb usage, gravity wells, and bullet impacts
- **Spring system**: Grid vertices connected by springs with mass/damping for rubber-sheet effect
- **World rotation**: Some surfaces rotate slowly during gameplay
- **Color themes**: Different levels may tint the grid color (matches gem section theme)

### 2.3 Surface Gameplay Impact

- **3D surfaces create blind spots** - enemies spawn on unseen sides
- **Curvature affects bullet trajectories** - bullets follow surface geodesics
- **Narrow passages** (peanut, plus) create chokepoints for strategy
- **Continuous surfaces** (sphere, torus) have no edges/boundaries
- **Open surfaces** (flat plane, dome) have lethal or bouncing boundaries

---

## 3. Game Modes

GW3D features game modes across four hub categories: Adventure, Classic, Ultimate, and Hardcore. Each mode has specific rules, starting conditions, and enemy pools.

### 3.1 Adventure Mode Game Types

These appear as level types within the 50-level Adventure campaign:

| Mode | Objective | Lives | Bombs | Supers | Key Rules |
|------|-----------|-------|-------|--------|-----------|
| **Deadline** | Score as high as possible before time expires | Infinite | Limited | Limited | Time-limited. Pure score challenge. |
| **Evolved** | Reach target score with limited lives | 3 | 1 | 1 | Standard combat. Earn extra lives/bombs at score thresholds. |
| **Checkpoint** | Kill all enemies per wave to earn time extensions | Infinite | 1 | 1 | Very short timer (1-15 sec). Wave-based. Dying incurs time penalty. |
| **Titan** | Reach target score; all enemies spawn as giant titans | 1 | 1 | 1 | Large enemies split into 4 medium, then 8 normal. One life only. |
| **Pacifism** | Reach score without shooting | 1 | 0 | 0 | No guns. Kill enemies by passing through gates. Only grunts + gates (in classic). Adventure adds Weavers, Wanderers, NUFOs, Rhinos. |
| **King** | Score target; can only shoot inside safe zones | 1 | 0 | 0 | King zones scattered on map. Zones disappear 5 seconds after player enters. Must move between zones. |
| **Rainbow** | Reach score before painters cover too much ground | 1 | 1 | 1 | Painter enemies paint ground orange. Game ends if coverage threshold hit. |
| **Sniper** | Reach score with limited ammunition | 1 | 0 | 0 | Fixed ammo count. Game ends when ammo depleted or player dies. |
| **Claustrophobia** | Survive as walls close in | 1 | 1 | 1 | Playing field shrinks over time. Increasingly cramped. |
| **Boss** | Defeat the boss before time expires | 1 | 1 | 1 | Multi-phase boss with health bars. Boss spawns enemy waves. |

### 3.2 Classic Mode (6 Game Types)

Pure versions of classic game modes - **no drones, no supers** (except Retro Evolved). All played on flat 2D plane.

| Mode | Rules | Starting Conditions |
|------|-------|-------------------|
| **Deadline Classic** | 3 minutes to score as high as possible | Infinite lives, 3 bombs (non-renewable) |
| **Evolved Classic** | Score as high as possible | 3 lives, 3 bombs. Earn extras at score thresholds. |
| **King Classic** | Shoot only inside king zones | 1 life, no bombs |
| **Pacifism Classic** | No guns, kill with gates | 1 life, no bombs. Only Grunts + Gates. |
| **Waves Classic** | Survive continuous dart/line waves | 1 life, no bombs. Waves increase in frequency and coverage. |
| **Retro Evolved Classic** | Score with 3 lives (no geoms) | 3 lives. Multiplier increases through kills, resets on death. Weapon upgrades at 10,000 points. |

### 3.3 Ultimate Mode (40 levels, Evolved Update)

Organized into 4 chapters of 10 levels each, ending with boss fights. Includes all Adventure game types plus two new exclusive modes:

| Mode | Rules | Notes |
|------|-------|-------|
| **Scorpion** | Cannot shoot. Leave a "laser wire" trail that destroys enemies on contact. Trail has limited length. | 1 life, no supers, no bombs, no drones. Similar to Pacifism but with trail mechanic instead of gates. |
| **Stock** | Limited ammunition shown on ship. Collect ammo crates for more bullets. | Infinite lives, 1 bomb, no supers. Ammo management is key. |

**Ultimate Mode Chapters:**
- **Nephrite** (Levels 1-10): Mixed modes including Deadline, Scorpion, Rainbow, King, Pacifism, Titan + Boss
- **Aventurine** (Levels 11-20): Evolved, Claustrophobia, Stock, Titan + Boss
- **Purpurite** (Levels 21-30): Sniper, Checkpoint, Deadline, Evolved + Boss
- **Eudialyte** (Levels 31-40): Mixed modes + Final Boss

### 3.4 Hardcore Mode (20 levels)

Remixed levels from Adventure and Ultimate - **no drones, no supers allowed**. Separate leaderboard. Ends with 1 boss (Topaz). Designed for series purists.

---

## 4. Weapons & Drones

### 4.1 Player Weapons

The player ship fires a standard stream of bullets by default. **Weapons are not permanently selected** - instead, temporary weapon upgrades come from Super States (see Section 6). The base weapon fires twin parallel projectile streams in the aim direction.

**Base Weapon Characteristics:**
- Twin parallel bullet streams
- Moderate fire rate
- Bullets destroy most enemies in 1 hit
- Bullets travel in straight lines (on 3D surfaces, follow geodesic/great-circle paths)
- Bullets despawn after a set distance/time

**In Retro Evolved Classic**, the weapon upgrades automatically at 10,000 points (wider spread, faster fire rate).

### 4.2 Drones (6 Types)

Drones are permanent companion units that orbit/follow the player. Selected before each level. Available in all modes EXCEPT Classic and Hardcore. Each can be upgraded 4 times. Unlocked by earning stars and beating bosses.

| Drone | Behavior | Upgrade Effect | Strategy |
|-------|----------|---------------|----------|
| **Attack** | Shoots in the same direction as the player. Fires identical bullets. | Increases gun count and fire rate. Fully upgraded: effectively doubles firepower. | Best for pure damage output. Use on levels with many enemies. |
| **Collect** | Flies around independently collecting geoms. Does not attack. | Increases speed and collection radius. Maxed: exceeds player speed. | Best for score-focused play. Lets player focus on combat while geoms are auto-collected. |
| **Ram** | Seeks and destroys enemies by flying into them. Acts independently. | Increases detection range and movement speed. | Good bodyguard. Effective near walls and tight spaces. |
| **Snipe** | Autonomously targets and fires precise rays at enemies. Slow but accurate. | Increases ray count and fire frequency. Maxed: 3 rays per 0.5 seconds. | Good for precision. Handles stragglers. |
| **Defend** | Shoots in the opposite direction from the player. Fires identical bullets backward. | Increases bullet spread and count. | Covers the player's rear. Good for kiting strategies. |
| **Sweep** | Circles the player's ship, destroying enemies on contact. | Increases orbit speed and radius. | Close-range protection. Good for dense swarm levels. |

**Drone Unlock Progression:** Drones unlock sequentially as the player earns stars across game modes. Beating Adventure bosses also unlocks upgrade tiers.

**Drone Upgrade System:** Each drone has 4 upgrade levels. Upgrades are purchased using accumulated stars. Higher levels significantly increase effectiveness.

---

## 5. Supers (Special Abilities)

Supers are activated abilities with limited uses per level. Selected before each level alongside drone. Activated via LT/L2 (controller) or Q (keyboard). Available in all modes EXCEPT Classic and Hardcore. Each can be upgraded 4 times.

| Super | Effect | Duration | Upgrade Effect | Strategy |
|-------|--------|----------|---------------|----------|
| **Homing** | Releases a large swarm of homing missiles from the drone that seek and destroy nearby enemies. | Short burst | More missiles and higher fire rate | Good panic button. Does not affect bosses or enemies behind walls. |
| **Miner** | Drops mines at the drone's location at regular intervals. Mines detonate when enemies pass over them. | Sustained over time | Increased deployment frequency (blast radius unchanged) | Set up defensive perimeters. Chain reactions possible when mines placed near each other. |
| **Black Hole** | Creates a black hole at the drone's location that sucks in nearby enemies and destroys them. Explodes at end. | Medium | Increased duration and explosion strength | Does not affect bosses. Good crowd control. |
| **Turret** | Spawns a stationary turret at the drone's location that fires bullets in clockwise rotation. | Medium | Increased bullet count and fire rate | Area denial. Good for holding chokepoints. |
| **Clone** | Creates a duplicate of the player's drone (same type and upgrade level). | Timed | Increased clone duration | Doubles drone effectiveness. Best with Attack or Snipe drones. |
| **Detonator** | Transforms drone into mobile detonator that homes on enemies, releases periodic explosions, then detonates massively. Drone respawns after. | Until detonation | Increased explosion radius, reduced respawn time | Aggressive option. Temporarily lose drone. |

**Super Unlock Progression:** Supers unlock by earning stars. Each super has 4 upgrade levels.

---

## 6. Super States (Temporary Power-ups)

Super States are temporary in-game power-ups that appear during gameplay. They manifest as a pattern of small dots on the playing field. **To activate: destroy ALL dots before they fade.** Touching a dot kills the player. Duration: **12 seconds** once activated. Multiple super states can stack simultaneously.

### 6.1 The Seven Super States

| Super State | Rarity | Effect | Details |
|-------------|--------|--------|---------|
| **Quad Fire** | Common | Adds 2 extra projectiles per shot + significantly increased fire rate | Massive damage boost |
| **Split Fire** | Common | Adds 2 projectiles firing at 45-degree angles from ship front | Wider coverage, good for crowds |
| **Reverse Fire** | Uncommon | Adds rear-facing gun firing 3 projectiles backward | Covers retreat direction |
| **Missile** | Uncommon | Fires 2 homing missiles per second automatically alongside main gun | Minor area damage on impact |
| **Trail Bomb** | Rare | Ship produces medium explosions periodically as it moves | Blast radius similar to Miner mines |
| **Magnet** | Uncommon | Geoms automatically fly toward the ship from much larger distance | Dramatically increases geom collection |
| **Shield** | Very Rare | Player becomes invulnerable. Can ram enemies for instant destruction. | No points awarded for rammed enemies. Geoms still drop. |

### 6.2 Super State Mechanics

- **Spawn**: Appear as dot patterns at random locations on the playing field
- **Activation**: Destroy ALL dots to receive the power-up
- **Danger**: Touching any dot = instant death
- **Duration**: 12 seconds per activation
- **Stacking**: Multiple active super states combine effects
- **Drones unaffected**: Drones do not benefit from super state effects
- **Fixed order**: In Adventure/Ultimate modes, super states appear in a predetermined sequence
- **Strategic delay**: Can leave some dots undestroyed to delay activation timing

---

## 7. Scoring System

### 7.1 Core Mechanics

The scoring system revolves around the **Geom Multiplier**:

```
Final Score per Kill = Base Enemy Score x Current Multiplier
```

### 7.2 Geoms

- **Appearance**: Small green diamond/shard shapes
- **Spawn**: Drop from defeated enemies (1-3 per standard enemy, more from advanced enemies)
- **Large Geoms**: Dropped by boss-tier/large enemies, worth **+10x multiplier** each
- **Standard Geoms**: Worth **+1x multiplier** each
- **Despawn Time**: ~3 seconds if uncollected (varies slightly by mode)
- **Collection**: Move ship to geom location, or use Collect drone / Magnet super state

### 7.3 Multiplier System

- Starts at **1x** at beginning of each level
- Each standard geom collected: **+1x**
- Each large geom collected: **+10x**
- **Multiplier persists through the level** (does not reset on wave changes)
- **Multiplier resets to 1x on death** (in modes with multiple lives)
- Skilled players can reach multipliers in the **ten-thousands**
- Example: 50 base score x 10,000 multiplier = 500,000 points per kill

### 7.4 Score Thresholds (Evolved Mode)

Extra lives and bombs are earned at powers of 10 starting at 100,000:

| Score | Reward |
|-------|--------|
| 100,000 | +1 Life, +1 Bomb |
| 1,000,000 | +1 Life, +1 Bomb |
| 10,000,000 | +1 Life, +1 Bomb |
| 100,000,000 | +1 Life, +1 Bomb |
| (continues...) | |

### 7.5 Bombs and Scoring

- **Bombs do NOT award points** for enemies killed
- Bombs DO cause enemies to drop geoms
- Bombs are purely defensive tools, not score-maximizers
- Strategic use: detonate bomb in dense crowd to collect geoms, building multiplier for subsequent manual kills

### 7.6 Gate Scoring (Pacifism)

- Passing through gates in quick succession multiplies the gate kill score
- Consecutive gate use creates score chains
- Gates provide a 4.5x score multiplier bonus for enemies caught in the explosion

### 7.7 Gravity Well Scoring

- More enemies consumed by the well before destruction = higher score + more geoms
- The well's score scales with the number of enemies it absorbed
- Risk/reward: feeding the well too many enemies causes it to explode into dangerous Protons

---

## 8. Spawning System

### 8.1 General Spawning Behavior

- Enemies "warp in" from above the playing field (visual warp-in effect)
- A **faint warning glow** appears at the spawn location before enemy materializes
- The warning is intentionally subtle/barely visible to maintain tension
- Enemies frequently **spawn close to the player** (a GW3D design choice increasing difficulty)
- On 3D surfaces, enemies can spawn on the **dark/unseen side**, creating blind-spot danger

### 8.2 Spawn Locations

| Location Type | Description | Modes |
|---------------|-------------|-------|
| **Corner spawns** | Enemies appear at the 4 corners of the playing field | Classic modes, flat plane levels |
| **Edge spawns** | Enemies appear along the edges/borders | General |
| **Random surface** | Enemies appear at random points across the surface | 3D surface levels |
| **Cluster spawns** | Groups of same-type enemies appear together | Wave-based modes |
| **Circular spawns** | Ring of enemies appears around the player | Evolved mode periodic waves |
| **Boss spawns** | Boss spawns enemy waves as part of its attack | Boss levels |

### 8.3 Wave Structure

- **Adventure Deadline**: Enemies spawn in waves with increasing frequency tied to survival time and kill count
- **Adventure Evolved**: Random intervals (1-5 seconds) + periodic waves from corners or circular around player
- **Checkpoint**: Fixed wave sequences. All enemies in a wave must be killed to earn time.
- **Titan**: Waves of giant titan versions of standard enemies
- **Classic Evolved**: Random spawns that increase in rate and enemy type variety over time

### 8.4 Difficulty Progression

- **Within a level**: Enemy spawn rate increases over time
- **Enemy variety increases**: Early waves are simple (Wanderers, Grunts), later waves introduce complex enemies (Snakes, Repulsors, Spinners)
- **Enemy speed increases**: Some enemies (especially Grunts) accelerate the longer they survive
- **Quantity scaling**: Later waves spawn larger groups
- **Adventure cross-level**: Later sections (Amethyst, Topaz) have dramatically higher baseline difficulty
- **Gravity wells and Spawner enemies** create cascading difficulty spikes

### 8.5 Spawn Timing After Death

- Dying **clears all enemies** from the field
- **May reset the enemy wave** (depends on specific level/mode)
- Brief respawn period before new enemies begin appearing
- Time is "wasted" during the respawn animation as enemies aren't spawning to be scored

---

## 9. Level Progression (Adventure Mode)

### 9.1 Structure

- **50 total levels** organized into **6 sections** (named after gemstones)
- Each section ends with a **Boss level**
- Each level has a specific **game mode** and **3D surface**
- **3-star rating system** per level based on score thresholds
- Stars are the universal currency for unlocking content (drones, supers, upgrades)
- At least **1 star required** to unlock the next level

### 9.2 Complete Level List

#### Sapphire (Levels 1-5)

| # | Level Name | Mode | Notes |
|---|-----------|------|-------|
| 1 | The Beginning | Deadline | Tutorial/intro level |
| 2 | Dead Planet | Deadline | |
| 3 | Twisted Blister | Evolved | |
| 4 | Soul Window | Deadline | |
| 5 | **Sapphire (Boss)** | Boss | First boss encounter |

#### Ruby (Levels 6-10)

| # | Level Name | Mode | Notes |
|---|-----------|------|-------|
| 6 | Sausage Smash | Deadline | Capsule/sausage surface |
| 7 | Maze | Checkpoint | |
| 8 | Titan World | Titan | First Titan mode |
| 9 | Sweep | Deadline | |
| 10 | **Ruby (Boss)** | Boss | |

#### Emerald (Levels 11-20)

| # | Level Name | Mode | Notes |
|---|-----------|------|-------|
| 11 | Peanut Dreams | Deadline | Peanut/dumbbell surface |
| 12 | Gate Dash | Pacifism | First Pacifism |
| 13 | King Hot Dog | King | First King mode, capsule surface |
| 14 | Cubism | Rainbow | First Rainbow mode |
| 15 | Equator | Deadline | |
| 16 | Pianola Roller | Evolved | |
| 17 | Rock | Evolved | |
| 18 | Spawn | Evolved | Features Spawner enemies |
| 19 | Infected | Evolved | |
| 20 | **Emerald (Boss)** | Boss | |

#### Opal (Levels 21-30)

| # | Level Name | Mode | Notes |
|---|-----------|------|-------|
| 21 | King Pond | King | |
| 22 | Hexawave | Sniper | First Sniper mode |
| 23 | Out of Time | Checkpoint | |
| 24 | Nufo Flow | Pacifism | Features NUFOs |
| 25 | Intensity | Evolved | |
| 26 | The Scream | Claustrophobia | First Claustrophobia |
| 27 | Abstract | Rainbow | |
| 28 | Barrel Roll | Deadline | Barrel/cylinder surface |
| 29 | Planet of Peace | Pacifism | |
| 30 | **Opal (Boss)** | Boss | |

#### Amethyst (Levels 31-40)

| # | Level Name | Mode | Notes |
|---|-----------|------|-------|
| 31 | Repulsive | Evolved | Repulsor enemies featured |
| 32 | Titans Revenge | Titan | |
| 33 | Dome of Doom | Deadline | Dome/hemisphere surface |
| 34 | Infected Planet | Evolved | |
| 35 | Endurance | Deadline | |
| 36 | Trash Compactor | Claustrophobia | |
| 37 | Expressionism | Rainbow | |
| 38 | Mind the Gap | Evolved | |
| 39 | Hexend | Checkpoint | |
| 40 | **Amethyst (Boss)** | Boss | |

#### Topaz (Levels 41-50)

| # | Level Name | Mode | Notes |
|---|-----------|------|-------|
| 41 | Limit Twist | Sniper | |
| 42 | Running in the Family | Evolved | |
| 43 | Crushed | Deadline | |
| 44 | Turbine Cube | Evolved | Cube surface |
| 45 | Deflector | Evolved | Neutron/Deflector enemies |
| 46 | Super Rock Crust | Checkpoint | |
| 47 | Royal Disease | King | |
| 48 | Spawners Revenge | Deadline | Features Spawner enemies |
| 49 | Super Sequence | Evolved | |
| 50 | **Topaz (Boss)** | Boss | Final boss |

### 9.3 Star System

- **1 Star**: Minimum score threshold. Required to unlock next level.
- **2 Stars**: Medium score threshold.
- **3 Stars**: High score threshold. "Geometry Warrior" achievement for 3-starring all 50 levels.
- Stars accumulate across all modes and are used to unlock drones, supers, and upgrades.
- Total collectible stars: 150 (Adventure) + 120 (Ultimate) + 60 (Hardcore) = 330 stars

### 9.4 Boss Level Conditions

- **1 life** per attempt
- Usually 1 bomb and 1 super
- **Timed**: must defeat boss before time expires (timer reaching 0 = instant death shockwave)
- Boss has **multiple health bars** (approximately 5 phases)
- Boss shields itself between phases (crystal shield, lethal barrier)
- Each new phase: shield drops, new health bar, additional time added to clock
- Boss spawns enemy waves during shielded phases
- Some bosses spawn sub-bosses that must be killed before main boss becomes vulnerable

---

## 10. Visual Effects

### 10.1 Neon Aesthetic

GW3D's signature look is built on a **neon vector aesthetic**:

- All game elements (ship, enemies, bullets, grid) have a **glowing neon outline/aura**
- Dark/black background contrasts with bright neon colors
- Each enemy type has a **unique neon color** for instant identification
- The overall palette: cyan (player/grid), blue (grunts), green (weavers), purple (wanderers), pink (spinners), orange (rockets/repulsors), yellow (golden gears/gates)

### 10.2 Grid Deformation

The playing surface grid uses a **spring-mass-damper simulation**:

- **Grid structure**: Vertices at each grid intersection, connected by springs
- **Mass points**: Small weight at each intersection
- **Springs**: Pull only (like rubber bands), never push
- **Border anchoring**: Edge masses are fixed in place
- **Interior anchoring**: Gentle pull-back springs to restore grid to rest position
- **Stiffness**: Higher = faster oscillation
- **Damping**: Higher = faster return to rest

**Deformation triggers:**
- Enemy death: Outward push from kill location
- Bomb detonation: Large outward push from bomb center
- Gravity Well: Continuous inward pull toward well center
- Bullet impact: Small local deformation
- Player respawn: Radial shockwave push

### 10.3 Particle Effects

- **Enemy death**: Burst of colored particles matching enemy color, expanding outward
- **Bullet trails**: Short trailing particles behind each projectile
- **Ship trail**: Faint trailing effect behind the player ship
- **Geom sparkle**: Geoms emit small sparkle particles while active
- **Bomb explosion**: Large radial particle burst (white/multi-colored)
- **Gate explosion**: Directional particle burst when player passes through
- **Gravity Well**: Swirling particle vortex effect
- **Boss damage**: Particle bursts at boss health bar transitions
- **Spawn warp**: Particles at enemy spawn locations (warp-in effect)

### 10.4 Bloom / Glow

- **HDR bloom pass** applied to entire scene
- All neon elements emit light that bleeds into surrounding pixels
- Creates the characteristic "glowing wire" look
- Bloom intensity increases during high-action moments
- **Implementation note**: Bloom threshold must be carefully tuned - too low causes white-out, especially with additive blending on particles

### 10.5 Background Effects

- **Fog, clouds, waves, spirals** serve as dynamic backdrop
- Background shifts and moves with camera
- Color-themed per section (matches gemstone: blue/sapphire, red/ruby, green/emerald, etc.)
- Parallax layers create depth
- Background reacts subtly to gameplay events

### 10.6 Death Animations

- **Player death**: Ship explodes into fragments with particle burst. Screen flash. Grid shockwave ripple outward from death location.
- **Enemy death**: Enemy shape shatters/dissolves into particles of its color. Grid deformation at kill location. Geoms spawn at death point.
- **Bomb clear**: All enemies simultaneously explode. Massive grid deformation wave. Screen-wide particle effect.
- **Boss phase transition**: Crystal shield shatters with particle effect. Boss flashes/pulses.

### 10.7 Screen Effects

- **Screen shake**: On bomb use, boss transitions, large explosions
- **Flash**: Brief white flash on player death or bomb use
- **Slow-motion**: Brief slow-down on player death (dramatic effect)
- **Vignette**: Subtle darkening at screen edges

---

## 11. Power-ups & Pickups

### 11.1 Geoms

| Type | Appearance | Multiplier Value | Drop Source |
|------|-----------|-----------------|-------------|
| **Standard Geom** | Small green diamond/shard | +1x | Most enemies (1-3 per kill) |
| **Large Geom** | Larger green shard | +10x | Boss-tier enemies, high-value kills |

- Despawn after ~3 seconds if uncollected
- Can be collected by player proximity, Collect drone, or Magnet super state

### 11.2 Bombs

- **Not a pickup** in most modes (start with fixed count)
- Activated via dedicated button (RT/R2 or Space)
- **Clears all enemies on screen** (or within large radius on 3D surfaces)
- Enemies killed by bombs **drop geoms but award NO score points**
- Extra bombs earned at score thresholds (100k, 1M, 10M...) in Evolved mode
- **Smart Bomb** = official name

### 11.3 Extra Lives

- Earned at score thresholds (100k, 1M, 10M...) in modes that support multiple lives
- No life pickups drop from enemies

### 11.4 Super State Pickups

- Appear as dot patterns on the field (see Section 6)
- Destroying all dots grants temporary weapon/ability enhancement
- 7 types with varying rarity
- 12-second duration

### 11.5 Ammo Crates (Stock Mode Only)

- Appear on the field in Stock game mode
- Shooting them grants additional ammunition
- Critical resource in ammo-limited gameplay

---

## 12. Player Ship & Controls

### 12.1 Ship Appearance

- **Shape**: Claw/chevron shape (pointed front, two rear prongs)
- **Color**: White/bright (easily visible against dark background and neon enemies)
- **Size**: Small relative to enemies and playing field
- **Drone orbit**: Selected drone visibly orbits/follows near the ship

### 12.2 Controls (Twin-Stick Shooter)

| Action | Controller | Keyboard/Mouse |
|--------|-----------|----------------|
| Move | Left Stick | WASD |
| Aim/Shoot | Right Stick (auto-fires when tilted) | Mouse aim + Left Click |
| Bomb | RT / R2 | Space |
| Super | LT / L2 | Q |

### 12.3 Ship Mechanics

- **Movement**: Player moves on the surface in UV coordinates. Ship is always centered on screen.
- **Camera**: Follows player along surface normal. Camera "up" aligned to surface tangent.
- **Shooting**: Independent aim direction. Bullets fire from ship in aim direction.
- **Speed**: Moderate base speed. Consistent across surfaces.
- **Collision**: Any enemy contact = death (unless Shield super state active)

### 12.4 Respawn

- On death: **brief invincibility period** (protective bubble appears, blinks out)
- All enemies cleared from field on death
- Wave may reset depending on level/mode
- Multiplier resets to 1x
- Small time loss in timed modes
- Ship respawns at center/safe location

---

## 13. Multiplayer Modes

### 13.1 Local Co-op Campaign

- **Players**: 2-4 (local/couch only)
- **Levels**: 10 dedicated co-op levels (separate from Adventure mode)
- **Progression**: Linear with 1 boss fight at end
- **Scoring**: Individual multipliers, combined team score
- **Star ratings**: Based on combined team performance
- **Design**: Levels designed specifically for cooperative play (very difficult solo)

### 13.2 Competitive Multiplayer (Online)

Two competitive modes supporting up to **8 players** via public matchmaking or private matches:

| Mode | Rules | Players |
|------|-------|---------|
| **Stock** | Teams race to defeat a boss. Limited ammo - must pick up and pass ammo to teammates. First team to kill boss wins. | Up to 8 (teams) |
| **Summoner** | Teams capture control points to summon more enemies. Score more points than opposing team. | Up to 8 (teams) |

---

## 14. Boss Encounters

### 14.1 General Boss Mechanics

- **11 total boss fights** across all modes (6 Adventure, 4 Ultimate, 1 Hardcore)
- All boss levels named after **gemstones**
- Background and level icon color-matches the gemstone
- Boss has **~5 health bars** (phases)
- Boss is **lethal on contact**
- **Health bar** displayed at top of screen

### 14.2 Boss Phase Pattern

1. **Vulnerable Phase**: Boss is exposed. Player damages boss health bar.
2. **Shield Phase**: After health bar depleted, boss generates crystal shield (invulnerable). Spawns a red barrier (lethal to touch).
3. **Enemy Wave Phase**: Boss spawns waves of standard enemies while shielded. Player must survive/kill waves.
4. **Sub-Boss Phase** (some bosses): Boss spawns 4 sub-bosses. All must be destroyed before main boss becomes vulnerable again.
5. **Time Extension**: Defeating a health bar adds time to the clock.
6. **Repeat**: New health bar appears, boss becomes vulnerable again.

### 14.3 Boss Scoring Strategy

- **Delay the killing blow** to farm enemy waves for maximum geoms/score
- Each boss phase spawns different enemy types (oranges, snakes, blues, greens, etc.)
- Risk: letting timer hit 0 creates an **unavoidable instant-death shockwave**
- Balance: weaken boss but don't accidentally finish it with stray bullets while farming waves

### 14.4 Boss Levels by Mode

**Adventure Mode Bosses:**
| Level | Boss Name | Notes |
|-------|-----------|-------|
| 5 | Sapphire | First boss, relatively simple patterns |
| 10 | Ruby | |
| 20 | Emerald | |
| 30 | Opal | |
| 40 | Amethyst | |
| 50 | Topaz | Final boss, most complex |

**Ultimate Mode Bosses:**
| Level | Boss Name |
|-------|-----------|
| 10 | Nephrite |
| 20 | Aventurine |
| 30 | Purpurite |
| 40 | Eudialyte |

**Hardcore Mode Boss:**
| Level | Boss Name |
|-------|-----------|
| 20 | Topaz |

### 14.5 Boss Enemy Wave Types

During shielded phases, bosses spawn waves of standard enemies:
- Early phases: Grunts, Wanderers
- Mid phases: Snakes, Weavers
- Late phases: Mixed complex enemies
- Sub-boss variant: 4 sub-bosses spawn; killing each changes the enemy type spawned by remaining sub-bosses
- Enemy types escalate based on how many sub-bosses remain (e.g., all 4 alive = Blues; 2 alive = more dangerous types)

---

## Appendix A: Enemy Appearance Quick Reference

For visual implementation, here's a consolidated color/shape guide:

| Enemy | Primary Color | Shape | Neon Glow Color |
|-------|--------------|-------|-----------------|
| Wanderer | Purple (blue tint in GW3D) | Spinning fan/pinwheel | Purple |
| Duck | Pink | Square (flips sprite) | Pink |
| Rocket | Orange | Pointed arrow with trail | Orange |
| Neutron | Blue-white | Spinning top | Cyan-white |
| Golden Gear | Yellow | Spinning cross | Yellow |
| NUFO | Yellow | Circle/fast shape | Yellow |
| Grunt | Blue | Diamond/rhombus (stretches) | Blue |
| Mayfly | Orange | Tiny triangular pyramid | Orange |
| Weaver | Green | Diamond/square | Green |
| Spinner | Pink | 3D octahedron/box | Pink |
| Spinner Child | Pink (smaller) | Mini octahedron | Pink |
| Snake Head | Blue | Round head segment | Blue |
| Snake Body | Various | Chain of segments | Various |
| Repulsor Front | Orange | Pointed tip (invulnerable) | Orange |
| Repulsor Rear | Blue | Blunt rear (vulnerable) | Blue |
| Battenberg | Purple + Yellow | Rounded diamond (2 purple diamonds + 2 yellow circles) | Multi |
| Proton | Blue | Small sphere/spring | Blue |
| UFO | Multi | Flying saucer | Multi |
| Gate | Orange tips, white line | Two pointed tips with passage | Orange |
| Gravity Well | Blue | Circle with multiple layers | Blue-dark |
| Spawner (red) | Red | Circular (invulnerable) | Red |
| Spawner (green) | Green | Circular (vulnerable) | Green |
| Cell | Green + Orange core | Giant mass | Green |
| Painter | Various | Geometric form | Matches paint color |
| Red Cube | Red | Cube (various sizes) | Red |
| Cannon | Various | Stationary weapon | Various |
| Clone | Yellow cells, black bg | Duplicate of enemy | Yellow-tinted |

---

## Appendix B: Titan Mode Enemy Size Progression

When enemies appear as Titans, they follow this split chain:

```
Giant Titan (many hits to destroy)
    |
    v
4x Medium Titans (moderate hits)
    |
    v
8x Normal Enemies (1 hit each)
```

**Enemies that appear as Titans:**
Duck, Wanderer, Grunt, Weaver, Spinner, Deflector/Neutron, Battenberg (Ultimate/Hardcore), Snake (Ultimate "Cobraphobia" only)

---

## Appendix C: Mode Starting Conditions Summary

| Mode | Lives | Bombs | Supers | Drones | Special |
|------|-------|-------|--------|--------|---------|
| Deadline | Infinite | Limited | Limited | Yes | Time limit |
| Evolved | 3 | 1 | 1 | Yes | Earn extras at score thresholds |
| Checkpoint | Infinite | 1 | 1 | Yes | Very short timer, waves extend |
| Titan | 1 | 1 | 1 | Yes | Giant enemies |
| Pacifism | 1 | 0 | 0 | No | No shooting |
| King | 1 | 0 | 0 | Yes* | Shoot only in zones |
| Rainbow | 1 | 1 | 1 | Yes | Paint coverage limit |
| Sniper | 1 | 0 | 0 | No | Limited ammo |
| Claustrophobia | 1 | 1 | 1 | Yes | Shrinking field |
| Boss | 1 | 1 | 1 | Yes | Timed boss fight |
| Scorpion | 1 | 0 | 0 | No | Trail kills, no shooting |
| Stock | Infinite | 1 | 0 | Yes | Limited ammo, collect crates |
| Classic Deadline | Infinite | 3 | 0 | No | 3 minute time limit |
| Classic Evolved | 3 | 3 | 0 | No | Earn extras at thresholds |
| Classic King | 1 | 0 | 0 | No | Shoot only in zones |
| Classic Pacifism | 1 | 0 | 0 | No | No shooting, gates only |
| Classic Waves | 1 | 0 | 0 | No | Dart waves |
| Retro Evolved | 3 | 0 | 0 | No | No geoms, multiplier resets on death |
| Hardcore (any) | Varies | Varies | 0 | No | No drones or supers |

---

## Appendix D: Key Implementation Numbers

These are approximate values gathered from community guides for use in implementation:

### Player
- Base move speed: ~7 squares/second
- Ship collision radius: Small (roughly 0.5 grid squares)
- Invincibility on respawn: ~2-3 seconds
- Bullet speed: ~15-20 squares/second
- Fire rate: ~10 bullets/second (base)

### Enemies (approximate speeds in grid squares/second)
- Wanderer: ~3 sq/s
- Duck: ~1 sq/s
- Rocket: ~10 sq/s
- Neutron: ~8 sq/s
- Grunt (start): ~4 sq/s (accelerates to 9.5 at 1 min, 20+ at 2 min)
- Mayfly: ~2-3 sq/s (sporadic)
- Weaver: ~7.5-10 sq/s
- Spinner: ~11 sq/s
- Snake: ~5-6 sq/s (S-wave pattern)
- Repulsor (charge): ~38 sq/s
- Proton: ~28.5 sq/s
- UFO: ~38 sq/s
- NUFO: ~15-20 sq/s (straight line)

### Geom
- Despawn time: ~3 seconds
- Standard value: +1x multiplier
- Large value: +10x multiplier
- Typical drops per enemy: 1-3 standard geoms
- Collection radius: ~1 grid square (larger with Magnet super state)

### Super States
- Duration: 12 seconds
- Dot pattern despawn time: ~5-8 seconds if not activated
- Dot count per pattern: 4-8 dots

### Bombs
- Effect radius: Entire visible area / full surface side
- No score awarded for bomb kills
- Geoms still drop from bomb kills
- Grid deformation: Large outward ripple

---

*Document compiled from multiple community sources. Enemy names may vary from any internal/official naming conventions as Lucid Games did not publish an official enemy guide. Score values are approximate and derived from community testing.*

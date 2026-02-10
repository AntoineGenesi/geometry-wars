# Legal / IP Analysis: Releasing a Geometry Wars-Inspired Browser Game

**Date:** 2026-02-10
**Status:** Research Complete
**Verdict:** CONDITIONAL RELEASE -- safe with targeted changes

---

## Table of Contents

1. [IP Ownership Chain](#1-ip-ownership-chain)
2. [Trademark Analysis](#2-trademark-analysis)
3. [Patent Analysis](#3-patent-analysis)
4. [Copyright Analysis](#4-copyright-analysis)
5. [Trade Dress Analysis](#5-trade-dress-analysis)
6. [Entity-by-Entity Comparison](#6-entity-by-entity-comparison)
7. [Precedent Cases](#7-precedent-cases)
8. [Risk Assessment Summary](#8-risk-assessment-summary)
9. [Safe Release Checklist](#9-safe-release-checklist)
10. [Sources](#10-sources)

---

## 1. IP Ownership Chain

| Date | Event | Owner |
|------|-------|-------|
| 1999-2007 | Bizarre Creations develops GW series | Bizarre Creations |
| 2007 | Activision acquires Bizarre Creations (~$107M) | Activision |
| 2011 | Activision shuts down Bizarre Creations | Activision |
| 2014 | Lucid Games develops GW3: Dimensions (published by Sierra/Activision) | Activision |
| Oct 13, 2023 | Microsoft acquires Activision Blizzard ($75.4B) | **Microsoft** |

**Current IP holder: Microsoft Corporation** (via Xbox Game Studios / Activision).

This is a well-funded corporation with active legal departments. They have the resources and motivation to enforce IP rights on a major franchise, though Geometry Wars is a relatively small property in their portfolio.

---

## 2. Trademark Analysis

### "Geometry Wars" Name

- **"GEOMETRY WARS" is a registered trademark** of Activision Publishing, Inc. (now Microsoft).
- The name uses the TM/registered symbol on Steam, PlayStation Store, and official Activision pages.
- The mark has been used in commerce across GW1 (2003), GW:RE (2005), GW:RE2 (2008), GW:G (2007), GW3:D (2014), and GW3:DE (2015).

**Status:** The trademark appears to be active. Even if maintenance filings were missed, Microsoft could revive it given the brand's recognition. The name "Geometry Wars" is not generic -- it identifies a specific commercial product.

### What This Means for the Project

- **CRITICAL:** The game CANNOT be called "Geometry Wars" or anything confusingly similar (e.g., "Geometry Warfare," "Geo Wars," "GeoWars 3D," "Geometry Battle").
- Using the name would be textbook trademark infringement -- no defense exists.
- Even the project folder name "Geometry Wars" should be changed before any public release.
- The word "Geometry" alone is generic and safe. "Wars" alone is generic and safe. Combined as "Geometry Wars" they are not safe.

### Safe Name Examples

Names that evoke the genre without infringing:
- "Vector Storm" / "Neon Vortex" / "Grid Defense" / "Shape Assault" / "Luminous Arena"
- "Polaris" / "Tesseract" / "Prismatic" / "Radiant Swarm"
- Reference: "Sektori" (2025) was openly called "the new Geometry Wars" by press with no legal issues -- because it has its own distinct name.

---

## 3. Patent Analysis

### Game Mechanics Are Generally Not Patentable

Under U.S. law, abstract game rules and mechanics are generally not patentable (Alice Corp. v. CLS Bank, 2014). However, **specific technical implementations** can be patented.

### Potentially Patentable Elements in GW Series

| Mechanic | Patentable? | Risk |
|----------|-------------|------|
| Twin-stick shooting | No -- genre convention since Robotron (1982) | None |
| Shooting on 3D surface geometry | Unlikely -- mathematical application | Very Low |
| Grid deformation responding to entities | Possibly -- specific visual tech | Low |
| Neon wireframe aesthetic | No -- visual style is not patentable | None |
| Specific enemy AI patterns | No -- abstract ideas | None |
| Geom collection / multiplier system | No -- standard scoring mechanic | None |

### Patent Search Results

No specific patents by Bizarre Creations or Activision for Geometry Wars gameplay mechanics were found in public patent databases. While Activision Publishing holds patents (primarily for Call of Duty features like matchmaking and engagement-optimized systems), none appear to cover twin-stick shooting, 3D surface gameplay, or grid deformation effects.

**Notable gaming patents that DO exist (for reference):**
- Namco's loading screen minigame patent (expired 2015)
- Warner Bros. Nemesis System patent (Shadow of Mordor)
- BioWare's dialogue wheel patent
- Sega's directional arrows in racing games (expired)

**Conclusion:** Patent risk is very low. No known GW-specific patents exist, and the core mechanics (twin-stick shooting, grid-based arena, shape-based enemies) are genre conventions used widely.

---

## 4. Copyright Analysis

### What IS Protected by Copyright

1. **Source code** -- the literal code of GW3 is copyrighted
2. **Specific artwork** -- exact 3D models, textures, sprite designs
3. **Audio** -- specific sound effects, music tracks
4. **Level designs** -- specific level layouts (arrangement of surfaces, enemy wave patterns)
5. **Specific creative expression** -- the particular combination of visual elements that make GW3 recognizable

### What IS NOT Protected by Copyright

1. **Game mechanics / rules** -- how the game plays (Data East v. Epyx; Lotus v. Borland)
2. **Genre conventions (scenes a faire)** -- neon on black grid is now a genre convention used by dozens of games
3. **Abstract enemy behaviors** -- "chase the player," "bounce off walls," "dodge bullets"
4. **Color associations** -- blue = basic enemy, green = dodger, etc. (functional, not expressive)
5. **General gameplay concepts** -- twin-stick shooting, power-ups, score multipliers

### The Idea-Expression Dichotomy

Under copyright law, ideas cannot be copyrighted; only their specific expression can. A "blue diamond shape that chases the player and accelerates over time" is an idea. The specific pixel art, 3D model vertices, animation keyframes, and shader code of GW3's grunt is expression.

**Key principle (Atari v. Amusement World, 1982):** When similarities between games are necessary consequences of the shared genre/concept, they constitute scenes a faire (scenes that must be done) and are not protectable.

### Application to This Project

This project writes all code from scratch in TypeScript/Three.js, creates all 3D geometry programmatically via `GeometryBuilder` utilities, generates all audio via Web Audio synthesis, and designs original level layouts. No assets from GW3 are used. The copyright concern is about **substantial similarity of creative expression**, not literal copying.

---

## 5. Trade Dress Analysis

### What Is Trade Dress?

Trade dress protects the "total image and overall appearance" of a product that identifies the source. For video games, this can include the distinctive visual presentation that consumers associate with a specific game/developer.

### Can GW3's Visual Style Be Protected?

Requirements for trade dress protection:
1. **Distinctiveness** -- the look must be associated with the source
2. **Non-functionality** -- the look must not serve a utilitarian purpose
3. **Likelihood of confusion** -- consumers must plausibly think your game is GW3

**Arguments FOR protection:**
- GW's neon-on-black-grid aesthetic was distinctive when first released (2003)
- The combination of specific geometric shapes, specific colors, grid deformation, and bloom effects is recognizable

**Arguments AGAINST protection (stronger):**
- The neon twin-stick aesthetic is now a **genre convention** used by dozens of commercial games: Sektori (2025), Super Stardust, Resogun, Neon Chrome, Beat Hazard, Waves, Particle Mace, Ultratron, etc.
- Microsoft would need to prove consumers are confused into thinking YOUR game is an official GW product
- Browser game vs. console AAA title makes confusion unlikely
- Free vs. $15 makes confusion unlikely

**Assessment:** Trade dress risk is LOW to MODERATE. The aesthetic alone is not enough -- it is the combination of aesthetic + identical enemy roster + identical names + identical behaviors that creates risk.

---

## 6. Entity-by-Entity Comparison

### Comparison Methodology

For each enemy in our game, I compared: name, visual shape, color, behavior, and overall similarity to GW3 equivalents.

Risk levels:
- **HIGH** = Same name AND same look AND same behavior as GW3 enemy
- **MEDIUM** = Two of three match (name, look, or behavior closely mirrors GW3)
- **LOW** = Shares only genre conventions or has significant original elements
- **ORIGINAL** = No clear GW3 counterpart

### Direct GW3 Counterparts (HIGH RISK)

| Our Enemy | GW3 Enemy | Name Match | Visual Match | Behavior Match | Risk |
|-----------|-----------|------------|--------------|----------------|------|
| **Grunt** | Grunt (Blue Diamond) | EXACT | HIGH -- blue diamond shape, chases player | HIGH -- accelerates toward player | **HIGH** |
| **Wanderer** | Wanderer/Pinwheel (Purple Fan) | EXACT | HIGH -- purple pinwheel, random wander | HIGH -- wanders randomly, bounces | **HIGH** |
| **Spinner** | Spinner/Pink Box | EXACT | MEDIUM -- octahedron vs. cube, pink/magenta | HIGH -- chases with wobble, spawns 3 on death | **HIGH** |
| **Weaver** | Weaver (Green Diamond/Dodger) | EXACT | HIGH -- green diamond, momentum movement | HIGH -- dodges bullets, inertia-based | **HIGH** |
| **Snake** | Snake/Worm (Blue segmented) | EXACT | HIGH -- blue circles, segmented body | HIGH -- S-pattern, head-only vulnerable | **HIGH** |
| **Rocket** | Rocket/Arrow (Orange arrow) | EXACT | HIGH -- orange arrow, straight movement | HIGH -- straight-line, bounces off walls | **HIGH** |
| **Duck** | Duck (Pink Square) | EXACT | HIGH -- pink square, cardinal movement | HIGH -- flips in 4 directions | **HIGH** |
| **Mayfly** | Mayfly/Cheeseburger (Tiny triangle) | EXACT | MEDIUM -- green triangle vs. tiny mixed shape | MEDIUM -- swarm toward player | **HIGH** |
| **Neutron** | Neutron/Top (Spinning polygon) | EXACT | MEDIUM -- teal heptagon vs. gyroscope | HIGH -- bounces randomly, fast spin | **HIGH** |
| **Gate** | Gate (Orange endpoints) | EXACT | HIGH -- dashed line with orange endpoint circles | HIGH -- pass-through detonation | **HIGH** |
| **Spawner** | Spawner (Red cage) | EXACT | MEDIUM -- red/green box vs. red spawner | HIGH -- stationary, spawns enemies | **HIGH** |
| **Gravity Well** | Gravity Well (Black Hole) | EXACT | MEDIUM -- concentric circles vs. dark vortex | HIGH -- pulls entities, activates on hit | **HIGH** |
| **Repulsor** | Repulsor/Rhino (Orange+blue) | EXACT | HIGH -- orange front/blue rear arrow | HIGH -- charge attack, rear vulnerable only | **HIGH** |
| **Virus** | Virus/Pentagon (Green) | EXACT | MEDIUM -- green octahedron vs. pentagon | HIGH -- multiplies, infects on contact | **HIGH** |
| **SpinnerSpawn** | Spinner Spawn (Tiny pink) | EXACT | HIGH -- small pink triangle, orbits parent | HIGH -- orbits spawn point after parent death | **HIGH** |
| **Boss** (gemstone phases) | Boss (GW3 has bosses) | PARTIAL | LOW -- dodecahedron gemstones are original design | MEDIUM -- multi-phase with shields is common | **MEDIUM** |

### Scaled Variants (MEDIUM RISK)

| Our Enemy | GW3 Equivalent | Risk | Notes |
|-----------|---------------|------|-------|
| **TitanGrunt** | Titan (GW3 has Titans) | MEDIUM | Name "Titan" is used in GW3; behavior is just a bigger grunt |
| **TitanSpinner** | Titan variant | MEDIUM | GW3 has Titan enemies that are larger versions |
| **TitanWeaver** | Titan variant | MEDIUM | Same pattern -- bigger weaver |
| **GiantWanderer** | Cell (absorbs, large) | LOW | GW3 has "Cells" (giant enemies) but mechanic differs |
| **GiantRocket** | No direct equivalent | LOW | Larger rocket is our original scaled variant |
| **GiantSnake** | No direct equivalent | LOW | Larger snake is our original scaled variant |
| **GiantNeutron** | No direct equivalent | LOW | Larger neutron is our original scaled variant |

### Original Enemies (LOW RISK)

| Our Enemy | GW3 Equivalent | Risk | Why Original |
|-----------|---------------|------|--------------|
| **Cluster** | None | **ORIGINAL** | Multi-cube blob with pulsation; no GW3 match |
| **Helix** | None | **ORIGINAL** | DNA double-helix shape, corkscrew movement |
| **Fractal** | None | **ORIGINAL** | Central shape with orbiting miniatures, advance-pause-retreat |
| **Swarm** | Mayfly (loose match) | **LOW** | Boid-like particle cluster with directional stretching |
| **Lurker** | None | **ORIGINAL** | Ambush predator, stationary until detection range |
| **Orbiter** | None | **ORIGINAL** | Orbits player in ring pattern, spiral inward |
| **Splitter** | Orbs (split mechanic) | **LOW** | GW3 orbs split into 2; our hexagons split into 3 then 2 (3 generations) |
| **Phaser** | None | **ORIGINAL** | Phase in/out visibility cycling, flanking repositioning |

### Summary

- **15 enemies** have HIGH risk (direct name + behavior match)
- **4 enemies** have MEDIUM risk (Titan/Giant variants)
- **8 enemies** have LOW or ORIGINAL risk (truly new designs)

---

## 7. Precedent Cases

### Cases Favoring the Clone Developer (Defendant Wins)

**Atari v. Amusement World (1982)** -- Asteroids clone
- Court ruled similarities were scenes a faire inherent to the "shoot space rocks" genre
- Defense: genre conventions are not copyrightable

**Data East v. Epyx (1988)** -- Karate Champ clone
- 9th Circuit reversed infringement finding
- Similarities were "inherent to the sport of Karate and video games in general"
- Established: genre-required elements cannot be monopolized

**Capcom v. Data East (1994)** -- Street Fighter II clone
- Fighter game similarities were genre conventions
- Even with strong visual resemblance, genre elements were unprotectable

### Cases Favoring the Original Developer (Plaintiff Wins)

**Tetris Holding v. Xio Interactive (2012)** -- Mino (Tetris clone)
- Court found Mino was substantially similar in its **creative expression**, not just its mechanics
- Critical: Mino copied the specific visual style down to near-identical block colors and grid layout
- **Lesson: copying mechanics is okay, but copying the total look-and-feel with near-identical art is not**

**Spry Fox v. Lolapps (2012)** -- Yeti Town (Triple Town clone)
- Settlement: Spry Fox received IP for both games
- Court found "substantial similarity" in look-and-feel
- Aggravating factor: 6waves had NDA access to Triple Town's private beta
- **Lesson: the more elements you copy in combination, the stronger the infringement case**

### The Grid Wars Incident (2006) -- DIRECTLY RELEVANT

**Grid Wars 2** by Mark Incitti was a free PC clone of Geometry Wars.
- Bizarre Creations contacted Incitti, citing effects on their sales
- Incitti offered to change the name and visuals -- **offers were ignored**
- Incitti voluntarily pulled the download link (no lawsuit filed)
- Game continued to circulate via mirrors and still exists today
- **No formal legal action was ever taken**

**Key takeaway:** Bizarre chose informal pressure over litigation. The clone developer offered to differentiate but was not given the chance. No court ever ruled Grid Wars was infringing. The game still exists.

### Modern Clones That Exist Without Issues

**Sektori (2025)** -- Explicitly called "the new Geometry Wars" by Kotaku, XboxEra, Aftermath
- Neon shapes on black, twin-stick shooting, geometric enemies
- By former Housemarque dev
- Sold commercially with no legal issues
- **Differentiated by:** own name, roguelike progression, dash mechanic, boss fights, original enemy designs

**Other commercial games in the neon twin-stick genre:**
- Super Stardust (Sony/Housemarque)
- Resogun (Sony/Housemarque)
- Neon Chrome
- Waves
- Beat Hazard
- Ultratron

---

## 8. Risk Assessment Summary

### Overall Verdict: CONDITIONAL RELEASE

The game can be released IF specific changes are made. Without changes, the risk is MEDIUM-HIGH.

### Risk Breakdown

| Category | Current Risk | After Changes | Notes |
|----------|-------------|---------------|-------|
| **Trademark (name)** | CRITICAL | NONE | Must rename -- cannot use "Geometry Wars" |
| **Copyright (code)** | NONE | NONE | All code is original TypeScript/Three.js |
| **Copyright (assets)** | NONE | NONE | All geometry/audio is procedurally generated |
| **Copyright (expression)** | MEDIUM-HIGH | LOW | 15 enemies with identical names/behaviors |
| **Trade dress** | MEDIUM | LOW | Neon aesthetic is genre; rename + differentiate enemies |
| **Patent** | VERY LOW | VERY LOW | No known GW patents |
| **Likelihood of enforcement** | LOW-MEDIUM | VERY LOW | Microsoft has bigger priorities; free browser game |

### Why Enforcement Is Unlikely But Not Impossible

**Arguments that Microsoft would NOT pursue this:**
- Geometry Wars is dormant (last release: 2015, 11 years ago)
- Microsoft has thousands of larger IP priorities
- Free browser game does not compete with a console product
- No Grid Wars-style precedent of actual litigation
- Genre has many commercial competitors (Sektori, etc.)

**Arguments that Microsoft MIGHT pursue this:**
- The enemy names are literally identical (Grunt, Weaver, Spinner, etc.)
- The project description says "recreation of Geometry Wars 3: Dimensions"
- If the game goes viral, it draws attention
- Microsoft has historically been protective of IP (e.g., Halo, Xbox trademarks)
- Even a cease-and-desist letter would be costly and disruptive

---

## 9. Safe Release Checklist

### MUST DO (Critical -- Without These, Do Not Release)

- [ ] **Rename the game** -- choose a completely original name with no "Geometry Wars" reference
- [ ] **Rename ALL 15 high-risk enemies** -- do not use any GW3 enemy names
- [ ] **Remove all references to "Geometry Wars" from code, UI, docs, and metadata**
- [ ] **Do not describe the game as a "recreation" or "clone" of Geometry Wars** in any public-facing material

### SHOULD DO (Strongly Recommended -- Significantly Reduces Risk)

- [ ] **Differentiate enemy visuals from GW3:**
  - Change Grunt from blue diamond to different shape/color
  - Change Wanderer from purple pinwheel to different form
  - Change Weaver from green diamond to unique shape
  - Change Snake color scheme (not blue segmented circles)
  - Make each enemy visually distinct from its GW3 counterpart
- [ ] **Differentiate at least some enemy behaviors:**
  - Add unique mechanics that GW3 does not have (you already have some: Phaser, Orbiter, Lurker, Fractal, Helix)
  - Modify chasing patterns, death behaviors, spawning logic
- [ ] **Add original game mechanics** that distinguish the game:
  - Your 3D surface gameplay (sphere, torus, etc.) already differentiates from GW3's flat + 3D surfaces
  - Your buff system, companion system, and weapon variety add originality
  - Your difficulty tiers and debug overlay are unique

### NICE TO DO (Further Risk Reduction)

- [ ] Change "geoms" to different collectible name (GW-specific term)
- [ ] Alter the grid deformation visual to be somewhat distinct
- [ ] Add an "inspired by the twin-stick shooter genre" note rather than referencing GW specifically
- [ ] Ensure boss designs are clearly original (your gemstone bosses already are)
- [ ] Consider color palette shifts for the overall aesthetic (e.g., dark blue background instead of pure black, different bloom colors)

### Proposed Enemy Renames

| Current Name | Proposed Name | Rationale |
|-------------|---------------|-----------|
| Grunt | Shard / Tracker / Pursuer | Blue diamond that chases -- generic enough |
| Wanderer | Drifter / Roamer / Vagrant | Random wandering behavior |
| Spinner | Vortex / Tumbler / Gyro | Spinning chase with spawn-on-death |
| SpinnerSpawn | Mote / Fragment / Shard | Small orbiting remnant |
| Weaver | Evader / Phantom / Slick | Bullet-dodging behavior |
| Snake | Serpent / Worm / Coil | S-pattern movement, segmented |
| Rocket | Bolt / Streaker / Arrow | Straight-line bouncer |
| Duck | Flipper / Hopper / Pacer | Cardinal-direction movement |
| Mayfly | Gnat / Midge / Speck | Tiny swarm enemy |
| Neutron | Ricochet / Bouncer / Pinball | Random bouncing |
| Gate | Barrier / Tripwire / Fence | Pass-through detonation |
| Spawner | Hive / Nexus / Incubator | Enemy generator |
| Gravity Well | Vortex / Singularity / Attractor | Gravity pull |
| Repulsor | Charger / Lancer / Bull | Charge attack |
| Virus | Plague / Contagion / Spore | Multiplication mechanic |
| TitanGrunt | Colossus / Juggernaut | Large grunt variant |
| TitanSpinner | Cyclone / Maelstrom | Large spinner variant |
| TitanWeaver | Specter / Wraith | Large weaver variant |

---

## 10. Sources

### IP Ownership
- [Bizarre Creations - Geometry Wars Wiki (Fandom)](https://geometry-wars.fandom.com/wiki/Bizarre_Creations)
- [Geometry Wars - Wikipedia](https://en.wikipedia.org/wiki/Geometry_Wars)
- [Activision Buys Bizarre Creations - Shacknews](https://www.shacknews.com/article/49149/activision-buys-bizarre-creations-developer)
- [Acquisition of Activision Blizzard by Microsoft - Wikipedia](https://en.wikipedia.org/wiki/Acquisition_of_Activision_Blizzard_by_Microsoft)
- [Every Activision Blizzard IP Xbox Now Owns - VGC](https://www.videogameschronicle.com/news/list-heres-every-activision-blizzard-ip-xbox-now-owns-including-crash-bandicoot-and-guitar-hero/)

### Trademark
- [Geometry Wars 3: Dimensions Evolved on Steam (TM symbol)](https://store.steampowered.com/app/310790/Geometry_Wars_3_Dimensions_Evolved/)
- [Activision Publishing Trademarks - USPTO Report](https://uspto.report/company/Activision-Publishing-Inc)
- [USPTO Trademark Search](https://www.uspto.gov/trademarks/search)

### Patent
- [10 Amazing Patent Protected Game Mechanics - DualShockers](https://www.dualshockers.com/amazing-patent-protected-game-mechanics/)
- [Can Game Mechanics Be Patented? - Bytescare](https://bytescare.com/blog/can-game-mechanics-be-patented)
- [Futility of Patents on AAA Video Game Mechanics - MTLR](https://mttlr.org/2022/10/the-futility-of-patents-on-aaa-video-game-mechanics/)
- [Activision Publishing Patent Filings](https://patents.justia.com/assignee/activision-publishing-inc)

### Copyright Law
- [Clone Wars: Five Most Important Cases - Game Developer](https://www.gamedeveloper.com/business/clone-wars-the-five-most-important-cases-every-game-developer-should-know)
- [Clone Games on Trial - Pillar Legal](https://www.pillarlegalpc.com/wp-content/uploads/2024/07/Pillar-Legal-Clone-Games-on-Trial-2023-5-23-1.pdf)
- [Tetris Holding v. Xio Interactive - Wikipedia](https://en.wikipedia.org/wiki/Tetris_Holding,_LLC_v._Xio_Interactive,_Inc.)
- [Data East v. Epyx - Wikipedia](https://en.wikipedia.org/wiki/Data_East_USA,_Inc._v._Epyx,_Inc.)
- [Video Game Clone - Wikipedia](https://en.wikipedia.org/wiki/Video_game_clone)
- [How Courts View Copyright Protection for Video Games - FKKS](https://fkks.com/news/how-courts-view-copyright-protection-for-video-games)

### Trade Dress
- [Using Trade Dress to Protect Video Games - UIC Law Review](https://repository.law.uic.edu/ripl/vol17/iss1/5/)
- [How Trade Dress Can Help Game Developers - IPWatchdog](https://ipwatchdog.com/2016/08/07/trade-dress-game-developers/id=71685/)
- [Trade Dress for Game Developers - Fenwick](https://www.fenwick.com/insights/publications/how-trade-dress-can-help-game-developers-level-up)

### Precedent Cases
- [Spry Fox v. Lolapps - Wikipedia](https://en.wikipedia.org/wiki/Spry_Fox,_LLC_v._Lolapps,_Inc.)
- [Bizarre Tries to Stop Geometry Wars Clone - Engadget](https://www.engadget.com/2006-08-11-bizarre-tries-to-stop-geometry-wars-clone.html)
- [Grid Wars Author Comments on Clone - Engadget](https://www.engadget.com/2006-08-18-grid-wars-author-comments-on-clones-creation.html)
- [Grid Wars - Wikipedia](https://en.wikipedia.org/wiki/GridWars)

### Genre Context
- [Sektori: The New Geometry Wars - Kotaku](https://kotaku.com/this-twin-stick-shooter-is-the-new-geometry-wars-and-it-rules-2000650227)
- [Sektori: Heir to Geometry Wars - Aftermath](https://aftermath.site/sektori-shooter-game-review-geometry-wars/)
- [GW3: Dimensions Enemies Guide - Steam Community](https://steamcommunity.com/sharedfiles/filedetails/?id=601842273)
- [GW3 Comprehensive Enemy Guide - KosGames](https://kosgames.com/geometry-wars-3-dimensions-evolved-comprehensive-enemy-guide-214/)
- [Geometry Wars Wiki Enemies Category](https://geometry-wars.fandom.com/wiki/Category:Enemies)

---

## Disclaimer

This analysis is research-based, not legal advice. For a definitive answer on releasability, consult an intellectual property attorney licensed in your jurisdiction. Copyright and trademark law varies by country, and specific outcomes depend on the exact facts of each case.

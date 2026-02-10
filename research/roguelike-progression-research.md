# Roguelike Meta-Progression Research

**Purpose:** Analyze successful roguelike/roguelite progression systems to design a meta-progression system for Geometry Wars 3D browser recreation.

**Date:** 2026-02-10

---

## 1. Vampire Survivors

**Genre:** Auto-shooter roguelite | **Price:** $4.99 | **Copies:** 10M+ | **Revenue:** ~$57M Steam

### How Meta-Progression Works

Vampire Survivors uses a **gold-based permanent upgrade system** as its core meta-progression loop:

1. **Gold (Primary Currency):** Earned during runs, persists between deaths. Every enemy drops coins; Greed stat multiplies earnings.
2. **PowerUps (Permanent Stat Upgrades):** 27 purchasable upgrades with escalating costs. Each level costs `initialCost * levelNumber`. Categories:
   - Combat: Might (+5% damage/level, 5 levels), Cooldown (-2.5%/level, 2 levels), Area (+5%/level, 2 levels), Duration (+15%/level, 2 levels), Amount (+1 projectile, 1 level at 5,000g)
   - Survival: Armor (+1/level, 3 levels), Max Health (+10%/level, 3 levels), Recovery (+0.1 HP/s/level, 5 levels), Revival (+1, 10,000g)
   - Economy: Greed (+10%/level, 5 levels), Growth (+3%/level, 5 levels), Luck (+10%/level, 3 levels)
   - Meta: Reroll (+2/level, 5 levels), Skip (+2/level, 5 levels), Banish (+2/level, 5 levels)
   - Total cost to max all: ~27M gold coins
3. **Character Unlocks:** 54 base characters, each with unique starting weapon and stat bonuses. Unlock conditions vary:
   - Stat-based: "Recover 1,000 HP total" (Clerici)
   - Weapon-based: "Upgrade Fire Wand to LV4" (Arca)
   - Currency-based: "Earn 5,000 coins in a single run" (Dommario)
   - Achievement-based: secret characters with hidden conditions
4. **Stage Unlocks:** New maps unlock by reaching milestones (time survived, bosses killed, hyper mode completions)
5. **Arcana System:** 22+ unlockable modifiers that alter fundamental game rules. Unlocked by reaching level 50 with specific characters or surviving 31 minutes on specific stages. Chosen during runs at minute marks (11:00, 21:00).

### Why It Works

- **Immediate gratification:** Every run earns gold, every gold purchase is a visible improvement
- **Low skill floor:** PowerUps make the game easier over time, ensuring progress even for weak players
- **High discovery ceiling:** 207 characters, 22 Arcanas, evolution recipes create layers of "what's next?"
- **Greed loop:** The Greed PowerUp itself makes future farming faster, creating exponential reward feeling
- **Cost curve creates pacing:** Early upgrades are cheap (200g), late ones expensive (10,000g+), naturally stretching engagement

### What Translates to Our Game

- Gold-equivalent currency earned per run (Geoms already exist in-game)
- Permanent small stat upgrades purchasable between runs
- Character/weapon unlock conditions tied to gameplay milestones
- Stage unlocks gated behind star ratings or achievements
- Cost escalation formula: `base_cost * level` is simple and effective

### What Doesn't Translate

- Auto-shooter doesn't need aiming skill — VS can give more power without skill ceiling issues. Twin-stick shooters must be careful not to trivialize the aiming skill component.
- 207 characters is not feasible for our scope — but 5-10 pilot variations would work
- Arcanas modify fundamental game rules in ways that work for 30-min sessions but may not suit endless arcade

**Sources:**
- [PowerUps Wiki](https://vampire.survivors.wiki/w/PowerUps)
- [Characters Wiki](https://vampire.survivors.wiki/w/Characters)
- [Arcanas Wiki](https://vampire-survivors.fandom.com/wiki/Arcanas)
- [Gold Farming Guide](https://vampire.survivors.wiki/w/Guide:Gold_farming)

---

## 2. Hades (Supergiant Games)

**Genre:** Roguelike action | **Price:** $24.99 | **Copies:** 5M+ | **Revenue:** ~$100M+

### How Meta-Progression Works

Hades uses a **multi-currency, multi-system** approach:

1. **Darkness (Primary Meta Currency):** Spent at the Mirror of Night for permanent upgrades. 12 upgrade pairs (base + alternate), each with multiple ranks:
   - Shadow/Fiery Presence: +10% damage/rank (5 ranks, 10-30 Darkness/rank) — conditional damage boosts
   - Death Defiance: Extra lives (3 ranks, 30/500/1,000 Darkness) — the most impactful
   - Greater/Ruthless Reflex: Dash upgrade (1 rank, 50-75 Darkness) — movement skill
   - Thick Skin/High Confidence: HP or conditional damage (10/5 ranks)
   - Olympian Favor/Dark Foresight: Rarity chances (40/10 ranks, expensive)
   - Gods' Pride/Legacy: Legendary boon chances (20/10 ranks, 100-250 Darkness/rank)
   - Key mechanic: Each upgrade slot has TWO versions (base and alternate). Only one active at a time. Can swap freely. This doubles decision space without increasing grind.

2. **Chthonic Keys:** Unlock new weapons (6 total) and unlock alternate Mirror upgrades. Earned during runs from chamber rewards.

3. **Titan Blood:** Upgrade weapon Aspects (4 per weapon = 24 total). Each Aspect fundamentally changes how the weapon plays. Earned from bosses.

4. **Diamonds:** Upgrade the House of Hades (cosmetic/narrative). Contractor work orders improve the hub world.

5. **Nectar/Ambrosia → Keepsakes/Companions:** Gift to NPCs to receive equippable items. Keepsakes provide run modifiers (guaranteed boon from specific god, extra HP, etc.). Requires relationship building across many runs.

6. **Pact of Punishment:** Voluntary difficulty modifiers that increase "Heat" level. Higher Heat unlocks unique rewards (bounties on bosses for Titan Blood). This is the ENDGAME loop — after beating the game, increase difficulty for rewards.

### Why It Works

- **Multiple orthogonal progression axes:** Darkness (power), Keys (variety), Blood (depth), Nectar (story). Player always has something to chase.
- **Dual-upgrade Mirror:** Swap between two philosophies per slot = meaningful choices without permanent commitment
- **Narrative integration:** Progression IS the story. Characters comment on your upgrades, weapons, and deaths.
- **Pact of Punishment is genius:** After you "beat" the game, self-imposed difficulty becomes the progression driver. No power ceiling problem.
- **Keepsakes as build-defining:** Choose which god's boons you want to start with = strategic depth

### What Translates to Our Game

- Multiple currencies (Geoms for upgrades, Stars for unlocks, Achievements for cosmetics)
- Dual-choice upgrade tree (each slot has two options, pick one)
- Weapon aspects concept: each weapon has 2-3 variants that change behavior
- Voluntary difficulty modifiers (like Pact of Punishment) for endgame progression
- Keepsake-like starting loadouts (pick one buff to start with)

### What Doesn't Translate

- Deep narrative integration (our game is arcade, not story-driven)
- 20+ hour completion time before endgame loop. Our runs are 5-15 min. Pacing must be much faster.
- NPC relationship system requires a cast of characters we don't have

**Sources:**
- [Mirror of Night Wiki](https://hades.fandom.com/wiki/Mirror_of_Night)
- [Pact of Punishment Wiki](https://hades.fandom.com/wiki/Pact_of_Punishment)
- [The Gamer - Mirror of Night analysis](https://www.thegamer.com/hades-mirror-of-night-roguelite-progression/)

---

## 3. Risk of Rain 2 (Hopoo Games)

**Genre:** Third-person roguelike shooter | **Price:** $24.99 | **Copies:** 5M+ | **Revenue:** ~$100M+

### How Meta-Progression Works

Risk of Rain 2 uses a **challenge-based unlock system** with minimal permanent power upgrades:

1. **Character Unlocks (9 survivors):** Each locked behind a specific challenge:
   - Artificer: Spend 11 Lunar Coins at the Bazaar Between Time
   - MUL-T: Complete the first teleporter event 5 times
   - Huntress: Complete 3 stages without dying in a single run
   - REX: Complete a specific multi-step quest with a fuel cell
   - Challenge design: Each unlock teaches a game mechanic or rewards mastery

2. **Lunar Coins (Persistent Currency):** 0.5% drop chance per kill (halves each subsequent drop per run). Spent at Bazaar for Lunar items, character unlocks, and Obliteration runs.

3. **Item Log / Monster Log / Environment Log:** Discovery-based collection. Items, enemies, and stages are catalogued as you encounter them. No gameplay effect — pure completionist progression.

4. **Challenge/Achievement Unlocks:** Most items and equipment are locked behind specific challenges:
   - "Kill 15 enemies in 2 seconds" → unlocks Backup Magazine
   - "Complete a Prismatic Trial" → unlocks specific items
   - Challenges range from easy (play X games) to near-impossible (Eclipse 8 with every character)

5. **Artifact System:** Unlockable game modifiers found in hidden areas. Examples: Artifact of Command (choose items), Artifact of Glass (10x damage, 10% HP), Artifact of Swarms (double enemies, half HP).

6. **Eclipse Difficulty:** Post-completion escalating difficulty (8 levels) with cumulative modifiers. Tracked per-character.

### Why It Works

- **Challenge-based unlocks reward SKILL, not time:** You can't grind your way to unlocks; you must actually accomplish the challenge
- **No permanent power upgrades:** This is controversial but means the game is always fair. A new player and a veteran have the same power in-run.
- **Discovery log creates exploration motivation:** "I haven't seen that item yet" drives different playstyles
- **Artifacts as game-changers:** Each fundamentally alters how you play, creating fresh experiences
- **Eclipse as endgame:** 8 difficulty levels x 9 characters = 72 distinct endgame goals

### What Translates to Our Game

- Challenge/achievement-based unlocks (tied to specific gameplay feats)
- Artifact-like modifiers (our game's Arcana equivalent)
- Discovery log for enemies, weapons, surfaces
- Per-character difficulty tracking
- NO or MINIMAL permanent power boosts (preserves skill-based arcade purity)

### What Doesn't Translate

- 30-60 minute runs don't match our 5-15 minute arcade sessions
- Lunar coin scarcity model works for long runs, needs adjustment for short ones
- Log collection is passive — needs active rewards to feel meaningful in an arcade context

**Sources:**
- [Character unlock guide](https://blog.omggamer.com/how-to-unlock-risk-of-rain-2-characters/)
- [Lunar Coins Wiki](https://riskofrain2.fandom.com/wiki/Lunar_Coins)
- [Achievements & Items](https://blog.omggamer.com/risk-of-rain-2-achievements-new-items/)

---

## 4. Enter the Gungeon (Dodge Roll)

**Genre:** Bullet-hell roguelite | **Price:** $14.99 | **Copies:** 3M+ | **Revenue:** ~$67M

### How Meta-Progression Works

1. **Hegemony Credits (Meta Currency):** Earned from boss kills (1-3 per boss, doubled for flawless). Used in The Breach (hub world) for:
   - Shop unlocks: Add new guns/items to the drop pool (Ox & Cadence shop)
   - Shortcut unlocks: Skip to later floors (costs credits + specific items)
   - Challenge mode: 6 credits to activate
   - Hunting quests: Completing quests for Frifle rewards credits

2. **Item/Gun Pool Expansion:** New guns and items are unlocked via Hegemony Credits, boss kills, NPC rescues, and achievements. The pool grows over time — more variety per run as you unlock more.

3. **NPC Rescues:** Finding NPCs in the Gungeon adds them to The Breach, providing new services:
   - Shop keepers, item synergy guides, elevator technicians
   - Each NPC adds permanent new functionality

4. **Shortcuts:** Pay escalating costs to unlock floor shortcuts. Trade-off: starting from a later floor means fewer items and credits.

5. **Past Kills:** Each character has a "past" to kill (final boss variant). Killing all pasts unlocks the true ending and final areas.

### Why It Works

- **Pool expansion is brilliant:** Instead of making YOU stronger, it makes the GAME more varied. Each unlock adds a new gun/item to the random pool.
- **Flawless bonus incentivizes skill:** 2x credits for no-damage boss fights
- **NPC rescues create "I found something!" moments**
- **Shortcuts have meaningful trade-offs:** Convenience vs. power
- **Past kills as ultimate goal:** Narrative endpoint per character creates clear long-term goals

### What Translates to Our Game

- Currency from boss/wave performance (bonus for flawless performance)
- Pool expansion: unlock new weapons/buffs to appear in runs
- NPC/feature unlocks in a hub or menu
- Performance bonuses (flawless wave completion = bonus currency)
- Shortcut concept: unlock ability to start at higher wave numbers

### What Doesn't Translate

- Room-based dungeon crawl structure vs. our wave-based arena
- NPC rescue requires explorable spaces we don't have
- Past kills are narrative; our game is score-chase

**Sources:**
- [Hegemony Credit Wiki](https://enterthegungeon.wiki.gg/wiki/Hegemony_Credit)
- [The Breach Wiki](https://enterthegungeon.fandom.com/wiki/The_Breach)
- [Game Developer - 3M copies](https://www.gamedeveloper.com/business/-i-enter-the-gungeon-i-has-topped-3-million-sales-in-just-under-four-years)

---

## 5. Geometry Wars 3: Dimensions (Lucid Games)

**Genre:** Twin-stick shooter | **Price:** $14.99 | **Copies:** 100-200K | **Revenue:** ~$645K Steam

### How Meta-Progression Works

1. **Star Rating System (1-3 stars per level):** Score-based ratings on Adventure mode levels. Stars are cumulative — total stars unlock:
   - New Adventure levels (linear progression)
   - Boss encounters (require star thresholds)
   - New Drones (6 total)
   - New Super Abilities (6 total)

2. **Drones (6 types):**
   - Attack (shoots forward), Collect (auto-gathers Geoms), Ram (seeks enemies), Snipe (auto-targets), Defend (shoots backward), Sweep (orbits player)
   - Each upgradeable 4 times with Geoms
   - Unlocked at star thresholds in Adventure mode

3. **Super Abilities (6 types):**
   - Homing (missiles), Miner (deployable mines), Black Hole (vortex), Turret (stationary gun), Clone (duplicate drone), Detonator (explosions)
   - Each upgradeable 4 times
   - Unlocked at star thresholds

4. **Geoms (In-Run Currency):** Dropped by enemies, collected for score multiplier AND used for drone/super upgrades.

### Why It Works (and Doesn't)

**What works:**
- Star system creates replayability for each level (chase 3 stars)
- Drone choice creates strategic variety
- Super abilities add tactical depth
- Simple, easy-to-understand progression

**What doesn't work (lessons for us):**
- Linear Adventure mode feels like a traditional game, not a roguelike. No randomness, no "one more run" pull.
- Once you 3-star everything... you're done. No endgame.
- No permanent stat upgrades — no sense of growing stronger
- Geom upgrade system is too simple (just spend currency, no choices)
- Only ~200K copies sold on Steam — progression didn't create retention

### What Translates to Our Game

- Star rating concept (but applied to endless mode milestones, not fixed levels)
- Drone system already exists as Companions
- Super abilities already exist
- Geom currency already exists

### What We Must Improve Over GW3

- Add roguelite meta-progression (permanent upgrades between runs)
- Add randomized elements within runs (buff drops, enemy composition)
- Add endgame loop (difficulty modifiers, challenges, leaderboards)
- Add achievement system for discovery and mastery
- Add cosmetic rewards for long-term engagement

**Sources:**
- [Steam Guide - Star Ratings](https://steamcommunity.com/sharedfiles/filedetails/?id=404958869)
- [Drone Wiki](https://geometry-wars.fandom.com/wiki/Drone)
- [Super Wiki](https://geometry-wars.fandom.com/wiki/Super)
- [Steam Revenue Calculator](https://steam-revenue-calculator.com/app/310790)

---

## 6. Cross-Game Analysis: Design Patterns

### Pattern 1: Currency Earned Per Run → Spent Between Runs

| Game | Currency | How Earned | How Spent |
|------|----------|------------|-----------|
| Vampire Survivors | Gold | Enemy drops | PowerUps (permanent stats) |
| Hades | Darkness | Chamber rewards | Mirror of Night (permanent stats) |
| Enter the Gungeon | Hegemony Credits | Boss kills | Shop unlocks (pool expansion) |
| Risk of Rain 2 | Lunar Coins | Rare drops (0.5%) | Character unlocks, Lunar items |
| GW3: Dimensions | Geoms (stars) | Enemy drops (score) | Drone/super upgrades |

**Our design:** Geoms serve double duty (in-run multiplier + meta currency). Between runs, spend accumulated Geoms on permanent upgrades.

### Pattern 2: Escalating Cost Curves

| Game | Formula | Early Cost | Late Cost | Ratio |
|------|---------|------------|-----------|-------|
| Vampire Survivors | base * level | 200g | 10,000g | 50x |
| Hades | Fixed per rank | 10 Darkness | 4,000 Darkness | 400x |
| Enter the Gungeon | Fixed amounts | 1 HC | 15 HC | 15x |

**Our design:** Polynomial cost curve. Level 1 costs 100 Geoms, Level 50 costs ~50,000.

### Pattern 3: Unlock Types

| Category | VS | Hades | RoR2 | EtG | GW3 |
|----------|----|----|------|-----|-----|
| Characters | Yes (54) | No (1) | Yes (9) | Yes (4+) | No |
| Weapons | Via characters | Via keys | Via challenges | Via credits | Via stars |
| Permanent stats | Yes (PowerUps) | Yes (Mirror) | No | No | No |
| Game modifiers | Yes (Arcanas) | Yes (Pact) | Yes (Artifacts) | Yes (Challenge) | No |
| Pool expansion | N/A | N/A | Via challenges | Via credits | N/A |
| Cosmetics | Limited | Yes (Contractor) | Yes (skins) | Limited | No |
| Difficulty modes | Yes (Hyper) | Yes (Heat) | Yes (Eclipse) | Yes (Challenge) | No |

### Pattern 4: What Creates "One More Run"

Based on analysis across all 5 games and game design research:

1. **Visible next milestone:** Player can always see the next unlock and roughly how far away it is (Source: [Meta Progression with Gradual Tutorial](https://notes.hamatti.org/gaming/video-games/meta-progression-with-gradual-tutorial-in-roguelike-games))
2. **Multiple parallel tracks:** When one track stalls, another provides progress (Hades excels at this)
3. **Meaningful choices, not just grinding:** Dual-option upgrades (Hades), Arcana selection (VS), Artifact choice (RoR2)
4. **Skill improvement alongside power improvement:** The player gets better AND their character gets stronger (Source: [Designing for Mastery in Roguelikes](https://www.gridsagegames.com/blog/2025/08/designing-for-mastery-in-roguelikes-w-roguelike-radio/))
5. **Discovery moments:** Finding a new enemy, weapon, or synergy for the first time
6. **Post-completion challenge:** Difficulty modifiers that extend endgame indefinitely
7. **Session-appropriate pacing:** Short-session games (VS, our game) need faster unlock cadence than long-session games (Hades, RoR2)

---

## 7. Recommendations for Geometry Wars 3D

Based on the above analysis, the recommended meta-progression system combines elements from:

- **Vampire Survivors:** Gold/Geom currency → permanent small stat upgrades (the core loop)
- **Hades:** Dual-choice upgrade tree + voluntary difficulty modifiers (depth)
- **Risk of Rain 2:** Challenge-based unlocks for weapons/surfaces (skill reward)
- **Enter the Gungeon:** Performance bonuses for flawless play (skill incentive)
- **GW3: Dimensions:** Star ratings for milestone tracking + drone/super unlocks (existing system evolution)

### Key Design Principle

**Small but meaningful.** Each upgrade should feel like "+2% fire rate" not "+50% fire rate." The game should always be beatable without upgrades (skill-first design, like RoR2), but upgrades make it more fun and varied (like VS).

See the HTML presentation (reports/roguelike-progression.html) for the full progression model with XP curves, unlock trees, and implementation plan.

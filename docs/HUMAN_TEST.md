# Human Test Checklist

> **What is this?** Everything Claude has changed that needs YOU to verify in a real browser. Items are grouped by system. Check them off as you go. If something fails, note what happened — Claude will read this file next session.
>
> **Last updated:** 2026-02-11

---

## How to Run

```bash
# Single player
Play Game.bat                    # or: npm run dev

# LAN multiplayer
Play Game.bat                    # starts both Vite + Colyseus
# Open http://localhost:3000?mode=network in two browser tabs
# Tab 1: click "Host Game"
# Tab 2: click "Join Game"
```

---

## LAN Multiplayer (HIGHEST PRIORITY — 10+ fix attempts, never verified working)

These fixes were all made in commits `39e5540`, `9da6c5a`, `b1043d9`, `7af24be` on 2026-02-11. None have been user-tested.

### Core Playability
- [ ] **Both players can move smoothly** — WASD on both tabs, movement should feel responsive (not jerky/teleporting)
- [ ] **Bullets fire in correct direction** — Aim with mouse, fire. Bullets should go toward crosshair, not random directions
- [ ] **Bullets move smoothly** — Bullets should glide, not snap/teleport between positions
- [ ] **Geoms (score pickups) move smoothly** — Same as bullets, should lerp not snap
- [ ] **Enemy movement is smooth** — Enemies should move fluidly, not stutter at 30fps intervals
- [ ] **Player aim updates while stationary** — Stand still, move mouse around. Player should visually rotate to face cursor instantly

### Robustness
- [ ] **Tab-out doesn't break movement** — Alt-tab away from one tab, come back. Player should stop moving while unfocused, resume on return
- [ ] **No spawn ring ghosts** — Kill enemies. Should NOT see lingering circular warning rings where enemies spawn
- [ ] **Respawn works** — Die, respawn. Player should be visible and controllable after respawn (not invisible)
- [ ] **Cube surface works** — Select cube map. Player should NOT get stuck at origin (0,0). Can move freely everywhere
- [ ] **Overall feel** — Does it feel like a playable game, or "laggy and weird"?

### Performance
- [ ] **Stable 60 FPS** — Open Chrome DevTools Performance tab. FPS should stay near 60, not dip to 30-40
- [ ] **No debug spam** — Console should NOT show LAN debug messages unless `?debug` is in URL

### LAN Task Files (for investigating failures)
- `tasks/lan-quick-wins-audit.md` — 60Hz patches, depth opacity removal, interpolation
- `tasks/lan-window-focus-control.md` — Tab focus handling
- `tasks/lan-spawn-rings-persist.md` — Ghost spawn rings
- `tasks/lan-respawn-invisible.md` — Invisible after death
- `tasks/lan-bullet-angle-wrong.md` — Bullet direction
- `tasks/lan-origin-blocking-cube.md` — Cube origin blocking
- `decisions/lan-deep-audit-2026-02-11.md` — Full 12-issue audit

---

## Main.ts Refactor (commit `b7a0923`)

The god function was split into 8 modules. Game behavior should be identical.

- [ ] **Player movement** — WASD moves player in all directions on all surfaces
- [ ] **Shooting** — Click to fire, bullets hit enemies, enemies die
- [ ] **Pickups spawn** — Kill enemies, weapon/buff/companion pickups appear
- [ ] **Pickup collection** — Walk over pickups, buffs activate, weapons switch
- [ ] **Camera controls** — Mouse wheel zoom, middle mouse orbit
- [ ] **Screen flash** — Death/protector activation should flash screen
- [ ] **UI updates** — Score, multiplier, lives, bombs all update correctly
- [ ] **Pause menu** — ESC opens pause, shows stats, can resume

### Refactor Task File
- `tasks/refactor-main-god-function.md`

---

## Game Modes (commit `b7a0923`)

4 new modes added alongside default Waves mode.

- [ ] **Mode selector visible** — Start menu "Quick Game" should show mode dropdown
- [ ] **Waves mode** — Default behavior, enemies spawn in waves
- [ ] **King mode** — Safe zones appear, must stand in zone to score
- [ ] **Rainbow mode** — Kill enemies in color order for bonus multiplier
- [ ] **Sniper mode** — Limited ammo, precision kills rewarded
- [ ] **Claustrophobia mode** — Shrinking play area

### Game Modes Task File
- `tasks/game-modes-implementation.md`

---

## Sound System (commits `07aee82`, earlier)

- [ ] **No audio distortion** — At high enemy counts (100+), sound shouldn't clip/crackle
- [ ] **Sounds don't stack infinitely** — Killing 20 enemies fast shouldn't produce 20 overlapping explosions
- [ ] **Volume is reasonable** — Not too loud, not too quiet

### Sound Task Files
- `tasks/sound-overwhelm-reinvestigate.md`
- `tasks/lan-still-broken-sound.md`

---

## Performance (commits `07aee82`, `a960932`)

- [ ] **No FPS crater at high scores** — Play until 450M+ score. FPS should stay above 30
- [ ] **Explosion particles don't tank FPS** — Chain explosions (many enemies dying at once) should not drop below 30fps
- [ ] **Performance graphs work** — Pause menu → Performance → graphs should display data

### Performance Task Files
- `tasks/fps-crater-reinvestigate.md`
- `tasks/perf-graphs-reinvestigate.md`
- `tasks/performance-drops-450m.md`

---

## Visual Features (various commits)

- [ ] **Enemy opacity behind surfaces** — Enemies on the far side of the surface should be nearly invisible (6% opacity), not glowing through
- [ ] **Enemy surface glow** — Enemies should cast a colored glow on the surface beneath them
- [ ] **Visual styles playground** — Start menu → Visual Styles → click a style → demo should load and be playable (not spinning wildly)
- [ ] **Weapon playground** — Start menu → Weapons → playground should work (USER VERIFIED WORKING in `bffc333`)

### Visual Task Files
- `tasks/enemy-opacity-behind-surfaces.md`
- `tasks/enemy-surface-glow.md`
- `tasks/visual-styles-playground-broken.md`

---

## Difficulty & Gameplay (commit `07aee82`)

- [ ] **Difficulty feels challenging** — Should get hard by wave 5-10, not trivially easy forever
- [ ] **Enemy speed scales** — Later enemies should be noticeably faster
- [ ] **Cube-tunnel speed** — Enemies on cube-tunnel should move at similar speed to other surfaces (not 10x faster or 10x slower)

### Difficulty Task Files
- `tasks/difficulty-still-too-easy.md`
- `tasks/cube-tunnel-speed-normalization.md`

---

## WebGPU (if your browser supports it)

**Updated 2026-02-12:** Dynamic bloom settings now work for WebGPU (using TSL uniform nodes)

- [ ] **WebGPU renderer activates** — Chrome 113+ should auto-detect and use WebGPU
- [ ] **Bloom effects work** — Neon glow should be visible (not flat/dark)
- [ ] **Bloom settings update in real-time (WebGPU)** — Open settings, adjust bloom strength slider → bloom should change immediately (not stay frozen)
- [ ] **Bloom threshold updates (WebGPU)** — Adjust bloom threshold slider → glow area should shrink/expand
- [ ] **Visual styles change bloom (WebGPU)** — Switch visual styles in settings → bloom should update per style
- [ ] **Fallback works** — Firefox/Safari should gracefully fall back to WebGL2

### WebGPU Task File
- `tasks/webgpu-optimization.md`

---

## Adventure Mode (NEW — 2026-02-12)

50-level campaign mode with progressive difficulty, star ratings, and level progression.

### Level Select UI
- [ ] **Adventure button visible** — Start menu shows "ADVENTURE" button as primary option
- [ ] **Level grid displays** — Click Adventure → shows all 50 levels in 6 sections (Sapphire, Ruby, Emerald, Opal, Amethyst, Topaz)
- [ ] **Locked levels show lock icon** — Levels after the first should show 🔒 if not unlocked
- [ ] **Star ratings display** — Completed levels should show ★★★ or ★★☆ etc. based on performance
- [ ] **Section headers visible** — Each gem section (Sapphire, Ruby, etc.) should have a visible header

### Level Gameplay
- [ ] **Level starts on click** — Click an unlocked level → game should start on the level's surface
- [ ] **Scripted waves spawn** — Level should spawn specific enemy waves (not random endless waves)
- [ ] **Lives/bombs/time match level** — Check pause menu → stats should match the level's config (e.g., Level 1 has 3 lives, 60s time limit)
- [ ] **Timer counts down (Deadline mode)** — Levels with time limits should show countdown timer
- [ ] **Timer shows elapsed time (Evolved mode)** — Levels without time limits should show elapsed time

### Level Completion
- [ ] **Level completes when waves clear** — Kill all enemies in all waves → Level Complete screen should show
- [ ] **Star rating displays** — Level Complete should show 1-3 stars based on score
- [ ] **Star rating is accurate** — Check score vs. level's star thresholds (shown on pause menu)
- [ ] **Progress saves** — Complete a level → go back to menu → level should show earned stars
- [ ] **Next level unlocks** — Complete Level 1 → Level 2 should unlock
- [ ] **Next button works** — Click "Next Level" → should start the next level
- [ ] **Replay button works** — Click "Replay" → should restart the same level
- [ ] **Menu button works** — Click "Menu" → should return to start menu

### Level Failure
- [ ] **Fails when lives run out** — Die with 0 lives → Game Over screen should show (not Level Complete)
- [ ] **Fails when time runs out (before clearing)** — If time expires before all waves cleared → should complete with current score (not fail)

### Edge Cases
- [ ] **Can't click locked levels** — Locked levels should be disabled/unclickable
- [ ] **Level 50 has no "Next"** — Last level should only show Replay and Menu buttons (no Next)
- [ ] **Back button works** — Click "Back" from level select → returns to main menu

### Adventure Task File
- `tasks/adventure-mode-design.md`

---

## Gravity Wells Environmental Hazard (NEW — 2026-02-12)

**Note:** The GravityWell entity has been enhanced with blue/red variants, visual indicators, and pull mechanics. The game loop integration (wiring callbacks) needs to be done separately.

### What Was Changed
- Added blue wells (0x4488ff): pull force affects movement, non-lethal
- Added red wells (0xff4444): lethal within 0.5 radius inner zone
- Added translucent pull radius ring (becomes visible when activated)
- Added red danger zone ring for red wells
- Added `onPullPlayer` callback for active force application
- Added `onWellActivated` audio callback
- EnemySpawner now supports 'gravity_well_red' spawn type

### How to Test (once wired into game loop)

#### Basic Functionality
- [ ] **Blue wells spawn and appear correctly** — Should see blue concentric rings
- [ ] **Red wells spawn and appear correctly** — Should see red concentric rings
- [ ] **Wells activate on first hit** — Shoot a well. Should change to magenta color and show pull radius ring
- [ ] **Pull radius ring pulses** — Activated well should show pulsing translucent ring
- [ ] **Red wells show danger zone** — Red wells should have inner red ring when activated

#### Pull Mechanics
- [ ] **Blue wells pull player smoothly** — Walk near activated blue well. Should feel pulled toward center (smooth force, not instant teleport)
- [ ] **Pull strength increases when closer** — Force should be stronger near center, weaker at edge
- [ ] **No pull when outside radius** — Far from well = no effect
- [ ] **Blue wells don't kill** — Can touch blue well center without dying

#### Lethal Mechanics (Red Wells)
- [ ] **Red wells kill on close contact** — Get very close to activated red well center. Should die within danger zone
- [ ] **Red wells pull from distance** — Should still feel pull force from outside lethal radius
- [ ] **Death is immediate** — No gradual damage, instant kill in danger zone

#### Edge Cases
- [ ] **Wells work on all surfaces** — Test on sphere, cube, mobius, torus
- [ ] **Wells consume enemies** — Enemies pulled into well should be consumed (score added)
- [ ] **Wells detonate after 10 consumed** — Well should explode after consuming 10 enemies
- [ ] **Inactive wells don't pull** — Freshly spawned well (not shot yet) should drift but not pull

### Task File
- `tasks/gravity-wells-hazard.md` — Implementation details

---

## How to Report Failures

When something fails, write a note here with:
1. **Which checkbox** failed
2. **What you saw** (exact behavior)
3. **What you expected**
4. **Browser + OS** (Chrome 120 on Windows 11, etc.)

Claude will read this file at the start of each session and prioritize fixing reported failures.

### Failure Notes
<!-- Add failure notes below this line -->


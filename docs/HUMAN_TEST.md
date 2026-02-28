# Human Test Checklist

> **What is this?** Everything Claude has changed that needs YOU to verify in a real browser. Items are grouped by system. Check them off as you go. If something fails, note what happened — Claude will read this file next session.
>
> **Last updated:** 2026-02-28
>
> **Visual Test Results (2026-02-12, commit a722f6a):** Headless Puppeteer + SwiftShader testing completed. Items marked `[V5 PASS]` were verified visually at Level 5. Items marked `[V5 INCONCLUSIVE]` could not be tested headless (need real browser). See `tasks/visual-test-human-todos.md` and `tasks/lan-visual-testing.md` for full details.

---

## S40-03: LAN MP Aim Camera-Frame Correction

**Fix:** In `network-main.ts`, `aimAngle` is now computed using the camera's actual world-space right/up vectors projected onto the surface tangent plane, instead of naively assuming `camera.right == tangentU`. This accounts for camera orbit (middle mouse) and camera-lerp lag. See `src/utils/aimAngle.ts` for the logic.

### Test: Aim is correct regardless of camera orbit

- [ ] Start LAN game (host + 1 client)
- [ ] Move mouse to the RIGHT of center → bullets fly RIGHT on screen ✓
- [ ] Move mouse ABOVE center → bullets fly UPWARD on screen ✓
- [ ] Move mouse BELOW center → bullets fly DOWNWARD on screen ✓
- [ ] Move mouse to the LEFT of center → bullets fly LEFT on screen ✓
- [ ] **Orbit test:** Hold middle mouse and drag to orbit camera ~90°. Bullets should STILL follow the mouse direction (not rotate with the surface tangent frame)
- [ ] **180° orbit test:** Orbit camera ~180°. Bullets should STILL follow the mouse direction (previously this would cause aim to be correct only "every 180°")
- [ ] **Regression (S39-02):** Confirm `atan2(-mouseY, mouseX)` fallback is not triggered (no orbit = same behaviour as before)
- [ ] Test on at least 2 different surfaces (e.g. sphere and torus)

---

## S39-02: LAN MP Aim Direction Fix

**Fix:** Reverted `atan2(mouseY, mouseX)` → `atan2(-mouseY, mouseX)` in `network-main.ts`. The S38d-08 "fix" was wrong — it inverted vertical aim. Root cause: `tangentV = camera.up` = screen UP direction, so mouse-up (aimY < 0) needs `-aimY` positive to produce `+tangentV` (screen up) bullet direction.

### Test: Bullets follow mouse direction in LAN MP

- [ ] Start LAN game (host + 1 client on same device with 2 tabs, or 2 devices)
- [ ] Move mouse to the RIGHT of center → bullets should fly to the RIGHT on screen
- [ ] Move mouse ABOVE center → bullets should fly UPWARD on screen
- [ ] Move mouse BELOW center → bullets should fly DOWNWARD on screen
- [ ] Move mouse to the LEFT of center → bullets should fly to the LEFT on screen
- [ ] **Regression:** Aim in all 4 diagonal directions — bullets should match mouse angle precisely

---

## S38d-07b: Bullet Paths Straight Near Poles (Vertex Fan Parallel Transport Fix)

**Fix:** Vertex fan traversal in `FaceWalker.ts` now uses proper parallel transport (`transportAcrossEdge`) instead of simple normal projection when crossing between faces at sphere poles. Simple projection caused accumulated angular errors — bullets visibly curved when traveling near north/south poles.

### Test: Bullets travel straight near poles
- [ ] **Start single-player on Sphere** — Use "Play Game.bat" → select Sphere surface
- [ ] **Fire bullets toward north pole** — Aim from equator toward +Y (north). Bullets should travel in a straight great-circle arc toward and through the pole
- [ ] **Fire bullets toward south pole** — Same test heading -Y. No curving.
- [ ] **Fire bullets across the pole** — Position player near a pole and fire through it. Bullet should exit on the far side moving in a consistent direction (not spiraling or veering)
- [ ] **Compare with equator** — Bullets near equator should look the same straightness as bullets near poles
- [ ] **Capsule/Pill surfaces** — Similar pole regions at the end caps; bullets should also travel straight there

---

## S38c-04: Damage Numbers in LAN Multiplayer

**What changed:** Killing-blow damage numbers now spawn in LAN MP. Root cause: server removed enemies in the same tick as the fatal hit, so client never saw `health < prevHealth`. Fix spawns damage number in the dead-enemy detection loop using last known health.

**What to test:**
- [ ] Start LAN game (2 devices or same device with 2 browser tabs)
- [ ] Shoot a basic enemy (grunt/wanderer) — red damage number should appear at the kill
- [ ] Shoot a multi-HP enemy (weaver, spinner) — number should appear on every hit AND on the kill
- [ ] Aura damage (ShockAura buff) also shows numbers (separate fix from S38c-03, should still work)
- [ ] Score popups (white numbers on kill) still appear alongside damage numbers

## S38d-01: Laptop LAN Deep Debug — Error Visibility + Direct Connect

**What changed:**
1. Error panel now shows the FULL error message (was truncated to 120 chars — hiding the real cause)
2. Added "Copy Debug Info" button — copies full diagnostics to clipboard for sharing
3. Added "Direct Connect" input field — bypass lobby by typing host IP directly

**What to test (when laptop fails to connect):**
- [ ] Run `Play Game.bat` on HOST PC
- [ ] On LAPTOP, open `http://[host-ip]:3000/` and try to join via LAN menu
- [ ] If connection fails, the error panel now shows the **FULL untruncated error message**
- [ ] Click "📋 COPY DEBUG INFO" and share the output in the issue/session report
- [ ] The error message should tell us exactly why it's failing (previously hidden)

**If lobby doesn't work — Direct Connect bypass:**
- [ ] When error panel appears, find "DIRECT CONNECT" section at the bottom
- [ ] Type the host's IP address (e.g. `192.168.1.100`) and click CONNECT
- [ ] This bypasses the lobby scan entirely and connects directly
- [ ] If this works but lobby doesn't, the bug is in the lobby scan, not the connection

**What the error message will reveal:**
- "Cannot reach game server" = network/firewall issue
- "WebSocket handshake failed" or "403" = proxy or CORS issue
- "Room not found" or "Lobby closed" = server state issue
- "Invalid schema" = version mismatch between client and server
- Any error longer than 120 chars was previously invisible!

---

## S38c-02: Laptop LAN Connection (Portproxy Fix)

**Root cause identified:** WSL2 portproxy rules from a previous `Setup-WSL-LAN.bat` session intercept laptop connections on port 3000, routing them to WSL2 (which has no server). Host PC works because localhost connections bypass portproxy.

**Pre-test setup (REQUIRED first time):**
1. On the HOST PC, right-click `CLEANUP-PORTPROXY.bat` → Run as Administrator
2. Verify output shows rules removed for ports 3000 and 2567
3. After cleanup, portproxy rules are cleared permanently — no need to repeat

**What to test:**
- [ ] Run `Play Game.bat` on HOST PC (non-admin is fine after cleanup)
- [ ] Verify no portproxy warning appears in the bat output
- [ ] Note the LAN IP shown (e.g., `http://192.168.1.100:3000`)
- [ ] Open that URL on the **LAPTOP** browser (Chrome recommended)
- [ ] Laptop should load the game page (not "connection refused")
- [ ] Go to LAN menu → see the host server in the lobby list
- [ ] Click JOIN → enter name → connect to game
- [ ] Both HOST and LAPTOP should see each other's player in-game
- [ ] Shoot at each other — positions should be synchronized
- [ ] Play a full round (wave 1-3) together — no disconnects

**What happens if portproxy still exists (diagnostics):**
- If `Play Game.bat` detects portproxy + not admin → it HALTS with a CRITICAL ERROR
- Run `CLEANUP-PORTPROXY.bat` as admin to fix, then retry
- If laptop connects but game fails → open DevTools → check for "PORTPROXY CONFLICT DETECTED" in the error panel

---

## S38b-07: Weapon Mastery — 4-Endpoint Branching Tree

**What changed:** Standard (Blaster) weapon now has a 4-endpoint branching tree instead of 2 linear branches. Other weapons unchanged.

**What to test:**
- [ ] Open Weapon Mastery screen (from menu)
- [ ] **Blaster** card shows 4 branch labels: SCATTER, RAPID FIRE, SEEKING, DEVASTATION
- [ ] Tree visually branches at level 4 into 4 separate columns at levels 5-10
- [ ] Clicking a locked node does NOT dim the screen (stopPropagation fix)
- [ ] Clicking a locked node can be dismissed by clicking elsewhere
- [ ] Earn some mastery points and spend them — unlocked nodes show bright gold
- [ ] RAPID FIRE and DEVASTATION branches cost 2 points per node (shows "2 pts" tooltip)
- [ ] SCATTER and SEEKING branches cost 1 point per node
- [ ] Right-click an unlocked node to refund the point
- [ ] All other weapons (Spread, Homing, etc.) still show their normal 2-branch trees

**V5 PASS** (Puppeteer screenshot 2026-02-28): 4 endpoints visible, branch labels correct, unlocked/locked states render properly.

## S38b-06: Mobile UI — Joysticks, HUD Visibility, Pause Button (iPhone)

Test on a real mobile device (iPhone in landscape mode).

**Single-player mobile (`?quickStart=true&surface=sphere&mobile=true`):**
- [ ] Left joystick appears at the BOTTOM-LEFT where you tap (not top-right)
- [ ] Right joystick appears at the BOTTOM-RIGHT where you tap (not top-left)
- [ ] WeaponHUD (weapon inventory panel) is visible in the LEFT side, NOT overlapping score/timer
- [ ] Pause button (⏸) is visible in the TOP-RIGHT corner, not hidden behind notch/home indicator
- [ ] HUD is readable — score, lives, bombs all visible without crowding
- [ ] After URL bar hides (on first interaction), game canvas stays full-screen (no black gap at bottom)

**LAN multiplayer (mobile joins via QR code):**
- [ ] Single-player HUD elements (lives, bombs, boost, combo, timer) are HIDDEN
- [ ] Only LAN-specific HUD shows: team score (center top), per-player score (top right), player list (top left)
- [ ] WeaponHUD visible on the left side without overlapping other elements
- [ ] Pause button (⏸) visible top-right

**The fixes (S38b-06):**
- Added `viewport-fit=cover` to viewport meta — full-screen on notched iPhones
- Pause button now uses `env(safe-area-inset-*)` to avoid home indicator / notch
- WeaponHUD moved from 40px to `max(80px, 20% of screen height)` — below score/timer cluster
- SP HUD elements properly hidden in LAN mode (were all visible before, cluttering the screen)
- Added `window.resize` handler to update canvas when iOS URL bar shows/hides

---

## S37: Cube Tunnel Enemy Visibility (opposite-wall dimming)

Enemies on the inner tunnel wall should stay dim, not brighten when the player is near the lip.

**What to test:**
- [ ] Select **Cube Tunnel** map and start playing
- [ ] Move toward any tunnel face (outer wall) and approach the top lip
- [ ] Enemies visible through/on the inner wall should appear **dim**, not bright
- [ ] Enemies actually adjacent to you on the *same* outer wall should remain **lit**
- [ ] No flickering when standing near the outer wall top (V≈0.44)
- [ ] Enemy dimming transitions smoothly as you move away from an enemy on the same wall

**The bug (before fix):** Standing near the top of an outer face (V≈0.44) caused enemies just inside the inner wall (V≈0.51) to pop to full brightness, despite the physical wall separating them. UV distance was only 0.07 (below 0.08 threshold), triggering the proximity override incorrectly.

---

## S34: i18n Language Selector

i18next-based localization with 4 languages. English is real; Spanish/French/German show `[ES]`/`[FR]`/`[DE]` prefixes as placeholders.

**Automated Level 5 evidence (2026-02-27):**
- Start menu in English: no foreign-language prefixes ✓ (see `test-screenshots/sessions/i18n-verification/10-english-dom-check.png`)
- Surface names in Spanish: show `[ES]` prefix ✓ (see `test-screenshots/sessions/i18n-verification/11-spanish-dom-check.png`)
- localStorage persistence verified ✓

**Human verification required:**

- [ ] Start game → all menus in English (no `[ES]`/`[FR]`/`[DE]` prefixes anywhere)
- [ ] Press Escape → pause menu opens correctly in English
- [ ] In pause menu, find **LANGUAGE** section → 4 flag buttons visible (🇬🇧 English, 🇪🇸 Español, 🇫🇷 Français, 🇩🇪 Deutsch)
- [ ] Click **Español** flag → all pause menu text immediately shows `[ES]` prefix
- [ ] Close pause menu, reopen → still Spanish
- [ ] Reload page → game still in Spanish (`gw_language` persists in localStorage)
- [ ] Click **English** flag → English text restored everywhere (no `[ES]` prefix)
- [ ] Surface names in start menu: in Spanish mode, show `[ES] Sphere`, `[ES] Cube`, etc.
- [ ] Settings menu: all labels show translated text when in Spanish mode
- [ ] Mobile: language flag buttons are tap-friendly (no accidental mis-hits)

---

## S35: Mobile Pause Menu Access (LAN Multiplayer)

Bug: On mobile in LAN mode, the ⏸ pause button did nothing (the `onPause` callback was never wired in `network-main.ts`). Also, the "STOP SERVER" button appeared in the main HUD on mobile, cluttering the screen — it should only be in the pause menu (host-only).

Fix: Wired `input.onPause` in `network-main.ts` to mirror the Escape key handler. Added `!mobile` guard to all `stopServerBtn.style.display = 'block'` assignments.

- [ ] **Mobile pause button works (host)** — On mobile in LAN, tap ⏸ (top-right corner) as the HOST. The pause menu should open, game freezes for all players. Tap ⏸ again (or Resume) to resume.
- [ ] **Mobile pause button works (non-host)** — On mobile in LAN, tap ⏸ as a NON-HOST. The local menu should open ("Game continues — only the host can pause the server"). Resume button closes it.
- [ ] **Stop server in pause menu (host only)** — Open pause menu as host. "STOP SERVER" button should be visible. As non-host, it should not appear.
- [ ] **Stop server NOT in main HUD on mobile** — When playing as host on mobile, the STOP SERVER button should NOT appear in the corner of the screen during gameplay. It should only be accessible from the pause menu.
- [ ] **Non-mobile HUD unaffected** — On desktop/keyboard, "STOP SERVER" button still appears in the HUD corner as before (host only).

---

## S35: Torus Hit Detection Fix (LAN Multiplayer)

Bug: On torus map in LAN multiplayer, hit detection was completely broken. Enemies walked through players without dealing damage. Root causes: (1) server used raw Euclidean UV distance (no wrap-around), so entities near V seam had inflated distance (0.94 instead of 0.06); (2) enemy V coordinate was clamped to 0.05-0.95 (enemies piled up at boundaries and couldn't cross V seam); (3) enemy tracking direction was wrong across V seam; (4) bullet V was clamped instead of wrapped.

Fix: Added `uvDistWrapped()`, `uvDelta()`, `surfaceWrapsV()` helpers to `server/rooms/GameRoom.ts`. All 5 collision checks now use wrap-aware distance. Enemy/bullet V coordinates now wrap correctly on torus.

- [ ] **Enemy hits player on torus** — In LAN MP on torus, let an enemy touch your player. You should take damage (lose a life or die). Before fix: enemies could overlap player with no damage.
- [ ] **Enemies cross V seam** — Watch enemies on torus. They should be able to move smoothly from V≈1.0 to V≈0.0 (crossing the tube seam). Before fix: enemies piled up at the boundary.
- [ ] **Bullets hit enemies near seam** — Fire bullets toward the V=0/1 seam on torus. Enemies near the seam should be killable. Before fix: bullets near seam would miss.
- [ ] **Player dies from expected distance** — Enemy touching you = death. No gaps where enemy overlaps you but no damage occurs.
- [ ] **Sphere/cube not broken** — Verify hit detection still works on sphere and cube maps (these use clamp for V, should be unchanged).

---

## S31: LAN Multiplayer — No Teleport on Hit (2026-02-25)

Bug: In LAN MP, when a player was hit by an enemy (but still had lives), the server teleported them to `(U+0.5, V+0.5)` — the "opposite side" of the surface. The client snapped to this position, causing apparent "random teleportation." Also: players started each new round at their final death position from the previous game.

Fix: Removed the `+0.5` position offset on hit. Player stays at hit location with 2s invincibility. Added `surfaceU/V` reset to spawn offsets when a new game starts.

- [ ] **LAN game with 2 players** — Start a game. Both players should appear at spawn positions near center (U=0.5, V=0.5 for player 1; U=0.6, V=0.5 for player 2).
- [ ] **Player gets hit by enemy** — Player should NOT teleport to a random position. Player should stay in place (or very close to it) with 2s of invincibility (blinking effect).
- [ ] **Player should be able to move away from enemies during invincibility** — The invincibility window gives time to escape.
- [ ] **New round (after voting)** — Players should respawn at spawn positions, not wherever they died in the previous round.
- [ ] **Death (lives=0)** — Player still disappears (alive=false), no regression there.
- [ ] **No other teleportation** — During normal movement, player position should stay consistent with WASD input. No rubber-banding or jumps.

---

## S31: Mobile Pause Menu — Touch Routing Fix (2026-02-24)

Bug: On mobile (landscape), pause menu buttons only highlighted on touch but didn't fire click events. Joystick appeared when touching the menu. Root cause: `TouchInput.handleTouchStart` called `e.preventDefault()` unconditionally, preventing the browser from generating synthetic click events. Fixed by adding `setGamePaused()` — when paused, touch events pass through without preventDefault so buttons work normally.

- [ ] **Open game on mobile (iPhone landscape)** — Tap the pause button (top-right ⏸). Menu should open.
- [ ] **Tap RESUME** — Game should resume, menu should close. No joystick should appear.
- [ ] **Tap SETTINGS** — Settings menu should open. No joystick.
- [ ] **Tap EXIT TO MENU** — Should return to main menu. No joystick.
- [ ] **Joystick check** — While pause menu is open, touching ANY area of the screen should NOT show a joystick. The joystick only appears during gameplay.
- [ ] **Scrolling** — If pause menu content is tall enough to scroll (many buffs), scroll gesture should work, not freeze.
- [ ] **Desktop regression** — ESC key still pauses/resumes on desktop. Mouse clicks on all menu buttons still work.

---

## S28b: Rejoin After Pause — No Dual Host (2026-02-24)

Bug: When a paused game had a player exit to main menu and rejoin, both players saw themselves as host simultaneously. Resume attempt crashed the server.

- [ ] **LAN game with 2 players (one on server machine, one on separate device)** — Start a game. Wait for game to begin.
- [ ] **Player B (server machine / localhost) pauses the game** — Only one player should have the pause control.
- [ ] **Player A exits to main menu** — In the pause menu, click exit. Page redirects to main menu.
- [ ] **Player A rejoins the same server** — Join the room again. Player A should appear as a NON-HOST (no "Stop Server" button, no ability to pause).
- [ ] **Player B resumes the game** — Game should unpause cleanly, both players visible and active.
- [ ] **Server logs should NOT show "Host promoted to localhost player" mid-game** — This log line should only appear during lobby join.
- [ ] **New game after vote** — After game ends and voting screen appears, vote for next game. New game should start UNPAUSED (not frozen).
- [ ] **Host leaving unpauses game** — If the host pauses, then exits to menu, the remaining player should be able to resume without being stuck in a frozen game.

---

## S28a: Pause Menu Buffs/Level/Companions (2026-02-23)

Feature: Pause menu now shows player level badge, active companions, cumulative bonuses, and active buffs.

- [ ] **Press ESC in SP game** — Pause menu should show a "PLAYER LEVEL" section with level number and title (e.g., "5 - Destroyer"). Level 0 "Rookie" section is still visible since player always has a level.
- [ ] **Cumulative bonuses visible** — If at any level above 0 or have any buffs, "CUMULATIVE BONUSES" section shows +X% Damage, +X% Fire Rate, +X% Move Speed.
- [ ] **Active buffs listed** — Pick up a buff drop mid-game, open pause, confirm the buff appears in "ACTIVE BUFFS" section with name, description, and current value.
- [ ] **Companions section** — If you have Protector Drones, Guardian, or Hunter companions active, "COMPANIONS" section appears listing types and counts.
- [ ] **MP pause menu** — In LAN game, pressing ESC shows same player level + cumulative bonuses in the MP pause menu.

---

## S28a: Voting Screen After Round End (2026-02-23)

Bug: After all players died in LAN mode, game restarted immediately with no voting screen shown.
Root cause: `VotingScreen.show()` auto-voted immediately on display → server saw all votes at once → instant relaunch.
Fix: Removed auto-vote from `show()`. Votes now only sent on explicit click.

- [ ] **Start a LAN game with 2 players, die on purpose** — After all lives are gone, voting screen should appear with "CHOOSE YOUR BATTLEFIELD" title, map grid, countdown timer.
- [ ] **Voting countdown visible** — Large yellow countdown timer showing ~30 seconds, ticking down.
- [ ] **Click different surfaces** — Vote badge count on clicked surface should increment. Other player should see the vote count update.
- [ ] **Both players vote for the same surface** — Game should launch that surface (not just reuse old one).
- [ ] **Wait 30 seconds without voting** — Server auto-picks the most voted (or defaults to sphere:waves:medium).
- [ ] **Host LAUNCH NOW button** — As host, clicking "LAUNCH NOW" should immediately start the game without waiting for countdown.
- [ ] **Non-host cannot use LAUNCH NOW** — Non-host should only see vote bubbles, no launch button.

---

## Session 27h Combined Score Display Zero (2026-02-23)

Bug: In LAN (network) mode, `#score-display` (large center-top number under "Wave X") showed "0" and never updated.
Fix: `network-main.ts` now updates `#score-display` with combined team score (sum of all player scores) on each state sync.

- [ ] **Start a LAN game with 2+ players** — The large center number under the wave label should start at 0.
- [ ] **Earn kills/score in LAN mode** — The center number should increase in real-time as players score.
- [ ] **Both players scoring simultaneously** — The center score should reflect the combined sum.
- [ ] **Wave label and score are readable** — "Wave X" appears at top, combined score appears below it (not overlapping).
- [ ] **Multiplier display (x1) is hidden** — The single-player multiplier display should not be visible in LAN mode.

---

## Session 27h Weapon HUD Wrong Weapon (2026-02-23)

Bug: HUD showed wrong weapon (e.g. "Tesla Coil") while player was actually shooting at blaster rate.
Root cause: `pruneDepletedWeapons()` removed depleted weapons from inventory but didn't update `currentWeapon`, so HUD showed the depleted weapon until the player pressed fire again.

- [ ] **Pick up Tesla Coil, let it deplete** — HUD should switch to show Standard (blaster) as active immediately after ammo runs out, NOT continue showing "Tesla Coil [0]".
- [ ] **Pick up Tesla Coil + Homing in inventory, deplete Tesla** — HUD should switch to Homing, not Standard.
- [ ] **HUD weapon display never shows "[0] ammo"** — A weapon with 0 ammo should never appear as the active weapon in the HUD.
- [ ] **Works in local split-screen** — Test with 2 players. Each player's HUD should show their own active weapon correctly.

---

## Session 27g Entity Dimming Fix (2026-02-23)

Bug: On LARGE (scale=1.5) and EPIC (scale=2.0) maps, ALL entities were dimmed including near-side
enemies. Root cause: localDist in DepthOcclusionSystem used world-space distance but BVH uses
local space, causing false occlusion hits on scaled surfaces.

- [ ] **Near-side entities bright on LARGE sphere** — Select sphere surface, choose LARGE map size. Enemies on the same side as you (near camera) should be fully bright, NOT dim. If all enemies look dark even when they're right next to you, bug is not fixed.
- [ ] **Far-side entities still dim** — Enemies on the opposite side of the sphere (behind surface) should still appear noticeably dimmer than near-side enemies.
- [ ] **Works on EPIC size** — Repeat with EPIC map size. Same behavior: near-side bright, far-side dim.
- [ ] **Torus and cube also work** — Try LARGE torus and LARGE cube. Near-side entities should be bright.
- [ ] **MP: same behavior** — In LAN multiplayer on a large surface, near-side entities should be bright.

---

## Session 27c MP Rendering Rearchitecture (2026-02-21)

SP and MP now share rendering setup via `src/rendering/SharedGameSetup.ts`. Test in LAN multiplayer:

### Visual parity (SP vs MP)
- [ ] **Surface colors match SP** — Grid color (blue), surface color (dark indigo), opacity all match single-player
- [ ] **Lighting matches SP** — Same ambient/directional/fill lights as single-player (no washed out or too dark)
- [ ] **Grid visible** — Grid lines visible on all surface types in MP
- [ ] **Cube surface works** — No stuck-in-triangle geometry glitch on cube surface

### Pause fix
- [ ] **Pause freezes enemies** — Press pause in MP. ALL enemies stop moving. They do NOT continue interpolating.
- [ ] **Camera still orbits during pause** — Can still look around while paused

### Tunnel transparency
- [ ] **Grid fades in tunnels** — On cube-tunnel or any enclosed surface, grid becomes transparent when it blocks camera-to-player view

### Connectivity
- [ ] **Laptop can connect via Play Game.bat** — Right-click bat → Run as Administrator. From laptop on same WiFi, navigate to the displayed IP:3000. Game loads and connects.

### Known issues (not fixed by this change)
- Entity colors (green vs blue) — may still be wrong if server sends incorrect type data
- Bullet geodesic paths — may still go to origin if server sends UV (0,0) for new bullets

---

## Session 27 VotingScreen — Valid Options Only (2026-02-21)

After dying in a LAN game (triggers voting phase):

### Surface options — only valid surfaces shown

- [ ] **KNOT and CYLINDER are gone** — The voting screen should NOT show a KNOT or CYLINDER option. The list should be: SPHERE, TORUS, CUBE, PILL, CAPSULE, ICOSAHEDRON, PEANUT, CUBE-TUNNEL (8 surfaces).
- [ ] **ICOSAHEDRON loads correctly** — Vote for ICOSAHEDRON, launch game. The icosahedron surface loads without error or crash.
- [ ] **PEANUT loads correctly** — Vote for PEANUT, launch game. The peanut surface loads without error or crash.
- [ ] **Each surface in the list loads** — Vote for sphere, torus, cube, pill, capsule (one at a time across multiple rounds). Each loads without crash.

### Mode options — only WAVES shown

- [ ] **KING and RAINBOW are gone** — The mode selector should only show WAVES. No KING or RAINBOW option visible.
- [ ] **Game starts as waves** — After voting, game always starts in waves mode regardless.

---

## Session 27 Respawn Location Bug Fix (2026-02-21)

Die to an enemy and wait for respawn.

### Safe Respawn Position

- [ ] **Player respawns away from death location** — After dying, the player should reappear on the OPPOSITE SIDE of the surface from where they died, NOT at the same spot or at the center. Move to one end of the surface, let enemies kill you, verify you respawn far from that spot.
- [ ] **LAN respawn also safe** — In a LAN game, die to an enemy (not boss last-life). Player should reappear at diagonally-opposite UV position, not at the death spot or center.

---

## Session 25 LAN Host Disconnect — Connection Lost Overlay (2026-02-20)

Start a LAN game (host + at least one non-host/client player).

### Client sees "CONNECTION LOST" when host exits

- [ ] **Overlay appears on host kill** — Have the host close their browser tab or stop the server process. Client should see a red "CONNECTION LOST" overlay immediately (< 2 seconds). Game scene freezes behind it.
- [ ] **Reason text shows** — Overlay text should describe reason: "Host disconnected from the game." or "Server connection closed (code X)."
- [ ] **Escape returns to menu** — While "CONNECTION LOST" overlay is shown, press Escape. Browser navigates back to the start screen.
- [ ] **Return button works** — Click "◀ RETURN TO MAIN MENU" button. Navigates to start screen.
- [ ] **No frozen-unresponsive state** — Before this fix, screen was frozen with no way out. After fix, the overlay is always shown and Escape always works.

### Client sees overlay when host uses "STOP SERVER"

- [ ] **Overlay shown on game_ended** — When host clicks the STOP SERVER button (which sends `game_ended`), client gets "The host has ended the game." overlay instead of frozen screen.

### Normal disconnect does NOT show overlay

- [ ] **Player clicking "RETURN TO MAIN MENU" does NOT see overlay** — When a player uses the local menu to return to the main menu themselves, they navigate away cleanly without triggering the connection-lost overlay.

## Session 25 LAN Lerp Convergence Fix (2026-02-20)

### LAN Multiplayer — Enemy Position Consistency (Phase 3)

Test with **two separate devices / browser tabs** on the same LAN:

- [ ] **Enemies appear at same positions on both clients** — Watch a group of enemies for 2-3 seconds. They should be at visually identical positions on both clients, not noticeably offset.
- [ ] **Enemies move smoothly** — No rubber-banding or stutter for enemies (ENEMY_LERP was 0.15, now 0.35 — faster convergence).
- [ ] **Bullets move smoothly** — Bullets should glide smoothly across the surface (BULLET_LERP was 0.3, now 0.5).
- [ ] **Local player still feels responsive** — Local player movement and aiming should feel identical to before (PLAYER_LERP is still 0.2, unchanged).
- [ ] **Newly spawned enemies appear at correct positions** — When a new wave spawns, enemies should appear at correct positions with no snap/pop (snap-on-first-spawn is preserved).

**What was changed (2026-02-20):** Tuned lerp factors in `onRender()` to reduce the convergence window from ~500ms to ~200ms at 60fps. `ENEMY_LERP` 0.15→0.35, `BULLET_LERP` 0.3→0.5, `GEOM_LERP` 0.2→0.3. `PLAYER_LERP` unchanged at 0.2.

---

## Session 25 LAN Surface Type Race Condition Fix (2026-02-20)

### LAN Multiplayer — Surface Type Verification

Open LAN multiplayer with **host choosing a different surface than the URL default**:

- [ ] **Correct surface loads for both players** — Host creates room with cube surface. Client joins. BOTH players should see a cube, not sphere. Check console for any `Surface type mismatch corrected` warnings.
- [ ] **No early entity rendering on wrong surface** — Enemies should NOT briefly appear in wrong positions before the surface loads. (Hard to observe but should be invisible delay < 16ms.)
- [ ] **No entities before confirmation** — If you have a very fast local connection (same PC), enemies should still appear in correct positions.
- [ ] **Surface type shown consistently** — Open `window.__lanDebug.status()` in both clients' consoles. Both should report the same `surfaceType`.

**Root cause fixed (2026-02-20):** Surface type race condition — client would render entities on wrong surface before server confirmed the correct type via `onStateChange`. Fixed by: (1) guarding `onRender` with `surfaceConfirmedFromServer` flag, (2) adding correction warning when mismatch is detected.

## Session 25 LAN Pause Menu — Escape Key (2026-02-20)

Start a LAN game (host + at least one non-host player).

### Non-Host Player (the main fix)

- [ ] **Escape opens menu** — As a non-host player, press Escape during gameplay. A "MENU" overlay should appear.
- [ ] **Menu shows correct options** — Should show: RESUME GAME, RETURN TO MAIN MENU. Should NOT show STOP SERVER.
- [ ] **Warning is visible** — Menu shows "⚠ Game continues — you can still be hit by enemies".
- [ ] **Escape closes menu** — Press Escape again. Menu disappears, game resumes normally.
- [ ] **Resume button works** — Click "▶ RESUME GAME". Menu closes, player movement resumes.
- [ ] **Return to menu button** — Click "◀ RETURN TO MAIN MENU". Disconnects and navigates to the start screen.
- [ ] **Player stops moving while menu is open** — While menu is open, verify other players see this player standing still (zero input sent to server).
- [ ] **Other players unaffected** — Open menu as non-host. Host and other non-hosts should see the game still running normally (enemies moving, their own movement unchanged).

### Host Player

- [ ] **Escape opens menu** — As host, press Escape. Menu appears with RESUME GAME, RETURN TO MAIN MENU, AND STOP SERVER.
- [ ] **Stop Server button works** — Click "⏹ STOP SERVER (ALL PLAYERS)". All players should be disconnected and returned to menu.
- [ ] **Host escape no longer pauses server** — Opening the local menu (Escape) does NOT freeze other players' game. (The old host-only server pause via Escape is replaced by this menu; server-controlled pause still works via other mechanisms.)

**Verification level:** Level 0 (code analysis only) — LAN requires human testing.

---

## Session 26 Visual Styles Playground — Appearance Mismatch & Respawn Fix (2026-02-20)

### Sektori Styles Look Correct in Demo

Open the Visual Styles page → click any **Sektori** style (e.g. "Sektori Cyan", "Sektori Warm"):

- [ ] **Sektori shows vibrant glow, NOT grey/muted** — The grid should glow brightly around the player with the correct color (cyan, warm orange, etc.). Moving around should show the proximity glow follow the player. Should look similar to the thumbnail.
- [ ] **Glow covers most of the surface** — When standing still, the glow should illuminate a significant portion of the grid around the player (not just a tiny dot).
- [ ] **Style matches thumbnail** — The preview thumbnail in the style selector should look roughly like the playable demo.

### Infinite Respawns in Playground

In any Visual Styles playground demo:

- [ ] **Player respawns after dying** — Let an enemy touch you. Player dies (flash), waits ~2 seconds, then respawns at center. Game does NOT end.
- [ ] **No "Game Over" screen** — After dying multiple times in a row, the game continues indefinitely. No game-over state, no black screen.
- [ ] **Lives display shows ∞** — The HUD (top-left stats overlay) shows `LIVES: ∞`, not a countdown number.

**Root causes fixed (2026-02-20):**
- `SektoriGridMaterial.glowRadius` was calibrated for thumbnail scale (surface radius ~3) but used unchanged in demo (surface radius ~11). Now scaled by `surfaceRadius / 3.0` to cover the same proportion of the surface.
- `STARTING_LIVES` was 3. When lives ran out, `GameInstance.onGameOver()` was called. Fixed by passing `lives: 0` (sentinel for infinite) and adding `infiniteLives` logic in `GameInstance.update()`.

---

## Session 25 Playground Aiming + Hit Detection Fix (2026-02-19)

### Visual Styles Playground

Open the Visual Styles page (click any style thumbnail → playable demo launches):

- [ ] **Player faces aim direction** — Move the mouse around; the player ship rotates to face the cursor. Should NOT be on the wrong axis or spinning.
- [ ] **Bullets travel toward cursor** — Fire (click/hold). Bullets should travel in the direction the mouse is pointing.
- [ ] **Bullets hit enemies** — Aim at a visible enemy and fire. Bullets should visually collide and kill the enemy (enemy disappears with particle effect + geom drops). Bullets must NOT pass through.
- [ ] **Smooth 60 FPS** — No lag or stutter during gameplay.

### Weapons Database Playground

Open the Weapons Wiki page → "Try It" button for any weapon:

- [ ] **Player faces aim direction** — Same as above; ship should rotate correctly.
- [ ] **Each weapon type hits enemies** — Cycle through 3+ weapons (the weapon switch buttons). Fire each one at an enemy. All weapon types should kill enemies (not pass through).
- [ ] **No lag** — Should be smooth 60 FPS, no slowdown.

**Root causes fixed (2026-02-19):**
- Cross product order in GameInstance.ts:533 was `crossVectors(aimDirection, playerNormal)` — produces left-handed (mirrored) basis. Fixed to `crossVectors(playerNormal, aimDirection)` matching GameLoop.ts.
- No bullet-enemy collision check existed in GameInstance.update(). Added `_checkBulletEnemyCollisions()` using `bulletPool.forEachActive()` with distance check.

---

## Session 24 Selective Bloom Masking (2026-02-19)

### Bloom Visual Quality — Arena Should NOT Glow, Enemies SHOULD

With bloom threshold at 0.3, only objects with luminance > 0.3 contribute to bloom. The dark arena surface and grid should NOT have a glow halo around them, while enemies, bullets, and the player SHOULD glow.

- [ ] **Arena surface is non-glowing** — The dark blue/black surface mesh should appear as a flat, non-glowing surface. No halo or bloom glow around the surface itself. If the surface appears to "glow" with a foggy bloom overlay, the threshold is too low.
- [ ] **Grid lines are non-glowing** — The arena grid lines should be crisp, dim blue lines without a glow halo. Grid should look like a grid, not a glowing web.
- [ ] **Enemies visibly glow** — Enemies should have a clear bloom glow around them — neon-style glowing shapes. The glow radius should be visible.
- [ ] **Bullets have glow trails** — Fired bullets should leave bright glowing streaks. Neon glow should be clearly visible.
- [ ] **Player ship glows** — The player ship/ship model should have a subtle neon glow around it.
- [ ] **Title screen bloom looks good** — The "GEOMETRY WARS 3D" title in the start menu should have a vivid cyan bloom effect (already verified via Puppeteer Level 5).

**What was verified (2026-02-19):**
- `DEFAULT_BLOOM.threshold = 0.3` in `src/core/Game.ts` — only pixels with luminance > 0.3 bloom
- Arena surface: `MeshBasicMaterial`, color `0x141440`, luminance ≈ 0.091 → **does NOT bloom** ✓
- Arena grid: `LineBasicMaterial`, color `0x2a2aaa`, luminance ≈ 0.201 → **does NOT bloom** ✓
- Enemies: `emissiveIntensity` ≥ 1.2 → **WILL bloom** ✓
- Bullets: `emissiveIntensity` = 0.6 → **WILL bloom** ✓
- Player: `emissiveIntensity` = 0.4 → **WILL bloom** ✓
- 12 regression tests added in `src/rendering/SelectiveBloom.test.ts` (all pass)
- Puppeteer screenshot confirms title + menu bloom looks correct, arena background is dark

**Verification level:** L5 (Puppeteer screenshot). Needs human testing to confirm in-game gameplay bloom quality.

---

## Session 24 LOD System Wiring Verified (2026-02-19)

### LOD (Level of Detail) Enemy Rendering

The LOD system is active and reduces triangle count for distant enemies. Enemies beyond 60 units use simplified icosahedron geometry (MEDIUM), and beyond 120 units use billboard quads (LOW).

- [ ] **LOD geometry switching visible on large maps** — On a map where you can see enemies far away (e.g., sphere or torus with 50+ enemies), enemies far from the camera should appear as simplified glowing shapes (icosahedrons) rather than complex geometry. This is subtle — the key indicator is smoother, more rounded shapes at distance.
- [ ] **No enemy disappearing** — All enemies should remain visible regardless of LOD level. LOD should change geometry shape, not remove enemies.
- [ ] **Positions remain correct** — Enemies at MEDIUM/LOW LOD should still be at their correct world positions (not offset or jittered).
- [ ] **LOD stats visible in F4 overlay** — Press F4 during gameplay with 50+ enemies. The debug overlay should show LOD stats (high/medium/low counts). Confirm the counts change as enemies move closer/farther.
- [ ] **Performance at 200 enemies** — Spawn 200 enemies (multiple wave cycles in Waves mode). FPS should be higher (or at least equal) compared to before LOD was active, due to triangle count reduction for distant enemies.

**What was verified (2026-02-19):**
- `LODManager` is instantiated in `main.ts` (line 619) and passed to `GameContext`
- `GameLoop.ts` calls `ctx.lodManager.update(camera, enemies)` each fixed step (lines 249-251)
- `EnemyInstanceManager.updateInstancesWithLOD()` is called with LOD assignments (lines 257-262)
- `RenderLoop.ts` applies LOD-based opacity adjustments (lines 137-142) and routes visibility to correct batch
- 29/29 LODManager unit tests pass
- 34/34 EnemyInstanceManager unit tests pass (including LOD batch methods)

**Verification level:** L2 (unit tests pass). Needs human testing to confirm visual geometry switching.

---

## Session 22 Camera Jerk Fix (2026-02-18)

### Camera Smoothness on All Maps

- [ ] **Camera follows smoothly on sphere** — Move the player with WASD. Camera should track instantly and smoothly. No "camera repositions itself" after a short delay. Every keypress should produce immediate camera response.
- [ ] **Small movements feel responsive** — Tap a key briefly (single press). Camera should respond immediately, not "dead frame then snap."
- [ ] **No jerk when stopping** — Stop pressing keys abruptly. Camera should stop without any catch-up snap or lurch. Previously the lerp would "finish catching up" after release.
- [ ] **Works on torus, cube, capsule** — Try the fix on multiple map types. Camera up-vector should track the surface normal smoothly on all surfaces.
- [ ] **Orbit (middle-mouse drag) still works** — Middle-click drag to orbit the camera. Should still work correctly.

**What was changed:**
- `src/core/CameraController.ts`: Removed velocity-damped up-vector lerp (`0.15/(1+v*25)`). Now uses `camera.up.copy(bitangent)` directly each frame. lookAt called AFTER the up update. Bitangent is stable (iteration 7 Gram-Schmidt fix) so no smoothing needed.
- `src/core/CameraController.jerk.test.ts` (NEW): 5 regression tests. Run `npm test src/core/CameraController.jerk.test.ts` to verify camera smoothness programmatically.

---

## Session 22 Enemy Visibility Scaling (2026-02-18)

### Far-Side Enemy Culling at High Entity Counts

- [ ] **Far-side enemies hidden at 200+ entities** — Spawn 200+ enemies (Waves mode, wait for many waves). Enemies on the BACK of the sphere (the side you can't see directly) should be invisible or nearly invisible. If you can see glowing enemy shapes through the sphere, that's a failure.
- [ ] **Bosses still visible on far side** — A boss enemy on the far side of the sphere should still be dimly visible (glow effect at ~10% opacity), not completely hidden. Confirms boss threat visibility is preserved.
- [ ] **Smooth horizon fade, no popping** — As you move around the sphere, enemies should gradually fade in as they come over the horizon, not pop in abruptly. Watch the horizon edge carefully.
- [ ] **Near-side enemies fully visible** — Enemies on YOUR side of the sphere (near the player) should look exactly the same as before — no unintended dimming.
- [ ] **Below 150 enemies: no change** — Kill enemies until fewer than 150 are on screen. Far-side enemies should reappear (depth occlusion still hides them behind surface, but the entity-count culling is off).
- [ ] **Player is clearly visible** — Even with 200+ enemies on screen, the player ship/character should be clearly visible. Player is not affected by far-side culling.

### Death Effect Scaling

- [ ] **Shockwave less distorting at 200+ enemies** — When killing many enemies simultaneously (bomb, or heavy shooting in a crowd), the screen distortion (shockwave effect) should be less intense than before. Previously, many simultaneous deaths caused heavy chromatic distortion.
- [ ] **Shockwave still visible at low counts** — With fewer than 100 enemies on screen, death shockwaves should feel the same as before (full intensity).
- [ ] **Boss death still impactful** — A boss death shockwave should still feel significant (though scaled at high counts).

**What was changed:**
- `RenderLoop.ts`: At 150+ entities, regular enemies on the far side of the surface (dot product with camera < -0.10) are hidden. Smooth fade zone near horizon (dot between -0.10 and 0.15). Bosses are exempt.
- `GameLoop.ts`: Death shockwave strength scaled down at high entity counts. Formula: `max(0.3, 1.0 - max(0, count-100)/200)`. At 200 enemies → 0.5×. At 300+ enemies → 0.3× minimum.

**Verification level:** L1 (TypeScript compiles clean). Needs human testing.

---

## Session 21 Camera Smoothing v2 (2026-02-17)

### Camera Smoothing
- [ ] **Camera feels smoother on sphere** — Move around sphere for 30+ seconds. Camera should NOT lurch when crossing triangle edges. Up-vector change should be gradual.
- [ ] **No lurch on pill surface** — Pill has high triangle-edge density. Camera should feel smooth, no visible snapping or lurching upward.
- [ ] **Position still responsive** — Camera should follow player position promptly (no major lag). Position lerp stays at 0.12 as before.
- [ ] **Smooth on all maps** — Test sphere, pill, torus, cube. All should feel smoother than before.

**What was changed:**
- `CAMERA_UP_LERP` lowered from `0.06` → `0.03` (halved — Approach 1)
- Added velocity-based damping: during rapid up-vector changes (triangle edge crossings), lerp factor is further reduced to `0.03 / (1 + velocity * 10)` (Approach 3)
- All regression guards preserved. Position lerp unchanged at 0.12.

**Status:** READY FOR HUMAN TESTING. Branch: task/s21-camera-smoothing-v2.

---

## Session 20 Movement Oscillation Fix (2026-02-17, commit 7e694c2)

### CRITICAL FIX - MUST TEST (Programmatically Verified Level 2)
- [ ] **Forward movement on pill is smooth** — Hold W (forward) for 3+ seconds on PILL surface. Player should move smoothly WITHOUT zigzagging left/right in an "X pattern". Movement should be straight forward.
- [ ] **Diagonal movement on pill is smooth** — Hold W+D (diagonal) for 3+ seconds on PILL surface. Should move in smooth diagonal, NOT stuttering or switching between component axes.
- [ ] **Player rotation is correct** — Rotate player with mouse while moving. Player mesh should rotate around the surface normal (spinning in place), NOT rotating around wrong axis (like rolling or tumbling).
- [ ] **Gun fires toward mouse** — Fire bullets while rotating. Bullets should travel toward mouse cursor position.
- [ ] **No regressions on other surfaces** — Test forward/diagonal movement on sphere, cube, torus. Should be smooth on all surfaces.

**What was fixed:**
User reported "X pattern" oscillation: move forward → shift left → forward → shift right 2x → repeat. Also reported wrong rotation axis. Root cause: MeshWalker._updateTangentFrame() dual Gram-Schmidt projection didn't check for 180° sign flips at triangle edges. When bitangent (forward direction) flipped, control system compensated laterally causing zigzag. Fix: Added sign-flip detection (dot product < 0) and negate to maintain consistent orientation, mirroring CameraController's approach.

**Programmatic Verification (Level 2):**
- 56 MeshWalker tests pass ✅
- 18 camera-relative input tests pass ✅
- Tangent frame stability test passes ✅
- 0 regressions to enemy movement or surface queries

**Status:** READY FOR HUMAN TESTING. Commit 7e694c2 on branch task/s20-player-movement-oscillation-fix.

---

## Session 19 Camera Smoothing Fix (2026-02-17)

### Critical Fix - MUST TEST (Programmatically Verified Level 4)
- [ ] **Diagonal movement feels smooth** — Hold W+D (diagonal) on sphere/torus for 5+ seconds. Camera should follow smoothly WITHOUT visible snapping or alternating between showing right-then-forward-then-diagonal directions. The movement should feel fluid, not jerky or "stilted."
- [ ] **Camera follows without lag** — Move in any direction. Camera should track the player responsively without noticeable delay (lerp 0.2 = ~12 frames to converge 90%).
- [ ] **Gun still aims at mouse** — Fire while moving in various directions. Bullets should travel toward mouse cursor, not at wrong angles.
- [ ] **No regression on other surfaces** — Test on sphere, cube, torus, pill. Movement should feel smooth on all surfaces.

**What was fixed:**
User reported diagonal movement felt "stilted/broken" with camera "going in one of those two directions (that builds the diagonal), then the other, before going back to diagonal" causing jerky oscillation. Root cause: tangent frame flips at triangle edge crossings exposed by instant camera follow (zero lerp from Session 19 attempt). Solution: Re-enabled camera smoothing with lerp factors (position 0.2, up vectors 0.15) to filter single-frame jumps while maintaining responsive following.

**Programmatic Verification (Level 4):**
- Camera stability tests: ✅ 5/5 passed
- Gun direction accuracy tests: ✅ 8/8 passed
- Movement direction drift tests: ✅ Diagonal oscillation test now PASSES (was expected to fail)
- TypeScript compiles clean (0 errors in CameraController.ts)

**Status:** READY FOR HUMAN TESTING. Commit pending (branch task/s19-camera-meshwalker-fix).

---

## Session 15 Player Movement Fix — Iterations 6-9 (2026-02-13/14)

### Critical Bug Fix - MUST TEST (Programmatically Verified Level 2)
- [ ] **Cube lateral movement is smooth** — Press D (right) on CUBE surface for 3+ seconds. Player should move smoothly rightward without oscillating or reversing direction.
- [ ] **No chevron spinning** — Press A or D on sphere for 5 seconds. The player chevron should NOT spin rapidly or show multiple copies in the same spot.
- [ ] **No map jumping** — Hold D for 5 seconds on sphere. The map/sphere should rotate smoothly, NOT jump in large discontinuous steps.
- [ ] **Forward movement is smooth** — Press W for 5 seconds. Player should move in a consistent direction, NOT veer left/right or jitter.
- [ ] **Diagonal movement works** — Press W+D for 5 seconds. Player should move in smooth diagonal arc, NOT "square fashion" with 90° snaps.
- [ ] **All surfaces work** — Test on sphere, pill (capsule), cube, and torus. Movement should be smooth on all.

**What was fixed (iterations 6-9):**
1. **Iteration 6:** Tangent frame swap hysteresis, orientation slerp smoothing, camera convergence speed increase.
2. **Iteration 7:** Dual Gram-Schmidt tangent frame transport (replaced swap-based approach).
3. **Iteration 9 (LATEST):** HalfEdgeMesh seam edge linking. ROOT CAUSE: Beveled cube geometry has seams where two halves of each face are built independently, creating false boundary edges. The geodesic walker reflected at these boundaries, causing 188/299 lateral displacement reversals. Fix: `_linkSeamEdges()` proximity-based edge matching (tolerance 0.05) links edges across geometry seams. Result: 2/299 reversals (only at true cube corners).

**Programmatic Verification (Level 2):**
- 65/65 movement tests pass (18 camera-relative + 27 surface + 17 integration + 3 cube-lateral)
- 3 new regression tests verify no false boundary edges, smooth seam crossing, and <5 reversals in 300 frames
- 0 regressions introduced
- TypeScript compiles clean (0 errors in changed source files)

**Status:** READY FOR HUMAN TESTING at 60 FPS (Level 6 verification needed). Commit 1635dbf.

### Iteration 10 — Cross-Surface Diagnostic Fix (2026-02-14)

**Puppeteer Level 5 verified (6/8 surfaces ALL PASS):**
- [x] Sphere: lateral, forward, diagonal all pass (wobble < 0.10)
- [x] Pill: lateral, forward, diagonal all pass (wobble < 0.08)
- [x] Torus: lateral, forward, diagonal all pass (wobble < 0.09)
- [x] Capsule: lateral, forward, diagonal all pass (wobble < 0.09)
- [x] Peanut: lateral, forward, diagonal all pass (wobble < 0.07)
- [x] Icosahedron: lateral, forward, diagonal all pass (wobble < 0.08)
- [ ] Cube: forward wobble 2.954, diagonal zigzag 0.50 (known geometric limitation — beveled edges)
- [ ] Pipe: lateral wobble 0.214, forward wobble 0.820 (known geometric limitation — tight curvature)

**What was fixed (iteration 10):**
1. Puppeteer diagnostic timing — player was dying before invincibility took effect on some surfaces
2. CameraController.targetUp lerp smoothing (factor 0.4) — reduces movement axis disruption at cube edges

**Status:** READY FOR HUMAN TESTING. Commit 1998383.

---

## Session 13 Game Regression Fixes (2026-02-12)

### Critical Bug Fixes - MUST TEST (Programmatically Verified Level 4)
- [ ] **Player movement is smooth** - Move with A/D keys on sphere surface for 30 seconds. Player should NOT have visible up/down jitter or wobble during horizontal movement.
- [ ] **Bullets can hit enemies without freezing** - Spawn multiple enemies, shoot them continuously for 60 seconds. Game should NOT freeze when bullets hit enemies.
- [ ] **Enemy positions update correctly** - Watch enemies move around surface. They should move smoothly without getting stuck or teleporting. Check minimap (if visible) to confirm enemy positions update.

**Programmatic Verification (Level 4):** All 3 fixes passed 60-second integration test:
- ✓ Collision freeze: 3525 frames advanced continuously (no freeze)
- ✓ Enemy UV sync: Enemy UV coordinates updated correctly (Δ0.153 UV units)
- ✓ Player movement: No position discontinuities detected (max Δ3.3 units)

**Status:** READY FOR HUMAN TESTING (Level 6 verification needed for final sign-off)

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
- [ ] **Both players can move smoothly** `[V5 INCONCLUSIVE - died too fast]` — WASD on both tabs, movement should feel responsive (not jerky/teleporting)
- [ ] **Bullets fire in correct direction** `[V5 INCONCLUSIVE - died too fast]` — Aim with mouse, fire. Bullets should go toward crosshair, not random directions
- [ ] **Bullets move smoothly** `[V5 INCONCLUSIVE - died too fast]` — Bullets should glide, not snap/teleport between positions
- [ ] **Geoms (score pickups) move smoothly** `[V5 INCONCLUSIVE - died too fast]` — Same as bullets, should lerp not snap
- [ ] **Enemy movement is smooth** `[V5 INCONCLUSIVE - died too fast]` — Enemies should move fluidly, not stutter at 30fps intervals
- [ ] **Player aim updates while stationary** `[V5 INCONCLUSIVE - died too fast]` — Stand still, move mouse around. Player should visually rotate to face cursor instantly

### Robustness
- [ ] **Tab-out doesn't break movement** `[V5 INCONCLUSIVE]` — Alt-tab away from one tab, come back. Player should stop moving while unfocused, resume on return
- [ ] **No spawn ring ghosts** `[V5 PASS]` — Kill enemies. Should NOT see lingering circular warning rings where enemies spawn
- [ ] **Respawn works** `[V5 POTENTIAL ISSUE - players stayed dead ~90s]` — Die, respawn. Player should be visible and controllable after respawn (not invisible)
- [ ] **Cube surface works** — Select cube map. Player should NOT get stuck at origin (0,0). Can move freely everywhere
- [ ] **Overall feel** — Does it feel like a playable game, or "laggy and weird"?

### Performance
- [ ] **Stable 60 FPS** `[V5 INCONCLUSIVE - SwiftShader]` — Open Chrome DevTools Performance tab. FPS should stay near 60, not dip to 30-40
- [ ] **No debug spam** `[V5 PASS]` — Console should NOT show LAN debug messages unless `?debug` is in URL

### LAN Connection (V5 PASS — re-verified 2026-02-17, 13/13 automated tests PASSED)
- [x] **Host game flow works** — LAN -> HOST GAME -> surface select -> START HOSTING -> ENTER GAME
- [x] **Join game flow works** — LAN -> lobby discovers hosted game -> click to join
- [x] **Both players render** — Both player characters visible on sphere with name labels
- [x] **Enemies spawn in LAN** — Grunts appear and move
- [x] **Score tracking works** — Host scored 100 points, kill log shows "Grunt x2"
- [x] **No console errors** — 0 critical errors on either page
- [x] **Two clients connect simultaneously** — Both get unique session IDs, server shows players.size=2
- [x] **Game stable 17+ seconds** — No disconnects, both clients still connected after extended play
- [x] **User testing required** — Full LAN on two physical devices on same network still needs human test

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

- [ ] **Player movement** `[V5 PASS]` — WASD moves player in all directions on all surfaces
- [ ] **Shooting** `[V5 INCONCLUSIVE - headless mouse events]` — Click to fire, bullets hit enemies, enemies die
- [ ] **Pickups spawn** `[V5 INCONCLUSIVE]` — Kill enemies, weapon/buff/companion pickups appear
- [ ] **Pickup collection** `[V5 INCONCLUSIVE]` — Walk over pickups, buffs activate, weapons switch
- [ ] **Camera controls** `[V5 INCONCLUSIVE - scroll events]` — Mouse wheel zoom, middle mouse orbit
- [ ] **Screen flash** `[V5 INCONCLUSIVE]` — Death/protector activation should flash screen
- [ ] **UI updates** `[V5 PASS]` — Score, multiplier, lives, bombs all update correctly
- [ ] **Pause menu** `[V5 PASS]` — ESC opens pause, shows stats, can resume

### Refactor Task File
- `tasks/refactor-main-god-function.md`

---

## Game Modes (commit `b7a0923`)

4 new modes added alongside default Waves mode.

- [ ] **Mode selector visible** `[V5 PASS]` — Start menu "Quick Game" should show mode dropdown
- [ ] **Waves mode** `[V5 PASS]` — Default behavior, enemies spawn in waves
- [ ] **King mode** `[V5 PASS]` — Safe zones appear, must stand in zone to score
- [ ] **Rainbow mode** `[V5 PASS]` — Kill enemies in color order for bonus multiplier
- [ ] **Sniper mode** `[V5 PASS]` — Limited ammo, precision kills rewarded
- [ ] **Claustrophobia mode** `[V5 PASS]` — Shrinking play area

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

## Mobile Pixel Ratio Cap (s24-perf-02) — 2026-02-19

**What was changed:** Mobile devices now cap pixel ratio at 1.5 (was 2.0). Desktop devices are unchanged.
- `src/core/Game.ts`: UA + `devicePixelRatio > 2` detection → `maxPixelRatio = 1.5` for mobile, `2.0` for desktop.
- `src/main.ts`: In the `if (mobile)` block, cap changed from `2` → `1.5`.

**Expected improvement on high-DPI mobile:** ~44% reduction in GPU fill work (1.5² = 2.25 vs 2.0² = 4.0 pixels per CSS pixel). Should improve FPS on 3x/4x/5x displays (modern iPhones, Samsung Galaxy).

**Expected behavior on desktop:** ZERO change. Desktop devices have pixel ratio 1.0–2.0, so the cap of 2.0 is unchanged.

- [ ] **Test on mobile device — visually acceptable** — Open the game on an iPhone or Android device with high-DPI display (pixel ratio ≥ 3). Game should look sharp and smooth. Slightly less crisp than before (1.5x vs 2x) but not noticeably blurry.
- [ ] **Desktop unchanged** — Open on a desktop/laptop. Rendering should look identical to before. Press F4 to open debug overlay and confirm pixel ratio is NOT affected (still uses native ratio up to 2.0).
- [ ] **FPS improvement on mobile** — On a 3x+ display, the game should run measurably smoother than before, especially on mid-range devices.

---

## Performance (commits `07aee82`, `a960932`)

- [ ] **No FPS crater at high scores** `[V5 INCONCLUSIVE - SwiftShader]` — Play until 450M+ score. FPS should stay above 30
- [ ] **Explosion particles don't tank FPS** `[V5 INCONCLUSIVE - SwiftShader]` — Chain explosions (many enemies dying at once) should not drop below 30fps
- [ ] **Performance graphs work** `[V5 PASS]` — Pause menu → Performance → graphs should display data

### Performance Profiling Overlay (NEW — 2026-02-16)

Real-time performance profiler that shows CPU hot spots during gameplay. Part of Phase 3 of the profiling dashboard.

- [ ] **Profiling overlay toggles with F5** — Press F5 → overlay should appear in top-right corner
- [ ] **Shows top 8 CPU consumers** — Overlay should list 8-10 systems/scopes sorted by time (e.g., "enemy_update", "render_draw", "particle_update")
- [ ] **Frame time is visible** — Should show current frame time (e.g., "13.2ms") vs budget (16.67ms for 60fps)
- [ ] **Percentage and visual bars** — Each scope should show percentage of frame budget and a visual bar chart
- [ ] **Color-coded frame time** — Green when under 80% budget, orange 80-100%, red over 100%
- [ ] **Profiling ON/OFF button works** — Click button in overlay → profiling should toggle on/off (status text updates)
- [ ] **No performance impact when hidden** — Press F5 to hide → FPS should not change (overlay only updates when visible)
- [ ] **Updates in real-time** — Watch overlay during gameplay → values should update every ~200ms reflecting current CPU usage
- [ ] **Test during explosion spike** — Spawn 200+ enemies, cause mass explosions → overlay should show which system is the bottleneck

### Performance Task Files
- `tasks/fps-crater-reinvestigate.md`
- `tasks/perf-graphs-reinvestigate.md`
- `tasks/performance-drops-450m.md`

---

## Visual Features (various commits)

- [ ] **Enemy opacity behind surfaces** `[V5 INCONCLUSIVE - SwiftShader]` — Enemies on the far side of the surface should be nearly invisible (6% opacity), not glowing through
- [ ] **Enemy surface glow** `[V5 INCONCLUSIVE - SwiftShader]` — Enemies should cast a colored glow on the surface beneath them
- [ ] **Visual styles playground** `[V5 PASS]` — Start menu → Visual Styles → click a style → demo should load and be playable (not spinning wildly)
- [ ] **Weapon playground** — Start menu → Weapons → playground should work (USER VERIFIED WORKING in `bffc333`)
- [ ] **Visual playground collision radius** `[V5 INCONCLUSIVE - needs gameplay]` — In Visual Styles demo, enemies should NOT kill you from far away. Must physically touch enemy to die. (Was 1.7-3.3x too large, now matches main game's CollisionSystem.ts)
- [ ] **Visual playground scroll zoom** `[V5 PASS]` — In Visual Styles demo, scroll wheel zooms camera in/out (matching Weapon Playground behavior)
- [ ] **Visual playground style switching** `[V5 PASS]` — Open Gold Luxury demo → BACK → open Sektori Cyan → should show cyan glow (NOT gold). Try 3+ style switches in a row.

### Visual Task Files
- `tasks/enemy-opacity-behind-surfaces.md`
- `tasks/enemy-surface-glow.md`
- `tasks/visual-styles-playground-broken.md`
- `tasks/visual-styles-playground-v2.md`

---

## Difficulty & Gameplay (commit `07aee82`)

- [ ] **Difficulty feels challenging** `[V5 PASS - enemy count 4->13->400]` — Should get hard by wave 5-10, not trivially easy forever
- [ ] **Enemy speed scales** `[V5 INCONCLUSIVE]` — Later enemies should be noticeably faster
- [ ] **Cube-tunnel speed** `[V5 INCONCLUSIVE]` — Enemies on cube-tunnel should move at similar speed to other surfaces (not 10x faster or 10x slower)

### Difficulty Task Files
- `tasks/difficulty-still-too-easy.md`
- `tasks/cube-tunnel-speed-normalization.md`

---

## WebGPU (UPDATED 2026-02-12 — 3 bugs fixed)

**Fixed:** Silent fallback detection, missing powerPreference, zero diagnostics. Previously the game could REPORT "WebGPU" while actually using WebGL2.

### Step 1: Check your system
- [ ] **Open Chrome DevTools console** → type `__webgpuDiagnostic()` → run it
  - Should show green PASS for navigator.gpu, adapter, and device
  - If any show red FAIL: the diagnostic will explain WHY and how to fix it
- [ ] **Open chrome://gpu** in a new tab → search for "WebGPU" → should say "Hardware accelerated"
  - If it says "Disabled" or "Software only": update your GPU driver

### Step 2: Test WebGPU activation
- [ ] **Start game normally** (`npm run dev` or Play Game.bat) → open Chrome console
  - Console should show `[GPUCapabilities]` group with `WebGPU: available (adapter: ...)`
  - Console should show `[RendererFactory] Created WebGPU renderer (backend: WebGPUBackend)`
  - If you see `WebGPU: NOT AVAILABLE`: the diagnostic in Step 1 explains why
- [ ] **Check Debug Overlay** — Press F4 → should show "WebGPU" in cyan text (not "WebGL2" in blue)
- [ ] **Check Profiling Overlay** — Press F5 → should show real-time performance profiler with top 8 CPU consumers, frame time, and visual bars
- [ ] **Check Settings menu** → System Info → Active Renderer should say "WebGPU"

### Step 3: If WebGPU works, test it
- [ ] **Bloom effects work** — Neon glow visible on WebGPU (not flat/dark)
- [ ] **Bloom settings update in real-time** — Open settings, adjust bloom strength → should change immediately
- [ ] **Visual styles change bloom** — Switch visual styles → bloom should update per style
- [ ] **Fallback works** — Add `?renderer=webgl` to URL → should use WebGL2 with full bloom

### Step 4: If WebGPU does NOT work
- [ ] **Note the error** — What does `__webgpuDiagnostic()` say? What does chrome://gpu say for WebGPU?
- [ ] **Write it here** so Claude can investigate further

### WebGPU Task Files
- `tasks/webgpu-feasibility-research.md` — 3 bugs found and fixed
- `tasks/webgpu-optimization.md` — Previous WebGPU work (bloom settings)

---

## Adventure Mode (NEW — 2026-02-12)

50-level campaign mode with progressive difficulty, star ratings, and level progression.

### Level Select UI
- [ ] **Adventure button visible** `[V5 PASS]` — Start menu shows "ADVENTURE" button as primary option
- [ ] **Level grid displays** `[V5 PASS]` — Click Adventure → shows all 50 levels in 6 sections (Sapphire, Ruby, Emerald, Opal, Amethyst, Topaz)
- [ ] **Locked levels show lock icon** `[V5 PASS]` — Levels after the first should show 🔒 if not unlocked
- [ ] **Star ratings display** — Completed levels should show ★★★ or ★★☆ etc. based on performance
- [ ] **Section headers visible** `[V5 PASS]` — Each gem section (Sapphire, Ruby, etc.) should have a visible header

### Level Gameplay
- [ ] **Level starts on click** `[V5 PASS]` — Click an unlocked level → game should start on the level's surface
- [ ] **Scripted waves spawn** `[V5 PASS]` — Level should spawn specific enemy waves (not random endless waves)
- [ ] **Lives/bombs/time match level** — Check pause menu → stats should match the level's config (e.g., Level 1 has 3 lives, 60s time limit)
- [ ] **Timer counts down (Deadline mode)** `[V5 PASS]` — Levels with time limits should show countdown timer
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
- [ ] **Can't click locked levels** `[V5 PASS]` — Locked levels should be disabled/unclickable
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

## Visual Styles Consistency (NEW — 2026-02-12)

All "Sektori" visual styles renamed to include "Dark" in the name, and lighter variants added.

### Naming
- [ ] **Sektori Dark styles** — Open Visual Styles → all Sektori styles should have "Dark" suffix (e.g., "Sektori Cyan Dark", "Sektori Fire Dark")
- [ ] **Lighter Sektori variants exist** — Should see "Sektori Cyan", "Sektori Fire", "Sektori Ice", "Sektori Aurora" WITHOUT "Dark" suffix
- [ ] **Total preset count is 42** — Should see 42 visual style thumbnails (was 38 before)

### Visual Appearance
- [ ] **Dark variants are dark** — "Sektori Cyan Dark" should have very dim surface (mostly see grid + glow)
- [ ] **Light variants are lighter** — "Sektori Cyan" (no Dark) should have MORE visible surface (brighter, more opaque)
- [ ] **Same glow effect on both** — Both dark and light variants should have the same proximity tile glow

### Rendering Consistency
- [ ] **Playground preview matches demo** — Click a Sektori style thumbnail → preview should look the same as the playable demo
- [ ] **Demo matches main game** — Apply a Sektori style → start a game → surface opacity and glow should match the demo
- [ ] **All 4 light variants work** — Test Cyan, Fire, Ice, Aurora light variants → all should render correctly with visible surface

### Task File
- `tasks/visual-styles-consistency.md`

---

## Custom Mesh Loading (NEW — 2026-02-13)

**New feature:** Load custom 3D models (.obj, .glb, .gltf) as playable surfaces. Comprehensive documentation in `docs/CUSTOM_MAPS.md` (user guide) and `docs/DEV_CUSTOM_MESHES.md` (developer guide).

### File Loading & Parsing

- [ ] **Load cup.obj via file picker** — Click START GAME → select Mode → "LOAD CUSTOM MAP" → choose `public/meshes/cup.obj` → game starts on custom mesh (player visible on surface)
- [ ] **Load torus.obj via file picker** — Load `public/meshes/torus.obj` → game starts on torus surface
- [ ] **Load bunny.obj via file picker** — Load `public/meshes/bunny.obj` → game starts on bunny-shaped surface
- [ ] **Load sphere-simple.obj via file picker** — Load `public/meshes/sphere-simple.obj` → works like built-in sphere
- [ ] **Load knot.obj via file picker** — Load `public/meshes/knot.obj` → complex topology, enemies move correctly

### Geometry & Movement

- [ ] **Player spawns on surface** — After loading custom mesh, player should be visible on the surface, not inside or floating above
- [ ] **Player can move** — Use WASD to move. Player should move smoothly on the custom mesh in all directions
- [ ] **Enemies spawn on surface** — Enemies should appear on the custom mesh surface, not floating or stuck
- [ ] **Enemies move smoothly** — Enemies should move around the mesh surface without getting stuck, clipping, or teleporting
- [ ] **Diagonal movement works** — Press W+D → player should move in smooth diagonal arc on custom mesh
- [ ] **Camera follows player** — Camera should orient to player's surface normal (not always pointing up), rotate smoothly as player moves

### Error Handling & Edge Cases

- [ ] **Load invalid file (test.txt)** — Attempt to load a text file. Should show error message: "Unsupported file type" or similar. Game should NOT crash
- [ ] **Load empty file** — Create an empty file named `empty.obj`, try to load. Should show error "No mesh geometry found". Game should NOT crash
- [ ] **Load non-existent file** — Try loading a file that doesn't exist. Should show error. Game should NOT crash
- [ ] **File too large (150k+ triangles)** — Create a mesh with >100k triangles, try to load. Should show error "Mesh too large: XXX triangles (max: 100,000)". Game should NOT crash
- [ ] **Drag-and-drop loads file** — (If enabled) Drag a .glb file onto the game window. Should load and start game
- [ ] **Corrupted mesh file** — Try loading a broken/corrupted .glb file. Should show error, not crash

### Gameplay On Custom Meshes

- [ ] **Gameplay is playable** — Game is fully playable on custom mesh (not unplayably difficult or broken)
- [ ] **Scoring works** — Kill enemies, score should increase normally
- [ ] **Weapons work** — Shoot at enemies on custom mesh. Bullets should hit correctly (not miss or curve wrong)
- [ ] **UI is visible** — Score, kill log, minimap (if enabled) should be visible and work correctly
- [ ] **Mode selection works** — Try different game modes (Waves, King, etc.) on custom mesh. All modes should work
- [ ] **Can pause** — Press ESC to pause. Should show pause menu. Resume should work

### Performance

- [ ] **Cup.obj loads fast** — (~2k triangles) Should load in <1 second
- [ ] **Bunny.obj loads reasonably** — (~25k triangles) Should load in ~1–3 seconds, no excessive lag during load
- [ ] **Game runs at 60 FPS on small mesh** — Cup or torus should maintain 60 FPS throughout gameplay (check DevTools Performance tab)
- [ ] **Game is playable on larger mesh** — Bunny (25k triangles) should run at 30–60 FPS (acceptable variance)
- [ ] **No frame stutters on spawn** — When enemies spawn or mesh first loads, FPS should not spike or drop sharply

### Multi-Mesh / Animation (if supported)

- [ ] **Animated mesh loads** — (If animated GLB exists) Load an animated mesh. Animation should play smoothly
- [ ] **Player follows animated surface** — Player should stay on the mesh even as it animates
- [ ] **Enemies work on animated mesh** — Enemies should spawn and move on animated mesh

### Visual Appearance

- [ ] **Mesh is visible** — Custom mesh should be visible in-game (rendered with semi-transparent material like built-in surfaces)
- [ ] **Mesh color is consistent** — All custom meshes use same visual style (semi-transparent dark purple)
- [ ] **UV grid is visible** — (If enabled in debug) UV grid overlay should show longitude/latitude lines on custom mesh
- [ ] **Mesh is properly scaled** — Custom mesh should be similar size to built-in surfaces (not tiny or huge)

### Multiplayer (if applicable)

- [ ] **Custom mesh works in co-op** — Load custom mesh in split-screen mode. Both players should see the same mesh, move correctly
- [ ] **Custom mesh works in LAN** — (If LAN enabled) Host game with custom mesh, join from another computer. Both players see mesh
- [ ] **Multiplayer is smooth** — No lag spikes or desync compared to built-in surfaces

### Documentation

- [ ] **User guide is helpful** — Read `docs/CUSTOM_MAPS.md`. Can you understand how to load a custom map? Is the guide clear?
- [ ] **Sample meshes are accessible** — Are the included sample meshes easy to find and load?
- [ ] **Error messages match docs** — When an error occurs, does the message match the troubleshooting guide in `docs/CUSTOM_MAPS.md`?

### Task File
- `tasks/custom-object-loader-s13-phase6-docs.md` — Phase 6 documentation and polish

---

## Debug OBJ Model Panel (s31)

Open the game with `?debug=true` in the URL (e.g. `http://localhost:3000/?debug=true`).

- [ ] **Orange "DEBUG: LOAD MODELS" button visible** — Main menu should show an orange-outlined button labelled "DEBUG: LOAD MODELS" in the bottom button row (next to WEAPON DATABASE, VISUAL STYLES, SETTINGS)
- [ ] **Button opens OBJ panel** — Click "DEBUG: LOAD MODELS". A panel should appear with file upload, preset model buttons, and a 3D preview area
- [ ] **Preset "Cube (OBJ)" loads** — Click the Cube preset. A 3D cube should appear in the preview renderer
- [ ] **Button absent in release mode** — Load the game WITHOUT `?debug=true`. The orange button should NOT be visible

### Task File
- `tasks/s31-debug-object-loading-demo-missing.md`

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


---

## Capsule/Pill Oscillation Fix (s23-unified-movement-fix) — 2026-02-18

- [V5 PASS] **Capsule map: movement is smooth** — Select Capsule map, hold W for 8s. Player should move continuously without oscillation. Previously oscillationRatio=0.327 (FAIL). Now: 0.000 (PASS).
- [V5 PASS] **Pill map: movement is smooth** — Select Pill map, hold W for 8s. Previously oscillationRatio=0.500 (FAIL). Now: 0.000 (PASS).
- [V5 PASS] **All 13/13 surfaces pass the movement audit** — Puppeteer audit confirms all surfaces now have oscillationRatio=0.000 (or near zero for sphere-tunnel=0.024).
- [ ] **Capsule: no jitter at cap poles** — Move player to the very bottom/top of the capsule hemisphere. Movement should be smooth without position jumps.
- [ ] **Pill: same pole test** — Same as above for pill.

**Root cause fixed:** `FaceWalker._computeEntryBary()` used `eps=0.1` as the entry nudge after crossing an edge. This added ~0.09×triangle_height extra world displacement per crossing (discontinuous, untracked). At the cap-cylinder junction, each crossing nudged the player alternately toward the cylinder (+y) and back to the cap (-y), causing oscillation. Fixed by reducing `eps=0.1→0.005` (5× the vertex detection epsilon of 0.001, so no vertex detection issues).

**Puppeteer audit:** 13/13 PASS (was 11/13). Reports saved in `reports/s23-movement-audit-*.html`.
**Regression test:** `src/test/capsule-pill-regression.test.ts` — passes ✅

---

## Half-Resolution Bloom (s24-perf-01-half-resolution-bloom) — 2026-02-19

- [ ] **Bloom glow is still visible** — Play for 30 seconds on any map. Neon glow/bloom should be clearly visible on enemies, bullets, and the player. Should NOT look flat or unlit.
- [ ] **Bloom is not obviously blocky or pixelated** — The glow effect should look soft and smooth, not pixelated. (Half-res bloom may be very slightly softer — this is acceptable and hard to notice.)
- [ ] **No visual artifacting on resize** — Resize the browser window. Bloom should remain correct after resize (no half-size render frozen on screen).
- [ ] **FPS improved vs. previous session** — If you have a baseline FPS reading (F4 overlay), verify it is equal or better than before. Expected improvement: significant on GPU-bound hardware.

**What changed:** `EffectComposer` now runs at 50% of window resolution (e.g., 960×540 instead of 1920×1080) for bloom+vignette post-processing, then upscales to full res for final output. Bloom is inherently blurry so the quality difference is imperceptible while GPU pixel fill is reduced 4×.

**Regression test:** `src/rendering/BloomResolution.test.ts` — 4/4 PASS ✅

---

## Pill Movement Fix (s22-pill-movement-broken-v3) — 2026-02-18

- [ ] **Pill map: forward movement is straight** — Select Pill map, move with W. Trail should be a smooth arc curving around the pill. **Regression**: before fix, the trail was a saw-tooth zigzag, reversing direction every ~5 frames near the south seam.
- [ ] **Pill map: movement doesn't stutter at south pole** — Press W for 3+ seconds near the bottom of the pill. Player should move continuously without reversing or stuttering.
- [ ] **All other maps unaffected** — Sphere, Cube, Icosahedron maps all move smoothly (no regressions from tightening vertex detection epsilon 0.05→0.001).

**Root cause fixed:** `FaceWalker.ts` atVertex detection epsilon was 0.05 — too large. When exiting a triangle near (but not at) a vertex (v≈0.004 < 0.05), the wrong adjacent face was selected with a mismatched alpha, causing position jumps and direction reversals. Fix: tightened epsilon to 0.001.

**Regression test:** `src/test/pill-movement-regression.test.ts` — passes ✅

---

## Geometry Sharing + Mobile Tiers (s24-perf-08-geometry-material-sharing) — 2026-02-19

### Geometry sharing (desktop):
- [ ] **Game runs without crashes** — Play for 60+ seconds. No black screen, no errors in console related to geometry disposal or shared buffers.
- [ ] **Projectile weapons still look correct** — Fire Spread (cyan spheres), Homing (cone), PlasmaMortar (green sphere), GravityGun (torus). All should appear at correct sizes.
- [ ] **BlackHole and Tesla weapons still look correct** — BlackHole shows purple sphere; Tesla Coil shows large wireframe sphere around player.
- [ ] **Weapon pickups still appear** — Pick up any weapon. Rotating octahedron pickup (outer wireframe + inner solid) should appear on the map.
- [ ] **SuperState pickups still appear** — Dot pattern pickups should appear and disappear as you collect dots.

### Mobile tier (test with `?mobile=true` URL parameter):
- [ ] **Mobile mode loads without error** — Add `?mobile=true` to the URL and load the game. Should run, no console errors.
- [ ] **Enemies further away switch to simplified geometry sooner** — At default zoom, distant enemies should appear as low-poly shapes (icosahedron/billboard) while close enemies show full detail. This should be more aggressive than desktop (half the threshold distances).
- [ ] **No glow trails on mobile** — Fast enemies (Mayfly, Rocket, Duck) should NOT have trailing glow effects in mobile mode. On desktop they do.
- [ ] **Particle effects are present but lighter** — Explosions and death particles should still appear, but fewer per event than desktop.

**What changed:**
- Shared geometry cache (`src/rendering/GeometryCache.ts`) — projectile geometries created ONCE, reused across all instances.
- WeaponManager, WeaponPickup, SuperStatePickup updated to use shared geometries.
- Mobile: LOD distances halved (highDistance 60→30, mediumDistance 120→60) — more aggressive LOD on mobile.
- Mobile: Glow trails disabled.
- Mobile: Particle budget pre-set to MEDIUM (60/frame vs 200/frame on desktop).

**Regression test:** `src/rendering/GeometryCache.test.ts` — passes ✅

---

## S26: Map Size Entity Mismatch Fix

### Test: Enemies on correct surface at non-default map sizes
- [ ] **Start a game on sphere with LARGE map size** — Enemies should appear on the same enlarged sphere as the player, not floating inside a smaller ghost sphere.
- [ ] **Start a game on sphere with SMALL map size** — Enemies should appear on the same smaller sphere as the player.
- [ ] **Start a game on sphere with EPIC map size** — Enemies should appear on the same 2x enlarged sphere as the player, not at 1x scale inside it.
- [ ] **Switch between map sizes** — Each size shows enemies correctly co-located with the player surface.
- [ ] **Test on cube at non-default size** — Enemies should appear on the cube faces, not hovering inside a smaller cube.
- [ ] **Test on torus at non-default size** — Enemies should appear on the torus surface, not on a smaller ghost torus inside it.
- [ ] **Pickups appear on the correct surface** — Weapon and buff pickups should appear on the scaled surface, not at original scale.

**What changed:**
- `src/surfaces/MeshSurface.ts`: `initGeodesicPosition()` and `moveGeodesic()` now correctly transform between world space and mesh local space. Previously, geodesic walking happened in local geometry space while MeshWalker expected world space, causing entities to jump to unscaled positions after the first movement frame.
- `src/main.ts`: `makeSurfaceTransformFn()` now accepts and applies `mapSizeScaleFactor` so UV-based entities (pickups, bullets, companions) also appear on the correctly-scaled surface.

**Regression test:** `src/surfaces/MeshSurface.test.ts` — "MeshSurface — map size scale (S26 regression)" — 11 tests covering sphere/cube/torus × SMALL/LARGE/EPIC — passes ✅

---

## S27g: Aim Offset Fix — Shooting Direction Aligned With Mouse Cursor

### Test: Bullets travel where you aim
- [ ] **Open single-player on sphere** — Aim mouse to the right, fire. Bullets should travel right. No angular offset between cursor direction and bullet path.
- [ ] **Aim precisely at an enemy** — Mouse cursor pointing directly at an enemy. Fire. Bullets should hit or travel through where the cursor is pointing.
- [ ] **Die and respawn** — After respawn, immediately aim at an enemy. Bullet direction should match cursor direction from the first shot (no "drift" or offset after respawn).
- [ ] **Move while aiming** — Hold W and aim in various directions. Bullet direction should stay locked to cursor, not drift toward movement direction.
- [ ] **Test on torus** — Same verification: aim is correct, no offset, respawn doesn't cause drift.
- [ ] **Test on cube** — Same verification.
- [ ] **Camera orbit (middle-mouse drag)** — Rotate camera view. Aim direction should still match what cursor points at relative to screen.

**What changed:**
- `src/core/GameLoop.ts`: Aim direction now derived from camera's actual world-space axes (`camera.matrixWorld` columns 0/1 projected onto the surface plane) instead of raw surface tangent/bitangent. Camera lerp lag previously caused a persistent misalignment between cursor direction on screen and bullet travel direction.
- `src/core/GameLoop.ts`: `lastAimDirection` is now reset to `null` on respawn, preventing stale aim direction from old surface location from affecting the first shots after respawn.

**Regression test:** `src/test/s27g-aim-offset.regression.test.ts` — 7 tests covering aligned/lagged camera, multi-surface consistency, degenerate fallback, tangent plane correctness — passes ✅

---

## S27h: Buff List Not Showing — Active Buffs Display Fix

### Test: Buff HUD shows during gameplay (runtime HUD)
- [ ] **Pick up buff in single player** — Kill enemies until a colored buff pickup drops. Walk over it. A small icon should appear top-right of the screen showing the buff type (HOT, TRG, AFT, etc.) and stack count (x1).
- [ ] **Stack multiple buffs** — Pick up the same buff type twice. Stack count should update to x2.
- [ ] **Pick up different buff types** — Multiple different icons should appear stacked vertically in the top-right.

### Test: Pause menu shows active buffs (pause menu ACTIVE BUFFS section)
- [ ] **SP: pause with buffs active** — In single player, pick up some buffs, then press ESC. The pause menu "ACTIVE BUFFS" section should list each buff with name, stacks, and effect description.
- [ ] **MP host: pause with buffs active** — In multiplayer as host, pick up buffs, press ESC. The pause menu should show YOUR buffs (not empty).
- [ ] **MP non-host: pause with buffs active** — In multiplayer as non-host player, pick up buffs, press ESC. The full pause menu appears (not a simple "PAUSED" overlay) showing YOUR buffs.

**What changed (previously fixed in s27h-non-host-pause-menu merge):**
- `src/network-main.ts`: Host's pause menu `setGameData()` call was hardcoded to `buffs: []` — fixed to use `buffManager.getActiveBuffs()`.
- `src/network-main.ts`: Non-host previously saw a simple "Host has paused" overlay with no buff display — now sees the full PauseMenu with their own buff state.

**Regression test:** `src/buffs/BuffManager.test.ts` — 20 tests covering addBuff, getActiveBuffs, onBuffGained callback, maxStack enforcement, rollBuffDrop, multiplier calculations, and pause menu data format — passes ✅


---

## S27h: Sphere Poles Blocked — Vertex Fan Traversal Fix

### Test: Walk to North Pole of sphere surface
- [ ] **Select sphere surface** — Start a game on the "sphere" surface (select from surface menu)
- [ ] **Walk north toward the pole** — Move the player upward toward the top of the sphere. You should be able to walk all the way to the north pole without stopping or circling.
- [ ] **Cross the north pole** — Continue pressing "forward" through the north pole. The player should smoothly pass through and continue walking on the other side of the sphere (camera will reorient).
- [ ] **No spinning or getting stuck** — The player should not circle the pole or freeze when approaching it directly.

### Test: Walk to South Pole of sphere surface
- [ ] **Walk south toward the south pole** — Move the player downward toward the bottom of the sphere. Should be able to reach and cross the south pole without getting stuck.

### Test: Enemies reach poles
- [ ] **Enemies follow you to the poles** — With an enemy chasing you, walk to the north or south pole. Enemies should be able to follow (or at least not get stuck circling the pole region).

**What changed:**
- `src/surfaces/geodesic/HalfEdgeMesh.ts`: Added `canonical[]` (exposed) and `vertexToFaces[]` adjacency map — maps each canonical vertex to all faces sharing it.
- `src/surfaces/geodesic/FaceWalker.ts`: When walking exits through a pole vertex (`atVertex=true`), the new code traverses the vertex fan (all faces sharing that vertex) to find the face on the "other side" and jumps directly into it. Previously only the 3 edges of the current face were checked, which caused the player to circle the pole.

**Root cause:** `THREE.SphereGeometry` UV spheres have all cap triangles sharing a single pole vertex. The geodesic walker couldn't cross this vertex to reach non-adjacent faces — it could only step to neighboring cap triangles, causing the player to circle.

**Regression test:** `src/surfaces/geodesic/geodesic.test.ts` — 2 new pole-crossing tests (north + south) — passes ✅


---

## S28a: Player Teleporting Randomly — MP Respawn Snap-Back Fix

### Test: No teleportation after death in multiplayer
- [ ] **Start local multiplayer** — Select 2-player split-screen mode
- [ ] **Let a player die** — Allow Player 1 or Player 2 to be killed by an enemy
- [ ] **Wait for respawn** — After the respawn delay, the player should appear at their fixed spawn UV position
- [ ] **Move immediately after respawn** — Press movement keys immediately after respawn. **The player should NOT snap back to the death location.**
- [ ] **Play 5+ minutes** — No random teleportation events should occur during extended play

### Test: No teleportation in single player
- [ ] **Play single player for 5+ minutes** — Movement should remain smooth; no random position jumps
- [ ] **Die and respawn in SP** — First move after respawn should continue from respawn position, not snap back to death

**What changed:**
- `src/multiplayer-main.ts:919-922`: Replaced direct walker assignment (`.position.copy()`, `.normal.copy()`, `.faceIndex =`) with `walker.teleportTo()`. This was the same bug fixed in GameLoop.ts (SP path) in task s27g — the MP path was missed.
- `src/test/PlaygroundTestHarness.ts:1016-1021`: Fixed same pattern in test harness to use `_meshSurface.closestPointOnSurface()` + `teleportTo()`.

**Root cause:** `_facePos` (internal geodesic state in MeshWalker) was not reset on respawn in multiplayer. First movement after respawn started geodesic walk from stale death location, teleporting player back.

**Regression test:** `src/test/s27g-respawn-snap-back.regression.test.ts` — 3 existing tests covering this exact teleportTo() behavior ✅

## S28c: Plasma Mortar — Phase 2 Shockwave Effects

### Test: Plasma mortar visual impact
- [ ] **Pick up plasma mortar weapon** — Find a plasma mortar pickup on the surface
- [ ] **Fire at surface** — Aim at the surface mesh and fire
- [ ] **Wave deformation visible** — The surface grid should show a **propagating ring deformation** expanding outward from impact (not instant kick)
- [ ] **Pronounced screen shake** — Screen shake should be noticeably stronger than other weapons (0.5 intensity vs 0.15 for homing)
- [ ] **Shockwave ring effect** — A screen-space shockwave ring should appear at the impact point and expand outward
- [ ] **White flash** — Brief white flash on impact
- [ ] **Chromatic aberration** — Brief color fringing on impact

### Test: Enemy knockback
- [ ] **Enemies near impact are knocked back** — Enemies within ~3 world units of the plasma mortar impact should be flung away from the explosion center
- [ ] **Falloff feels right** — Enemies very close get more knockback; those at the edge get less

### Test: Multiplayer
- [ ] **Same effects in multiplayer split-screen** — Wave deformation, screen shake, and enemy knockback should all work in 2-player mode

**What changed:**
- `src/effects/SurfaceShockwave.ts`: New class (Phase 1) — propagating deformation ring
- `src/core/GameContext.ts`: Added `surfaceShockwave: SurfaceShockwave` field
- `src/core/GameLoop.ts`: Added `ctx.surfaceShockwave.update(dt)` alongside `surface.updateGrid(dt)`
- `src/main.ts`: Created `SurfaceShockwave` instance; upgraded plasma mortar explosion (propagating wave, stronger shake, shockwave ring, white flash, chromatic aberration, enemy knockback)
- `src/multiplayer-main.ts`: Same upgrades (minus post-processing effects which aren't set up in MP)

## S32: MP Lobby Touch Routing Fix (iPhone)

**Root cause:** `TouchInput` called `e.preventDefault()` on all `window` touch events, blocking browser click generation on DOM lobby buttons. Fixed by calling `setGamePaused(true)` at lobby start (and on all non-playing phases), `setGamePaused(false)` when game actually starts.

### Test: MP lobby buttons on iPhone (host)
- [ ] **Join as mobile host** — Scan QR / open LAN URL on iPhone, become the host (first to join)
- [ ] **"START GAME" button responds** — Tap it; game should start (no joystick should appear)
- [ ] **"STOP SERVER" button responds** — If visible, tap it; should navigate back to menu
- [ ] **No joystick when tapping buttons** — Verify joystick does NOT appear during button taps

### Test: Joystick works after game starts
- [ ] **Joystick active once playing** — After host taps "START GAME" and game begins, virtual joystick should respond normally to touch

### Test: No desktop regression
- [ ] **Desktop mouse still works** — Open in browser on PC, verify Start Game / Stop Server buttons respond to mouse clicks normally

## S34: Pickup/Arrow System Alignment Fix

**Root causes fixed:**
1. Pickups spawned at wrong UV position (worldToSurface ignored worldRotation)
2. Arrow sprite too small
3. Bob animation didn't work (was overridden by surface transform)

### Test: Pickup spawning and collection (all surfaces)
- [ ] **Kill an enemy** — A pickup should appear WHERE the enemy died (not somewhere random)
- [ ] **Arrow visible** — A downward-pointing arrow above the pickup, clearly visible and flashing
- [ ] **Arrow above pickup** — Arrow should be directly above the pickup visual, not offset to the side
- [ ] **Collect pickup** — Walk over the pickup; it should be collected when player touches it

### Test: Torus surface specifically
- [ ] **Kill enemies on torus** — Pickups appear at correct positions on torus (both inner and outer surfaces)
- [ ] **Torus collection works** — Walking over pickups on torus collects them (was broken due to worldRotation bug)
- [ ] **[S35 NEW] Arrow points AT pickup (torus)** — Arrow should appear ABOVE the pickup and point DOWN toward it. Previously the arrow pointed away (below/opposite) when pickups were far around the ring from the player. Fixed by using camera.up instead of bitangent_at_pickup to position the sprite.
- [ ] **[S35 NEW] Arrow correct on other surfaces** — Kill enemies on sphere, cube, peanut, cylinder and confirm arrow always appears above the pickup pointing toward it (same fix, universal).

### Test: Arrow visual improvements
- [ ] **Arrow is prominent** — Arrow sprite is bigger and brighter than before (2x larger, with glow halo)
- [ ] **Arrow pulses** — Arrow flashes/pulses to attract attention
- [ ] **Arrow bounces** — Arrow bounces up and down above pickup
- [ ] **Pickup bobs** — Pickup visual bobs up and down along the surface normal

## S35: Cube MP Camera 180° Rotation Fix

**Fix:** MeshWalker bitangent sign-flip protection prevents 180° camera rotation when crossing cube face edges in multiplayer.

### Test: Cube multiplayer — walk between faces, verify no camera flip
- [ ] **Start multiplayer on cube** — Open multiplayer, select cube surface, start game
- [ ] **Walk between all faces** — Move player between front/back/left/right/top/bottom faces
- [ ] **No 180° flip** — Camera should NOT suddenly rotate 180° (view should stay consistent)
- [ ] **Controls stay intuitive** — After face transition, "up" still moves the direction you expect
- [ ] **Camera may tilt** — Camera IS allowed to tilt/orbit over one axis (this is normal for cube surface walking)
- [ ] **Tested on single-player too** — Walk between cube faces in single-player, same behavior


## S36: FractalSnake Variants in KotH

**Fix:** EnemySpawner now cycles through all 4 FractalSnake head variants sequentially (standard → triple_inner → double_outer → pulsing) instead of random selection. KingMode now spawns FractalSnakes at 10s, 18s, 26s, 34s (staggered) to guarantee all 4 variants appear within the first 35 seconds.

### Test: All 4 FractalSnake variants visible in KotH
- [ ] **Start KotH mode** — Quick Game → King → Sphere → Start
- [ ] **Snake spawns at ~10s** — A FractalSnake should appear around 10 seconds in
- [ ] **Snake has standard head** — First snake should have the default triangular head
- [ ] **Snake at ~18s** — Second snake with triple_inner head (extra inner triangle geometry)
- [ ] **Snake at ~26s** — Third snake with double_outer head (outer doubled frame)
- [ ] **Snake at ~34s** — Fourth snake with pulsing head (animated pulsing geometry)
- [ ] **All variants visually distinct** — Each of the 4 snakes should look noticeably different
- [ ] **Follower chain visible** — Each snake has a double row of 4 followers behind the head (8 followers total)
- [ ] **Kill head → followers released** — On head kill, followers become independent enemies


## S38b: LAN MP Hit Detection — Sphere Fix

**Fix:** Server-side collision on sphere now uses great-circle world-space distance instead of UV Euclidean distance. Old threshold (0.04 UV ≈ 1.26 world units) was 3× too large. New threshold (0.5 world units) matches visual entity sizes (player 0.15 + enemy 0.30 + margin).

### Test: LAN multiplayer sphere hit detection
**Requires:** Two devices on same LAN. Start server with `npm run server`.

- [ ] **Start LAN game on sphere** — Both players connect, Sphere map selected
- [ ] **Enemies don't kill at distance** — Stand near an enemy but not visually touching → should NOT lose life
- [ ] **Enemies kill on contact** — Move into an enemy until visually overlapping → SHOULD lose life
- [ ] **Test near north pole** — Move to top of sphere (near pole) and repeat above checks
- [ ] **Pickup collection** — Walk over a weapon pickup → should collect when visually overlapping, not from distance
- [ ] **Enemy at pickup glow** — Enemy enters the glow of a nearby pickup item → should NOT cause life loss
- [ ] **Life loss gives invincibility** — After being hit, brief invincibility (enemies pass through) → then normal again

## S38b-01: LAN Laptop Connection Regression (creator flag fix)

**Fix:** Laptop joiners were incorrectly receiving `creator=1` URL param (→ `requestHost=true` in Colyseus), which should only be set for the HOST (PC clicking HOST GAME → ENTER GAME). Without this fix, laptops joining via LAN lobby try to claim the host role, which can prevent the game from starting properly.

### Test: Laptop can join LAN game
- [ ] **Start LAN host on PC** — Run "Play Game.bat", go to LAN tab, click HOST GAME, then ENTER GAME
- [ ] **Laptop joins from LAN lobby** — On same WiFi, open laptop browser to PC's IP:port. The LAN lobby should appear. Click the server entry. Enter name. Click Join.
- [ ] **Game starts for both players** — Both PC and laptop should load into the game simultaneously without one being stuck on loading screen
- [ ] **PC is the host (Player 1)** — The PC player should appear as Player 1 / host
- [ ] **Laptop is the joiner (Player 2)** — The laptop player should appear as Player 2 / joiner, NOT trying to be host
- [ ] **Phone can also join** — QR code / phone join should still work alongside the laptop

### Test: Phone join still works (regression check)
- [ ] **Scan QR code on phone** — Should join as non-creator (same as before)
- [ ] **Manual IP connect on phone** — Enter server IP manually → should join as non-creator

---

## S38b-03: Geodesic Bullets in LAN (UV Wrap Fix)

**Fix:** Bullet lerp in network-main.ts now uses wrap-aware delta to take the shortest path around UV boundaries. Without this fix, bullets teleport/snap to wrong positions when crossing the u=0/1 boundary (server wraps with modulo, client lerped the long way around).

### Test: Bullets follow geodesics in LAN gameplay
- [ ] **Start LAN game** — Use "Play Game.bat" → LAN mode, connect two clients
- [ ] **Fire bullets on Sphere** — Bullets should curve following great-circle geodesics, same as single-player
- [ ] **Fire bullets on Torus** — Bullets should curve on torus surface without teleporting at UV boundaries
- [ ] **Fire bullets on Cube** — Bullets move in straight UV lines (flat UV is expected/correct for cube)
- [ ] **Fire bullets near u=0/u=1 boundary** — Bullets should NOT teleport when crossing the wrap boundary
- [ ] **Fire bullets on Peanut** — Bullets should curve with 2-axis metric correction
- [ ] **Fire bullets on Pipe/Mobius/Cube-Ring/Cube-Tunnel** — No teleportation at V boundary either
- [ ] **Visually matches single-player** — LAN bullet paths should look the same as SP bullet paths

## S38c-01: MP Bullets Not Curving Toward Poles (Regression Verification)

**Investigation:** S38b-03 UV wrap fix IS in the code. Server geodesic math pushes bullets AWAY from poles (toward equator), not toward poles. Root cause of user-reported pole convergence is most likely s38c-00 (changes not visible due to deployment issue).

**Programmatic regression tests added:** `server/rooms/GameRoom.geodesic-bullets-lan.test.ts` — 6 tests verify bullets move away from poles on sphere, no NaN, no out-of-bounds UV.

### Test: Bullet paths are straight in LAN (not pole-converging)
- [ ] **Start LAN game** — Use "Play Game.bat" → LAN mode (after s38c-00 deployment fix is applied)
- [ ] **Fire bullets on Sphere toward equator** — Should travel in great-circle arc, NOT drift toward north or south pole
- [ ] **Fire bullets at multiple angles on Sphere** — No bullet should spiral toward or reach v=0 (north pole) or v=1 (south pole) unless deliberately aimed there
- [ ] **Fire bullets near UV boundary on Sphere** — No teleportation, bullets smoothly cross u=0/u=1
- [ ] **Fire on Torus** — Bullets travel in straight geodesic lines on torus surface
- [ ] **Compare with single-player** — Bullet paths should look identical to SP mode on same surface
- [ ] **Test all 12 surfaces** — No pole-convergence on any surface

---

## S41-07: MP Scene Cleanup — Stale Objects Between Maps

**Fix:** `cleanupSurface()` now calls `surface.dispose()` (geometry/material GPU resources freed), resets `surfaceConfirmedFromServer`, and the voting→playing transition now force-calls `cleanupSurface()` + `initSurface()` to guarantee the old surface is removed for every new game round, including same-type transitions (sphere→sphere).

### Test: No stale floating objects when switching maps in LAN MP
- [ ] **Start LAN game** — Use "Play Game.bat" → LAN mode, connect two clients
- [ ] **Play a game to completion** — Any map (e.g. Sphere)
- [ ] **Vote to play again on a DIFFERENT map** — e.g. vote for Peanut
- [ ] **Confirm no stale sphere** — When peanut map starts, there should be NO large sphere mesh floating around/behind the peanut
- [ ] **No floating shiny objects** — No enemy meshes, bullet trails, or surface geometry at old sphere positions
- [ ] **Test same-type maps** — Play sphere → vote sphere again → confirm no duplicate sphere meshes visible
- [ ] **Test all surface transitions** — sphere→torus, cube→peanut, etc. each transition should be clean
- [ ] **Memory: play 3+ consecutive games** — Browser memory usage should not grow unboundedly between games (GPU resources disposed)

---

## S42-02: Pole Crossing Camera Inversion Fix

**Fix:** Two separate fixes:
1. `MeshWalker._tryPoleTraversal()` now resets the tangent frame to align with the movement direction after teleporting past the pole. Previously, frame-rotation accumulated during pole-circling could invert the bitangent (camera up), causing camera inversion after crossing.
2. `CameraController.updateFromFrame()` (MP camera path) now has sign-flip protection: if the UV-derived camera "up" vector flips >90° from the previous frame (UV wrapping at pole), it is negated to maintain continuity.

### Test: SP — Cross north/south pole on sphere without camera inverting

- [ ] **Start SP game on sphere** — Use "Play Game.bat" → sphere surface
- [ ] **Walk toward north pole** — Hold W to move toward the top of the sphere
- [ ] **Cross the north pole** — Continue holding W through the pole. Player should pass through and continue on the other side without stalling or spinning.
- [ ] **Camera NOT inverted after crossing** — After the pole crossing, pressing W should still move the player "forward" (away from where you came). If the camera inverted, W would move the player backward.
- [ ] **Repeat for south pole** — Walk to bottom of sphere, cross, verify no inversion
- [ ] **Peanut surface: both poles** — Switch to peanut surface, cross both poles, same smooth behavior expected

### Test: MP — Pole crossing in LAN multiplayer

- [ ] **LAN MP on sphere** — Host + join a LAN game on sphere surface
- [ ] **Both players can cross poles** — Both host and client should be able to cross poles without camera inversion
- [ ] **User testing required** — Claude can only test SP visually; MP pole crossing requires human LAN test

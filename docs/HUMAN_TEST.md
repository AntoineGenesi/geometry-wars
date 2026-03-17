# Human Test Checklist

> **What is this?** Everything Claude has changed that needs YOU to verify in a real browser.
> Items are grouped by priority. Check them off as you go. If something fails, note what happened.
>
> **Last updated:** 2026-03-17 (s44r23 rewrite — cleared pre-s44r19 history)

---

## P0 — Test These First

### SP Invisible Enemies Wave 5+ (s44r23-01)

**Changes made** — sphere tunnel + cube ring dimming fix needed.

- [ ] SP sphere-tunnel: play to wave 5+, enemies should remain VISIBLE (not disappear)
- [ ] SP cube-ring: play to wave 5+, enemies should remain VISIBLE
- [ ] Enemies BEHIND surfaces should be dim (not invisible, not too bright)
- [ ] Enemies IN FRONT of surfaces should be fully visible
- [ ] No progressive darkening across waves

### Performance: Modern Mode 50+ Entities (s44r23-02)

**Changes made** — bloom bottleneck fix needed.

- [ ] Start SP game in **modern mode** (not pixelated)
- [ ] Play to wave 3–5 (50+ entities on screen)
- [ ] FPS should be ≥50fps on a reasonable GPU
- [ ] Pixelated mode should still run at 60fps as baseline

### MP Enemies Visible and Moving — All Maps (s44r20-01)

**Changes made** — MeshWalker override fix merged.

- [ ] Start MP LAN game on **cube** map — enemies should MOVE and be VISIBLE (3+ waves)
- [ ] Start MP LAN game on **sphere** map — same check
- [ ] Start MP LAN game on **torus** map — same check
- [ ] Enemies should not be frozen in place
- [ ] Enemies should not be invisible/dim from wave 1

---

## HIGH — Test After P0

### Death Screen: No Input After Final Death (s44r23-03)

**Changes made** — game-over transition input block fix needed.

- [ ] Lose all lives in SP
- [ ] During the death/game-over screen (10-second transition), player should NOT be able to move or shoot
- [ ] Cannot spawn a new player or continue playing after final death

### Cube Ring MEDIUM Size (s44r23-05)

**Changes made** — medium size recalibration needed.

- [ ] Start SP game on **cube-ring** medium variant
- [ ] Map should feel noticeably larger than the small variant (not the same size)
- [ ] All size variants (small/medium/large) should feel distinctly different

### MP PvPvE Invisible Enemies Wave 7+ (s44r21-01)

**Changes made** — NaN visibility guards merged.

- [ ] Start MP **PvPvE** game on sphere
- [ ] Play to wave 7+
- [ ] Enemies should remain visible (not progressively dim/invisible)
- [ ] Also test on cube and Möbius if possible

### SP Post-Game: Returns to Main Menu (s44r20-05)

**Changes made** — post-game freeze frame fix merged.

- [ ] Finish a SP game (lose all lives or reach end)
- [ ] When "Weapon Mastery" screen appears, press exit/done
- [ ] Should return to the **main menu** (not freeze on the game-over frame)

---

## MEDIUM — Test When Convenient

### Score Graph: Zoom, Hover, Kills Toggle (s44r23-04)

**Changes made** — score graph enhancements needed.

- [ ] End a SP game — post-game screen should show an AoE2-style score chart
- [ ] Chart should have **two tabs**: Score view and Kills view
- [ ] Hovering over the chart should show a tooltip with score/kills/wave info
- [ ] Should be able to zoom in/out on the chart

### Server Restart Message (s44r20-04)

**Changes made** — "undefined" countdown fix merged.

- [ ] As MP host, trigger a server restart
- [ ] Message should read something like "Restarting with new settings..." (not "undefined")
- [ ] Countdown timer should display correctly

### MP Pause Menu: Restart Round Closes Menu (s44r20-06)

**Changes made** — menu close fix merged.

- [ ] In MP, open the pause menu
- [ ] Press "Restart Round Now"
- [ ] The pause menu should CLOSE after pressing (not stay open)

---

## s44r22 Batch — Implemented, Needs Level 6 Verification

These were implemented in s44r22 and need user confirmation they work as expected.

### Enemy Dimming Behind Surfaces — Sphere Map (s44r22-01)

- [ ] SP sphere map: enemies partially behind the surface should appear **dim** (not fully visible, not invisible)
- [ ] Enemies fully on the front surface should be bright/normal

### Hit Detection: TitanGrunt Bullets All Angles (s44r22-09)

- [ ] Find the large blue rectangle enemy (TitanGrunt)
- [ ] Shoot at it from different angles (front, side, above, below)
- [ ] Bullets should connect and damage it from **all angles** (not just head-on)

### Weapon Cycling Through Full Inventory (s44r22-10)

- [ ] Pick up 3+ different weapon types
- [ ] Cycle through weapons with the weapon button
- [ ] Should cycle through ALL picked-up weapons (not just toggle between 2)

### Mortar/Missiles: Last Until Hit (s44r22-11)

- [ ] Fire mortar or homing missiles at multiple enemies
- [ ] Each missile should fly until it hits **one** target, then explode
- [ ] Multiple missiles should NOT all explode simultaneously for the same single target

### Gravity Gun Particles: Entity Color (s44r22-12)

- [ ] Pick up gravity gun
- [ ] Suck in enemies — the particle effect should be the **enemy's color** (not always purple)

### Aura Ring MP: Near-Invisible + Surface-Projected (s44r22-13)

- [ ] In MP, observe a player using the aura ring ability
- [ ] The aura should appear **nearly transparent** (not a solid glowing ring)
- [ ] The ring should project flat onto the surface geometry (not float above it)

### MP Dynamic Difficulty: Hard Enemies at High Waves (s44r22-14)

- [ ] Play MP to wave 30+ — harder/new enemy types should start appearing
- [ ] Play MP to wave 60+ — even harder enemies
- [ ] Play MP to wave 100+ — the hardest enemy configurations
- [ ] Wave 103 should NOT feel trivially easy

### MP Pause Menu Landscape Layout (s44r22-15 — iPhone 13)

- [ ] On iPhone 13 in **landscape orientation**, open the MP pause menu
- [ ] Should show a **2-column layout**: buttons on the left, info/buffs on the right
- [ ] Menu should not be skewed to one side

### Mobile MP: Start Zoomed In + Smoother Performance (s44r25-06)

- [ ] Scan the QR code with your phone to join a multiplayer game
- [ ] On joining, the camera should be **clearly zoomed in** — player ship should be easily visible, not tiny dots
- [ ] Gameplay should be **noticeably smoother** at game start (no initial lag spike from quality dropping)
- [ ] Pinch-to-zoom should still work normally after the automatic zoom
- [ ] At 30-50 enemies, framerate should feel playable (30+ fps)

### Mobile Movement: No Direction Reversal (s44r22-16)

- [ ] On mobile MP, use the joystick to move
- [ ] Movement should feel **responsive** — no brief reversal/snapping to opposite direction
- [ ] No input lag when starting to move

### Mobile Weapon Button: Draggable (s44r22-17)

- [ ] On mobile (SP or MP), the weapon cycle button should be visible on the **left side**
- [ ] Should be **draggable** to reposition it
- [ ] Pressing it should cycle through weapons

### Kill Streak Announcements (s44r22-05)

- [ ] Kill 3+ enemies in quick succession
- [ ] A pop-up announcement should appear (e.g., "Triple Kill" or similar)
- [ ] Braille-style animation effects should appear around the announcement

### MP Host UI: No "Waiting for Host" When You ARE Host (s44r22-07)

- [ ] Create a MP room as host
- [ ] After the map loads, the host UI should show **host controls** (map selection, settings)
- [ ] Should NOT show "Waiting for host..." message when you are the host

### Server Stop Protection (s44r22-08)

- [ ] Start a MP game with active players (shooting/moving within last 30 seconds)
- [ ] Try to stop the server as host
- [ ] Should be **blocked** or warned: "Cannot stop — players are active"
- [ ] Should be allowed to stop if players have been idle for 30s+

---

## Notes

- Items marked as s44r22 were implemented but some had related bugs (s44r23) — if s44r22 item seems broken, check if there's a corresponding s44r23 task.
- For MP tests: always use LAN (2 players on same network) for Level 6 verification.
- SP tests can be done solo.

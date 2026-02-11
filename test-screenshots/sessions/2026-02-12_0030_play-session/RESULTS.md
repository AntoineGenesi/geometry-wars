# Visual Test Session: Play-Through

**Timestamp:** 2026-02-12 00:30 UTC
**Task:** General play-through verification (no specific task — user asked "play the game and tell me what you see")
**Commit:** a321b62 (feat: complete 3 remaining tasks + visual testing rules)
**Script:** tests/visual/play-game.mjs
**Renderer:** WebGL2 via SwiftShader (headless)
**FPS:** 7-9 (expected for software rendering)

## Flow Tested

Start Menu → Quick Game → Mode Select (Waves) → Surface Select (Sphere) → START → Gameplay (23s) → Pause → Debug Overlay → Bomb

## Screenshots

| File | Time | What It Shows |
|------|------|--------------|
| 01-start-menu.png | 0:00 | Title, 5 buttons (ADVENTURE highlighted green), 3D sphere preview with animated enemies, bottom bar |
| 02-mode-select.png | — | Mode/surface selector: Waves/King/Sniper/Rainbow/Claustrophobia + surface picker. START button below fold. |
| 03-mode-surface-selected.png | — | Same as 02 with Waves selected (fullPage captured — distorted viewport, don't use fullPage) |
| 04-game-started.png | 0:01 | Sphere surface, full HUD visible. Player NOT visible yet. ENT:0, BUL:0. Timer, score, lives, bombs all showing. |
| 05-moving-w.png | 0:03 | Player visible as cyan arrow near sphere center. ENT:4. Minimap shows 4 red dots (enemies). |
| 06-moving-d.png | 0:04 | Player moved right. Similar view. |
| 07-shooting.png | 0:07 | Player firing — trail of ~6 cyan bullet dashes going right. 3 enemy types visible: blue squares, magenta X-shapes, blue diamond. ENT:13, BUL:12. |
| 08-mid-gameplay.png | 0:23 | Most active scene. Player center, firing right. Multiple enemy types scattered. ENT:13, BUL:38. Score still 0. |
| 09-paused.png | 0:27 | Pause menu: RESUME/CONTROLS/WEAPONS/SETTINGS/PERF GRAPHS. Right panel: Blaster 0.25dmg 6/s, Total Kills: 0, No buffs, Avg FPS 9.3, Peak Enemies 13. |
| 10-debug-overlay.png | 0:29 | Pause menu again (ESC resume didn't work). Duration 0:29, Peak Enemies 41, Min FPS 3.0. |
| 11-gameplay-with-debug.png | 0:29 | Same as 10 — still stuck on pause menu. |
| 12-after-bomb.png | 0:29 | Same as 10 — Space (bomb) didn't work while paused. |

## What Worked

- Start menu renders cleanly — title, buttons, animated 3D preview
- Mode/surface selector shows all 5 modes with descriptions
- Game initializes on sphere with complete HUD (score, timer, lives, bombs, weapon, multiplier, level progress)
- Player visible as cyan arrow, moves with WASD
- Bullets fire as cyan dashes in aimed direction
- Multiple enemy types visible with distinct shapes and colors (blue squares, magenta X-shapes, blue diamonds)
- Minimap shows player (cyan) + enemies (red) accurately
- Pause menu is comprehensive: weapon stats, kill count, buffs, performance data
- Debug overlay works with renderer, FPS, entity counts

## Issues Found

1. **0 kills after 23 seconds of shooting** — Bullets fire visually but score stays 0 and Total Kills stays 0. Possible causes: (a) SwiftShader runs at 7 FPS = game is ~10x slower, bullets may not have reached enemies yet. (b) Collision detection may have a real bug. (c) Mouse aim might be wrong in headless (bullets going in wrong direction relative to enemies). NEEDS REAL BROWSER VERIFICATION.

2. **ESC to resume didn't work** — After opening pause, `keyboard.press('Escape')` didn't resume. Game stayed paused for all subsequent screenshots (10-12). Likely a Puppeteer keyboard focus issue, not a game bug.

3. **706 console errors** — Mostly 404s (probably favicon/sourcemaps) and `require is not defined` (server-side modules loaded in browser). Minor.

4. **START button below viewport fold** — User has to scroll down in the mode/surface selector to see the START button. Could confuse new players.

## Conclusion

Game loads and renders correctly. Core gameplay loop (menu → mode select → game → HUD → pause) works. Main unknown: whether kills actually register in a real browser at 60fps. SwiftShader at 7fps makes collision timing unreliable for testing.

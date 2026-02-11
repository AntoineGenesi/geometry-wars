# Visual Test: LAN Multiplayer (Attempt 1)
**Timestamp:** 2026-02-11T16:10:24.603Z
**Commit:** a722f6a
**Script:** tests/visual/test-lan-visual.mjs (v1 - no START GAME click)
**Renderer:** WebGL2 via SwiftShader (headless)
**Goal:** "I need to see both players connected, moving, and shooting in a LAN game to confirm LAN multiplayer works."

## Attempt 1
**Issue:** Script did not have an explicit START GAME click step. The game stayed in "Waiting for players..." lobby for most of the test, then accidentally started when mouse clicks from shooting tests hit the START GAME button.

### Key Findings

**Pre-game lobby (screenshots 01-20):** Both players connected successfully. Host showed "HostPlayer (YOU): 0, JoinPlayer: 0" in the player list. Joiner showed "HostPlayer: 0, JoinPlayer (YOU): 0". START GAME button visible. The connection and lobby system works perfectly.

**Accidental game start (screenshot 25 onwards):** When the mouse moved to position (500, 180) for the shooting test, it clicked the START GAME button. The game transitioned to "Wave 0" gameplay.

**25-host-after-combat.png:** First gameplay screenshot from host. Shows "Wave 0", both player names ("HostPlayer" and "JoinPlayer") visible on the sphere with crosshair icons next to each. Players are alive. A few enemies visible.

**25-join-after-combat.png:** From the joiner's view, both "HostPlayer" and "JoinPlayer" are visible side by side on the sphere. Camera angle differs from host.

**26-host-after-long-run.png:** Host moved. "HostPlayer" and "JoinPlayer" labels visible on sphere. Some purple/pink enemies visible.

**27-host-final-gameplay.png:** "JoinPlayer: 0 [DEAD]" - the joiner died. Host still alive. "HostPlayer" label visible. A white line extending from the player (bullet trail). Several enemies scattered.

**27-join-final-gameplay.png:** Joiner's view shows "[DEAD]". Large white explosion flash (death effect). "HostPlayer" label visible through the flash.

**28-host-debug-overlay.png:** Both DEAD. "HostPlayer (YOU): 100 [DEAD]", "JoinPlayer: 0 [DEAD]". Score: 100. Kill log: "Grunt x2, 2 total". Confirms scoring and kill tracking work.

### What This Attempt Proved
1. LAN connection flow works end-to-end through the UI
2. Both players connect, appear in player list, and render on the sphere
3. Both player characters have name labels
4. Enemies spawn as Grunts (diamond shapes)
5. Host scored 100 points by killing enemies
6. Kill log tracks kills correctly
7. Players can die independently
8. Death explosion effects render
9. The game world is shared

### Superseded by Attempt 2
See session 2026-02-11_1615 for the improved test with explicit START GAME click.

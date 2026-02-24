# Session 32 Triage Complete — 7 Tasks Ready for Execution

**Completed:** 2026-02-25 T23:45 UTC
**Input:** Voice transcript (user frustrated, game "unplayable")
**Output:** 7 structured task files with full context
**Status:** READY FOR ORCHESTRATOR WORKERS

---

## Executive Summary

User reports game is broken after S31 mastery system merge:
- **CRITICAL:** Game runs at ~50% speed (not FPS, actual game speed reduced)
- **CRITICAL:** LAN laptop can't connect (5th attempt)
- **HIGH:** Multiple regressions (QR, mobile MP touch, UX labels)

All issues are **bugs/regressions, not new features**. No planning phase needed — tasks are structured and ready for execution.

---

## Critical Path

```
1. Game Slowdown Fix (BLOCKS EVERYTHING)
   ├─ Must identify S31 culprit
   ├─ Must verify 60 FPS normal speed
   ├─ Estimated: 45-60 minutes
   └─ Worker: sonnet (COMPLEX)

2. QR Code Fix (PREREQUISITE for LAN test)
   ├─ Encoding broken, not display
   ├─ Estimated: 30 minutes
   └─ Worker: sonnet (STANDARD)

3. LAN Laptop Connection Fix (MOST COMPLEX)
   ├─ 4 prior attempts failed
   ├─ Phone works = server fine, issue is laptop path
   ├─ Estimated: 60-90 minutes
   └─ Worker: opus (COMPLEX + reasoning)

4. Mobile/UX Fixes (PARALLEL after Wave 1)
   ├─ Touch routing broken (S31 only fixed SP)
   ├─ "(You)" label showing for all players
   ├─ Object demo needs better models
   ├─ Each estimated: 20-45 minutes
   └─ Workers: sonnet (STANDARD)
```

**Total time (optimistic):** 3.5-4.5 hours of focused work

---

## Tasks at a Glance

### Wave 1: CRITICAL BLOCKER
| Task | What | Why Now |
|------|------|---------|
| **s32-game-slowdown-regression-critical** | Fix game speed (50% slow) | Game unplayable, blocks all testing |
| **s32-debug-key-f4-not-f3** | Fix doc/code key mismatch | Quick win, parallel execution |

### Wave 2: SEQUENTIAL DEPENDENCIES
| Task | What | Depends On | Why |
|------|------|-----------|-----|
| **s32-qr-code-encoding-broken-no-text-found** | Fix QR encoding | Slowdown fixed | Laptop needs working QR to join |
| **s32-lan-laptop-connection-attempt-5** | Fix laptop connection | QR fixed | Can't test with broken QR |

### Wave 3: PARALLEL
| Task | What | Est. Time |
|------|------|-----------|
| **s32-mp-lobby-touch-routing-broken-buttons-unresponsive** | Fix mobile button responsiveness | 30-45 min |
| **s32-mp-you-label-showing-for-all-players** | Fix local player label | 20-30 min |
| **s32-object-demo-low-poly-models-with-animation** | Load low-poly GLB models | 30-45 min |

---

## Key Insights from User Feedback

1. **"Game feels sluggish"** — Not frame drops. Actual game time is ~50% slower. Likely per-frame cost (allocations, polling, expensive loop).

2. **"Phone works, laptop doesn't"** — Proof that server is accessible and phone's connection path works. Laptop uses different path (manual IP entry, not QR). URL or IP advertised to laptop is wrong.

3. **"QR code says 'no text found'"** — Encoding issue, not rendering. iPhone scanner can read it but it encodes invalid data. Compare v5.0 (working) to HEAD.

4. **"Mobile buttons don't work, joystick appears"** — Input hijacking. Game's InputManager/joystick receiving touch events meant for menu. S31 pause menu fix should apply here too.

5. **"You've literally made it worse"** — User testing revealed regressions not caught in autonomous testing. S31 felt OK during autonomous run, but gameplay testing shows broken.

---

## Execution Instructions

### For Slowdown Worker (sonnet)

```
Read: .claude/rules/execution-focus.md (80% fix time, 20% investigation)
      tasks/s32-game-slowdown-regression-critical.md (full context)

Approach:
1. Turn on F3 debug overlay → measure FPS + game tick time
2. Profile render loop vs game loop (which is slow?)
3. Check MasteryStore for expensive ops (localStorage I/O per frame?)
4. Check passive bonus application (looping all enemies per frame?)
5. Check pickup collision changes (expensive world-space distance?)
6. Git bisect S31 commits if needed
7. Measure before/after fix
8. Verify 60 FPS, normal game speed

Minimum verification: Puppeteer 30-second gameplay at normal speed
```

### For QR Worker (sonnet)

```
Read: tasks/s32-qr-code-encoding-broken-no-text-found.md

Approach:
1. Find QR code generation (grep "qrcode" or similar)
2. Check URL construction (what value is being encoded?)
3. Use zxing.org to decode test QR + verify URL is correct
4. Check for encoding artifacts (spaces, special chars, truncation)
5. Diff v5.0..HEAD on network files to see what changed
6. Fix and verify iPhone can read it

Minimum verification: Online QR decoder shows valid URL, Puppeteer screenshot
```

### For LAN Worker (opus)

```
Read: tasks/s31-lan-laptop-connection-attempt-4.md (previous investigation)
      tasks/s32-lan-laptop-connection-attempt-5.md (current task)

CRITICAL: This has failed 4 times. Be systematic, not guess-and-fix.

Approach:
1. Understand why phone works (uses QR → Vite proxy → port 3000)
2. Understand why laptop fails (uses manual IP → ??? → ??? → fails)
3. Add server-side connection logging (timestamp, IP, port, URL, result)
4. Trace what IP/URL is advertised to laptop vs phone
5. Test: can laptop reach advertised IP:port from local network?
6. Check: is Vite proxy correctly forwarding WebSocket?
7. Check: is Colyseus server binding to all interfaces (0.0.0.0)?
8. Diff v5.0 vs HEAD on: vite.config.ts, server/main.ts, LANClient.ts
9. Identify 1-2 specific fixes
10. Test both devices connect

Minimum verification: Puppeteer 2-device test + both players in-game
```

### For Mobile Workers (sonnet)

```
Read: tasks/s31-mobile-pause-menu-touch-routing-broken.md (S31 fix for reference)
      Related task (touch routing or label)

Touch routing (s32-mp-lobby-touch-routing-broken-buttons-unresponsive):
- Find where InputManager hijacks touch events
- Add check: if (isPaused || isLobbyOpen) skip touch processing
- OR: set canvas.style.pointerEvents = 'none' when lobby open
- Test: tap buttons → respond, joystick doesn't appear

MP Label (s32-mp-you-label-showing-for-all-players):
- Find "(You)" string in codebase
- Check condition: if (entity === localPlayer) → if true, show label
- Verify condition in ALL code paths (main.ts, multiplayer-main.ts, network-main.ts)
- Test: each player sees label only on self

Object Demo (s32-object-demo-low-poly-models-with-animation):
- Find existing object loading code (S31 had OBJ panel task)
- Load 2-3 GLB files (1K-10K vertices, with walking animation)
- Wire into F4 demo mode
- Test: Puppeteer screenshot showing models walking
```

---

## Risk Mitigation

### If Slowdown Fix Takes >90 minutes:
- Slowdown worker should checkpoint findings to task file every 30 min
- If diagnosis stalled after 60 min of investigation, switch to fix attempts
- Consider spawning a second worker on different S31 commit hypothesis

### If LAN Fix Repeatedly Fails (history: 4 attempts failed):
- Opus worker should read ALL prior task files before starting
- Document each failed hypothesis in decision log
- After 2 failed attempts, consider reverting to v5.0 LAN code + merging piecemeal
- Fallback: disable LAN temporarily (focus on SP/split-screen fixes)

### If QR Encoding is Cryptic:
- Compare URL generation in v5.0 vs HEAD side-by-side
- Test: does v5.0 QR work? If yes, identify exact diff
- If v5.0 QR also broken, may need to research QR encoding standard

---

## Success Criteria

**Slowdown:** Game FPS stable 60, game time matches real time (1 game second = 1 real second)
**QR:** iPhone native camera app scans code, shows URL, can open in Safari
**LAN:** Both devices (phone + laptop) successfully join multiplayer game
**Mobile touch:** Lobby buttons responsive on iPhone, no joystick hijacking
**MP label:** Each player sees "(You)" only on self, correct labels on others
**Object demo:** F4 shows walking 3D models, not static spheres

---

## Files for Reference

- **Execution Plan:** `.claude/state/s32-triage-execution-plan.md`
- **Triage Summary:** `inbox/s32-voice-triage-summary.md`
- **Task Files:** `tasks/s32-*.md` (7 files)
- **Updated TODO:** `TODO.md` (S32 section at top)
- **Previous LAN:** `tasks/s31-lan-laptop-connection-attempt-4.md`
- **Previous Mobile:** `tasks/s31-mobile-pause-menu-touch-routing-broken.md`

---

## User Expectations

✅ **Delivered in this triage:**
- Identified all 9 issues → 7 structured tasks
- No time wasted on planning (tasks are execution-ready)
- Clear execution order (critical path identified)
- Full context in each task (workers don't need to re-investigate)

⏳ **Next step:** Launch orchestrator workers in Wave 1 → Wave 2 → Wave 3

🎯 **Goal:** Game fully playable again within 4 hours

---

**Triage Complete. Ready for worker execution.**

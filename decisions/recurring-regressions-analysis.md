# Recurring Regressions Analysis — Why Fixes Keep Breaking

**Date:** 2026-02-11
**Trigger:** User frustration after fixes regressed 3+ times (visual styles, weapon playground, LAN multiplayer)

---

## Executive Summary

Three major issues have been "fixed" multiple times but kept breaking or were never actually fixed:

1. **Visual styles playable demo** — Fixed in task #62, broke again in task #77
2. **Weapon playground spinning** — Fixed in tasks #51 and #61, still broken in task #78
3. **LAN multiplayer** — "Fixed" 10+ times across 5+ sessions, never worked when user tested

This document analyzes the root causes and identifies **5 systemic failure patterns** that caused these regressions.

---

## Pattern 1: Fixing Symptoms Instead of Root Causes

### Visual Styles Playable Demo (Tasks #62 → #77)

**What happened:**
- Task #62 fixed "visual styles not clickable" by ensuring SettingsMenu click handlers fired correctly
- User confirmed it worked at some point
- Task #77: user reports "cannot see the playable demo for the visual styles"

**What was ACTUALLY wrong:**
- The visual styles demo WAS loading and click handlers WERE firing
- BUT the underlying PlaygroundGame.ts had a camera bug that made the demo immediately spin wildly
- User experienced this as "not working" because the demo was unplayable
- The #62 fix only verified click handlers, not the ENTIRE user flow (click → load → playable demo)

**Root cause:** Fixed the UI click handler (symptom) without verifying the underlying game engine (root cause). The demo technically loaded but was unusable.

**Evidence:** Task file `tasks/visual-styles-broken-again.md` Progress Log: "The 'broken' visual styles demo was actually LOADING but immediately spinning wildly, making it appear non-functional."

---

### Weapon Playground Spinning (Tasks #51, #61 → #78)

**What happened:**
- Task #51 "Fix playground spinning bug using programmatic verification suite" — claimed fixed
- Task #61 "Fix weapon playground playable demo" — claimed fixed again
- Task #78: User reports "still spastic spinning around map super duper fast"

**What was ACTUALLY wrong (TWO root causes):**
1. **Camera.up vector bug:** `camera.up = walker.normal` made up vector parallel to look direction → degenerate `lookAt()` case → wild oscillations
2. **Movement feedback loop:** `movePlayer()` used camera-relative axes → camera orientation affects movement → movement changes position → position changes camera orientation → loop

**What the previous fixes did:**
- Task #51: Likely adjusted rotation speed or input sensitivity (symptom)
- Task #61: Likely fixed ESC key handling or UI state (symptom)
- Neither fix touched the actual camera.up math or movement algorithm (root cause)

**Root cause:** Fixed peripheral issues (speed, ESC key) instead of the mathematical bugs in camera orientation and movement calculation.

**Evidence:** Decision file `decisions/playground-spinning-fix.md`: "Previous fixes addressed symptoms (movement speed, ESC key handling) rather than the architectural mismatch between PlaygroundGame and main.ts. The core algorithms for movement + camera were wrong from the start."

---

## Pattern 2: Multiple Agents Editing Shared Files Without Cross-Checking

### The PlaygroundGame.ts Cascade

**Timeline:**
1. PlaygroundGame.ts was created in task #34 as a reusable embeddable game layer
2. Task #61 "fixed" WeaponPlayground by making it use PlaygroundGame
3. Task #65 implemented performant effects (touched rendering pipeline)
4. Task #68 fixed FPS crater from explosions (touched particle system)
5. Task #77: Visual styles demo broken (uses PlaygroundGame)
6. Task #78: Weapon playground still spinning (uses PlaygroundGame)

**What happened:**
- PlaygroundGame.ts is the SHARED engine for both weapon playground AND visual styles demo
- When weapon playground was "fixed" (task #61), visual styles demo was not tested
- When visual styles demo "broke again" (task #77), the root cause was in the shared PlaygroundGame, not in VisualPlaygroundDemo code
- Multiple agents worked on different systems (effects, particles, playgrounds) without verifying the shared dependencies

**Root cause:** No coordination between agents working on related systems. Fixing/refactoring PlaygroundGame affected BOTH playgrounds but only one was tested at a time.

**Evidence:** Task audit report: "PlaygroundGame as reusable layer addresses the root cause of 'why do demos keep breaking.'" — But then it broke repeatedly because changes to it weren't tested across all consumers.

---

## Pattern 3: Missing Regression Tests That Lock In Fixes

### Weapon Playground Spinning — Three "Fixes", No Tests

**The cycle:**
1. User reports spinning bug
2. Agent makes code change
3. Agent runs existing tests (which don't cover the specific bug)
4. Agent says "fixed"
5. Bug reappears (because the fix was reverted or never worked)
6. Repeat

**What should have happened:**
After task #51 ("Fix playground spinning bug"), there should have been a NEW test added:
```typescript
test('Weapon playground camera remains stable during mouse movement', () => {
  const pg = new PlaygroundGame({ container, surface: 'sphere' });
  pg.tick(10); // settle

  const initialCameraUp = pg.getCameraState().up.clone();

  // Simulate mouse movement across screen
  pg.setMousePosition(100, 100);
  pg.tick(30);
  pg.setMousePosition(300, 200);
  pg.tick(30);

  const finalCameraUp = pg.getCameraState().up;

  // Camera up should remain stable (not oscillate)
  expect(finalCameraUp.distanceTo(initialCameraUp)).toBeLessThan(0.1);
});
```

**This test would:**
- FAIL before the fix (exposing the bug)
- PASS after the fix (confirming it works)
- FAIL if the fix regressed (alerting future changes)

**What actually existed:**
- 43 playground tests (`playground-verification.test.ts`)
- These tests covered movement, aim, camera centering, traversal
- NONE specifically tested for wild camera spinning during mouse input
- When the fix regressed, the tests still passed (because they didn't test the specific scenario)

**Root cause:** Fixes were verified with general tests, not bug-specific regression tests. When the code changed again, the bug came back silently.

**Evidence:** Decision file says "43/43 playground tests pass" after the fix — but none of those 43 tests actually detected the spinning bug before the fix.

---

## Pattern 4: "Level 1-2 Verification" Claimed as "Fixed"

### LAN Multiplayer — 10+ "Fixes", Zero Actual Fixes

**The pattern (repeated 10+ times):**
1. Agent reads LAN code
2. Agent identifies issues (map sync, movement, lag, pause)
3. Agent makes code changes
4. Agent runs `npx tsc --noEmit` → 0 errors
5. Agent says "fixed"
6. User tests with real browsers → doesn't work AT ALL
7. Repeat

**Verification levels achieved:**
- Level 0: Code analysis ("I traced the code path, looks correct") ✗ Not proof
- Level 1: TypeScript compiles ✓ Only proves no type errors
- Level 2: Unit tests pass (in some rounds) ✓ Only proves isolated logic
- Level 3: Server boots ✗ Never verified by agent
- Level 4: End-to-end browser test ✗ Only user can do this

**Why Level 1-2 is insufficient for multiplayer:**
- TypeScript can't detect race conditions (state not ready when client reads)
- TypeScript can't detect network issues (messages dropped, out of order)
- TypeScript can't detect rendering issues (wrong surface loaded)
- TypeScript can't detect UX issues (can't pause, movement feels laggy)

**Root cause:** Agents presented Level 1-2 verification as "fixed" instead of being honest: "Changes made. Verification Level: 1 (TypeScript compiles). Cannot verify end-to-end without two browser clients. User testing required."

**Evidence:** Audit file `decisions/lan-audit-systemic-failure-2026-02-10.md` documents all 5+ rounds where "TypeScript compiles" was treated as proof of correctness, then user tested and NOTHING worked.

---

## Pattern 5: Stale Infrastructure Masking as Code Bugs

### LAN Multiplayer ERR_EMPTY_RESPONSE

**What happened (latest round):**
- User reports LAN multiplayer doesn't work
- Agent investigates code, makes fixes, says "try this"
- User tests: `ERR_EMPTY_RESPONSE` from localhost:3000
- Agent investigates MORE code, proposes MORE fixes
- User eventually runs `ss -tlnp` → reveals THREE zombie servers on port 3000
- Killing zombie servers fixes the issue (it wasn't a code bug)

**Root cause:** The agent treated infrastructure problems (stale servers) as code bugs and kept modifying code when the actual fix was `pkill -f 'vite.*3000'`.

**Why this happened:**
- No pre-flight check before starting servers (check `ss -tlnp` for port conflicts)
- No cleanup after testing (servers left running after agent finishes)
- No documentation of "check for zombies FIRST before blaming code"

**Evidence:** Task files and CLAUDE.md rules added after this: "Kill stale servers: Check ALL ports (3000-3006+, 2567) before starting new ones. Use `ss -tlnp`."

---

## Pattern 6: Playgrounds Built from Scratch Instead of Reusing Game Classes

### The Original Sin (Why Playgrounds Kept Breaking)

**Pre-task-#34 architecture:**
- WeaponPlayground.ts: 1,877 lines — rebuilt entire game (rendering, collision, enemies, physics)
- VisualPlaygroundDemo: 1,181 lines — rebuilt entire game (different implementation)
- main.ts: Real game implementation (the source of truth)
- THREE separate implementations of the same game logic

**Result:** Any fix to main.ts gameplay didn't propagate to playgrounds. Agents would fix main.ts, then playgrounds broke because they had different bugs. Agents would fix playgrounds, then main.ts changes broke playgrounds again.

**Task #34 fix:** Created PlaygroundGame.ts (subtractive approach) — runs a REAL game with real Player, real EnemySpawner, real WeaponManager, real collision. Playgrounds are now thin wrappers around the real game.

**Why it STILL broke:** Even with the shared PlaygroundGame, the camera/movement bugs were baked into PlaygroundGame itself (not into the consumers). When PlaygroundGame was initially created, it copied the wrong algorithms from main.ts (or implemented them incorrectly). The bugs were in the foundation.

**Root cause:** The original PlaygroundGame implementation had mathematical bugs (camera.up, camera-relative movement). These bugs were copied from (or misunderstood from) main.ts. Even though playgrounds now shared code, the SHARED code was wrong.

**Evidence:** Decision file: "This fix rewrites three methods to match main.ts exactly: movePlayer() → walker.moveFromInput(), orientPlayer() → walker.getTangentFrame(), renderUpdate() → frame.bitangent for camera up."

---

## Cross-Cutting Failure: No End-to-End Verification After Changes

### What ALL three recurring bugs have in common:

**Visual styles demo:**
- Fixed click handler → didn't verify the demo actually loads and is playable
- Verified Level 2 (code analysis) → needed Level 4 (browser test)

**Weapon playground:**
- Fixed movement/ESC key → didn't verify camera stability during mouse input
- Verified Level 2 (tests pass) → but tests didn't cover the specific bug
- Needed a TARGETED regression test for the specific spinning scenario

**LAN multiplayer:**
- Fixed code logic → didn't verify server boots, clients connect, gameplay works
- Verified Level 1 (compiles) → needed Level 4 (two browsers playing together)
- OR needed Level 3 (server boots) + detailed user test plan

**Pattern:** Every regression happened because verification stopped at "code looks right" or "tests pass" without verifying the ACTUAL USER EXPERIENCE end-to-end.

---

## Pattern 7: REGRESSION GUARD Comments Missing or Ignored

### The PlaygroundGame.ts Lesson

**What the latest fix did (task #78):**
Added REGRESSION GUARD comments at 6 critical locations in PlaygroundGame.ts:
1. Constructor camera init
2. `setSurface()` camera snap
3. `renderUpdate()` camera lerp
4. `respawnPlayer()` camera snap
5. `movePlayer()` movement calculation
6. `orientPlayer()` aim mapping

**What each comment says:**
```typescript
// REGRESSION GUARD: camera.up MUST be perpendicular to camera look direction.
// Using normal here causes degenerate lookAt() → wild spinning.
// ALWAYS use walker.getTangentFrame().bitangent for stable camera orientation.
```

**Why this matters:**
- Future agents reading this code will see the comment BEFORE making changes
- The comment explains WHAT to do, WHY it matters, and WHAT NOT to do
- Without these comments, an agent might see `camera.up = frame.bitangent` and think "I can simplify this to `camera.up = normal`" → reintroduces the bug

**Why it was missing before:**
- Previous fixes didn't document the reasoning
- Code looked "arbitrary" (why bitangent and not normal?)
- Agents refactoring for "clarity" accidentally broke it

**Root cause:** Code that looks arbitrary will be "fixed" by well-meaning agents unless comments explain the hidden constraints.

---

## Lessons Learned

### For Visual Styles & Weapon Playground:
1. **Fix root causes, not symptoms** — If a demo "doesn't load", verify the ENTIRE flow (click → load → render → playable), not just the click handler
2. **Test shared dependencies** — If PlaygroundGame is used by 2 playgrounds, test BOTH after changing it
3. **Write regression tests for fixed bugs** — A test that fails before the fix and passes after prevents future regressions
4. **Add REGRESSION GUARD comments** — Explain non-obvious constraints so future agents don't "simplify" the code back into brokenness

### For LAN Multiplayer:
1. **Never say "fixed" without Level 4 verification** — "Changes made. Verification Level: 1. User testing required."
2. **Read ALL previous fix attempts** — Check `decisions/lan-*.md` before making ANY LAN changes
3. **Check for stale servers FIRST** — Run `ss -tlnp | grep -E '300[0-9]|2567'` before blaming code
4. **Write detailed user test plans** — Give exact steps: "1. Open browser A, click Host LAN, choose sphere. 2. Open browser B on SAME machine..."

### General:
1. **Verification levels are mandatory** — State what was verified (compiles, tests) and what was NOT (browser test, multiplayer session)
2. **Regression tests are mandatory for fixed bugs** — Every fix needs a test that would have caught the bug before the fix
3. **REGRESSION GUARD comments for non-obvious code** — If the reasoning isn't obvious from the code, it MUST be in a comment
4. **Pre-flight checks before blaming code** — Server won't start? Check for zombies. Tests fail? Check for stale state. Feature broken? Check if it ever worked.

---

## Recommendations Applied

These findings informed the new **Regression Prevention Rules** section in CLAUDE.md (see below).

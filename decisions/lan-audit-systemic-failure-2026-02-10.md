# AUDIT: Why LAN Multiplayer Keeps Being "Fixed" But Never Works

**Date:** 2026-02-10
**Triggered by:** User frustration after 5+ rounds of LAN "fixes" that never work when tested

---

## Timeline of LAN Modifications

| Commit | Date | What Was Changed | Claimed Fixed |
|--------|------|-----------------|---------------|
| `cfff89f` | Initial | First network-main.ts created | Initial implementation |
| `630615a` | Early | Upgrade rendering with MeshSurface | Better visuals |
| `e833637` | Early | Enable bloom for neon glow | Visual improvement |
| `949f803` | Early | Add weapon system to network multiplayer | Weapons work |
| `0c11000` | Mid | Major update - LAN hosting | LAN hosting works |
| `9182f9e` | Feb 8 | Research reports, perf breakthroughs | N/A |
| `79dc624` | Feb 9 | LAN improvements, server lifecycle | Map sync, movement, lag |
| `03fc22c` | Feb 9 | 11-task batch, LAN fixes | Movement, surface config |
| `afd9940` | Feb 9 | LAN rendering overhaul | Visual quality, speeds |
| `5a9f825` | Feb 9 | Complete rewrite using real game classes | Architecture, visual parity |

**User tested after `5a9f825`:** Map still loads sphere (not rectangle), movement gets stuck, still laggy, can't pause, no server stop button. **NONE of the claimed fixes worked.**

---

## The Five Systemic Failures

### 1. "Fixed" Without Testing = Not Fixed

Every single LAN commit includes language like:
- "Build Verification: `npx tsc --noEmit`: PASS (zero errors)"
- "What Could NOT Be Verified: End-to-end testing with 2 clients"

**The pattern**: Agent makes code changes → TypeScript compiles → agent says "fixed" → user tests → it's broken.

**TypeScript compilation is NOT verification.** It only proves the code has no type errors. It says nothing about:
- Whether map selection actually propagates to clients
- Whether movement actually works on the surface
- Whether the server actually sends the right data
- Whether the client actually connects and renders

### 2. Treating Code Analysis as Proof

Agents write detailed analyses like "I traced the code path: StartMenu sends surfaceType to server → server stores in state → client reads state.surfaceType → creates surface." This LOOKS correct. But there could be:
- Race conditions (state not ready when client reads it)
- Fallback defaults kicking in (`|| 'sphere'`)
- The server never actually receiving the message
- The client connecting before the room state is initialized

**Code tracing is hypothesis, not proof.** Without running the actual server and client, it's speculation.

### 3. Each Session Starts Fresh (Context Loss)

Each new session or agent:
1. Reads network-main.ts
2. Sees problems
3. Makes changes based on code analysis
4. Claims "fixed"
5. Never reads what PREVIOUS sessions tried and why they failed

Even when decision files exist (like `lan-multiplayer-investigation-2026-02-09.md`), agents don't always read them or cross-reference with previous attempts.

### 4. Fixing Narrow Bugs Instead of Testing the Full Flow

Agents fix individual bugs in isolation:
- "Movement inverted → negate moveY" ✓
- "Map from URL params → read from server state" ✓
- "Patch rate 50ms → 33ms" ✓

But nobody tested: "If I open two browser tabs, connect to the same server, choose rectangle, do both tabs show rectangle? Can both players move around? Can they see each other?"

### 5. Architectural Problems Papered Over

The fundamental issue (three separate game implementations) was only identified in the THIRD round of investigation (`lan-architectural-analysis-2026-02-09.md`). Even then, the rewrite that followed still couldn't be verified.

---

## Root Cause Summary

**The agent has no way to run a real browser and verify LAN gameplay.** It can:
- Read code ✓
- Edit code ✓
- Compile TypeScript ✓
- Run unit tests ✓

It CANNOT:
- Open two browser windows
- Connect to a Colyseus server from a real browser
- Verify WebGL rendering
- Test real multiplayer interaction

**This means every LAN "fix" is a hypothesis, not a verified fix.** The systemic failure is that agents present hypotheses as facts ("fixed") instead of being honest about what they can and cannot verify.

---

## Recommended Process Changes

### For CLAUDE.md:

1. **Ban the word "fixed" for multiplayer code** unless actually tested end-to-end
2. **Require explicit verification levels** in every LAN-related change:
   - Level 0: Code analysis only (hypothesis)
   - Level 1: TypeScript compiles (syntax correct)
   - Level 2: Unit tests pass (logic correct in isolation)
   - Level 3: Server starts and accepts connections (verified)
   - Level 4: Full end-to-end test (actually works)
3. **Require reading ALL previous LAN decision files** before making any LAN changes
4. **Require writing a test plan** that the USER can execute, with exact steps
5. **Never present Level 0-2 verification as "working"** — always say "code changes made, needs user testing"

### For the actual LAN fix:

The agent should:
1. Make code changes
2. Start the server programmatically to verify it at least boots
3. Write a DETAILED test plan for the user with exact steps
4. Explicitly list every claim and its verification level
5. NOT say "fixed" — say "changes made, test plan below"

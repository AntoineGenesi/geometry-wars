# Audit: Merge Technique Blind Spot — Multi-Path Requirements (S42-03)

**Date:** 2026-03-01
**Status:** Documented + Protocol Added
**Triggered by:** User feedback: "Are you blindly just merging Git? Because you should look at tasks that I've asked multiple times."

---

## Problem Statement

Requirements often apply to multiple code paths in the project:
- Single-Player (main.ts) vs. Multiplayer (network-main.ts, server/)
- Lobby UI (StartMenu.ts) vs. Pause Menu (PauseMenu.ts)
- Gameplay mechanics (Player.ts) vs. Network sync

When a fix is committed and merged, it touches **ONE code path only**. The **OTHER code paths** are silently left half-fixed. Next session (or user during testing) discovers the incomplete feature.

**Root Cause:** Worker commits are reviewed for correctness, but not audited for **scope completeness**. A commit message like "feat: QR code short code" gives no indication whether it applied to the lobby QR, pause menu QR, or both.

---

## Case Study: QR Code Short Code (S38d → S42)

**Timeline:**
- **S27 (67a9b5c):** Added pause menu QR code with full URL (PauseMenu.ts)
- **S38d-02 (254483f):** Switched lobby QR to short code (LANClient.ts)
  - Commit message: "improve short code QR system with better logging"
  - Files touched: `src/network/LANClient.ts` only
  - **Missing:** PauseMenu.ts never touched
- **S38d-03 (3410111):** QR display in lobby (StartMenu.ts)
- **S39-04 (8350088):** Fixed lobby QR layout
- **S42-01 (pending):** Pause menu STILL using giant URL

**Why This Happened:**
1. Requirement "use short code for QR" was interpreted as "fix QR in lobby"
2. Worker fixed lobby, tested it, committed
3. Main context merged without asking: "Does pause menu also have a QR code?"
4. 4 sessions later (S42-01), user discovers pause menu QR still broken
5. User frustration: "I SWEAR i asked you to fix this"

**Evidence:** S42-01 task file explicitly states this is a duplicate requirement: "Previous fix attempt (S38d-03, S39-04): QR code was added to the LAN lobby (StartMenu.ts) showing the short code. But the pause menu (PauseMenu.ts) still shows the giant full URL."

---

## Code Path Inventory

The project has **4+ distinct code paths** where the same feature might need implementation:

| Path | Entry Point | Example | Status |
|------|-------------|---------|--------|
| Single-Player Game | `src/main.ts` | Player movement, enemy spawning | Often complete |
| Multiplayer Lobby | `src/multiplayer-main.ts` | Mode/surface selection UI | Often complete |
| Multiplayer Game | `src/network-main.ts` | Player sync, gameplay, UI | Often **incomplete** |
| Server Logic | `server/GameState.ts` | Authoritative game state | Often **incomplete** |
| UI Screens | `src/ui/*.ts` | StartMenu, PauseMenu, GameOver | Often **partially complete** |

**MP Parity Gaps (from S41-13 audit):**
- 30 SP enemy types, but server only has ~12
- Weapon mastery tracked in SP, not synced to server
- Surface scaling factor (mapSizeScaleFactor) missing from server
- Pickup dimming logic missing from MP client

---

## What Blind Merge Looks Like

**Scenario:**
1. User says: "Weapon mastery should work in multiplayer too"
2. Worker adds weapon mastery UI to PauseMenu.ts (pause menu upgrade button)
3. Commit message: "feat: weapon mastery upgrade button in pause menu"
4. Main context sees PauseMenu.ts touched, tests look good, merges ✓
5. User plays multiplayer: Clicks button, nothing happens (server doesn't track weapon levels)
6. User: "I SWEAR I asked you to implement this for MP"

**The Gap:** Commit message never said "updated server code too" or "TODO: server support needed."

---

## Solution: Merge Protocol

Created `.claude/rules/merge-protocol.md` with:

1. **Code Path Inventory** — What paths exist, when they're used
2. **Worker Checklist** — Before committing, ask "Does this apply elsewhere?"
3. **Main Context Checklist** — Before merging, verify all paths are touched
4. **Multi-Path Requirement Examples** — When to be suspicious
5. **Red Flag Patterns** — "User said X should work everywhere"

**Key Protocol Rules:**
- Commit message **must list which code paths were modified**
- If multi-path requirement but only one path fixed: **explicitly note in commit message**
- Before merging: verify scope matches task requirement
- If partial fix: create follow-up task before merging

---

## Other Half-Fixed Features Identified

While auditing merge history, found these patterns (not exhaustive):

1. **QR Code (S27 → S42):** Lobby fixed, pause menu pending
2. **MP Parity Gaps (S41-13):** 3+ systems missing from server (weapons, surface scaling, pickups)
3. **Enemy AI (S41-10):** Ported to server, but unclear if client rendering needs sync
4. **UI in Multiple Screens:** Locale selector (s41-11) touched PauseMenu but not all screens
5. **Movement Bugs:** Often touch Player.ts but not network-main.ts equivalent

These aren't "bugs" — they're **scope misses** where a requirement applies to multiple code paths, but the fix only touched one.

---

## How to Prevent This Going Forward

**For Workers:**
- Before committing: "Does this requirement apply to other code paths?"
- List touched files in commit message: `feat: X — StartMenu.ts, PauseMenu.ts, server/GameState.ts`
- If not all paths covered: explicitly note follow-up: `TODO: server support (s42-02)`

**For Main Context:**
- Before merging: read commit message
- If vague: ask worker to clarify which paths were touched
- If partial: create follow-up task in TODO.md
- Trust the commit message—if it's empty or unclear, **don't merge**

**For Triager (when creating tasks):**
- If requirement applies to SP and MP, **explicitly say so** in task file
- List which files need changes: `Affects: StartMenu.ts, PauseMenu.ts, server/GameState.ts`
- Mark dependencies if needed

---

## References

- **Protocol Document:** `.claude/rules/merge-protocol.md`
- **S42-01 Example:** `tasks/s42-01-qr-code-pause-menu-short-code.md`
- **MP Architecture Audit:** `docs/MP-ARCHITECTURE.md` + `reports/mp-architecture-audit.html` (from S41-13)
- **This Decision:** This file

---

## Acceptance Criteria (for this audit task, S42-03)

- [x] Identified root cause: blind git merging without auditing scope
- [x] Case study with evidence: QR code saga (S27 → S42)
- [x] Documented code path inventory
- [x] Created merge protocol with checklists
- [x] Added protocol reference to CLAUDE.md
- [x] Identified other half-fixed features (patterns)
- [x] Decision log created (this file)

**Status:** Done. Protocol added to project. Future merges should audit scope using `.claude/rules/merge-protocol.md`.

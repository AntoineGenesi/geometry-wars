# MP Lives Shared Between All Players (Should Be Per-Player)

## Timeline
- **First reported:** 2026-02-26 — "Lives are shared across players — should be 3 lives PER player" (source: archive/inbox/2026-02-26_0800.md)
- **Fix claimed:** commit around s44f area — fix applied — user was not satisfied
- **Still broken:** 2026-02-26 — "Lives STILL shared — the fix didn't work. Lives are shared between players." (source: archive/inbox/2026-02-26_0900.md)
- **Still broken:** 2026-02-27 — "I still think the lives on the multiplayer are shared." (source: archive/inbox/2026-02-27_2100.md)
- **Still broken:** 2026-02-28 — "The hearts are still shared. I'm still... when the guy, like, has hearts, like, I was dying and then it applied to all three of us." (source: archive/inbox/2026-02-26_2200.md)
- **Fix attempt:** commit history around s44g — lives fix applied
- **Still broken:** 2026-03-01 — "The game... hit detection is broken..." (lives issue not specifically mentioned as separate from hit detection at this point)
- **Status:** Believed FIXED but was subject to many regression complaints; double-check in verification

## Root Cause
MP server tracked a single shared lives counter for the session rather than per-player lives tracking. When any player died, the shared counter decremented, affecting all players. Fix required changing the data model in `GameRoom.ts` from `state.lives` (shared) to `state.players[sessionId].lives` (per-player).

The fix was applied multiple times but kept regressing, suggesting the game-over condition check was still reading the shared counter.

## What Worked
- Per-player lives tracking in `GameRoom.ts` player state object
- Separate death handling per player session ID

## What DIDN'T Work
- "Fixing" lives on client side — server-authoritative state always overwrote client display
- Partial fix that changed display but not actual deduction logic

## Regression Risk
- If game-over logic reads a shared state field, lives will appear shared again
- When adding new game modes (e.g., PvP), ensure lives are tracked per-player not per-game

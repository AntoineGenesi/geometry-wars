# LAN Deep Fix - 2026-02-10

## Context

Sixth round of LAN multiplayer fixes. Previous five rounds all claimed "fixed" at verification level 0-2 (code analysis / compiles / tests pass) but all failed when the user actually tested. This round explicitly acknowledges verification level 3 and does NOT claim "fixed".

## Root Causes Identified

### 1. isHost Race Condition (affected Bugs 1, 4)

The `isHost` flag was computed at connect time from `network.getServerHostId()`. But Colyseus schema deserialization is asynchronous -- the `hostId` field hasn't been decoded when `connect()` resolves. So `getServerHostId()` returns `''`, making `isHost` always `false`.

**Impact:** ESC for pause did nothing. Surface type detection tried to be clever about host vs non-host logic but got it wrong.

**Fix:** Re-check `isHost` on every `onStateChange` and on ESC press.

### 2. Surface Type Schema Default (affected Bug 1)

`GameState.surfaceType` defaults to `'sphere'` in the constructor. When the client first reads the state after connecting, it may see this default before the actual value is decoded. Previous code had logic like `if (serverSurface !== 'sphere')` which incorrectly treated the default as intentional.

**Fix:** Use URL parameter as initial guess (correct for host, reasonable for client), then override from server state on first confirmed `onStateChange`.

### 3. Pole Singularity (affected Bug 2)

Sphere UV mapping has a singularity at V=0 and V=1 (poles). The sin(phi) correction factor approaches infinity near poles. Previous minimum of 0.15 (correction up to 6.67x) was too aggressive, combined with V clamp at 0.02 (very close to pole).

**Fix:** Raised minimum to 0.3 (max 3.3x correction), widened clamp to 0.05-0.95.

### 4. No Client-Side Prediction (affected Bug 3)

All previous rounds only tuned server tick/patch rates. The fundamental issue is that without client-side prediction, every movement has AT MINIMUM 2 network ticks of latency (input -> server -> response = 66ms at 30Hz).

**Fix:** Added client-side prediction for local player movement.

### 5. Stop Button Scope (affected Bug 5)

The stop button existed in StartMenu but disappeared when entering the game.

**Fix:** Added an in-game stop button visible to the host.

### 6. Incomplete Wiring (affected Bug 6)

The timeout UI, API, and server code all existed but were never connected:
- UI had `#lan-timeout-input` but the value was never read
- `LANClient.startHost()` accepted options but was called without them
- `vite-plugin-lan` accepted POST body but never parsed it for timeout
- Server had `SHUTDOWN_TIMEOUT` env var but vite-plugin never set it

**Fix:** Connected all the wiring: UI -> LANClient -> vite-plugin -> env var -> server.

## Decisions

1. **Client-side prediction uses simplified physics** (no sin(phi) correction). This means the predicted position may differ slightly from server position near sphere poles. Server reconciliation at 30Hz corrects this. Trade-off: slight visual snap near poles vs. complexity of replicating full server physics client-side. Chose simplicity.

2. **V clamp at 0.05-0.95 removes ~10% of sphere surface**. Players can't reach the very top or bottom 5% of the sphere. This is acceptable because those areas are singularities in the UV mapping and provide bad gameplay anyway.

3. **Stop server button uses `/__lan/stop` API** which only works in dev mode (Vite plugin). In production (no Vite), the button will still send `end_game` to disconnect all clients, but the server process won't be killed. Acceptable for current use case (LAN is always dev mode).

## Reversibility

Easy - all changes are in 5 files. `git diff` shows the full change set.

## 2026-02-08 - Split-Screen Local Co-Op Implementation

**Context:** The existing local co-op rendered both players in a shared viewport with a single camera. When players moved apart, both became tiny. Need true split-screen with per-player cameras.

**Options Considered:**
1. Per-viewport EffectComposer (bloom per viewport) - Pros: Full bloom in split-screen / Cons: Requires multiple render targets + compositing, complex, perf-heavy
2. Skip EffectComposer, direct renderer.render() per viewport - Pros: Simple, good perf / Cons: No bloom in split-screen (emissive materials still glow)
3. Single shared bloom pass + viewport rendering - Pros: Some bloom / Cons: Bloom bleeds across viewports

**Decision:** Option 2 - Skip bloom in split-screen, use `game.renderOverride` callback

**Reasoning:** Emissive materials already provide neon glow via material properties. The bloom pass is a subtle enhancement, not critical. The complexity of per-viewport EffectComposer (render targets, resizing, compositing) far outweighs the visual benefit in a split-screen scenario where each viewport is already smaller.

**Implementation:**
- `SplitScreenRenderer` handles viewport/scissor clipping with 1px divider lines
- `game.renderOverride` callback replaces `composer.render()` when set
- Per-viewport depth-opacity via `preRender` callback
- `ConfigurableInput` replaces `MultiplayerInput` with rebindable keys + localStorage
- `SplitScreenHUD` provides per-viewport HUD overlays
- `ControlsMenu` for rebinding keys
- `StartMenu` gets player count sub-panel (2/3/4)
- Enemy wave count scales with player count: `baseCount * (1 + (N-1) * 0.3)`

**Reversibility:** Easy - Remove `renderOverride`, revert `multiplayer-main.ts` to old version. New files are additive.

**Files Added:**
- `src/rendering/SplitScreenRenderer.ts` (~120 lines)
- `src/input/ConfigurableInput.ts` (~230 lines)
- `src/ui/ControlsMenu.ts` (~220 lines)
- `src/ui/SplitScreenHUD.ts` (~130 lines)

**Files Modified:**
- `src/core/Game.ts` - Added `renderOverride` field + conditional in loop()
- `src/ui/StartMenu.ts` - Added `playerCount` to MenuSelection + co-op sub-panel
- `src/main.ts` - Pass playerCount in URL when multiplayer selected
- `src/multiplayer-main.ts` - Full rewrite for N-player support

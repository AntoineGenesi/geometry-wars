# Third Visual Style: Arcade Pulse (Desktop Defender Inspired)

**Date:** 2026-03-15
**Status:** Design complete — awaiting implementation
**Complexity:** STANDARD (core) + optional COMPLEX extensions
**Task:** s44r18-13

---

## Context

User request (2026-03-15, verbatim): *"Research into the pixel effects and stuff that the game
Desktop Defender has, because I really like some of it. It's just the glowing aesthetic part; it
has particles. It's 2D, I think, top-down, and it's like an auto battler, but I'm just saying the
actual styling is really nice. The styling is just the color and the vibrancy, so maybe that could
be another mode as well. The colors are using the particles it uses, and it's simpler and it's
pixelated or whatever. That could be a third effect that you kind of build a third star if it's
possible. Just sort of make something nice and artistic that feels nice to look at but is playable.
That's important as well."*

We currently have two visual modes: **pixelated** and **modern**. The user wants a **third mode**
(a "third star") inspired by Desktop Defender's aesthetic.

---

## Desktop Defender Reference: What We're Inspired By

Desktop Defender (Steam, 2025) is an idle auto-battler/tower defense game with:

- **2D top-down perspective** — fixed overhead camera like our game
- **Retro pixel art** — geometric, 8/16-bit style, clean edges
- **Vibrant, fully-saturated colors** — each entity type has its own hue lane
- **Dark background** — near-black, entities glow against it like neon signs
- **Active particles at all times** — enemies trail particles, not just on death
- **Moderate bloom/glow** — halo around lit elements, not diffuse overbloom
- **Minimalist aesthetic** — entities are the visual focus, background is minimal
- **Readable gameplay** — despite high visual density, enemy types are instantly distinguishable

Reviews consistently describe it as: "chiptune party," "pleasant to watch passively," "visually
cohesive while running in background as screensaver."

**What we take from it:**
- The dark-background + saturated-entity contrast
- Per-entity distinct colors (not monochromatic)
- Particle activity (living, not just death burst)
- Glow around entities, not the environment

**What we don't take:**
- 2D flat sprite rendering (we're 3D with surface geometry)
- Tiny window format (we're full-screen)
- Pixel-art rasterization per se (we already have pixelated mode for that)

---

## Design: "Arcade Pulse" Style

**Name:** Arcade Pulse
**Alternative names:** Vibrant Glow, Neon Swarm, Chroma Arcade

### Core Philosophy
> Entities are the art. The surface is invisible. Every enemy glows. Movement is alive.

The surface/grid becomes nearly invisible. All visual energy goes to entities — enemies glow in
saturated per-type colors, bullets blaze yellow, the player pulses cyan-white. The result looks
like watching a retro arcade game played on a neon sign.

---

## Color Palette

### Background and Surface
```
Background:       #000008  (near-black with faint blue tint — deeper than current #0a0020)
Surface fill:     opacity 0.04  (nearly transparent — just a faint shape hint)
Grid lines:       opacity 0.06, color #111133  (barely visible)
Grid segments:    U: 8, V: 6  (very sparse — minimal visual noise)
```

### Entity Colors (Proposed Per-Type)
```
Player:           #00FFFF → #FFFFFF  (cyan → white pulse — energetic, central)
Player bullets:   #FFFF44  (bright warm yellow — instantly readable)
Basic enemy:      #FF3366  (hot magenta-red)
Swarm enemy:      #FF6600  (orange)
Turret enemy:     #9933FF  (deep violet)
Sniper enemy:     #00FF99  (acid green)
Boss:             #FF2200  (pure red with white corona bloom)
Pickup/orb:       #44FFAA  (mint green)
```

**Note:** Implementing full per-entity color overrides requires `EnemyInstanceManager` changes
(see Scope below). Core implementation can use a single vibrant preset that works with EXISTING
entity colors — the color palette above is the aspirational target for full implementation.

---

## Bloom / Glow Settings

| Parameter | Pixelated | Modern | **Arcade Pulse** |
|-----------|-----------|--------|-----------------|
| bloomStrength | 0.6-1.0 (preset) | 0.6-1.0 (preset) | **1.8** |
| bloomRadius | ~0.4 | ~0.5 | **0.45** |
| bloomThreshold | ~0.85 | ~0.85 | **0.50** |
| bloomResolutionScale | 0.40 | 1.0 | **1.0** |

**Why high strength + low threshold?**
- Low threshold (0.50) means only the brightest entity pixels trigger bloom — dark grid lines
  do NOT bloom. This is the Desktop Defender effect: entities glow, backgrounds stay dark.
- High strength (1.8) amplifies the glow on those bright pixels — vivid halo effect.
- Full resolution (1.0) keeps entity glow crisp and readable (not pixelated).

---

## Grid Treatment (Preset Definition)

```typescript
{
  name: 'Arcade Pulse',
  gridColor: 0x111133,
  surfaceColor: 0x000008,
  surfaceOpacity: 0.04,
  gridOpacity: 0.06,
  wireframeOnly: false,
  bloomStrength: 1.8,
  bloomRadius: 0.45,
  bloomThreshold: 0.50,
  gridSegmentsU: 8,
  gridSegmentsV: 6,
  depthCurve: 'none',      // full depth always visible — no fade
  description: 'Vibrant arcade aesthetic. Entities glow against near-black. Desktop Defender inspired.',
  sektoriConfig: {
    baseColor: new THREE.Color(0x000008),
    glowColor: new THREE.Color(0x00FFFF),   // player = cyan glow
    glowColor2: new THREE.Color(0x3300CC),  // halo = deep blue
    glowRadius: 3.0,
    falloffExponent: 3.0,                    // sharp falloff (clean arcade edges)
    baseOpacity: 0.04,
    glowOpacity: 0.55,
    pulseAmplitude: 0.3,                     // strong pulse
    pulseSpeed: 2.5,                         // fast — energetic
    trailCount: 8,
    trailFalloff: 0.65,
    trailRadiusFalloff: 0.8,
  },
}
```

---

## Particle Effects

### Existing Behavior (Death Only)
Currently particles only emit on entity death (explosion burst) and special events.

### Proposed: Active Trailing
Add continuous per-enemy particle trails:
- **Rate:** ~20 particles/second per enemy
- **Size:** 1.5-2px (small, pixel-crisp)
- **Lifetime:** 0.3-0.5 seconds
- **Color:** Match enemy color, fade to transparent
- **Gravity:** 0 (no drift — trail follows path)

**Performance math:**
- 50 enemies × 20 particles/sec × 0.4s lifetime = **400 active particles**
- Pool size: 10,000 (25x headroom) ✅
- Emit calls: 50/frame at 60fps = 1 per enemy per frame (cheap) ✅
- **Gate on:** quality tier medium+ (skip on mobile/low tier)

### Where to emit trails:
- `src/core/GameLoop.ts` — SP game loop, per-enemy update
- `src/network-main.ts` — MP game loop, per-enemy update
- Gate with: `particleSystem && qualityTier !== 'low'`

---

## Visual Mode Integration

### Extending VisualMode
```typescript
// src/ui/VisualStyleSettings.ts — line 99
export type VisualMode = 'pixelated' | 'modern' | 'vibrant';
```

### Game.setVisualMode() Changes
```typescript
// src/core/Game.ts — ~line 533
case 'vibrant':
  this.bloomResolutionScale = 1.0;  // full res (crisp)
  if (this.bloomPass) {
    this.bloomPass.strength = 1.8;
    this.bloomPass.threshold = 0.50;
    this.bloomPass.radius = 0.45;
  }
  // WebGPU path
  if (this.webgpuBloomStrengthUniform) {
    this.webgpuBloomStrengthUniform.value = 1.8;
    this.webgpuBloomThresholdUniform.value = 0.50;
  }
  this.renderer.domElement.style.imageRendering = '';  // no pixel-upscale
  break;
```

---

## Feasibility Assessment

| Feature | Effort | Risk | Notes |
|---------|--------|------|-------|
| Add 'vibrant' to VisualMode type | Trivial (1 line) | None | Simple union type extension |
| setVisualMode('vibrant') case | Easy (10 lines) | Low | Mirrors existing modern/pixelated cases |
| Add Arcade Pulse presets to VISUAL_PRESETS | Easy (20-30 lines) | Low | Same structure as existing 42 presets |
| SektoriGridMaterial config | Easy | Low | Already supports full config — just tune values |
| SettingsMenu UI (third option) | Easy | Low | Add one radio button / option |
| loadVisualMode parsing for 'vibrant' | Trivial | None | 1 character change to conditional |
| Continuous particle trails (enemies) | Medium | Medium | CPU overhead — gate on quality tier |
| Per-entity color overrides | Complex | High | EnemyInstanceManager + dimming interaction |
| WebGPU bloom compat | Medium | Medium | TSL bloom path differs from UnrealBloomPass |

**Core implementation (without per-entity colors):** STANDARD, ~2-4 hours
**Full vision (with per-entity colors):** COMPLEX, requires dedicated task

---

## Implementation Plan (Core)

### Phase 1: Type + Mode (15 min)
1. `src/ui/VisualStyleSettings.ts` L99 — add `'vibrant'` to VisualMode union
2. `src/ui/VisualStyleSettings.ts` L103-109 — handle `'vibrant'` in loadVisualMode (default to 'modern')

### Phase 2: Bloom Settings (20 min)
3. `src/core/Game.ts` ~L533 — add `'vibrant'` case in `setVisualMode()`
4. Handle both WebGL2 (bloomPass) and WebGPU (uniform node) paths

### Phase 3: Presets (30 min)
5. `src/ui/VisualPlayground.ts` L104 — add 3-4 Arcade Pulse presets to VISUAL_PRESETS
   - "Arcade Pulse" (primary — Sektori + vibrant)
   - "Neon Swarm" (non-Sektori variant)
   - "Chroma Dark" (deeper contrast variant)

### Phase 4: UI (20 min)
6. `src/ui/SettingsMenu.ts` — add 'Arcade Pulse' to visual mode selector
7. `src/ui/EffectsPanel.ts` — if panel handles mode switching, add third option

### Phase 5: Particle Trails (Optional, Medium scope)
8. `src/core/GameLoop.ts` — add per-enemy trail emission in entity update loop
9. `src/network-main.ts` — same for MP path
10. Gate on `visualMode === 'vibrant' && qualityTier !== 'low'`

---

## Scope: What Is NOT Included (Separate Tasks)

- **Per-entity color override system** — requires EnemyInstanceManager refactor. The dimming
  system already uses `instanceColor` for opacity — adding per-type hue override needs careful
  design to not break dimming. Separate COMPLEX task.
- **Enemy-specific particle effects** (e.g., trailing fire for bosses) — separate task.
- **Custom sprite/texture work** — no pixel art sprites needed; we use existing geometry.
- **Matchmaking / game mode changes** — purely visual, no gameplay changes.

---

## "Playable" Requirement (User's Key Ask)

User explicitly said: *"make something nice and artistic that feels nice to look at but is
PLAYABLE. That's important as well."*

Arcade Pulse maintains playability through:
1. **Near-invisible grid** — removes visual clutter that obscures spatial reasoning
2. **Per-enemy distinct colors** (aspirational) — instant enemy type recognition
3. **Bullet color contrast** — yellow bullets against dark background = high visibility
4. **Depth visibility** — `depthCurve: 'none'` means all enemies always visible regardless
   of surface position (no depth fade hiding enemies on far side)
5. **Focused bloom** — threshold 0.50 means only *entities* bloom, not fog/grid noise

---

## Decision: Why Not Just Add More Presets?

The user says "third star" — implying a mode-level change (like pixelated vs modern), not just
another entry in the 42-preset VisualPlayground. A named mode:
- Persists as a single setting (not "go find it in a grid of 42")
- Can have behavior beyond bloom settings (pixel ratio, particle systems, entity colors)
- Is discoverable from the settings menu as a first-class option
- Matches the "third visual style" framing in the task

We implement it as BOTH: a new VisualMode type AND a set of Arcade Pulse presets in the Playground.

---

## Reversibility

**Easy to reverse:** The VisualMode type extension is additive (no existing code breaks).
The presets are additive (no existing presets change). The setVisualMode() 'vibrant' case
is new code (no existing cases touched).

**To revert:** Remove 'vibrant' from VisualMode union, remove the case in setVisualMode(),
remove the Arcade Pulse presets from VISUAL_PRESETS, remove the UI option.

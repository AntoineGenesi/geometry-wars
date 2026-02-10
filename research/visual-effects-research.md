# Visual Effects Research — Beyond Bloom and Basic Particles

**Date:** 2026-02-11
**Status:** Complete
**Context:** Geometry Wars 3D browser game, Three.js ^0.170, targeting 60fps with 10K+ entities on phones and laptops

---

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [Current Effects Inventory](#current-effects-inventory)
3. [Effect Research — 12 Categories, 35+ Effects](#effect-research)
4. [Cost Matrix](#cost-matrix)
5. [Top 5 Recommended Effects](#top-5-recommended)
6. [Effects to Avoid](#effects-to-avoid)
7. [Implementation Priority Roadmap](#implementation-priority-roadmap)
8. [Prototype Code Snippets](#prototype-code-snippets)

---

## Executive Summary

This document catalogs 35+ visual effect techniques across 12 categories, evaluated for a neon-glow arcade shooter running in the browser. Each effect is rated on GPU cost, visual impact, implementation complexity, InstancedMesh compatibility, and mobile feasibility.

**Key findings:**
- The biggest visual bang-for-buck comes from **screen-space post-processing effects** (chromatic aberration, CRT scanlines, screen-space distortion) because they cost a fixed amount regardless of entity count
- **Instanced particle sub-types** (ring bursts, directional sparks, confetti) are nearly free additions since the particle system already exists
- **Ribbon trails** using MeshLine or custom geometry offer much richer visuals than the current Line-based trails
- **Shockwave distortion** is the single highest-impact effect we're missing — it's the signature Geometry Wars "death pop"
- **Volumetric effects** (god rays, true fog) should be avoided entirely on mobile — the fill rate cost is prohibitive

---

## Current Effects Inventory

Before adding new effects, here's what already exists in the codebase:

| Effect | File | Type | Notes |
|--------|------|------|-------|
| Bloom (UnrealBloomPass) | `Game.ts`, `SplitScreenRenderer.ts` | Post-process | WebGL2 EffectComposer, WebGPU TSL approximation |
| Vignette | `Game.ts`, `SplitScreenRenderer.ts` | Post-process (ShaderPass) | Subtle edge darkening |
| Point particles | `ParticleSystem.ts` | GPU Points | 10K pool, additive blending, shader-based circular sprites |
| Shatter fragments | `ParticleSystem.ts` | Mesh pool | 400 pre-allocated triangle/square/diamond meshes |
| Chain lightning | `ChainLightning.ts` | Line geometry | Jagged bolts with jitter animation, surface projection |
| Glow trail | `GlowTrail.ts` | Line + layers | 3 glow layers, speed-reactive intensity |
| Basic trail | `TrailEffect.ts` | Line | Simple vertex-color fade |
| Entity glow | `EntityGlow.ts` | Sprite | Radial gradient texture, pulsing |
| Screen shake | `ScreenShake.ts` | Camera offset | Exponential decay, stacking |
| Sektori grid glow | `SektoriGridMaterial.ts` | Custom ShaderMaterial | Proximity glow on surface grid lines |
| Depth opacity | `DepthOpacity.ts` | CPU computation | Raycast occlusion for far-side fade |

**Gaps identified:** No screen-space distortion, no ribbon/mesh trails, no color grading, no chromatic aberration, no shockwave rings, no energy tendrils, no dissolve/dust effects, no portal/warp visuals.

---

## Effect Research

### Category 1: Distortion Effects

#### 1.1 Shockwave Distortion Ring

**Description:** An expanding ring that displaces screen pixels outward as it passes, creating a visible ripple/shockwave emanating from explosions or deaths. THE signature Geometry Wars effect.

- **GPU Cost:** LOW — Single full-screen shader pass sampling the scene texture with UV offset
- **Visual Impact:** 5/5 — Instantly recognizable, extremely juicy
- **Implementation:** Post-process ShaderPass. Maintain a small array of active shockwaves (position, radius, strength, time). Fragment shader computes UV displacement based on distance to each shockwave center. Max ~8 concurrent shockwaves.
- **InstancedMesh Compatible:** YES — screen-space, entity-count-independent
- **Mobile Feasible:** YES — single texture sample + math, negligible cost
- **Example Games:** Geometry Wars (all versions), Nuclear Throne, Nex Machina
- **Priority:** MUST-HAVE

```
Estimated cost: 0.1-0.3ms per frame (1 full-screen pass)
Draw calls: +0 (merged into existing post-process chain)
```

#### 1.2 Heat Haze / Localized Distortion

**Description:** Wavy distortion around hot objects (e.g., charging enemies, overheated weapons). Uses a noise-based UV offset applied to a screen-space region.

- **GPU Cost:** LOW — Same technique as shockwave but localized and continuous
- **Visual Impact:** 3/5 — Subtle but adds atmosphere, good for telegraphing danger
- **Implementation:** Can share the shockwave ShaderPass. Add a "persistent distortion" mode where radius doesn't expand. Sample a noise texture for organic waviness.
- **InstancedMesh Compatible:** YES
- **Mobile Feasible:** YES (with reduced distortion sources, max 4)
- **Example Games:** Hades (fire effects), Returnal (enemy telegraphs)
- **Priority:** NICE-TO-HAVE

#### 1.3 Barrel/Pincushion Distortion

**Description:** Slight lens distortion on the entire screen, making edges curve inward or outward. Enhances the "looking through a screen" feel.

- **GPU Cost:** LOW — Single uniform UV remap in post-process
- **Visual Impact:** 2/5 — Very subtle, easily overdone
- **Implementation:** Add a barrel distortion term to the vignette shader (combine them).
- **InstancedMesh Compatible:** YES
- **Mobile Feasible:** YES
- **Example Games:** Most retro/arcade games with CRT filter options
- **Priority:** SKIP for now — vignette already handles edge treatment

---

### Category 2: Trail Effects

#### 2.1 Ribbon Trails (Mesh-Based)

**Description:** Instead of a thin Line, create a screen-facing quad strip that tapers from wide to narrow. Allows texture mapping (gradient, energy pattern) and per-vertex color/alpha.

- **GPU Cost:** LOW-MEDIUM — Each trail is a single draw call with ~20-60 vertices. 10 active trails = 10 draw calls.
- **Visual Impact:** 5/5 — Dramatically richer than Line-based trails. Allows width variation, texture scrolling, glow falloff.
- **Implementation:** Custom BufferGeometry updated each frame. Two vertices per point (left/right offset by normal * width). Use a ShaderMaterial with a gradient texture + additive blending. Can use THREE.Mesh instead of THREE.Line.
- **InstancedMesh Compatible:** PARTIAL — Each trail is unique geometry, but can batch by sharing material
- **Mobile Feasible:** YES — low vertex count, single texture sample
- **Example Games:** Geometry Wars 3 (player trail), Thumper, Beat Saber
- **Priority:** MUST-HAVE (replaces GlowTrail)

```
Estimated cost: 0.05ms per trail (negligible vertex count)
Draw calls: +1 per active trail (can batch to 1 with instancing tricks)
```

#### 2.2 Afterimage / Ghost Trail

**Description:** Previous frames of an entity rendered as translucent copies at decreasing opacity, creating a "speed lines" effect.

- **GPU Cost:** MEDIUM — Requires rendering the entity multiple times OR storing previous transform matrices
- **Visual Impact:** 4/5 — Looks great for fast-moving enemies and player dashes
- **Implementation Option A:** Store last N transforms, render entity N times with decreasing opacity. Expensive for many entities. **Option B (better):** Render to a "ghost buffer" with low-pass feedback (accumulation buffer) — single extra render pass. Fragment: `ghostBuffer = mix(ghostBuffer, currentFrame, 0.15)`. Additive blend over scene.
- **InstancedMesh Compatible:** OPTION B is fully compatible (screen-space)
- **Mobile Feasible:** YES for Option B (one extra full-screen blit), NO for Option A at scale
- **Example Games:** Devil May Cry (Vergil), Smash Bros (fast characters)
- **Priority:** NICE-TO-HAVE

#### 2.3 Dash Line / Dashed Trail

**Description:** Animated dashed pattern along a trail path, like a conveyor belt or energy conduit.

- **GPU Cost:** LOW — Same as ribbon trail, just modulate alpha with `fract(uv.x * frequency + time)`
- **Visual Impact:** 3/5 — Good for differentiation (e.g., different weapon trails)
- **Implementation:** Add to ribbon trail shader. UV.x along trail length, modulate with step/smoothstep for dashes.
- **InstancedMesh Compatible:** YES (same as ribbon)
- **Mobile Feasible:** YES
- **Example Games:** Tron (light cycles), various racing games
- **Priority:** NICE-TO-HAVE (easy add-on to ribbon trails)

---

### Category 3: Electric / Lightning Effects

#### 3.1 Arc Renderer (Improved)

**Description:** The existing ChainLightning creates jagged lines, but real electric arcs should have glow halos, branching forks, and screen-space bloom interaction.

- **GPU Cost:** LOW — Current implementation is already cheap. Adding a glow texture sprite per segment adds ~1 draw call per active chain.
- **Visual Impact:** 4/5 with improvements — Current 3/5
- **Implementation:** Upgrade ChainLightning with: (a) wider line emulation via screen-facing quads, (b) glow sprites at junction points, (c) secondary "branch" lines at random angles. All within existing Line+Sprite system.
- **InstancedMesh Compatible:** YES (sprites and lines are separate from instanced enemies)
- **Mobile Feasible:** YES
- **Example Games:** Geometry Wars 3 (Tesla weapon), Risk of Rain 2 (Loader)
- **Priority:** MUST-HAVE (upgrade existing system)

#### 3.2 Electrostatic Field

**Description:** Multiple tiny arcs jumping between nearby enemies or around a charged entity, creating a "Jacob's ladder" effect.

- **GPU Cost:** LOW — Reuse ChainLightning geometry, just fire many short bolts
- **Visual Impact:** 4/5 — Very visually distinctive for "electric" themed enemies/weapons
- **Implementation:** Each frame, pick random pairs of nearby vertices on an entity's surface and draw short lightning bolts between them. Pool of ~20 short Line objects, recycled every 2-3 frames.
- **InstancedMesh Compatible:** YES — arcs are overlay geometry
- **Mobile Feasible:** YES (limit to 10-15 arcs)
- **Example Games:** Enter the Gungeon (electric enemies), Risk of Rain 2
- **Priority:** NICE-TO-HAVE

---

### Category 4: Shield / Bubble Effects

#### 4.1 Fresnel Shield Sphere

**Description:** A semi-transparent sphere around a player/enemy that's most visible at the edges (Fresnel effect) and flashes on impact.

- **GPU Cost:** LOW — Single sphere mesh with custom ShaderMaterial. Fresnel = `1.0 - dot(viewDir, normal)`. One draw call.
- **Visual Impact:** 5/5 — Extremely recognizable, classic sci-fi shield look
- **Implementation:** `SphereGeometry(radius, 32, 16)` with ShaderMaterial: vertex shader passes world normal and view direction, fragment computes Fresnel term, multiplies by color, additive blending. Animate opacity pulse on hit.
- **InstancedMesh Compatible:** NO for InstancedMesh (need unique sphere per entity), but only 1-4 shields active at once
- **Mobile Feasible:** YES — trivial geometry, simple shader
- **Example Games:** Halo (overshield), Destiny 2 (Titan bubble), Mass Effect (Barrier)
- **Priority:** MUST-HAVE (for player shields, boss shields)

```
Estimated cost: 0.05ms per shield (simple sphere + Fresnel)
Draw calls: +1 per active shield
```

#### 4.2 Hexagonal Force Field

**Description:** Shield made of hexagonal tiles that light up individually when hit, creating a honeycomb impact pattern.

- **GPU Cost:** MEDIUM — Requires hex grid UV calculation in shader, hit tracking per hex cell
- **Visual Impact:** 5/5 — Extremely cool, very "sci-fi"
- **Implementation:** Same sphere as 4.1, but fragment shader converts UV to hex grid coords. Store up to 8 recent hit positions as uniforms. Each hex cell checks distance to hit points and lights up accordingly with fade-out.
- **InstancedMesh Compatible:** NO (unique per entity, but few active)
- **Mobile Feasible:** YES (math-only shader, no textures needed)
- **Example Games:** Overwatch (Sigma/Winston shields), Star Trek, Halo Infinite
- **Priority:** NICE-TO-HAVE (upgrade from basic Fresnel when ready)

---

### Category 5: Screen-Space Effects

#### 5.1 Chromatic Aberration

**Description:** RGB channel separation at screen edges or triggered by impacts. Red, green, blue channels are sampled at slightly different UV offsets.

- **GPU Cost:** LOW — 3 texture samples instead of 1 in post-process (2 extra samples)
- **Visual Impact:** 4/5 — Instant "digital damage" feel, very neon-aesthetic
- **Implementation:** Post-process ShaderPass. On hit, increase `aberrationStrength` which decays over time. Fragment: `r = texture(tDiffuse, uv + offset * strength).r; g = texture(tDiffuse, uv).g; b = texture(tDiffuse, uv - offset * strength).b;`
- **InstancedMesh Compatible:** YES (screen-space)
- **Mobile Feasible:** YES (2 extra texture samples is negligible)
- **Example Games:** Hotline Miami, Hyper Light Drifter, Cyberpunk 2077
- **Priority:** MUST-HAVE

```
Estimated cost: 0.05-0.1ms (merged into existing post-process chain)
Draw calls: +0 (combine with vignette pass)
```

#### 5.2 CRT Scanlines

**Description:** Horizontal scanline pattern overlaid on the scene, optionally with slight color bleed and interlace flicker. Enhances the retro arcade feel.

- **GPU Cost:** LOW — Simple `sin(gl_FragCoord.y * frequency)` modulation in post-process
- **Visual Impact:** 3/5 — Niche appeal, some players find it annoying. Good as optional toggle.
- **Implementation:** Add to vignette/final pass: `color *= 0.9 + 0.1 * sin(gl_FragCoord.y * scanlineFrequency)`. Optional: add slight barrel distortion and color fringing per scanline.
- **InstancedMesh Compatible:** YES
- **Mobile Feasible:** YES
- **Example Games:** Geometry Wars: Retro Evolved (optional), Resogun, Pac-Man Championship Edition
- **Priority:** NICE-TO-HAVE (settings toggle)

#### 5.3 Screen Flash

**Description:** Brief full-screen color flash (white, red, etc.) on significant events — player death, boss spawn, super weapon activation.

- **GPU Cost:** NEGLIGIBLE — Additive color overlay in post-process, one uniform
- **Visual Impact:** 4/5 — Strong punctuation for key moments, very "game feel"
- **Implementation:** Add `flashColor` and `flashIntensity` uniforms to final pass. `color += flashColor * flashIntensity`. Decay flashIntensity over ~0.15 seconds.
- **InstancedMesh Compatible:** YES
- **Mobile Feasible:** YES
- **Example Games:** Every action game ever (Call of Duty, Doom, etc.)
- **Priority:** MUST-HAVE

#### 5.4 Speed Lines / Radial Blur

**Description:** Lines radiating from center when player moves fast, creating a sense of speed. Can also be a radial blur post-process.

- **GPU Cost:** LOW (lines) to MEDIUM (radial blur with multi-sample)
- **Visual Impact:** 3/5 — Good feedback for speed boosts, less useful in top-down
- **Implementation Option A:** Overlay geometry: thin Lines from center outward, additive blending, tied to player speed. **Option B:** Post-process radial blur: sample scene texture along radial direction from screen center, 4-8 taps.
- **InstancedMesh Compatible:** YES (both approaches)
- **Mobile Feasible:** YES for Option A, CAREFUL for B (limit taps to 4)
- **Example Games:** F-Zero, WipEout, many racing games
- **Priority:** SKIP — 3D surface gameplay doesn't benefit much from screen-center radial blur

---

### Category 6: Volumetric Effects

#### 6.1 God Rays / Light Shafts

**Description:** Beams of light radiating from a bright source through the scene, visible where they pass through transparent or lit geometry.

- **GPU Cost:** HIGH — Requires multiple passes: radial blur from light source position, mask with depth buffer. 6-12 texture samples per pixel.
- **Visual Impact:** 5/5 — Stunning when done right
- **Implementation:** Post-process: render bright objects to a separate buffer, apply radial blur centered on light position, composite. Requires additional render target.
- **InstancedMesh Compatible:** YES (post-process)
- **Mobile Feasible:** NO — too many texture samples, additional render target hurts fill rate
- **Example Games:** Dark Souls, Destiny 2, The Last of Us
- **Priority:** SKIP — wrong aesthetic for neon arcade, and too expensive for mobile

#### 6.2 Volumetric Fog / Atmosphere

**Description:** Thick fog that varies in density, creating depth and atmosphere.

- **GPU Cost:** HIGH — Raymarching in post-process (16-64 steps per pixel) or depth-based fog (cheap but flat)
- **Visual Impact:** 3/5 — Works against our neon-on-black aesthetic
- **Implementation:** Depth-based: `fogFactor = exp(-density * depth)`, cheap. Raymarched: expensive but beautiful.
- **InstancedMesh Compatible:** YES
- **Mobile Feasible:** Only depth-based fog (negligible cost), NOT raymarched
- **Example Games:** Silent Hill, Bloodborne
- **Priority:** SKIP — conflicts with neon aesthetic, obscures gameplay

---

### Category 7: Particle Sub-Types

#### 7.1 Ring Burst

**Description:** Particles emitted in a flat ring expanding outward, creating a "nova" effect. Different from spherical emission.

- **GPU Cost:** NEGLIGIBLE — Same particle system, just constrain emission to a ring shape
- **Visual Impact:** 4/5 — Very Geometry Wars (the expanding ring on enemy death)
- **Implementation:** In `ParticleSystem.emit()`, instead of spherical spread, constrain velocity to a plane: `velocity = tangentPlane * randomAngle * speed`. Add `emitRing(position, normal, count, speed, ...)` method.
- **InstancedMesh Compatible:** YES (uses existing particle pool)
- **Mobile Feasible:** YES
- **Example Games:** Geometry Wars, Resogun, Super Stardust
- **Priority:** MUST-HAVE

#### 7.2 Directional Sparks

**Description:** Long, thin particles that stretch in their direction of motion (like sparks from grinding metal). Created by scaling point sprites along velocity.

- **GPU Cost:** NEGLIGIBLE — Modify existing particle shader to stretch along velocity direction
- **Visual Impact:** 4/5 — Much more dynamic than circular particles
- **Implementation:** Pass velocity to particle vertex shader. Compute screen-space velocity direction, stretch `gl_PointSize` along that axis. Or use a custom quad geometry per particle for more control.
- **InstancedMesh Compatible:** YES (extends existing particle system)
- **Mobile Feasible:** YES
- **Example Games:** Dark Souls (metal sparks), Nier: Automata, Geometry Wars
- **Priority:** MUST-HAVE

#### 7.3 Confetti / Paper Particles

**Description:** Small flat quads that tumble and flutter as they fall, each with random color. Good for celebrations (level up, high score).

- **GPU Cost:** LOW — Reuse the shatter fragment system, just change behavior to add flutter
- **Visual Impact:** 3/5 — Great for positive feedback moments
- **Implementation:** Use existing fragment pool, add sinusoidal flutter to rotation and slow fall velocity. Each fragment gets a random bright color.
- **InstancedMesh Compatible:** PARTIAL — uses existing Mesh pool
- **Mobile Feasible:** YES (reuses existing system)
- **Example Games:** Mario Party, Overcooked, Celeste (level complete)
- **Priority:** NICE-TO-HAVE

#### 7.4 Debris / Chunk Particles

**Description:** Small geometric shapes (cubes, wedges) that fly outward on impact, bouncing off the surface. Heavier than sparks.

- **GPU Cost:** LOW — Similar to shatter fragments but with surface collision
- **Visual Impact:** 3/5 — Adds weight and impact to collisions
- **Implementation:** Extend shatter system. After each position update, project back to surface using `meshSurface.closestPointOnSurface()`. Bounce with energy loss.
- **InstancedMesh Compatible:** PARTIAL (mesh pool)
- **Mobile Feasible:** YES (limit count to 20 per event)
- **Example Games:** Rocket League (car impact), Geometry Wars (heavy enemies)
- **Priority:** NICE-TO-HAVE

---

### Category 8: Color Effects

#### 8.1 Color Grading / LUT

**Description:** Apply a lookup table to remap all colors, shifting the entire scene's mood. Can transition between LUTs for different game states (normal, danger, boss fight).

- **GPU Cost:** LOW — Single 3D texture sample in post-process
- **Visual Impact:** 4/5 — Completely transforms the feel of the scene
- **Implementation:** Create a 16x16x16 or 32x32x32 3D LUT texture. In post-process: use scene color as UV into LUT, output remapped color. Can lerp between two LUTs for transitions. Three.js has no built-in LUT pass but the shader is trivial.
- **InstancedMesh Compatible:** YES (screen-space)
- **Mobile Feasible:** YES (single 3D texture lookup)
- **Example Games:** Every AAA game (Uncharted, God of War, DOOM)
- **Priority:** NICE-TO-HAVE (for boss fights, danger zones, multiplayer team tinting)

#### 8.2 HDR Tone Mapping

**Description:** Already partially configured (THREE.NoToneMapping is set). Switching to ACESFilmic or Reinhard would compress bright highlights more gracefully, preventing white-out.

- **GPU Cost:** NEGLIGIBLE — Built into Three.js renderer, just change `toneMapping` property
- **Visual Impact:** 3/5 — Subtle but prevents harsh clipping on bright effects
- **Implementation:** `renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.2;` — literally two lines
- **InstancedMesh Compatible:** YES
- **Mobile Feasible:** YES
- **Example Games:** Standard in all modern engines
- **Priority:** NICE-TO-HAVE (try ACESFilmic and compare)

#### 8.3 Film Grain

**Description:** Subtle noise overlay that adds texture to flat areas, reducing banding and adding cinematic grit.

- **GPU Cost:** NEGLIGIBLE — `color += (random(uv + time) - 0.5) * grainStrength` in post-process
- **Visual Impact:** 2/5 — Very subtle, only noticeable on close inspection
- **Implementation:** Add to final pass shader. Hash function for pseudo-random, seeded by UV + time.
- **InstancedMesh Compatible:** YES
- **Mobile Feasible:** YES
- **Example Games:** Silent Hill, Resident Evil, Limbo
- **Priority:** SKIP — conflicts with clean neon aesthetic

---

### Category 9: Geometry Effects

#### 9.1 Mesh Deformation / Vertex Displacement

**Description:** Surface mesh warps in response to player movement or impacts. The grid deforms and springs back, like the classic Geometry Wars grid.

- **GPU Cost:** MEDIUM — Requires vertex shader modifications on the surface mesh. If using displacement map, needs per-frame texture update. If CPU-side, needs geometry buffer update.
- **Visual Impact:** 5/5 — THE defining Geometry Wars visual. The wobbly grid is iconic.
- **Implementation Option A (GPU):** Custom vertex shader on surface material. Pass up to 16 "deformation points" as uniforms (position + strength + radius + decay). Vertex shader offsets position along normal by sum of all deformation influences. **Option B (CPU):** Modify surface geometry positions directly. Worse performance but simpler.
- **InstancedMesh Compatible:** YES — deformation is on the surface mesh, not on instanced entities
- **Mobile Feasible:** YES for GPU approach (uniform-driven, no extra passes)
- **Example Games:** Geometry Wars (all versions), Super Stardust, Resogun
- **Priority:** MUST-HAVE (if not already implemented in surface materials)

```
Estimated cost: 0.2ms per frame (vertex shader math on ~5K surface vertices)
Draw calls: +0 (modifies existing surface draw call)
```

#### 9.2 Dissolve / Dust Effect

**Description:** Entity crumbles into dust, with the mesh progressively becoming transparent in a noise pattern until nothing remains.

- **GPU Cost:** LOW per entity — Custom ShaderMaterial with noise threshold. `if (noise(uv) < dissolveProgress) discard;`
- **Visual Impact:** 5/5 — Dramatic death effect, very satisfying
- **Implementation:** For InstancedMesh enemies, this is HARD because you can't have per-instance shader uniforms easily. **Workaround:** When an enemy starts dissolving, remove it from the InstancedMesh and spawn a temporary standalone Mesh with the dissolve material. Limit to ~5 simultaneous dissolves.
- **InstancedMesh Compatible:** NO directly — requires spawning standalone meshes (pool of ~10)
- **Mobile Feasible:** YES (noise discard is cheap, limit concurrent dissolves)
- **Example Games:** Thanos snap (Avengers), Nier: Automata, Destiny 2
- **Priority:** NICE-TO-HAVE (complex InstancedMesh workaround)

---

### Category 10: Line Effects

#### 10.1 Animated UV / Scrolling Energy Lines

**Description:** Lines (grid, trails, lightning) with a texture that scrolls along their length, creating a flowing energy look.

- **GPU Cost:** NEGLIGIBLE — Just `uv.x += time * scrollSpeed` in the vertex/fragment shader
- **Visual Impact:** 4/5 — Makes static lines feel alive and dynamic
- **Implementation:** Already partially possible with SektoriGridMaterial. Extend to trail materials: add time-based UV offset. Use a repeating gradient or pattern texture.
- **InstancedMesh Compatible:** YES (shader-only change)
- **Mobile Feasible:** YES
- **Example Games:** Tron, Geometry Wars grid
- **Priority:** MUST-HAVE (easy, high-impact upgrade to existing line materials)

#### 10.2 Neon Tube Lines

**Description:** Lines rendered as glowing tubes rather than flat lines. Screen-facing quad strips with a radial gradient cross-section, creating a 3D tube illusion.

- **GPU Cost:** LOW — Same as ribbon trail technique, applied to grid/decoration lines
- **Visual Impact:** 4/5 — Significantly more polished look than `linewidth: 1` lines
- **Implementation:** Replace LineSegments with custom BufferGeometry of screen-facing quads. Fragment shader: distance from center of quad determines brightness (bright center, dim edges). Additive blending.
- **InstancedMesh Compatible:** YES (geometry batching)
- **Mobile Feasible:** YES (low vertex count)
- **Example Games:** Beat Saber, Tron: Evolution, Rez Infinite
- **Priority:** NICE-TO-HAVE (significant visual upgrade but requires reworking grid rendering)

---

### Category 11: Water / Ripple Effects

#### 11.1 Surface Ripple Simulation

**Description:** 2D wave simulation on the game surface. Impacts create ripples that propagate outward, interact, and decay. Rendered as normal perturbation on the surface.

- **GPU Cost:** MEDIUM — Requires a ping-pong texture pair (current/previous wave state). Each frame: compute new wave state from neighbors + damping. Sample wave texture in surface shader for normal offset.
- **Visual Impact:** 5/5 — Beautiful interactive water-like surface response
- **Implementation:** Two small render targets (e.g., 256x256). Compute shader or fragment shader does wave equation: `new[x,y] = 2*current[x,y] - previous[x,y] + speed*(neighbors - 4*current[x,y]) - damping`. Surface shader reads this as a normal map perturbation. Write impact positions when bullets/enemies hit.
- **InstancedMesh Compatible:** YES (surface shader change, not entity change)
- **Mobile Feasible:** WITH FALLBACK — Use 128x128 resolution on mobile, 256x256 on desktop. The ping-pong render targets are the bottleneck.
- **Example Games:** Geometry Wars (grid deformation IS this), Flow, PixelJunk Eden
- **Priority:** NICE-TO-HAVE (overlaps with mesh deformation; choose one or combine)

#### 11.2 2D Shockwave Ring on Surface

**Description:** A visible ring expanding across the surface (not screen-space), following the surface curvature. Different from screen-space shockwave (5.1) — this lives in world space.

- **GPU Cost:** LOW — Surface shader checks distance from ring center, draws a bright ring at the right radius
- **Visual Impact:** 4/5 — Looks great on curved surfaces (sphere, torus)
- **Implementation:** Pass ring uniforms to surface material (center, radius, width, color, intensity). Fragment shader: `ringDist = abs(distance(worldPos, center) - ringRadius)`. If within width, add color. Multiple rings via uniform array.
- **InstancedMesh Compatible:** YES
- **Mobile Feasible:** YES
- **Example Games:** Geometry Wars 3 (surface attacks), Super Mario Galaxy (shockwave)
- **Priority:** MUST-HAVE (different from screen distortion, great for surface gameplay)

---

### Category 12: Portal / Warp Effects

#### 12.1 Spiral Vortex

**Description:** A swirling spiral pattern that pulls visuals toward a center point, like looking into a drain. Good for enemy spawners, black holes, or portals.

- **GPU Cost:** LOW — ShaderMaterial on a flat disc or sphere. UV rotation based on distance from center and time.
- **Visual Impact:** 5/5 — Very dramatic, immediately draws the eye
- **Implementation:** Disc mesh with custom ShaderMaterial. Fragment: convert UV to polar coordinates, rotate theta by `frequency / radius + time`. Add glow ring at edge. Additive blending.
- **InstancedMesh Compatible:** NO (unique geometry per vortex, but only 1-3 active)
- **Mobile Feasible:** YES (simple math shader)
- **Example Games:** Portal, Geometry Wars 3 (black holes), Risk of Rain 2
- **Priority:** MUST-HAVE (enemy spawn points need visual flair)

```
Estimated cost: 0.05ms per vortex (single plane mesh + shader math)
Draw calls: +1 per active vortex
```

#### 12.2 Tunnel / Warp Speed

**Description:** Stretching lines from center of screen outward, creating a "jump to hyperspace" effect. Good for level transitions.

- **GPU Cost:** LOW — Screen-space post-process: radial streaks from center
- **Visual Impact:** 4/5 — Great for transitions but single-purpose
- **Implementation:** Post-process pass: sample scene texture along radial direction with increasing offset. Or overlay geometry: instanced thin Lines radiating from center with animated length.
- **InstancedMesh Compatible:** YES
- **Mobile Feasible:** YES (limit sample count)
- **Example Games:** Star Wars, Mass Effect (relay), No Man's Sky
- **Priority:** NICE-TO-HAVE (only needed for level transitions)

#### 12.3 Matrix-Style Digital Rain

**Description:** Cascading columns of characters/symbols falling like rain, overlaid on the scene or on a surface.

- **GPU Cost:** LOW-MEDIUM — Requires a texture atlas of characters, animated UV sampling per column
- **Visual Impact:** 4/5 — Very distinctive "digital" feel, fits neon aesthetic
- **Implementation:** Render to a dedicated quad overlay or into the surface shader. Create a glyph atlas texture. For each column: animate Y offset over time, sample glyph at current position. Vary speed and brightness per column.
- **InstancedMesh Compatible:** YES (overlay or texture effect)
- **Mobile Feasible:** YES (with reduced column count)
- **Example Games:** The Matrix (obviously), Enter the Gungeon (glitch effects), Rez
- **Priority:** NICE-TO-HAVE (great for special levels or boss encounters)

---

### Additional Effects (User Requested)

#### A.1 Energy Tendrils

**Description:** Wispy energy trails that reach outward from an entity, undulating organically. Like tentacles of light.

- **GPU Cost:** LOW-MEDIUM — Each tendril is a line/ribbon with noise-based displacement. 4-8 tendrils per entity = 4-8 Line objects.
- **Visual Impact:** 4/5 — Excellent for boss enemies, charged states
- **Implementation:** Each tendril: a Line with ~20 points. Each frame, update positions: base follows entity, tip follows `noise(index + time) * amplitude` offset. Additive blending, fade alpha toward tip.
- **InstancedMesh Compatible:** NO (unique geometry per entity, but only on 1-3 special entities)
- **Mobile Feasible:** YES (limit to 4 tendrils per entity)
- **Example Games:** Hollow Knight (Radiance boss), Hades (final boss)
- **Priority:** NICE-TO-HAVE (boss-only effect)

#### A.2 Crystal Shattering

**Description:** An entity's mesh splits into sharp polygonal pieces that fly apart with reflective surfaces.

- **GPU Cost:** MEDIUM — Pre-compute Voronoi fracture of enemy mesh. On death, swap InstancedMesh entry for standalone pieces.
- **Visual Impact:** 5/5 — Extremely dramatic
- **Implementation:** Pre-compute 8-12 convex pieces per enemy type using Voronoi decomposition. On death, remove from InstancedMesh, spawn piece meshes with outward velocity + rotation. Pool and reuse.
- **InstancedMesh Compatible:** NO directly (swap to standalone meshes on death)
- **Mobile Feasible:** WITH FALLBACK (limit to 6 pieces, use existing shatter system as fallback)
- **Example Games:** Returnal, Control (Hiss enemies), Nier: Automata
- **Priority:** NICE-TO-HAVE (the existing shatter fragment system covers 80% of this)

#### A.3 Fractal / Geometric Patterns

**Description:** Procedural fractal patterns (Mandelbrot zoom, Sierpinski, sacred geometry) rendered on surfaces or as background effects.

- **GPU Cost:** HIGH — Fractal iteration in shader (10-50+ iterations per pixel)
- **Visual Impact:** 5/5 — Mesmerizing, very unique
- **Implementation:** ShaderMaterial on background plane or surface. Fragment shader iterates fractal equation. Can be pre-baked to texture for mobile.
- **InstancedMesh Compatible:** YES (shader or texture)
- **Mobile Feasible:** NO real-time, YES pre-baked texture
- **Example Games:** Psychedelic indie games, background effects in Rez
- **Priority:** SKIP — too expensive for real-time, doesn't fit gameplay

---

## Cost Matrix

| # | Effect | GPU Cost | Visual Impact | Complexity | Instanced OK? | Mobile? | Priority |
|---|--------|----------|--------------|------------|---------------|---------|----------|
| 1.1 | Shockwave Distortion | LOW (0.1-0.3ms) | 5/5 | Medium | YES | YES | MUST-HAVE |
| 1.2 | Heat Haze | LOW (0.1ms) | 3/5 | Low | YES | YES | Nice-to-have |
| 1.3 | Barrel Distortion | LOW (0.05ms) | 2/5 | Low | YES | YES | Skip |
| 2.1 | Ribbon Trails | LOW (0.05ms/trail) | 5/5 | Medium | PARTIAL | YES | MUST-HAVE |
| 2.2 | Afterimage | MED (0.3ms) | 4/5 | High | YES (Option B) | YES (B) | Nice-to-have |
| 2.3 | Dash Line Trail | LOW (0.02ms) | 3/5 | Low | YES | YES | Nice-to-have |
| 3.1 | Arc Renderer v2 | LOW (0.1ms) | 4/5 | Low | YES | YES | MUST-HAVE |
| 3.2 | Electrostatic Field | LOW (0.1ms) | 4/5 | Medium | YES | YES | Nice-to-have |
| 4.1 | Fresnel Shield | LOW (0.05ms) | 5/5 | Low | NO (few) | YES | MUST-HAVE |
| 4.2 | Hex Force Field | MED (0.1ms) | 5/5 | High | NO (few) | YES | Nice-to-have |
| 5.1 | Chromatic Aberration | LOW (0.05ms) | 4/5 | Low | YES | YES | MUST-HAVE |
| 5.2 | CRT Scanlines | LOW (0.02ms) | 3/5 | Low | YES | YES | Nice-to-have |
| 5.3 | Screen Flash | NEGLIGIBLE | 4/5 | Low | YES | YES | MUST-HAVE |
| 5.4 | Speed Lines | LOW (0.1ms) | 3/5 | Medium | YES | YES | Skip |
| 6.1 | God Rays | HIGH (1-2ms) | 5/5 | High | YES | NO | Skip |
| 6.2 | Volumetric Fog | HIGH (2-5ms) | 3/5 | High | YES | NO | Skip |
| 7.1 | Ring Burst | NEGLIGIBLE | 4/5 | Low | YES | YES | MUST-HAVE |
| 7.2 | Directional Sparks | NEGLIGIBLE | 4/5 | Medium | YES | YES | MUST-HAVE |
| 7.3 | Confetti | LOW (0.05ms) | 3/5 | Low | PARTIAL | YES | Nice-to-have |
| 7.4 | Debris Chunks | LOW (0.1ms) | 3/5 | Medium | PARTIAL | YES | Nice-to-have |
| 8.1 | Color Grading LUT | LOW (0.05ms) | 4/5 | Medium | YES | YES | Nice-to-have |
| 8.2 | HDR Tone Mapping | NEGLIGIBLE | 3/5 | Low | YES | YES | Nice-to-have |
| 8.3 | Film Grain | NEGLIGIBLE | 2/5 | Low | YES | YES | Skip |
| 9.1 | Mesh Deformation | MED (0.2ms) | 5/5 | High | YES | YES | MUST-HAVE |
| 9.2 | Dissolve / Dust | LOW (0.1ms) | 5/5 | High | NO (pool) | YES | Nice-to-have |
| 10.1 | Animated UV Lines | NEGLIGIBLE | 4/5 | Low | YES | YES | MUST-HAVE |
| 10.2 | Neon Tube Lines | LOW (0.1ms) | 4/5 | Medium | YES | YES | Nice-to-have |
| 11.1 | Surface Ripples | MED (0.3ms) | 5/5 | High | YES | FALLBACK | Nice-to-have |
| 11.2 | Surface Shockwave Ring | LOW (0.05ms) | 4/5 | Low | YES | YES | MUST-HAVE |
| 12.1 | Spiral Vortex | LOW (0.05ms) | 5/5 | Medium | NO (few) | YES | MUST-HAVE |
| 12.2 | Warp Speed | LOW (0.1ms) | 4/5 | Medium | YES | YES | Nice-to-have |
| 12.3 | Digital Rain | LOW-MED (0.2ms) | 4/5 | Medium | YES | YES | Nice-to-have |
| A.1 | Energy Tendrils | LOW-MED (0.15ms) | 4/5 | Medium | NO (few) | YES | Nice-to-have |
| A.2 | Crystal Shatter | MED (0.3ms) | 5/5 | High | NO (swap) | FALLBACK | Nice-to-have |
| A.3 | Fractal Patterns | HIGH (1-3ms) | 5/5 | High | YES | NO | Skip |

**Cost Legend:**
- NEGLIGIBLE: < 0.05ms, no additional draw calls
- LOW: 0.05-0.2ms, 0-1 additional draw calls
- MEDIUM: 0.2-0.5ms, 1-3 additional draw calls
- HIGH: > 0.5ms, multiple passes or render targets

---

## Top 5 Recommended Effects

### 1. Shockwave Distortion (1.1)
**Why:** The single most impactful missing effect. Every Geometry Wars death should create a screen-space ripple. Implementation is a single ShaderPass in the existing post-process chain. Works perfectly on mobile. This will make deaths feel 10x more impactful.

### 2. Ribbon Trails (2.1)
**Why:** Replaces the thin Line-based trails with proper width, tapering, and texture support. This is the difference between "indie prototype" and "polished game." Every moving entity benefits. Low GPU cost per trail.

### 3. Chromatic Aberration + Screen Flash (5.1 + 5.3)
**Why:** Bundled because they should be combined in the same post-process pass. Chromatic aberration on damage + screen flash on kills gives immediate, visceral feedback. Zero additional draw calls (merge into existing vignette pass).

### 4. Mesh Deformation / Grid Warp (9.1)
**Why:** THE iconic Geometry Wars visual. The surface grid should wobble when enemies spawn, when bombs go off, when the player dashes. This is a vertex shader change on the existing surface material — no new draw calls.

### 5. Spiral Vortex for Spawn Points (12.1)
**Why:** Enemy spawn points currently just... appear. A swirling vortex effect telegraphs spawns, adds drama, and gives players visual information. Simple disc mesh with a procedural shader. 1 draw call per spawner.

**Honorable mentions:** Fresnel Shield (4.1) for player shields/buffs, Ring Burst particles (7.1) for enemy deaths, Surface Shockwave Ring (11.2) for bomb effects on the surface.

---

## Effects to Avoid

| Effect | Why Skip |
|--------|----------|
| **God Rays (6.1)** | HIGH GPU cost (1-2ms), extra render target, doesn't fit neon-on-black aesthetic. Wrong visual language. |
| **Volumetric Fog (6.2)** | Extremely expensive on mobile, obscures gameplay, conflicts with the clean neon look. |
| **Barrel Distortion (1.3)** | Vignette already handles edge treatment. Barrel distortion is disorienting in a fast-paced game. |
| **Film Grain (8.3)** | Conflicts with clean neon aesthetic. Adds noise that fights bloom. |
| **Fractal Patterns (A.3)** | Beautiful but too GPU-expensive for real-time. Pre-baked textures lose the appeal. Not worth it. |
| **Speed Lines / Radial Blur (5.4)** | 3D surface gameplay with orbiting camera means there's no consistent "forward" direction. This effect only works for forward-racing games. |

---

## Implementation Priority Roadmap

### Phase 1 — Quick Wins (1-2 days)
These integrate into the existing post-process chain with minimal code:
1. **Screen Flash** — Add 2 uniforms to vignette pass
2. **Chromatic Aberration** — Add to vignette pass (3 extra texture samples)
3. **Ring Burst particles** — Add `emitRing()` to ParticleSystem
4. **Directional Sparks** — Modify particle shader for velocity-based stretching
5. **Animated UV on grid** — Add time uniform to SektoriGridMaterial

### Phase 2 — Core Effects (3-5 days)
New systems that significantly elevate visual quality:
1. **Shockwave Distortion** — New ShaderPass in post-process chain
2. **Ribbon Trails** — New RibbonTrail class replacing GlowTrail
3. **Spiral Vortex** — New SpawnVortex class (disc + ShaderMaterial)
4. **Surface Shockwave Ring** — Uniforms in surface material shader

### Phase 3 — Polish Effects (3-5 days)
Nice-to-haves that complete the visual package:
1. **Fresnel Shield** — New ShieldEffect class
2. **Mesh Deformation** — Vertex shader modification on surface material
3. **Arc Renderer v2** — Upgrade ChainLightning with glow halos
4. **CRT Scanlines** — Optional toggle in settings
5. **Color Grading LUT** — Boss fight atmosphere changes

### Phase 4 — Stretch Goals
1. Hex Force Field, Dissolve Effect, Energy Tendrils, Crystal Shatter, Digital Rain

---

## Prototype Code Snippets

### Shockwave Distortion ShaderPass

```glsl
// Fragment shader for shockwave distortion post-process
uniform sampler2D tDiffuse;
uniform vec3 shockwaves[8]; // xy = screen-space position (0-1), z = radius
uniform float shockStrengths[8]; // current strength (decays over time)
uniform int shockCount;
varying vec2 vUv;

void main() {
  vec2 uv = vUv;

  for (int i = 0; i < 8; i++) {
    if (i >= shockCount) break;

    vec2 center = shockwaves[i].xy;
    float radius = shockwaves[i].z;
    float strength = shockStrengths[i];

    vec2 diff = uv - center;
    float dist = length(diff);

    // Ring-shaped distortion at current radius
    float ring = 1.0 - abs(dist - radius) / 0.05;
    ring = clamp(ring, 0.0, 1.0);

    // Displace UV outward from center
    vec2 displacement = normalize(diff) * ring * strength * 0.03;
    uv += displacement;
  }

  gl_FragColor = texture2D(tDiffuse, uv);
}
```

### Ribbon Trail Geometry Update

```typescript
// Core ribbon trail: screen-facing quad strip with tapering width
updateRibbon(points: Vector3[], camera: Camera, widthStart: number, widthEnd: number) {
  const positions = this.positionBuffer;
  const uvs = this.uvBuffer;
  const count = points.length;

  for (let i = 0; i < count; i++) {
    const t = i / (count - 1); // 0 at head, 1 at tail
    const width = widthStart * (1 - t) + widthEnd * t;

    // Direction along trail
    const tangent = _tangent;
    if (i < count - 1) {
      tangent.subVectors(points[i + 1], points[i]).normalize();
    } else {
      tangent.subVectors(points[i], points[i - 1]).normalize();
    }

    // Screen-facing normal
    const toCamera = _toCamera.subVectors(camera.position, points[i]).normalize();
    const right = _right.crossVectors(tangent, toCamera).normalize();

    // Two vertices per point (left and right)
    const idx = i * 6; // 2 verts * 3 components
    positions[idx]     = points[i].x - right.x * width;
    positions[idx + 1] = points[i].y - right.y * width;
    positions[idx + 2] = points[i].z - right.z * width;
    positions[idx + 3] = points[i].x + right.x * width;
    positions[idx + 4] = points[i].y + right.y * width;
    positions[idx + 5] = points[i].z + right.z * width;

    // UVs: x = left/right, y = position along trail
    uvs[i * 4]     = 0; uvs[i * 4 + 1] = t;
    uvs[i * 4 + 2] = 1; uvs[i * 4 + 3] = t;
  }

  this.geometry.setDrawRange(0, (count - 1) * 6); // triangles
  this.geometry.attributes.position.needsUpdate = true;
  this.geometry.attributes.uv.needsUpdate = true;
}
```

### Fresnel Shield

```glsl
// Vertex shader
varying vec3 vNormal;
varying vec3 vViewDir;
varying float vFresnel;

void main() {
  vec4 worldPos = modelMatrix * vec4(position, 1.0);
  vNormal = normalize(normalMatrix * normal);
  vViewDir = normalize(cameraPosition - worldPos.xyz);
  vFresnel = 1.0 - abs(dot(vNormal, vViewDir));
  vFresnel = pow(vFresnel, 2.0); // sharper edge

  gl_Position = projectionMatrix * viewMatrix * worldPos;
}

// Fragment shader
uniform vec3 shieldColor;
uniform float hitFlash; // 0-1, set on impact
uniform float time;

varying float vFresnel;

void main() {
  // Base fresnel glow
  float alpha = vFresnel * 0.6;

  // Pulse animation
  alpha *= 0.8 + 0.2 * sin(time * 3.0);

  // Hit flash: brief full-sphere flash
  alpha += hitFlash * 0.4;

  gl_FragColor = vec4(shieldColor, alpha);
}
```

### Spiral Vortex

```glsl
// Fragment shader for spawn vortex disc
uniform float time;
uniform vec3 vortexColor;
uniform float intensity;

varying vec2 vUv;

void main() {
  vec2 centered = vUv - 0.5;
  float dist = length(centered);
  float angle = atan(centered.y, centered.x);

  // Spiral pattern: rotate angle based on distance and time
  float spiral = sin(angle * 4.0 - dist * 20.0 + time * 5.0);
  spiral = spiral * 0.5 + 0.5; // 0-1

  // Fade toward edge
  float edgeFade = 1.0 - smoothstep(0.3, 0.5, dist);

  // Bright ring at edge
  float ring = smoothstep(0.38, 0.42, dist) * (1.0 - smoothstep(0.42, 0.50, dist));

  float alpha = (spiral * 0.4 + ring * 0.8) * edgeFade * intensity;

  if (dist > 0.5) discard;

  gl_FragColor = vec4(vortexColor * (1.0 + ring * 2.0), alpha);
}
```

### Chromatic Aberration (merge into vignette pass)

```glsl
uniform sampler2D tDiffuse;
uniform float chromaticStrength; // 0 = off, 0.005 = subtle, 0.02 = heavy
uniform float offset;
uniform float darkness;
varying vec2 vUv;

void main() {
  // Chromatic aberration: separate RGB channels
  vec2 dir = vUv - vec2(0.5);
  float dist = length(dir);
  vec2 chromaticOffset = normalize(dir) * chromaticStrength * dist;

  float r = texture2D(tDiffuse, vUv + chromaticOffset).r;
  float g = texture2D(tDiffuse, vUv).g;
  float b = texture2D(tDiffuse, vUv - chromaticOffset).b;

  vec4 texel = vec4(r, g, b, 1.0);

  // Vignette (existing)
  vec2 vuv = (vUv - vec2(0.5)) * vec2(offset);
  float vignette = 1.0 - dot(vuv, vuv);
  texel.rgb *= mix(1.0 - darkness, 1.0, vignette);

  gl_FragColor = texel;
}
```

---

## Sources and References

- [GameDev.net — Geometry Wars pixel shaders discussion](https://www.gamedev.net/forums/topic/414082-geometry-wars-pixel-shaders/414082/)
- [pmndrs/postprocessing — Three.js post-processing library](https://github.com/pmndrs/postprocessing)
- [Codrops — Water-like distortion with Three.js](https://tympanus.net/codrops/2019/10/08/creating-a-water-like-distortion-effect-with-three-js/)
- [Codrops — Ripple effect on texture with Three.js](https://tympanus.net/codrops/2021/11/22/ripple-effect-on-a-texture-with-three-js/)
- [DaveTech — Shockwave distortion with shaders](https://www.davetech.co.uk/gamemakerdistortscreen)
- [CRT Shader Effect — Three.js WebGL](https://daenavan.github.io/crt-threejs/)
- [GitHub — CRT shader with chromatic aberration](https://github.com/luiscarlospando/crt-shader-with-chromatic-aberration-glow-scanlines-dot-matrix)
- [Three.js Refractive Shader with Chromatic Aberration](https://blog.lbproject.dev/creating-a-refractive-material-with-chromatic-aberration-in-three-js)
- [Maxime Heckel — Refraction, dispersion, and shader light effects](https://blog.maximeheckel.com/posts/refraction-dispersion-and-other-shader-light-effects/)
- [Utsubo — What Changed in Three.js 2026](https://www.utsubo.com/blog/threejs-2026-what-changed)
- [Utsubo — 100 Three.js Tips](https://www.utsubo.com/blog/threejs-best-practices-100-tips)
- [Codrops — Building Efficient Three.js Scenes](https://tympanus.net/codrops/2025/02/11/building-efficient-three-js-scenes-optimize-performance-while-maintaining-quality/)

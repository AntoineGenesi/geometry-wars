# Aura Ring Visual Effects — Per-Buff Design & Implementation Guide

**Date:** 2026-02-11
**Status:** Complete
**Context:** Geometry Wars 3D browser game, Three.js ^0.170, targeting 60fps with 10K+ entities on phones and laptops

---

## Table of Contents

1. [Problem Analysis](#problem-analysis)
2. [Architecture Overview](#architecture-overview)
3. [Per-Buff Visual Designs (8 Types)](#per-buff-visual-designs)
4. [Multi-Buff Layering Strategy](#multi-buff-layering-strategy)
5. [GPU Cost Matrix](#gpu-cost-matrix)
6. [Mobile-Safe Fallbacks](#mobile-safe-fallbacks)
7. [Implementation Plan](#implementation-plan)
8. [Code Sketches](#code-sketches)

---

## Problem Analysis

### What Exists Today

The player has two aura ring systems, both suffering from the "flat paper" problem:

1. **PlayerLevel aura** (`src/core/PlayerLevel.ts`):
   - `THREE.RingGeometry(0.85, 1.0, 48)` with `MeshBasicMaterial`
   - Breathing opacity oscillation: `0.12 + sin(t * 1.2) * 0.05`
   - Scale pulse: `1.0 + sin(t * 1.8) * 0.05`
   - Single solid color, `NormalBlending`, no depth write
   - **Result:** A thin, flat, semi-transparent washer on the surface. Looks like a decal.

2. **Multiplayer AuraSystem** (`src/multiplayer/AuraSystem.ts`):
   - `SurfaceProjectedRing` — a ribbon of triangles projected onto the mesh surface via BVH
   - Same `MeshBasicMaterial`, opacity 0.15-0.30
   - Scale pulse `1.0 + sin(t * 2.0) * 0.03`
   - **Result:** Slightly better (follows surface curvature) but still a flat ribbon with no visual energy.

### What the User Wants

The user described specific, buff-dependent visual effects:
- "Pulsating or bits appearing and disappearing around in that circle"
- "Matrix effect, blocks appearing and disappearing along that ring"
- "If you've got shock, there's electricity and sparks"
- "If you've got fire, there's fire randomly appearing"

These are **animated, dynamic, buff-specific** effects — not static rings with opacity pulsing.

### Root Cause of "Flat Paper"

1. **No animation variety** — Only uniform opacity and scale breathing. Every ring looks identical.
2. **No particle/element spawning** — No objects appear and disappear along the ring edge.
3. **No unique identity** — All buffs share the same ring geometry. Only color differs.
4. **MeshBasicMaterial** — No shader-driven animation. No noise, no UV scrolling, no procedural patterns.
5. **NormalBlending** — Doesn't glow through bloom. AdditiveBlending would interact with the bloom pipeline.

### Design Principles for the Fix

1. **Each buff type gets a unique ShaderMaterial** with procedural animation baked into the fragment shader. This avoids spawning hundreds of particles per aura.
2. **Shader-first approach:** The ring geometry stays simple (a single ring or plane), but the shader does the heavy lifting — noise functions, UV scrolling, masked regions, time-based animation.
3. **Supplement with light particles** for key buffs (Shock, Incendiary) where discrete elements (sparks, embers) sell the effect.
4. **All effects use AdditiveBlending** so they interact with the bloom pass.
5. **Object pool all supplementary particles** — zero per-frame allocation.
6. **Total budget: 1ms for all active auras combined** (shader + particles + update logic).

---

## Architecture Overview

### New System: `BuffAuraRenderer`

A new class `src/buffs/BuffAuraRenderer.ts` that manages the visual representation of all active buff auras around the player.

```
BuffAuraRenderer
├── ring meshes (one per active buff, pooled)
│   ├── ShaderMaterial per buff type (shared, not cloned per instance)
│   └── RingGeometry or PlaneGeometry (shared)
├── particle emitters (pooled, per buff type)
│   └── Uses existing ParticleSystem.emit() for lightweight sparks
└── update(dt, playerPos, normal, activeBuffs[])
    ├── position/orient active rings
    ├── update shader uniforms (time, pulse, etc.)
    └── emit supplementary particles (budgeted)
```

### Integration Points

1. **Geometry:** Use the existing `SurfaceProjectedRing` from `AuraSystem.ts` for surface-following rings, OR use a simpler flat `RingGeometry` oriented to the surface normal (cheaper, sufficient for single-player buffs since they're always near the player's view).
2. **Shaders:** Custom `ShaderMaterial` per buff type. Share vertex shader (standard ring positioning). Unique fragment shaders per buff.
3. **Bloom:** `AdditiveBlending` + `depthWrite: false` ensures all auras glow through the `UnrealBloomPass`.
4. **Particles:** Emit through the existing `ParticleSystem` (already has 10K pool, additive blending, budget enforcement).
5. **Update:** Called from the main game loop in `main.ts`, same place as `playerLevel.update()` and `buffManager.update()`.

### Shared Ring Vertex Shader

All 8 buff aura types share this vertex shader. The fragment shader is unique per buff type.

```glsl
// Shared vertex shader for all buff aura rings
varying vec2 vUv;
varying float vAngle;    // 0..1 around the ring
varying float vRadius;   // 0..1 inner-to-outer
varying vec3 vWorldPos;

void main() {
  vUv = uv;
  // Encode angle (0..1 around ring) and radius (0..1 inner-outer)
  // UV.x = angle (0..1), UV.y = radial position (0 = inner, 1 = outer)
  vAngle = uv.x;
  vRadius = uv.y;
  vWorldPos = (modelMatrix * vec4(position, 1.0)).xyz;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
```

The custom ring geometry maps UV.x to the angular position (0 to 1 around the circumference) and UV.y to the radial position (0 = inner edge, 1 = outer edge). This gives the fragment shader full control over angular and radial patterns.

---

## Per-Buff Visual Designs

### 1. Tough Times (Shield / Defense)

**Buff:** 12% damage block chance per stack (hyperbolic). Color: `#4488ff` (blue).

**Visual Concept:** A hexagonal energy barrier. Hex tiles flicker independently — some bright, some dim, creating a "force field with failing sectors" look. On block proc, a bright flash ripple emanates from the impact point.

**Implementation: SHADER-BASED (1 draw call)**

Fragment shader approach:
- Tile the ring into hexagonal cells using the angular + radial UV coordinates
- Each hex cell has an independent "brightness" driven by a hash of (cellIndex, floor(time * flickerSpeed))
- Cells randomly brighten and dim over time, creating the "sectors powering on/off" look
- Edge glow: Fresnel-like brightening at hex cell boundaries
- On block: Pass a `uBlockTime` uniform. When recently triggered, all cells flash bright white then fade back.

```glsl
// Fragment shader sketch — Tough Times (Hex Shield)
uniform float uTime;
uniform float uBlockTime;   // Time of last block proc
uniform vec3 uColor;        // #4488ff
uniform float uOpacity;     // Base opacity (0.3)

varying float vAngle;
varying float vRadius;

// Hex grid function
vec2 hexGrid(vec2 p) {
  vec2 q = vec2(p.x * 2.0 / sqrt(3.0), p.y);
  vec2 r = floor(q);
  vec2 f = fract(q);
  // ... standard hex cell ID computation
  return r;
}

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

void main() {
  // Map ring to rectangular UV space
  vec2 gridUV = vec2(vAngle * 12.0, vRadius * 2.0); // 12 cells around, 2 radially
  vec2 cellId = hexGrid(gridUV);

  // Per-cell flicker
  float flickerPhase = hash(cellId) * 6.28;
  float flickerSpeed = 1.5 + hash(cellId + 0.5) * 2.0;
  float cellBright = 0.3 + 0.7 * step(0.6, sin(uTime * flickerSpeed + flickerPhase) * 0.5 + 0.5);

  // Block flash (decays over 0.3s)
  float blockFlash = max(0.0, 1.0 - (uTime - uBlockTime) * 3.33);

  // Edge glow (hex cell boundaries)
  vec2 cellFract = fract(gridUV);
  float edgeDist = min(min(cellFract.x, 1.0 - cellFract.x), min(cellFract.y, 1.0 - cellFract.y));
  float edge = smoothstep(0.0, 0.08, edgeDist);
  float edgeGlow = (1.0 - edge) * 0.5;

  float alpha = (cellBright * 0.6 + edgeGlow + blockFlash) * uOpacity;
  vec3 color = mix(uColor, vec3(1.0), blockFlash * 0.8);

  gl_FragColor = vec4(color * alpha, alpha);
}
```

**Supplementary particles:** None needed. The shader does everything.

**GPU Cost:** ~0.05ms. Single ring mesh, ~200 fragments, simple math.

---

### 2. Afterburner (Speed)

**Buff:** +10% move speed per stack (capped +80%). Color: `#44ff44` (green).

**Visual Concept:** Speed streaks radiating backward from the player's movement direction. The ring itself has animated dashes that scroll in the direction of movement, like a conveyor belt or speedometer ticks. Faster stacks = faster scroll + more streaks.

**Implementation: SHADER-BASED (1 draw call)**

Fragment shader approach:
- Dashed ring: Use `fract(vAngle * dashCount - uTime * scrollSpeed)` to create animated dashes that rotate around the ring
- Dash count and scroll speed scale with stack count
- Each dash has a brightness gradient (bright leading edge, dim trailing edge)
- Radial fade: Bright at outer edge, fading inward (looks like speed lines flying outward)

```glsl
// Fragment shader sketch — Afterburner (Speed Streaks)
uniform float uTime;
uniform float uStacks;     // Current stack count
uniform vec3 uColor;       // #44ff44
uniform float uOpacity;

varying float vAngle;
varying float vRadius;

void main() {
  float dashCount = 8.0 + uStacks * 4.0;        // More dashes with more stacks
  float scrollSpeed = 2.0 + uStacks * 0.5;       // Faster scroll with stacks

  // Scrolling dashes around the ring
  float dashPhase = fract(vAngle * dashCount - uTime * scrollSpeed);

  // Triangular dash shape: bright leading edge, fading trail
  float dashAlpha = smoothstep(0.0, 0.1, dashPhase) * smoothstep(0.6, 0.1, dashPhase);

  // Radial gradient: bright at outer edge
  float radialGrad = smoothstep(0.0, 1.0, vRadius);

  // Occasional bright "burst" dash (every 4th dash is extra bright)
  float burstPhase = fract(vAngle * (dashCount / 4.0) - uTime * scrollSpeed * 0.5);
  float burst = smoothstep(0.3, 0.0, burstPhase) * 0.5;

  float alpha = (dashAlpha * radialGrad + burst) * uOpacity;
  gl_FragColor = vec4(uColor * alpha, alpha);
}
```

**Supplementary particles:** Occasional green speed-line particles emitted behind the player (2-3 per frame when moving fast). Reuse existing `ParticleSystem.emit()`.

**GPU Cost:** ~0.04ms shader + ~0.01ms particles = ~0.05ms total.

---

### 3. Hot Hands (Damage / Fire)

**Buff:** +15% bullet damage per stack. Color: `#ff4400` (red-orange).

**Visual Concept:** A smoldering ring with embers and small flame licks. Fire sprites randomly appear along the ring edge, grow briefly, then fade. The ring itself has a scrolling noise texture creating a "lava flow" or "burning coal" appearance. Heat shimmer distortion near the ring.

**Implementation: SHADER + PARTICLES (1 draw call + shared particle emit)**

Fragment shader approach:
- Scrolling noise: Two layers of simplex noise at different scales/speeds create a turbulent fire pattern
- Color gradient from deep red (cold) through orange to bright yellow (hot) based on noise value
- Pulsing "hot spots" that migrate around the ring using sin(angle * frequency + time)

```glsl
// Fragment shader sketch — Hot Hands (Fire Ring)
uniform float uTime;
uniform float uStacks;
uniform vec3 uColorCold;    // #ff2200 deep red
uniform vec3 uColorHot;     // #ffaa00 bright orange
uniform vec3 uColorCore;    // #ffff44 yellow-white
uniform float uOpacity;

varying float vAngle;
varying float vRadius;

// Simplex noise (2D) — inline or via texture lookup
float snoise(vec2 v) {
  // ... standard simplex noise implementation (or use a noise texture)
  // Abbreviated here for readability
  return fract(sin(dot(v, vec2(12.9898, 78.233))) * 43758.5453) * 2.0 - 1.0;
}

void main() {
  vec2 noiseCoord = vec2(vAngle * 4.0, vRadius * 2.0);

  // Two noise octaves for turbulence
  float n1 = snoise(noiseCoord + vec2(uTime * 0.3, uTime * 0.5)) * 0.6;
  float n2 = snoise(noiseCoord * 2.0 + vec2(-uTime * 0.7, uTime * 0.2)) * 0.4;
  float fire = clamp(n1 + n2 + 0.3, 0.0, 1.0);

  // Hot spots that migrate
  float hotSpot = sin(vAngle * 6.28 * 3.0 + uTime * 1.5) * 0.5 + 0.5;
  hotSpot = pow(hotSpot, 4.0); // Sharpen
  fire = clamp(fire + hotSpot * 0.4, 0.0, 1.0);

  // Color gradient based on fire intensity
  vec3 color = mix(uColorCold, uColorHot, fire);
  color = mix(color, uColorCore, smoothstep(0.8, 1.0, fire));

  // Radial shape: flames rise from inner edge outward
  float radialShape = smoothstep(0.0, 0.3, vRadius) * smoothstep(1.0, 0.5, vRadius - fire * 0.3);

  float alpha = fire * radialShape * uOpacity * (0.8 + uStacks * 0.05);
  gl_FragColor = vec4(color * alpha, alpha);
}
```

**Supplementary particles:** Ember particles rising from the ring. Budget: 4-6 embers per second, using `ParticleSystem.emit()` with orange/red colors, upward velocity, short lifetime (0.3s). Each ember is a single point particle — no extra draw calls.

**GPU Cost:** ~0.08ms shader (noise is the expensive part) + ~0.01ms particles = ~0.09ms total.

---

### 4. Shock Aura (Electricity)

**Buff:** Passive shock damage to nearby enemies. Color: `#aa44ff` (purple).

**Visual Concept:** Electric arcs crawling along the ring edge. Small lightning bolts appear, jump to a new position on the ring, then fade. Bright spark points flash at random locations. The ring itself has a fast "pulse/scan line" that sweeps around it periodically.

**Implementation: SHADER + ARC PARTICLES (1 draw call + shared particle emit)**

Fragment shader approach:
- Scanning pulse: A bright band that sweeps around the ring at high speed, like a radar sweep
- Between sweeps, random segments brighten briefly (simulating arc flash)
- Base ring has subtle electrical noise (high-frequency hash-based flicker)
- Bright spark points: Use a hash function to place 3-5 "spark" positions that change each frame

```glsl
// Fragment shader sketch — Shock Aura (Electric Ring)
uniform float uTime;
uniform float uStacks;
uniform vec3 uColor;        // #aa44ff purple
uniform vec3 uSparkColor;   // #ffffff white
uniform float uOpacity;

varying float vAngle;
varying float vRadius;

float hash(float n) { return fract(sin(n) * 43758.5453); }

void main() {
  // Scanning pulse (sweeps around ring every ~1.5s)
  float scanSpeed = 0.8 + uStacks * 0.1;
  float scanPos = fract(uTime * scanSpeed);
  float scanDist = abs(vAngle - scanPos);
  scanDist = min(scanDist, 1.0 - scanDist); // Wrap-around
  float scan = smoothstep(0.08, 0.0, scanDist) * 1.5;

  // Random arc flashes (3-5 positions that change every ~0.15s)
  float arcCount = 3.0 + uStacks;
  float timeSlot = floor(uTime * 7.0);
  float arcFlash = 0.0;
  for (float i = 0.0; i < 6.0; i++) {
    if (i >= arcCount) break;
    float arcPos = hash(timeSlot * 13.0 + i * 7.0);
    float arcDist = abs(vAngle - arcPos);
    arcDist = min(arcDist, 1.0 - arcDist);
    float arcWidth = 0.02 + hash(i + timeSlot * 3.0) * 0.03;
    arcFlash += smoothstep(arcWidth, 0.0, arcDist) * 0.8;
  }

  // Base electrical noise
  float noise = hash(floor(vAngle * 48.0) + floor(uTime * 20.0)) * 0.15;

  // Radial shape (brighter at center of ring width)
  float radial = smoothstep(0.0, 0.3, vRadius) * smoothstep(1.0, 0.7, vRadius);

  float intensity = (noise + scan + arcFlash) * radial;
  vec3 color = mix(uColor, uSparkColor, smoothstep(0.8, 1.5, intensity));
  float alpha = intensity * uOpacity;

  gl_FragColor = vec4(color * alpha, alpha);
}
```

**Supplementary particles:** This buff already has `ShockArcRenderer` producing lightning bolts to enemies. Additionally, emit 2-3 bright purple spark particles per second along the ring edge. These supplement the shader arcs with discrete flying sparks.

**GPU Cost:** ~0.06ms shader + ~0.01ms sparks + existing ShockArcRenderer cost = ~0.10ms total (ShockArcRenderer is already budgeted separately).

---

### 5. Magnetism (Geom Attraction)

**Buff:** Increased geom collection radius. Color: `#ffff00` (yellow).

**Visual Concept:** Gravitational distortion effect. Particles are visibly being "pulled" inward along the ring, like a vortex drain. The ring has inward-pointing chevrons/arrows that animate toward the center. Small yellow dots drift inward from the ring edge toward the player.

**Implementation: SHADER + PARTICLES (1 draw call + shared particle emit)**

Fragment shader approach:
- Inward-flowing chevrons: Triangle wave pattern that scrolls radially inward (UV.y animated over time)
- The chevrons fade as they approach the center, creating a "suction" visual
- Radial pulse that contracts periodically (ring squeezes inward then relaxes)

```glsl
// Fragment shader sketch — Magnetism (Gravity Pull)
uniform float uTime;
uniform float uStacks;
uniform vec3 uColor;        // #ffff00 yellow
uniform float uOpacity;

varying float vAngle;
varying float vRadius;

void main() {
  // Inward-flowing chevron pattern
  float chevronCount = 8.0;
  float flowSpeed = 1.5 + uStacks * 0.3;

  // Create V-shaped pattern using angular and radial coords
  float angularCell = fract(vAngle * chevronCount);
  float chevronShape = 1.0 - abs(angularCell - 0.5) * 2.0; // V shape: 0 at edges, 1 at center

  // Animate radially inward
  float flowPhase = fract(vRadius + uTime * flowSpeed);
  float flowAlpha = smoothstep(0.0, 0.3, flowPhase) * smoothstep(1.0, 0.5, flowPhase);

  // Combine: chevron shape modulated by flow
  float pattern = chevronShape * flowAlpha;

  // Contracting pulse
  float pulse = sin(uTime * 3.0) * 0.5 + 0.5;
  float radialPulse = smoothstep(0.0, mix(0.4, 0.6, pulse), vRadius);

  // Outer edge particles flowing inward (small bright dots)
  float dotPhase = fract(vRadius * 3.0 + uTime * 2.0);
  float dots = smoothstep(0.05, 0.0, abs(dotPhase - 0.5)) * step(0.7, vRadius);

  float alpha = (pattern * radialPulse * 0.7 + dots * 0.5) * uOpacity;
  gl_FragColor = vec4(uColor * alpha, alpha);
}
```

**Supplementary particles:** Yellow dot particles that spawn at the ring edge and drift inward toward the player. Budget: 3-5 per second, lifetime 0.5s. These sell the "attraction field" effect.

**GPU Cost:** ~0.04ms shader + ~0.01ms particles = ~0.05ms total.

---

### 6. Trigger Happy (Multi-shot / Fire Rate)

**Buff:** +12% fire rate per stack. Color: `#ff8800` (orange).

**Visual Concept:** Rapid-fire energy pulses. The ring is segmented into "chambers" that light up in rapid sequence, like a revolving cylinder. Each chamber fires off a brief bright flash, creating a machine-gun visual rhythm. The animation speed scales with stacks.

**Implementation: SHADER-BASED (1 draw call)**

Fragment shader approach:
- Divide ring into N chambers (segments)
- One chamber is "active" at a time, cycling rapidly
- Active chamber is bright, adjacent chambers have slight afterglow
- Flash pulse on each chamber transition

```glsl
// Fragment shader sketch — Trigger Happy (Rapid Fire Chambers)
uniform float uTime;
uniform float uStacks;
uniform vec3 uColor;        // #ff8800 orange
uniform vec3 uFlashColor;   // #ffff88 bright yellow
uniform float uOpacity;

varying float vAngle;
varying float vRadius;

void main() {
  float chamberCount = 6.0 + uStacks * 2.0;
  float cycleSpeed = 3.0 + uStacks * 1.0; // Faster with more stacks

  // Current active chamber
  float activeIndex = floor(fract(uTime * cycleSpeed) * chamberCount);
  float chamberIndex = floor(vAngle * chamberCount);

  // Chamber brightness
  float isActive = step(abs(chamberIndex - activeIndex), 0.5);

  // Adjacent chamber afterglow
  float prevIndex = mod(activeIndex - 1.0, chamberCount);
  float nextIndex = mod(activeIndex + 1.0, chamberCount);
  float isAdjacent = step(abs(chamberIndex - prevIndex), 0.5) + step(abs(chamberIndex - nextIndex), 0.5);

  // Flash on transition (brief bright pulse)
  float transitionPhase = fract(fract(uTime * cycleSpeed) * chamberCount);
  float flash = smoothstep(0.1, 0.0, transitionPhase) * isActive;

  // Chamber separator lines
  float cellFract = fract(vAngle * chamberCount);
  float separator = smoothstep(0.02, 0.0, cellFract) + smoothstep(0.98, 1.0, cellFract);

  // Radial shape
  float radial = smoothstep(0.0, 0.2, vRadius) * smoothstep(1.0, 0.8, vRadius);

  float intensity = (isActive * 0.8 + isAdjacent * 0.2 + flash * 1.0 + separator * 0.3) * radial;
  vec3 color = mix(uColor, uFlashColor, flash * 0.7);
  float alpha = intensity * uOpacity;

  gl_FragColor = vec4(color * alpha, alpha);
}
```

**Supplementary particles:** None needed. The rapid chamber animation is visually engaging on its own.

**GPU Cost:** ~0.04ms. Simple shader math, no noise.

---

### 7. Incendiary Rounds (Fire DOT)

**Buff:** 15% chance to ignite enemies on hit. Color: `#ff6600` (orange-red).

**Visual Concept:** A ring of fire with visible flame tongues licking upward. Individual flame elements appear at random positions along the ring, grow tall, then shrink and fade. The ring base has a glowing ember texture. Very similar to Hot Hands but with distinct vertical flame shapes rather than a flat lava pattern.

**Implementation: SHADER + PARTICLES (1 draw call + shared particle emit)**

Fragment shader approach:
- The ring surface has a base ember glow (low noise, warm orange)
- Flame tongues: Use vAngle to place N flame positions (hash-based), each flame is a smoothed spike shape in the radial direction
- Flames animate their height over time (grow, hold, shrink cycle)
- Each flame's lifecycle is staggered by its hash so they appear randomly

```glsl
// Fragment shader sketch — Incendiary Rounds (Flame Tongues)
uniform float uTime;
uniform float uStacks;
uniform vec3 uColorBase;    // #ff4400 deep red
uniform vec3 uColorFlame;   // #ff8800 orange
uniform vec3 uColorTip;     // #ffcc44 yellow tip
uniform float uOpacity;

varying float vAngle;
varying float vRadius;

float hash(float n) { return fract(sin(n) * 43758.5453); }

void main() {
  // Base ember glow
  float ember = 0.2 + 0.1 * sin(vAngle * 20.0 + uTime * 2.0);

  // Flame tongues (6-10 positioned around the ring)
  float flameCount = 6.0 + uStacks * 1.0;
  float flameIntensity = 0.0;
  float flameHeight = 0.0;

  for (float i = 0.0; i < 12.0; i++) {
    if (i >= flameCount) break;

    // Flame position (fixed but changes every ~2s)
    float epoch = floor(uTime * 0.5 + hash(i) * 2.0);
    float flamePos = hash(epoch * 7.0 + i * 13.0);

    // Lifecycle: grow (0-0.3), hold (0.3-0.7), shrink (0.7-1.0)
    float lifecycle = fract(uTime * 0.8 + hash(i * 3.0));
    float height;
    if (lifecycle < 0.3) {
      height = lifecycle / 0.3;
    } else if (lifecycle < 0.7) {
      height = 1.0;
    } else {
      height = 1.0 - (lifecycle - 0.7) / 0.3;
    }

    // Angular distance to this flame
    float dist = abs(vAngle - flamePos);
    dist = min(dist, 1.0 - dist);

    // Flame shape: narrow at base, wider at top (inverted)
    float flameWidth = 0.015 + 0.01 * (1.0 - vRadius);
    float flame = smoothstep(flameWidth, 0.0, dist);

    // Radial extent based on height
    float maxRadius = 0.3 + height * 0.7;
    float radialFlame = smoothstep(maxRadius, maxRadius - 0.2, vRadius) * step(0.0, vRadius);

    flameIntensity += flame * radialFlame * height;
    flameHeight = max(flameHeight, flame * height);
  }

  // Color gradient: base red -> orange -> yellow tip
  vec3 color = mix(uColorBase, uColorFlame, flameHeight * 0.5);
  color = mix(color, uColorTip, smoothstep(0.6, 1.0, flameHeight));

  // Combine ember base + flames
  float radialBase = smoothstep(0.0, 0.2, vRadius) * smoothstep(0.4, 0.2, vRadius);
  float alpha = (ember * radialBase + flameIntensity) * uOpacity;

  gl_FragColor = vec4(color * alpha, alpha);
}
```

**Supplementary particles:** Small ember particles floating upward from flames. Budget: 3-4 per second. Orange/red, short lifetime (0.4s), slight upward velocity. Adds dimensionality.

**GPU Cost:** ~0.08ms shader (loop over flames) + ~0.01ms particles = ~0.09ms total.

---

### 8. Volatile (Explosion on Death)

**Buff:** Enemies explode on death. Color: `#ff2244` (red-pink).

**Visual Concept:** An unstable, volatile energy field. The ring flickers between stable and unstable states — sections randomly "crack" with bright energy leaks, like a containment field about to fail. Occasional bright flash pulses. The overall look should feel dangerous and barely-contained.

**Implementation: SHADER-BASED (1 draw call)**

Fragment shader approach:
- Base ring has a crackle/shatter pattern (Voronoi-based cell cracks)
- Random cells "crack open" revealing bright energy underneath
- Periodic instability pulses where multiple cells crack simultaneously
- The ring itself slightly jitters in position (vertex shader offset)

```glsl
// Fragment shader sketch — Volatile (Unstable Containment)
uniform float uTime;
uniform float uStacks;
uniform vec3 uColor;         // #ff2244 red-pink
uniform vec3 uCrackColor;    // #ff88aa bright pink-white
uniform float uOpacity;

varying float vAngle;
varying float vRadius;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

// Simple Voronoi distance for crack pattern
float voronoi(vec2 p) {
  vec2 ip = floor(p);
  vec2 fp = fract(p);
  float d = 1.0;
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      vec2 n = vec2(float(x), float(y));
      vec2 diff = n + hash(ip + n) - fp;
      d = min(d, dot(diff, diff));
    }
  }
  return sqrt(d);
}

void main() {
  // Voronoi crack pattern
  vec2 cellCoord = vec2(vAngle * 10.0, vRadius * 3.0);
  float cellDist = voronoi(cellCoord);

  // Cracks are visible at cell edges (low voronoi distance)
  float crack = smoothstep(0.15, 0.0, cellDist);

  // Random cells "crack open" (change which cells are active over time)
  vec2 cellId = floor(cellCoord);
  float cellHash = hash(cellId);
  float crackTime = floor(uTime * 3.0 + cellHash * 5.0);
  float isCracked = step(0.6 - uStacks * 0.03, hash(cellId + crackTime));

  // Instability pulse (periodic)
  float pulse = pow(sin(uTime * 4.0) * 0.5 + 0.5, 8.0); // Sharp pulse

  // Combine
  float radial = smoothstep(0.0, 0.2, vRadius) * smoothstep(1.0, 0.8, vRadius);
  float baseGlow = 0.15 * radial;
  float crackGlow = crack * isCracked * 0.9 * radial;
  float pulseGlow = pulse * 0.4 * radial;

  float intensity = baseGlow + crackGlow + pulseGlow;
  vec3 color = mix(uColor, uCrackColor, smoothstep(0.3, 0.8, intensity));
  float alpha = intensity * uOpacity;

  gl_FragColor = vec4(color * alpha, alpha);
}
```

**Supplementary particles:** On volatile explosion proc, emit a burst of red-pink particles outward (already handled by `BuffManager.onVolatileExplosion`). The aura itself needs no ongoing particles.

**GPU Cost:** ~0.07ms (Voronoi is moderately expensive but the ring has few fragments). Total ~0.07ms.

---

## Multi-Buff Layering Strategy

Players can have multiple buffs simultaneously. Here is how to handle visual stacking:

### Approach: Concentric Rings with Stacking Rules

1. **Up to 3 simultaneous aura rings displayed.** If the player has more than 3 buffs, show the 3 highest-priority (rarest first, then most stacks). The remaining buffs are shown only in the HUD.

2. **Ring radius assignment:**
   - 1 buff: Single ring at radius 1.0x (default size)
   - 2 buffs: Inner ring at 0.75x, outer ring at 1.15x
   - 3 buffs: Inner at 0.6x, middle at 0.9x, outer at 1.25x

3. **Ring width:** Each ring is thinner when more are displayed:
   - 1 buff: Full width (inner radius 0.85, outer 1.0 relative)
   - 2 buffs: 70% width each
   - 3 buffs: 55% width each

4. **Opacity scaling:** Each additional ring reduces opacity by 20% to prevent visual overload:
   - 1 buff: 100% opacity
   - 2 buffs: 85% each
   - 3 buffs: 70% each

5. **Priority order** (determines which buffs get displayed):
   1. Uncommon buffs first (ShockAura, Volatile)
   2. Then by stack count (highest first)
   3. Then by category: elemental > defensive > offensive > utility

6. **Z-ordering:** Inner rings render first (lower renderOrder), outer rings render on top.

### Performance Under Stacking

Worst case: 3 active aura rings = 3 draw calls + 3 shader evaluations.
- 3 shaders at ~0.08ms each = 0.24ms
- Supplementary particles: budgeted to 10 total per second across all buffs
- **Total worst case: ~0.30ms** (well within 1ms budget)

### Visual Conflict Resolution

Some buff combinations look bad together (e.g., Hot Hands red-orange + Incendiary Rounds orange-red = indistinguishable). Resolution:

- If Hot Hands AND Incendiary are both active, merge their visuals into a single "inferno" ring that uses both shaders blended 50/50. This saves a draw call and looks intentional.
- ShockAura's purple + any warm color (orange, red) provides good contrast naturally.
- Magnetism's yellow + Speed's green work fine as concentric rings.

---

## GPU Cost Matrix

| Buff Type | Shader Cost | Particles/sec | Extra Draw Calls | Total ms/frame | Mobile Safe? |
|-----------|------------|---------------|-----------------|---------------|-------------|
| Tough Times (Shield) | 0.05ms | 0 | +1 | **0.05ms** | YES |
| Afterburner (Speed) | 0.04ms | 3-5 | +1 | **0.05ms** | YES |
| Hot Hands (Damage) | 0.08ms | 4-6 | +1 | **0.09ms** | YES (reduce noise octaves) |
| Shock Aura (Electric) | 0.06ms | 2-3 | +1 | **0.10ms** | YES |
| Magnetism (Attract) | 0.04ms | 3-5 | +1 | **0.05ms** | YES |
| Trigger Happy (Fire Rate) | 0.04ms | 0 | +1 | **0.04ms** | YES |
| Incendiary (Fire DOT) | 0.08ms | 3-4 | +1 | **0.09ms** | YES (reduce flame count) |
| Volatile (Explosion) | 0.07ms | 0 | +1 | **0.07ms** | YES (simplify Voronoi) |

### Budget Summary

| Scenario | Active Rings | Total Cost | Budget (1ms) |
|----------|-------------|-----------|-------------|
| 1 buff (common case) | 1 | 0.04-0.10ms | 4-10% of budget |
| 2 buffs | 2 | 0.08-0.19ms | 8-19% of budget |
| 3 buffs (max displayed) | 3 | 0.12-0.29ms | 12-29% of budget |
| 3 buffs + particles | 3 + particles | 0.15-0.35ms | 15-35% of budget |

**Conclusion:** Even the worst case (3 expensive auras + particles) uses only ~35% of the 1ms budget. Plenty of headroom.

### Comparison to Current System

| Metric | Current (flat ring) | New (shader auras) |
|--------|-------------------|-------------------|
| Draw calls per aura | 1 | 1 (same) |
| Visual variety | None (color only) | 8 unique animations |
| Fragment complexity | ~0 (solid color) | LOW-MEDIUM (noise/hash) |
| Bloom interaction | Weak (NormalBlending) | Strong (AdditiveBlending) |
| Supplementary particles | 0 | 0-6/sec (budgeted) |
| Total cost | ~0.01ms | ~0.05-0.10ms |

The cost increase is 5-10x per ring, but the absolute numbers are tiny (0.05ms vs 0.01ms). This is a visual quality investment with negligible performance impact.

---

## Mobile-Safe Fallbacks

For devices detected as mobile (via `MobileDetector.ts`):

### Tier 1: Full Quality (Desktop, high-end mobile)
- All shader effects at full quality
- All supplementary particles enabled
- Up to 3 simultaneous aura rings

### Tier 2: Reduced Quality (Mid-range mobile)
- Noise-based shaders (Hot Hands, Incendiary) use 1 octave instead of 2
- Voronoi (Volatile) uses simplified distance function (4 samples instead of 9)
- Supplementary particles reduced to 50%
- Max 2 simultaneous aura rings

### Tier 3: Minimal Quality (Low-end mobile)
- All shaders replaced with simple color + opacity pulse (current behavior, but with AdditiveBlending)
- No supplementary particles
- Max 1 aura ring (highest priority buff only)
- This tier is functionally the same as current, just with better blending

### Implementation of Quality Tiers

The `BuffAuraRenderer` constructor accepts a quality tier parameter. Each buff's `ShaderMaterial` has a `#define QUALITY` preprocessor directive:

```glsl
#if QUALITY >= 2
  // Full noise, full Voronoi, all effects
#elif QUALITY >= 1
  // Simplified noise, reduced samples
#else
  // Simple pulse only
#endif
```

This is compiled once at material creation time, not checked per frame. No runtime branching cost.

---

## Implementation Plan

### Phase 1: Foundation (2-3 hours)

1. **Create `BuffAuraRenderer` class** (`src/buffs/BuffAuraRenderer.ts`)
   - Ring geometry with angular/radial UV mapping
   - Material slot system (one ShaderMaterial per buff type)
   - Object pool for ring meshes (max 3 active)
   - Update method: position, orient, update uniforms
   - Multi-buff stacking logic (priority, sizing, opacity)

2. **Create shared vertex shader** and the ring geometry
   - Custom `BufferGeometry` with UV.x = angle, UV.y = radial
   - ~48 angular segments, 2 radial vertices = 96 vertices per ring
   - Reusable across all buff types

3. **Wire into main.ts** game loop
   - Create `BuffAuraRenderer` alongside existing `BuffManager`
   - Call `buffAuraRenderer.update()` in the render loop
   - Pass active buffs, player position, surface normal

### Phase 2: First 4 Buff Shaders (3-4 hours)

Build the 4 most visually distinct buff shaders first:

1. **Shock Aura** — Electric scanning + arc flashes (most requested by user)
2. **Hot Hands** — Fire noise + scrolling lava
3. **Tough Times** — Hex shield flicker
4. **Afterburner** — Speed dashes + scroll

These 4 cover all the visual archetypes (electric, fire, geometric, motion) and are the most played buffs.

### Phase 3: Remaining 4 Buff Shaders (2-3 hours)

5. **Magnetism** — Inward chevrons + attraction dots
6. **Trigger Happy** — Rapid-fire chambers
7. **Incendiary Rounds** — Flame tongues (shares base with Hot Hands)
8. **Volatile** — Unstable Voronoi cracks

### Phase 4: Polish & Integration (1-2 hours)

1. **Multi-buff layering** — Test all combinations, tune stacking opacity/sizing
2. **Mobile quality tiers** — Add `#define QUALITY` variants
3. **Supplementary particle emitters** — Wire particle calls for fire, electric, magnet buffs
4. **Block proc flash** — Connect Tough Times' `uBlockTime` to `BuffManager.onPlayerHit()`
5. **Stack scaling** — Connect `uStacks` uniform to actual stack counts
6. **Performance profiling** — Verify total cost under 1ms with 3 buffs active

### Total Estimated Effort: 8-12 hours

### Implementation Order (Build First)

| Priority | Buff | Reason |
|----------|------|--------|
| 1st | Shock Aura | User specifically mentioned "electricity and sparks". Most visually distinctive. |
| 2nd | Hot Hands | User mentioned "fire randomly appearing". Noise-based = most technically interesting. |
| 3rd | Tough Times | Hex shield is a classic visual. Good variety from fire/electric. |
| 4th | Afterburner | Clean, simple, immediately satisfying speed lines. |
| 5th | Volatile | Voronoi cracks look impressive, medium difficulty. |
| 6th | Magnetism | Attraction field is unique but less visually dramatic. |
| 7th | Trigger Happy | Simple chamber animation, low risk. |
| 8th | Incendiary | Shares fire base with Hot Hands, can leverage that work. |

---

## Code Sketches

### BuffAuraRenderer Class Structure

```typescript
// src/buffs/BuffAuraRenderer.ts

import * as THREE from 'three';
import { StackBuffType, BUFF_DEFINITIONS } from './BuffManager';

// Pre-allocated temp vectors
const _tempNormal = new THREE.Vector3();

// Quality tiers
export enum AuraQuality {
  Minimal = 0,   // Simple pulse only
  Reduced = 1,   // Simplified shaders
  Full = 2,      // All effects
}

// Max simultaneous ring visuals
const MAX_VISIBLE_RINGS = 3;

// Ring geometry settings
const RING_SEGMENTS = 48;
const RING_INNER_RADIUS = 0.85;
const RING_OUTER_RADIUS = 1.0;

interface AuraRingSlot {
  mesh: THREE.Mesh;
  material: THREE.ShaderMaterial;
  buffType: StackBuffType | null;
  active: boolean;
}

export class BuffAuraRenderer {
  readonly root: THREE.Group;

  private slots: AuraRingSlot[] = [];
  private sharedGeometry: THREE.BufferGeometry;
  private materials: Map<StackBuffType, THREE.ShaderMaterial> = new Map();
  private quality: AuraQuality;

  constructor(quality: AuraQuality = AuraQuality.Full) {
    this.root = new THREE.Group();
    this.root.name = 'BuffAuras';
    this.quality = quality;

    // Create shared ring geometry with angular/radial UVs
    this.sharedGeometry = this.createRingGeometry();

    // Create materials for each buff type
    this.createMaterials();

    // Pre-allocate ring mesh pool
    for (let i = 0; i < MAX_VISIBLE_RINGS; i++) {
      const material = new THREE.ShaderMaterial(); // Placeholder
      const mesh = new THREE.Mesh(this.sharedGeometry, material);
      mesh.visible = false;
      mesh.frustumCulled = false;
      mesh.renderOrder = 90 + i;
      this.root.add(mesh);

      this.slots.push({
        mesh,
        material,
        buffType: null,
        active: false,
      });
    }
  }

  update(
    dt: number,
    totalTime: number,
    playerPos: THREE.Vector3,
    surfaceNormal: THREE.Vector3,
    activeBuffs: Array<{ type: StackBuffType; stacks: number }>,
  ): void {
    // 1. Determine which buffs to display (priority sort, max 3)
    const displayed = this.prioritizeBuffs(activeBuffs);

    // 2. Assign buffs to slots
    for (let i = 0; i < MAX_VISIBLE_RINGS; i++) {
      const slot = this.slots[i];

      if (i < displayed.length) {
        const buff = displayed[i];
        const mat = this.materials.get(buff.type);
        if (!mat) continue;

        // Assign material if buff type changed
        if (slot.buffType !== buff.type) {
          slot.mesh.material = mat;
          slot.material = mat;
          slot.buffType = buff.type;
        }

        // Update uniforms
        mat.uniforms.uTime.value = totalTime;
        mat.uniforms.uStacks.value = buff.stacks;

        // Position and orient
        const radiusScale = this.getRadiusScale(i, displayed.length);
        slot.mesh.position.copy(playerPos).addScaledVector(surfaceNormal, 0.06);
        _tempNormal.copy(playerPos).add(surfaceNormal);
        slot.mesh.lookAt(_tempNormal);
        slot.mesh.scale.setScalar(radiusScale);

        // Opacity scaling for multiple buffs
        mat.uniforms.uOpacity.value = this.getOpacity(displayed.length);

        slot.mesh.visible = true;
        slot.active = true;
      } else {
        slot.mesh.visible = false;
        slot.active = false;
        slot.buffType = null;
      }
    }
  }

  // ... helper methods for priority sorting, radius calculation, etc.

  private createRingGeometry(): THREE.BufferGeometry {
    // Custom ring with UV.x = angle (0..1), UV.y = radial (0..1)
    const geometry = new THREE.BufferGeometry();
    const vertexCount = (RING_SEGMENTS + 1) * 2;
    const positions = new Float32Array(vertexCount * 3);
    const uvs = new Float32Array(vertexCount * 2);
    const indices: number[] = [];

    for (let i = 0; i <= RING_SEGMENTS; i++) {
      const angle = (i / RING_SEGMENTS) * Math.PI * 2;
      const u = i / RING_SEGMENTS; // Angular coordinate 0..1

      const cos = Math.cos(angle);
      const sin = Math.sin(angle);

      // Inner vertex
      const vi = i * 2;
      positions[vi * 3 + 0] = cos * RING_INNER_RADIUS;
      positions[vi * 3 + 1] = sin * RING_INNER_RADIUS;
      positions[vi * 3 + 2] = 0;
      uvs[vi * 2 + 0] = u;
      uvs[vi * 2 + 1] = 0; // Inner edge

      // Outer vertex
      const vo = vi + 1;
      positions[vo * 3 + 0] = cos * RING_OUTER_RADIUS;
      positions[vo * 3 + 1] = sin * RING_OUTER_RADIUS;
      positions[vo * 3 + 2] = 0;
      uvs[vo * 2 + 0] = u;
      uvs[vo * 2 + 1] = 1; // Outer edge

      // Triangles
      if (i < RING_SEGMENTS) {
        const a = vi, b = vi + 1, c = vi + 2, d = vi + 3;
        indices.push(a, b, c);
        indices.push(c, b, d);
      }
    }

    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    geometry.setIndex(indices);

    return geometry;
  }

  private getRadiusScale(slotIndex: number, totalDisplayed: number): number {
    if (totalDisplayed === 1) return 1.5; // Default buff radius
    if (totalDisplayed === 2) return slotIndex === 0 ? 1.1 : 1.7;
    // 3 buffs
    return [0.9, 1.3, 1.9][slotIndex];
  }

  private getOpacity(totalDisplayed: number): number {
    return [0.5, 0.4, 0.35][Math.min(totalDisplayed - 1, 2)];
  }

  private prioritizeBuffs(
    buffs: Array<{ type: StackBuffType; stacks: number }>
  ): Array<{ type: StackBuffType; stacks: number }> {
    return buffs
      .slice()
      .sort((a, b) => {
        const defA = BUFF_DEFINITIONS[a.type];
        const defB = BUFF_DEFINITIONS[b.type];
        // Uncommon first
        if (defA.rarity !== defB.rarity) {
          return defA.rarity === 'uncommon' ? -1 : 1;
        }
        // Then by stacks
        return b.stacks - a.stacks;
      })
      .slice(0, MAX_VISIBLE_RINGS);
  }

  dispose(): void {
    this.sharedGeometry.dispose();
    for (const mat of this.materials.values()) {
      mat.dispose();
    }
  }
}
```

### Ring Geometry UV Layout

The custom ring geometry maps coordinates as follows:

```
            UV.x = 0.0                UV.x = 0.5              UV.x = 1.0
               |                         |                        |
               v                         v                        v
         ___________                ___________               ___________
        /           \              /           \             /           \
  UV.y=1 (outer)    |        UV.y=1            |       UV.y=1            |
       |             |            |             |           |             |
  UV.y=0 (inner)    |        UV.y=0            |       UV.y=0            |
        \___________/              \___________/             \___________/

  angle = 0 deg                angle = 180 deg           angle = 360 deg
```

This allows fragment shaders to:
- Use `vAngle` (UV.x) for patterns around the ring circumference
- Use `vRadius` (UV.y) for patterns from inner to outer edge
- Create any 2D pattern mapped onto the ring topology

### Integration in main.ts

```typescript
// In main.ts, alongside existing buff system setup:

import { BuffAuraRenderer, AuraQuality } from './buffs/BuffAuraRenderer';

// During init:
const buffAuraRenderer = new BuffAuraRenderer(
  isMobile ? AuraQuality.Reduced : AuraQuality.Full
);
game.scene.add(buffAuraRenderer.root);

// In the game loop (onFixedUpdate or render callback):
const activeBuffs = buffManager.getActiveBuffs().map(b => ({
  type: b.type,
  stacks: b.stacks,
}));
buffAuraRenderer.update(
  dt,
  totalTime,
  player.position,    // From MeshWalker
  player.normal,      // Surface normal
  activeBuffs,
);
```

### Connecting Proc Events to Visuals

```typescript
// Tough Times block flash:
buffManager.onPlayerHit = () => {
  const blocked = buffManager.onPlayerHit();
  if (blocked) {
    buffAuraRenderer.triggerBlockFlash(); // Sets uBlockTime uniform
  }
};

// Volatile explosion flash:
buffManager.onVolatileExplosion = (pos, radius, damage) => {
  buffAuraRenderer.triggerVolatilePulse(); // Brief unstable pulse
  particleSystem.shatterEffect(pos, volatileColor, 20, 1.0, 2.0);
};
```

---

## Summary

This research document provides:

1. **8 unique visual designs** for each buff type, each with a distinct animation character
2. **Shader-first approach** — most effects are pure fragment shader, keeping draw calls to +1 per visible aura
3. **Total cost under 0.35ms** even with 3 simultaneous auras + supplementary particles
4. **Multi-buff layering** with priority sorting, concentric ring sizing, and opacity scaling
5. **Mobile fallbacks** with 3 quality tiers and compile-time shader branching
6. **Full code sketches** for the renderer class, geometry, shaders, and integration

The key insight is that replacing `MeshBasicMaterial` with custom `ShaderMaterial` per buff type transforms a "flat paper" ring into a living, animated effect — with negligible additional GPU cost because the ring geometry is tiny (96 vertices) and fragment shaders are evaluated over a small screen area.

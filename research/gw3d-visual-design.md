# Geometry Wars 3: Dimensions - Visual Design Reference

**Date:** 2026-02-09
**Status:** Reference research — visual design and aesthetics. No codebase-specific references.

Comprehensive visual reference for browser recreation. All details sourced from game analysis, developer interviews, community guides, and technical breakdowns.

---

## 1. Overall Aesthetic - The "Geometry Wars Look"

The signature GW look is defined by:

- **Pitch-dark background** with a subtle deep-space/cosmic feel (very dark blue-black, approximately `#050510` to `#0a0a1a`)
- **Neon-bright geometric shapes** rendered with additive bloom glow
- **Wireframe + solid hybrid rendering** on enemies and player - shapes have visible edges with glowing filled faces
- **Color-saturated explosions** that burst into hundreds of matching-color particles
- **Deforming grid** on the playing surface that reacts to gameplay events (bullets, explosions, black holes)
- **Everything glows** - entities, bullets, particles, grid lines all emit light via bloom post-processing
- **High contrast** - bright neon on near-black creates extreme contrast that defines the visual identity
- **Minimalist geometry** - every game element is a simple geometric shape (diamonds, circles, squares, arrows, pinwheels)

The developers at Bizarre Creations described their approach: shapes were hand-coded, simple particle effects added for flourishes, significant game objects got distinctive shadows while everything else stayed flat. The goal was letting the player's subconscious focus on game elements rather than backgrounds.

In GW3D specifically, the backgrounds shifted from pure black to a dark cosmic/space environment with subtle nebula-like effects behind the 3D surfaces.

---

## 2. Color Palette

### Primary Entity Colors

| Entity | Color Name | Hex (Approx) | Notes |
|--------|-----------|---------------|-------|
| **Player Ship** | White/Bright Cyan | `#FFFFFF` / `#00FFFF` | White body, cyan glow - easy to spot in chaos |
| **Player Bullets** | White/Bright Cyan | `#FFFFFF` / `#88FFFF` | Small bright dots/lines with slight trail |
| **Geoms (Collectibles)** | Bright Green | `#00FF44` / `#44FF44` | Small diamond shapes, sparkle effect |
| **Grid Lines** | Dark Blue | `#1E1E8B` (30, 30, 139) | Alpha ~0.33, every 3rd line thicker |
| **Bomb Flash** | White | `#FFFFFF` | Full-screen white flash on detonation |

### Enemy Colors

| Enemy | Color | Hex (Approx) | Shape |
|-------|-------|---------------|-------|
| **Grunt** | Blue | `#4444FF` / `#4488FF` | Diamond/rhombus |
| **Wanderer** | Purple | `#AA44FF` / `#9944FF` | Pinwheel/fan (4-6 blades) |
| **Weaver** | Green | `#00FF44` / `#44FF44` | Diamond/square (rotated 45 deg) |
| **Spinner** | Pink/Magenta | `#FF44FF` / `#FF44AA` | Octahedron/box |
| **Spinner Spawn** | Light Pink | `#FF88CC` | Tiny pink boxes |
| **Duck** | Pink | `#FF4488` / `#FF6699` | Two conjoined squares |
| **Rocket** | Orange | `#FF8800` / `#FF6600` | Dart/arrow shape with trail |
| **Neutron (Deflector)** | Teal/Cyan | `#44DDDD` / `#00CCCC` | Heptagon/spinning top |
| **Mayfly** | Yellow-Green | `#AAFF00` / `#CCFF44` | Tiny triangular pyramid |
| **Weaver (GW3)** | Green | `#00FF44` | Diamond with inertia-based wobble |
| **Golden Gear** | Yellow/Gold | `#FFD700` / `#FFAA00` | Plus/cross shape |
| **Snake Head** | Blue | `#4488FF` | Circle/ring |
| **Snake Body** | Dark Blue | `#224488` | Smaller circles/rings |
| **Repulsor (Dasher)** | Orange front / Blue rear | `#FF4400` / `#4444FF` | Arrow - two-part (front shield, rear vulnerable) |
| **Gravity Well (inactive)** | Blue | `#4488FF` | Concentric rings |
| **Gravity Well (active)** | Magenta/Purple | `#FF00FF` | Concentric rings, pulsing |
| **Proton (BH Spawn)** | Blue | `#4488FF` / `#44AAFF` | Atom-like sphere with orbiting particle (GW3) |
| **NUFO** | Yellow | `#FFDD00` / `#FFD700` | Disc/UFO shape |
| **Spawner (invulnerable)** | Red | `#FF2222` / `#FF0000` | Circle |
| **Spawner (vulnerable)** | Green | `#00FF44` / `#22FF22` | Circle |
| **Virus** | Green | `#00CC00` / `#22AA22` | Pentagon |
| **Battenberg** | Purple + Yellow | `#AA44FF` + `#FFD700` | Diamond that splits into purple darts + yellow blockers |
| **Painter** | Rainbow/Orange | `#FF8844` | Leaves orange ground coverage |
| **Boss** | Varies per boss | Various | Large, shielded, with health bar |
| **Red Cube (Blocker)** | Red | `#FF0000` | Indestructible cube |
| **Gate** | Orange tips | `#FF6600` | Bar with lethal orange endpoints |

### Background Colors

- **Game background**: Very dark blue-black (`#050510` to `#0a0a1a`)
- **GW3D space background**: Deep space with subtle nebula tones (dark purples, deep blues)
- **Grid surface**: Slightly lighter than background (`#0a0a2a` to `#111133`), with blue grid lines
- **Grid lines (primary)**: Dark blue `#1E1E8B` at alpha 85/255 (~33%)
- **Grid lines (secondary, every 3rd)**: Same color but thicker (3px vs 1px)

### Neon Glow Behavior

The center of any bright element appears nearly **white** while the glow halo around it takes on the **saturated color**. This is key to the neon look:
- A blue grunt's center edges are `#AACCFF` (near-white blue) while its glow halo is saturated `#4444FF`
- The bloom saturation is set higher than 1.0 (approximately 1.5x) so glows are MORE colorful than the source

---

## 3. Player Ship

### Shape
- **Claw/chevron shape** - like a pointed arrowhead or angular bracket `>` rotated to face the aim direction
- Approximately a flattened isoceles triangle with a notch cut from the rear (creating the claw)
- Width roughly 2x height
- The shape is white/bright so it stands out against all colored enemies

### Visual Properties
- **Color**: White body (`#FFFFFF`) with cyan accent glow (`#00FFFF`)
- **Glow**: Strong bloom halo, appears as a bright white-cyan beacon
- **Size**: Relatively small compared to most enemies - roughly 0.3-0.4 world units across
- **Trail**: Subtle engine trail from rear when moving (cyan/white particles)
- **Orientation**: Always rotates to face the aim/shoot direction (right stick)

### States
- **Normal**: Solid white with cyan glow
- **Invincible (after respawn)**: Flashing/pulsing with increased glow intensity, semi-transparent flicker
- **Shield active**: Visible shield aura around ship (cyan ring)
- **Death**: Explodes into white/cyan particle burst + screen shake

---

## 4. Enemy Visual Designs (Detailed)

### Tier 1: Basic Enemies

**Grunt (Blue Diamond)**
- Shape: Diamond/rhombus (square rotated 45 degrees)
- Color: Blue (`#4444FF`)
- Size: ~0.25 world units
- Animation: Stretches back and forth as it moves (pulsing elongation along movement axis)
- Glow: Standard blue neon halo
- Death: Blue particle burst

**Wanderer (Purple Pinwheel)**
- Shape: 4-blade pinwheel/fan
- Color: Purple (`#AA44FF`), slightly blue-tinted in GW3D
- Size: ~0.3 world units (blade length)
- Animation: Constant spinning rotation around center axis (3+ rad/s)
- Glow: Purple neon halo
- Death: Purple particle spray

**Duck (Pink Joined Squares)**
- Shape: Two pink squares joined together (like a domino piece)
- Color: Pink (`#FF4488`)
- Size: ~0.3 world units
- Animation: Moves by "flipping" - rotates 90 degrees to shuffle one unit in cardinal directions
- Glow: Pink neon halo
- Death: Pink particle burst

**Mayfly (Yellow-Green Triangle)**
- Shape: Tiny triangular pyramid (tetrahedron)
- Color: Yellow-green (`#AAFF00`)
- Size: Very small (~0.15 world units) - spawns in large groups
- Animation: Tilts/wobbles erratically while tracking player
- Glow: Faint yellow-green halo (small so less visible)
- Death: Small yellow-green puff
- Note: Bullets pierce through them

### Tier 2: Tracking/Movement Enemies

**Weaver (Green Diamond)**
- Shape: Diamond/square (similar to Grunt shape but green)
- Color: Green (`#00FF44`)
- Size: ~0.3 world units
- Animation: Wobbles/weaves as it moves (inertia-based), rotates along movement direction
- Glow: Green neon halo
- Death: Green particle burst
- Special: Visibly dodges bullets - sharp lateral movements when bullets approach

**Spinner (Pink Octahedron)**
- Shape: Octahedron (two pyramids joined at base)
- Color: Pink/Magenta (`#FF44FF`)
- Size: ~0.3 world units
- Animation: Constant tumbling rotation on multiple axes (X and Y rotation simultaneously)
- Glow: Pink/magenta neon halo
- Death: Splits into 3 smaller SpinnerSpawns + particle burst
- SpinnerSpawn: Tiny pink boxes that orbit the death location rapidly

**Rocket (Orange Dart)**
- Shape: Pointed dart/arrow - elongated triangle
- Color: Orange (`#FF6600` to `#FF8800`)
- Size: ~0.3 world units long, narrow
- Animation: Leaves an orange particle trail while moving in straight lines
- Glow: Orange neon halo + trailing glow
- Death: Orange particle burst

**Neutron/Deflector (Teal Spinning Top)**
- Shape: Spinning top/gyroscope (heptagonal)
- Color: Teal/Cyan (`#44DDDD`)
- Size: ~0.3 world units
- Animation: Rapid spinning, moves at 2x player speed with perfect wall reflections
- Glow: Teal neon halo
- Death: Teal particle burst

### Tier 3: Complex Enemies

**Snake (Blue Head + Dark Blue Body)**
- Shape: Head is a circle/ring, body segments are smaller circles/rings
- Color: Head `#4488FF` (bright blue), Body `#224488` (dark blue)
- Size: Head ~0.2 units, body ~0.15 units, 5+ segments
- Animation: S-pattern sinusoidal movement, body follows head with delay
- Glow: Blue glow on head, subtle glow on body
- Death: Only head is vulnerable - body absorbs shots without damage
- Visual: Looks like a chain of blue circles snaking across the surface

**Repulsor/Dasher (Orange + Blue Arrow)**
- Shape: Two-part arrow/wedge
- Color: Front (shield) orange `#FF4400`, Rear (vulnerable) blue `#4444FF`
- Size: ~0.5 world units total (larger enemy)
- Animation: Lock phase: front pulses (scaling 0.8-1.2x at 8Hz). Charge: front scales up 1.2x, dashes at 4x player speed. Recovery: slow turn.
- Glow: Orange glow on front, blue glow on rear
- Death: Dual-color burst (orange + blue particles)
- Key visual cue: Players must identify blue rear to know where to shoot

**Battenberg (Purple + Yellow Diamond)**
- Shape: Rounded diamond composed of purple and yellow sections
- Color: Purple `#AA44FF` + Yellow `#FFD700`
- Size: ~0.4 world units
- Animation: Moves straight, bounces off surfaces
- Death/Split: Separates into 2 purple tracking darts (fast, wide turns) + 2 yellow blockers (hover slowly near split point)

### Tier 4: Special Enemies

**Gravity Well / Black Hole**
- Shape: Concentric rings/circles (4 nested rings of decreasing radius)
- Color: Inactive blue `#4488FF`, Active magenta `#FF00FF`
- Size: ~0.8 world units (large)
- Animation: Constant pulsing scale (0.8x-1.2x), when active creates visible gravitational distortion pulling nearby entities. Bends bullet trajectories visually.
- Glow: Strong glow, intensifies when active
- Death/Detonate: Massive explosion, spawns Protons, grid shockwave

**Spawner (Red/Green Circle)**
- Shape: Circle
- Color: Red `#FF2222` (invulnerable), Green `#22FF22` (vulnerable)
- Size: ~0.5 world units (large)
- Animation: Color transition from red to green after spawning enemies. Pulses.
- Glow: Color-matching glow
- Death: Only dies when green. Particle burst matching current color.

**Virus (Green Pentagon)**
- Shape: Pentagon
- Color: Green `#00CC00`
- Size: ~0.3 world units
- Animation: Self-replicates - visually splits/buds into new copies
- Glow: Green glow
- Note: Does NOT drop geoms

**Golden Gear (Yellow Cross)**
- Shape: Plus/cross shape
- Color: Yellow/Gold `#FFD700`
- Size: ~0.3 world units
- Animation: Slow spinning, attracted to geoms. Spins rapidly before exploding when full.
- Glow: Gold neon halo
- Death: Small particle puff (does not damage player)

**NUFO (Yellow Disc)**
- Shape: Flat disc/UFO
- Color: Yellow `#FFDD00`
- Size: ~0.25 world units
- Animation: Rapid rotation while floating in straight lines, moves in groups
- Glow: Yellow glow
- Note: Passive, drops no geoms. Spawns outside map and disappears out the other side.

### Tier 5: Boss Enemies

**Boss**
- Shape: Large geometric form (varies per boss - named after gemstones: Sapphire, Ruby, Emerald, etc.)
- Color: Varies per boss
- Size: Very large - clearly dominant on screen
- Shield: Visible crystalline shield surrounds boss during invulnerable phases (translucent, faceted)
- Health bar: Red bar at top of screen
- Animation: Shield activates/deactivates between phases. Spawns regular enemies around itself.
- Phases: Health bar turns red when shielded (cannot be damaged). Shield drops after surviving waves or defeating sub-bosses.

---

## 5. Particle Effects

### Enemy Death Explosion

When an enemy dies:
1. **Color-matched particle burst**: 20-50 particles matching the enemy's primary color spray outward in all directions
2. **Particle shape**: Small dots/points with additive blending (bright center, colored halo)
3. **Particle behavior**: Fast initial velocity (radial outburst), rapid deceleration and fade over 0.3-0.5 seconds
4. **Scale**: Particles start small, briefly expand, then shrink as they fade
5. **Grid deformation**: Death creates a brief outward push on the surface grid at the death location

### Bullet Impact

- Small spark effect on hit (4-8 particles)
- White/cyan colored
- Very short lived (0.1-0.2 seconds)

### Player Bullets

- Shape: Small elongated dots/dashes (not circles - slightly stretched along travel direction)
- Color: White core with slight cyan tint (`#FFFFFF` to `#88FFFF`)
- Size: Very small (~0.05 world units)
- Trail: Faint short trail behind each bullet
- Fire pattern: Burst of 3 bullets per shot in tight triangular formation, middle bullet travels slightly faster
- Fire rate: ~10 bursts per second = 30 bullets/second when holding fire

### Bomb Detonation

- **Full-screen white flash** that rapidly fades
- **Shockwave ring** expanding outward from detonation point
- **All enemies simultaneously explode** with their individual color-matched particle bursts
- **Grid deformation**: Major shockwave pushes grid outward from center, then springs back
- **Geom shower**: Massive spray of green geom diamonds from all dying enemies

### Geom Pickup

- Green diamonds (`#00FF44`) float after enemy death
- Slight drift/wobble animation
- When collected: small sparkle effect, score multiplier text popup
- Attracted toward player when very close (magnetic pull radius)
- Sparkle/glint effect on idle geoms (subtle pulsing brightness)

### Player Death

- Large white/cyan explosion (bigger than enemy deaths)
- Screen shake (intense, short duration ~0.3s)
- Brief screen flash
- All active enemies pause momentarily
- Respawn with invincibility glow (flashing ship)

---

## 6. Surface Rendering (3D Shapes)

### Grid Surface

In GW3D, the playing surface is a 3D geometric shape:

- **Material**: Semi-transparent/translucent dark surface with glowing grid lines
- **Grid lines**: Thin blue lines (`#1E1E8B`, alpha ~33%) forming a regular grid across the surface
- **Grid spacing**: Approximately 1/40th of the surface width per cell
- **Grid thickness**: 1px for normal lines, 3px for every 3rd line (creates major/minor grid pattern)
- **Grid deformation**: Springs at each intersection react to:
  - Bullets passing nearby (small outward push)
  - Explosions (large outward push, then spring back)
  - Black holes (inward pull, constant suction)
  - Player respawn (shockwave ripple)
  - Bombs (massive shockwave)
- **Surface opacity**: Semi-transparent - can partially see through to the back side
- **Surface color**: Very dark blue-gray (`#0a0a2a` to `#111133`)
- **Rendering**: `FrontSide` only (not DoubleSide) to avoid double-vision on complex shapes

### Surface Shapes (Adventure Mode)

Each level uses one of several 3D shapes:
- Sphere, Cube, Cylinder, Torus, Peanut, Capsule, and others
- The shape floats in dark space
- Camera orbits with the player, maintaining consistent view angle
- Surface edges are visible as brighter grid boundary lines

### Classic Mode Surface

- Flat rectangular playing field
- Visible border/wall at edges (bright colored line, typically cyan/white)
- Grid covers entire surface
- Grid deformation is most visible here (flat surface makes ripples obvious)

---

## 7. HUD / UI Design

### In-Game HUD

**Layout:**
- **Score**: Top-center of screen, large white text
- **Multiplier**: Below or next to score, smaller text (format: "x123")
- **Lives**: Top-left, represented as small ship icons
- **Bombs**: Top-left (below lives), represented as small bomb icons
- **Boss health bar**: Top of screen, red bar (only during boss fights)

**Font Style:**
- Clean, sans-serif, slightly condensed
- White text with subtle glow
- Score uses monospace or tabular figures for consistent width
- Large score numbers, smaller labels

**Score Popup (on enemy kill):**
- Appears briefly at the death location
- Shows point value (e.g., "+100")
- Color: White or color-matched to enemy
- Animation: Floats upward, scales up slightly, fades out over ~1 second
- Size: Small, non-intrusive

**Multiplier Popup (on geom collect):**
- Brief flash at collection point
- Shows multiplier increment

### Menu Design

**Main Menu / Level Select:**
- Dark background with subtle particle effects/nebula
- 3D geometric shapes floating or rotating in background
- Level select shows a node-based map with connections between levels
- Levels marked with star ratings (1-3 stars)
- Selected level shows the 3D shape preview
- Neon-accented UI elements (buttons, borders)
- Font: Clean sans-serif, all-caps for headers

**Pause Screen:**
- Semi-transparent dark overlay (`#000000` at ~70% opacity)
- Menu options centered on screen
- "PAUSED" text in large white letters
- Options: Resume, Restart, Quit
- Neon accent lines/borders on hover

**Game Over Screen:**
- Shows final score prominently
- Star rating earned
- Options to retry or go back to menu
- Dark background with score breakdown

### Font Recommendations for Recreation

The game uses clean, geometric sans-serif fonts:
- Similar to: Orbitron, Rajdhani, Exo 2, Play, or Audiowide
- Characteristics: geometric, slightly futuristic, good readability at small sizes
- Weight: Medium to Bold for headers, Regular for body/scores
- Color: White (`#FFFFFF`) with slight neon glow effect

---

## 8. Camera Effects

### Screen Shake
- Triggered by: Player death, bomb detonation, large explosions, boss damage phases
- Intensity: Proportional to event magnitude
- Duration: 0.1-0.5 seconds
- Type: Random offset applied to camera position (not rotation)
- Decay: Rapid exponential falloff

### Camera in GW3D (3D Mode)
- Camera follows player along the surface normal
- Positioned ~15 units above player along surface normal
- `camera.up` set to surface bitangent (prevents flipping on torus/complex shapes)
- `camera.lookAt(playerPosition)` keeps player centered
- Surface tilts subtly as player moves (parallax effect)
- Camera smoothly interpolates between positions (slight lag for feel)

### Bloom / Post-Processing

**Bloom Configuration (reference values from GW-style recreation):**
- Bloom threshold: 0.25 (anything below 25% brightness excluded)
- Bloom intensity: 2.0
- Bloom saturation: 1.5 (glow is MORE saturated than source - key to neon look)
- Base image intensity: 1.0
- Blur amount (sigma): 4.0
- Blur passes: Gaussian blur applied twice (horizontal + vertical)
- Base image darkened in high-bloom areas to prevent white-out

**For Three.js UnrealBloomPass:**
- threshold: 0.25 - 0.85 (lower = more glow, but risk white-out with additive materials)
- strength: 1.0 - 2.0
- radius: 0.5 - 1.0
- Important: Use NormalBlending on particles/trails (AdditiveBlending causes white-out with bloom)

### Depth-Based Opacity (GW3D specific)
- Enemies on the far side of 3D surfaces fade based on camera-facing angle
- Dot product of surface normal and camera direction determines opacity
- Fully visible when facing camera, nearly transparent when facing away
- Creates natural depth cue on spheres, torus, etc.

---

## 9. Drone Companion Visuals

Drones are small ship-like companions that orbit/follow the player:

| Drone | Behavior | Visual Notes |
|-------|----------|--------------|
| **Attack** | Follows player, fires parallel bullets | Small version of player ship, fires white bullets |
| **Collect** | Independently flies to geoms | Moves away from player to gather greens |
| **Ram** | Orbits player, charges into enemies | Visible dash trail when ramming |
| **Snipe** | Follows player, fires long-range shots | Fires thin laser-like beam at targets |
| **Defend** | Follows player, blocks enemies | Shield-like appearance near player |
| **Sweep** | Circles player in orbit | Visible orbital ring path, destroys enemies on contact |

- All drones are smaller than the player ship (~50% size)
- Colored similar to player (white/cyan tones)
- Have their own subtle glow

---

## 10. Super Ability Visual Effects

| Super | Visual Effect |
|-------|--------------|
| **Homing** | Large burst of glowing missiles that seek enemies (orange/red trails) |
| **Mine** | Drops glowing mines at drone location (pulsing dots on surface) |
| **Detonator** | Mobile explosive drone, periodic small explosions, then one massive blast |
| **Turret** | Stationary auto-firing turret placed on surface |
| **Black Hole** | Creates a swirling vortex that pulls enemies in |
| **Nuke** | Similar to bomb but triggered by super button |

---

## 11. Special Visual Effects

### Grid Deformation Spring Physics

The background grid uses a mass-spring simulation:
- Each grid intersection is a point mass connected by springs
- Spring stiffness: ~0.28, damping: ~0.06
- Border points are anchored (immovable)
- Interior points have gentle restoring force (stiffness: 0.002, damping: 0.02)
- Natural spring length: 95% of rest distance
- Uses symplectic Euler integration (energy-conserving)
- Bullets create explosive (outward) force on grid
- Black holes create implosive (inward) force with pulsation
- Player respawn creates Z-axis shockwave
- Grid lines use Catmull-Rom interpolation for smooth deformation curves

### Spawn Warning

Before enemies spawn:
- Brief flash/glow at spawn location
- Possible expanding ring effect at spawn point
- Gives player ~0.5s visual warning before enemy appears

### Combo/Kill Streak Effects

- Rapid successive kills increase visual intensity
- Screen edges may pulse with color
- Score popups chain together

### Wave Transition

Between waves:
- Brief calm period
- Text overlay showing wave number
- Subtle screen effect (flash, zoom)

---

## 12. Key Visual Principles for Recreation

1. **Everything emits light**: Use emissive materials (`MeshStandardMaterial` with `emissive` and `emissiveIntensity`) - nothing should look "flat"
2. **Bloom is mandatory**: Without bloom post-processing, the game looks completely wrong
3. **Color = identity**: Each enemy type has a unique, instantly recognizable color
4. **Dark background is essential**: The extreme contrast between dark background and neon entities creates the look
5. **Particles everywhere**: Every interaction (kill, collect, shoot, explode) generates particles
6. **Grid deformation sells the world**: The reactive grid makes the surface feel alive
7. **Simplicity of shapes**: Enemies are made of basic geometry (diamonds, circles, squares, triangles). Complex shapes are avoided.
8. **White = player/bullets**: The player and bullets are white/cyan to distinguish from colored enemies
9. **Size indicates threat**: Bigger enemies are more dangerous (Gravity Well, Boss, Spawner)
10. **Animation indicates behavior**: Spinning = wanderer, pulsing = about to act, stretching = moving

### Material Template (Three.js)

```typescript
// Standard enemy material
const enemyMaterial = new THREE.MeshStandardMaterial({
  color: ENEMY_COLOR,           // e.g., 0x4444ff for Grunt
  emissive: ENEMY_COLOR,        // same color for self-illumination
  emissiveIntensity: 0.8,       // strong glow
  transparent: true,
  opacity: 0.9,
  side: THREE.FrontSide,
  roughness: 0.3,
  metalness: 0.1
});

// Grid line material
const gridLineMaterial = new THREE.LineBasicMaterial({
  color: 0x1E1E8B,
  transparent: true,
  opacity: 0.33,
  linewidth: 1  // or 3 for major lines
});

// Particle material (NormalBlending to avoid white-out with bloom)
const particleMaterial = new THREE.PointsMaterial({
  color: PARTICLE_COLOR,
  size: 0.05,
  transparent: true,
  blending: THREE.NormalBlending,  // NOT AdditiveBlending
  depthWrite: false
});
```

### Bloom Configuration (Three.js)

```typescript
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass';

const bloomPass = new UnrealBloomPass(
  new THREE.Vector2(window.innerWidth, window.innerHeight),
  1.0,    // strength (1.0-2.0 range)
  0.5,    // radius
  0.85    // threshold (0.25 for more glow, 0.85 for less white-out)
);
```

---

## 13. Precise Technical Parameters (from GW-style XNA implementation)

These values come from the Envato Tuts+ Neon Vector Shooter tutorial series, which is the closest documented technical recreation of the Geometry Wars visual style.

### Bloom Shader Pipeline (3-pass)

The bloom is implemented as a 3-pass pipeline:
1. **Extract bright pixels**: Subtract `BloomThreshold` from each color component, scale back up so max = 1, clamp to [0,1]
2. **Gaussian blur**: Two-pass (horizontal + vertical) with `sigma = blurAmount`. Render targets at **half resolution** (performance optimization that doesn't hurt quality since the result is blurred anyway)
3. **Recombine**: Blend blurred bloom image with original, applying saturation and intensity adjustments

**Exact bloom parameters:**
| Parameter | Value | Description |
|-----------|-------|-------------|
| Threshold | 0.25 | Anything below 25% brightness excluded from bloom |
| Blur amount (sigma) | 4.0 | Standard deviation of Gaussian blur |
| Bloom intensity | 2.0 | How strongly bloom affects final result |
| Base intensity | 1.0 | How strongly original image affects final result |
| Bloom saturation | 1.5 | Glow is 50% MORE saturated than source (key to neon look!) |
| Base saturation | 1.0 | Original image saturation unchanged |

**Saturation formula:**
```
luminosity = dot(color, float3(0.3, 0.59, 0.11))  // weighted by human eye sensitivity
grey = float3(luminosity, luminosity, luminosity)
saturated = lerp(grey, color, saturationAmount)
```

**Critical neon insight:** A bloom saturation of 1.5 causes the glow around bright objects to have MORE saturated colors than the objects themselves. This simulates real neon lights where the center appears white while the surrounding glow is strongly colored.

**Base image darkening:** The base image is darkened in areas with bright bloom to prevent clipping when the two are added together.

### Particle System Parameters (exact values)

**System capacity:** 20,480 particles via circular array pool

**Enemy death explosion:**
- Particle count: **120 particles**
- Duration: **190 frames (~3.2 seconds at 60fps)**
- Speed: `18 * (1 - 1 / random(1, 10))` -- weighted toward maximum speed
- Colors: Two interpolated HSV hues matching enemy color, saturation 0.5, value 1.0
- Scale: 1.5x base particle size
- Alpha: `min(1, min(percentLife * 2, speed * 1))^2` -- squared for smooth fade
- Slowdown: velocity *= 0.97 per frame

**Bullet hit particles:**
- Particle count: **30 particles**
- Duration: **50 frames (~0.83 seconds)**
- Speed: random 0-9 units/frame
- Color: Light blue
- Behavior: Bounce off screen edges (velocity reflection)

**Player death:**
- Particle count: **1,200 particles** (10x enemy death)
- Duration: **190 frames**
- Speed: Same weighted formula as enemies
- Color: White-to-yellow lerp
- Type: IgnoreGravity (unaffected by black holes)

**Ship exhaust fire (continuous):**
- Streams: 3 concurrent (center + 2 swiveling sides)
- Duration: 60 frames per particle
- Base velocity: -3 units opposite to movement
- Perpendicular sway: `0.6 * sin(t * 10)` magnitude
- Particles per frame: 6 (white line + colored glow per stream)
- Colors: Deep red `(200, 38, 9)` = `#C82609` for sides; Orange-yellow `(255, 187, 30)` = `#FFBB1E` for center
- Alpha: 0.7 opacity

**Particle visual formula:**
- Length scaling: `min(min(1, 0.2 * speed + 0.1), alpha)` -- particles stretch by speed
- LengthMultiplier: Scales particle along velocity direction (motion blur effect)

**Black hole spray (on hit):**
- 150 particles, 90 frame duration
- Radial distribution: `TwoPi * i / numParticles + startOffset`
- Velocity: 8-16 units/frame outward
- Type: IgnoreGravity

**Black hole continuous orbital spray:**
- Color: Purple (hue 5, saturation 0.5)
- Velocity: 12-15 units/frame
- Duration: 190 frames
- Rotation: `sprayAngle -= TwoPi / 50` per frame

**Black hole gravity on particles:**
```
vel += 10000 * normalToBlackHole / (distance^2 + 10000)
// Tangential acceleration when distance < 400:
vel += 45 * perpendicular / (distance + 100)
```

### Grid Deformation Spring Constants (exact values)

**Grid resolution:** ~1600 point masses across viewport
- Grid spacing: `sqrt(viewportWidth * viewportHeight / 1600)` -- approximately 1 mass per 30-40 pixels

**Spring network:**
| Connection | Stiffness | Damping |
|-----------|-----------|---------|
| Border anchors | 0.1 | 0.1 |
| Interior anchors (every 3rd point, 1/9th of masses) | 0.002 | 0.02 |
| Main spring connections | 0.28 | 0.06 |

**Point mass base friction:** 0.98 per frame

**Force application formulas:**
- Directed force: `force_on_mass = 10 * force / (10 + distance(force_position, mass_position))`
- Explosive (bullets): `ApplyExplosiveForce(0.5 * bulletVelocity.length(), bulletPosition, radius=80)`
- Implosive (black holes): force varies sinusoidally: `sin(sprayAngle / 2) * 10 + 20` with radius=200
- Player respawn shockwave: `ApplyDirectedForce(vec3(0, 0, 5000), playerPos, radius=50)` -- massive Z-axis impulse

**Temporary damping increase:** After explosive/implosive forces, call `IncreaseDamping(0.6)` to stabilize affected regions

### Black Hole Physics

**Attraction/repulsion by entity type:**
- Bullets: Constant repulsive force of 0.3 (bullets are pushed away)
- Enemies/Player: Linear attractive force from 2.0 (closest) to 0.0 (at 250 units), using linear interpolation
- Particles: Inverse-square gravitational attraction

**Black hole properties:**
- Destruction threshold: 10 hits to kill
- Visual pulsation: scale = `1 + 0.1 * sin(time)` (gentle breathing effect)
- Attraction radius: 250 units

---

## 14. Super State Visual Details

### How Super States Appear
- Spawn as a **pattern of dots** on the surface, resembling a constellation or symbol
- Patterns include: arrow, rainbow circle, and other geometric designs
- Each dot acts like an immobile enemy that must be shot
- Must destroy ALL dots before the pattern fades to activate the super state
- Audio cue: "Super State" voice line when pattern appears

### Active Super State Indication
- **Ship glows a specific color** when a super state is active
- The changed glow color serves as the primary visual indicator of the active powerup

### Super State Types
| Super State | Visual Effect |
|-------------|--------------|
| **Quad Fire** | Ship fires 4 streams in cardinal directions |
| **Split Fire** | Bullet streams split mid-flight |
| **Reverse Fire** | Bullets fire from rear of ship |
| **Missile** | Homing projectiles with trails |
| **Trail Bomb** | Medium-sized explosions left in trail |
| **Magnet** | All geoms on screen pulled to player (green particles stream inward) |
| **Shield** | Invulnerability aura, can ram enemies to kill them |

---

## 15. Enemy Shader Pipeline (Developer-Confirmed)

From the PlayStation Blog interview with Lucid Games:

1. **Modeling**: Enemies are modeled in **Maya** as geometric shapes
2. **In-game shading**: Custom internal graphics shaders create the "unique neon glow look"
3. **Visual stages**: Each enemy goes through wireframe -> polygon surfaces -> in-game object with glowing surfaces
4. **Behavioral visualization**: Enemy visual state communicates behavior (docile vs. active states must be visually distinct)

This confirms that the neon glow is not just post-processing bloom -- the entities themselves use custom emissive shaders that make their surfaces glow, with bloom then amplifying this effect.

---

## 16. Post-Processing Stack (from PCGamingWiki config)

The game's settings file includes these post-processing toggles:
- **Bloom**: On/Off
- **Blur**: On/Off (likely motion blur or depth-of-field)
- **Vignette**: On/Off (darkening at screen edges)
- **EffectDetail**: Low/Medium/High (controls particle density and effect complexity)

Reducing to Medium or Low removes special effects, confirming they are layered on top of base rendering.

---

## 17. Current Codebase vs. GW3D Reference (Gap Analysis)

### What matches well:
- Enemy color assignments (all hex values match reference)
- Player ship color (cyan `#00FFFF`)
- Bullet color (white-cyan `#88FFFF`)
- Geom color (bright green `#00FF44`)
- Grid color (`#1E1E8B`) and surface color (`#0A0A2A`)
- Bloom is enabled with threshold 0.85, strength 1.0, radius 0.4

### What could be improved:
1. **Bloom parameters**: Current threshold (0.85) is conservative. Consider lowering toward 0.25-0.5 for more glow, paired with NormalBlending on all particles
2. **Bloom saturation**: UnrealBloomPass doesn't natively support separate bloom saturation. Would need custom shader pass to achieve the 1.5x saturation effect
3. **Particle counts**: Enemy death should spawn ~120 particles (verify current ParticleSystem capacity and death particle counts)
4. **Player death particles**: Should be 1,200 particles (10x enemy death) with white-to-yellow color
5. **Ship exhaust**: Currently uses GlowTrail; could add 3-stream exhaust particles (center orange-yellow, sides deep red)
6. **Grid deformation forces**: Verify spring constants match reference values (stiffness 0.28, damping 0.06)
7. **Vignette**: Not currently implemented -- adds subtle screen-edge darkening for focus
8. **Particle stretching by velocity**: Particles should stretch along their movement direction (motion blur effect)

---

## Sources

- [Steam Community: GW3 Enemy Guide](https://steamcommunity.com/sharedfiles/filedetails/?id=601842273)
- [KosGames: Comprehensive Enemy Guide](https://kosgames.com/geometry-wars-3-dimensions-evolved-comprehensive-enemy-guide-214/)
- [PlayStation Blog: Creating a New Enemy](https://blog.playstation.com/2015/04/03/creating-a-new-enemy-in-geometry-wars-3-dimensions-evolved/)
- [Gamasutra/GameDeveloper: The Color and The Shape - Bizarre Creations Interview](https://www.gamedeveloper.com/pc/the-color-and-the-shape-bizarre-creations-on-i-geowars-i-sensible-aesthetic)
- [Envato Tuts+: Neon Vector Shooter - Bloom and Black Holes](https://code.tutsplus.com/make-a-neon-vector-shooter-in-xna-bloom-and-black-holes--gamedev-9877t)
- [Envato Tuts+: Neon Vector Shooter - The Warping Grid](https://code.tutsplus.com/make-a-neon-vector-shooter-in-xna-the-warping-grid--gamedev-9904t)
- [Geometry Wars Wiki: Fandom](https://geometry-wars.fandom.com/wiki/Geometry_Wars_3:_Dimensions_Evolved)
- [Geometry Wars Wiki: Enemy Category](https://geometry-wars.fandom.com/wiki/Category:Enemies)
- [Geometry Wars Wiki: Grunt](https://geometry-wars.fandom.com/wiki/Grunt)
- [Geometry Wars Wiki: Wanderer](https://geometry-wars.fandom.com/wiki/Wanderer)
- [Geometry Wars Wiki: Weaver](https://geometry-wars.fandom.com/wiki/Weaver)
- [Geometry Wars Wiki: Drone](https://geometry-wars.fandom.com/wiki/Drone)
- [Geometry Wars Wiki: Boss](https://geometry-wars.fandom.com/wiki/Boss)
- [Wikipedia: Geometry Wars 3: Dimensions](https://en.wikipedia.org/wiki/Geometry_Wars_3:_Dimensions)
- [PCGamingWiki: GW3 Dimensions Evolved](https://www.pcgamingwiki.com/wiki/Geometry_Wars_3:_Dimensions_Evolved)
- [Envato Tuts+: Neon Vector Shooter - Particle Effects](https://code.tutsplus.com/make-a-neon-vector-shooter-in-xna-particle-effects--gamedev-10111t)
- [Windows Central: Interview with Lucid Games co-founder](https://www.windowscentral.com/we-chat-co-founder-lucid-games-about-geometry-wars-3-dimensions)
- [Geometry Wars Wiki: Super State](https://geometry-wars.fandom.com/wiki/Super_State)
- [Geometry Wars Wiki: Super](https://geometry-wars.fandom.com/wiki/Super)
- [Geometry Wars Wiki: Geoms](https://geometry-wars.fandom.com/wiki/Geoms)
- [Steam Community: Comprehensive Enemy Guide (2021)](https://steamcommunity.com/sharedfiles/filedetails/?id=2553017498)
- [GameDev.net: Geometry Wars Pixel Shaders](https://www.gamedev.net/forums/topic/414082-geometry-wars-pixel-shaders/414082/)
- [LearnOpenGL: Bloom](https://learnopengl.com/Advanced-Lighting/Bloom)
- [LearnOpenGL: Physically Based Bloom](https://learnopengl.com/Guest-Articles/2022/Phys.-Based-Bloom)
- [Three.js Forum: Wireframe Glow Model](https://discourse.threejs.org/t/wireframe-glow-model/42289)
- [Construct 2 Forum: Geometry Wars Style Glow](https://www.construct.net/en/forum/construct-2/how-do-i-18/geometry-wars-style-glow-95943)

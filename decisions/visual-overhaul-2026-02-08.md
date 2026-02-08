## 2026-02-08 - Visual Effects Overhaul

**Context:** Multiple visual improvements requested: score popups, geom spawning, particle counts, bloom, vignette.

**Changes Made:**

### Score Popups (BF3-style)
- Canvas 128x48 (was 256x128), font 28px (was 48px)
- Scale range 0.25-0.4 (was 0.4-1.0)
- Purely upward drift (was random sideways)
- Lifetime 0.7s (was 1.0s)
- Cleaner fade: quick in, steady, quick out

### Geom Spawning
- Spawn exactly at kill position (removed UV scatter)
- Added burst velocity with random direction + friction deceleration (0.92/frame)
- Magnetic pull delayed 0.3s to let burst settle

### Particle System
- Pool increased to 10,000 particles + 400 fragments (was 5,000 + 200)
- Enemy death: 40-60 fragments + 48 particles + 8 white flash (was 20-32 + 12)
- Player death: 130 fragments + 210 particles (was 55 + 55) - 10x enemy death
- Bullet impact: 15 particles (was 6)

### Bloom Settings
- Threshold lowered to 0.3 (was 0.85) - more entities glow
- Strength increased to 1.5 (was 1.0) - stronger neon
- Radius to 0.5 (was 0.4) - wider glow halos

### Vignette
- Added custom shader vignette pass to post-processing stack
- Darkness: 1.2, Offset: 1.0 (subtle screen-edge darkening)

### Effects Demo Panel
- New EffectsPanel.ts: press G to toggle real-time effects controls
- Sliders for bloom strength/threshold/radius and vignette darkness
- Allows live tweaking without code changes

**Decision:** Particle counts are 50-70% of GW3D reference values rather than 100% because:
1. Three.js is less performant than XNA/DirectX for particles
2. Browser has more overhead
3. Can be tuned higher once performance is validated

**Reversibility:** Easy - all changes are in ParticleSystem.ts, Game.ts (bloom), main.ts (bloom config)

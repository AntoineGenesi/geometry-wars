# Geometry Wars 3D Dimensions - Browser Recreation

Browser-based 3D arcade shooter inspired by Geometry Wars 3: Dimensions. Built with Three.js, TypeScript, and Vite.

Core experience: you're on a couch with friends, you say "pull out your phone, go to this URL" and everyone is immediately playing together. No downloads, no installs, no accounts.

## Tech Stack

- Three.js ^0.170 (3D rendering, bloom, GPU particles), WebGPU with WebGL2 fallback
- TypeScript 5.7 + Vite 6 (build tooling)
- three-mesh-bvh (BVH-accelerated surface walking)
- Colyseus ^0.15 (network multiplayer, server-authoritative)
- Rapier.js WASM (physics)
- Web Audio API (procedural synth audio)
- Node 20+ required (20.19.5 via nvm)

## Quick Start

```bash
npm install
npm run dev
```

Open http://localhost:3000

## Game Modes

| Mode | URL | Notes |
|------|-----|-------|
| Single player | http://localhost:3000 | Default mode |
| Local co-op | http://localhost:3000?mode=multiplayer | 2-player same screen |
| LAN multiplayer | Start menu > LAN > Host Game | Up to 4 players, same WiFi |
| Network multiplayer | http://localhost:3000?mode=network | Up to 4 players, needs server |

### LAN Multiplayer

1. Run `npm run dev`
2. Click **LAN** in the start menu, then **HOST GAME**
3. Share the displayed URL with friends on the same WiFi
4. Click **ENTER GAME** to join your own server

### Network Multiplayer

```bash
npm run server    # Colyseus on port 2567
```

Then open http://localhost:3000?mode=network (or `?mode=network&server=ws://hostname:2567` for remote).

## Controls

| Action | Single Player | P1 (Co-op) | P2 (Co-op) |
|--------|--------------|-------------|-------------|
| Move | WASD | WASD | IJKL |
| Aim | Mouse | Mouse | Auto-aim |
| Shoot | Click | Click | O |
| Bomb | Space | Space | P |
| Pause | ESC | ESC | - |
| Mute | M | M | - |
| Debug overlay | F3 | F3 | - |

## Surface Shapes (12)

sphere, cube, pill, pipe, torus, peanut, capsule, icosahedron, mobius, sphere-tunnel, cube-ring, cube-tunnel

## Features

- **Surfaces**: 12 built-in surfaces + **custom map loading** (OBJ, GLB, GLTF — load your own 3D models!)
- **Enemies**: 30 enemy types with 5-tier difficulty scaling (Normal to Nightmare)
- **Weapons**: 10 weapon types (Standard, Spread, Piercing, ChainLightning, Homing, PlasmaMortar, GravityGun, LaserBeam, BlackHole, TeslaCoil)
- **Super states**: 7 types (QuadFire, SplitFire, ReverseFire, Missile, Magnet, TrailBomb, Shield)
- **Buffs**: 8 buff types with visual auras and pickup system
- **Companions**: SurfaceAgent system with composable behaviors (Idle, MoveTo, Follow, Orbit, Patrol)
- **Multiplayer**: Local co-op + LAN via Colyseus with interest management, kill attribution, and proximity aura buffs
- **Effects**: GPU particle system (5000 pool), screen shake, trails, glow, chain lightning, score popups
- **Audio**: SoundEngine (11 procedural synth sounds) + BackgroundMusic (4 presets, 128bpm procedural beat)
- **UI**: Start menu, weapon wiki + playground, settings, kill log, minimap, pause menu with stats, debug overlay (F3)
- **Performance**: Zero-allocation update loops, InstancedMesh batching, 3-level LOD, adaptive quality targeting 60fps

## Architecture

- **Core engine**: Game.ts loop, Entity base class, EntityManager, GameClock, DifficultyScaling
- **Surface system**: 12 UV-parameterized surfaces + MeshSurface (BVH) for mesh-agnostic walking
- **Movement**: Player and bullets use MeshWalker (geodesic face walking); enemies use UV bridge
- **Enemies**: 30 types managed by EnemySpawner with 5-tier difficulty scaling
- **Weapons**: 10 weapon types + WeaponManager + timed pickups + super states
- **Multiplayer**: Local co-op + Colyseus network; kill attribution + proximity aura buffs + interest management
- **Effects**: GPU particle system, screen shake, trails, glow, chain lightning, score popups, ally glow
- **Audio**: SoundEngine (11 procedural synth sounds) + BackgroundMusic (128bpm procedural beat)
- **Rendering**: InstancedMesh enemies + bullets, LOD system, adaptive quality, WebGPU with WebGL2 fallback, depth opacity

## Directory Structure

```
src/           Source code (core/, entities/, surfaces/, weapons/, effects/, audio/, ui/, input/, etc.)
server/        Colyseus multiplayer server + InterestManager + PriorityQueue
decisions/     Architectural decision records
research/      Game research data, surface movement analysis, market research
docs/          Architecture docs, multiplayer docs, WebRTC migration plan
tasks/         Task tracking files with full context
reports/       Interactive HTML reports and presentations
```

## Tests

```bash
npm test            # 1270+ vitest tests (26 files)
npm run test:visual # Puppeteer visual regression tests
npm run test:lan    # Programmatic LAN multiplayer tests
```

## Documentation

- `docs/ARCHITECTURE.md` - System architecture overview
- `docs/CUSTOM_MAPS.md` - **User guide: how to load custom 3D models**
- `docs/DEV_CUSTOM_MESHES.md` - **Developer guide: custom mesh system architecture and extension**
- `docs/MULTIPLAYER.md` - Multiplayer modes and controls
- `docs/lan-multiplayer-architecture.md` - Detailed LAN/network architecture
- `docs/webrtc-migration-plan.md` - WebRTC migration research
- `decisions/` - All architectural decision records

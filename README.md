# Geometry Wars 3D Dimensions - Browser Recreation

Browser recreation of Geometry Wars 3: Dimensions using Three.js, TypeScript, and Vite.

## Tech Stack

- Three.js ^0.170 (3D rendering, bloom, GPU particles)
- TypeScript 5.7 + Vite 6 (build tooling)
- three-mesh-bvh (BVH-accelerated surface walking)
- Colyseus ^0.15 (network multiplayer)
- Web Audio API (procedural synth audio)
- Node 20+ required

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
| Local multiplayer | http://localhost:3000?mode=multiplayer | 2-player splitscreen |
| Network multiplayer | http://localhost:3000?mode=network | Up to 4 players |
| Mesh test scene | http://localhost:3000/mesh-test.html?shape=torus | Surface testing |

For network multiplayer, start the server first:

```bash
npm run server    # Colyseus on port 2567
```

Then open http://localhost:3000?mode=network (or `?mode=network&server=ws://hostname:2567` for remote).

## Controls

| Action | Single Player | P1 (Local MP) | P2 (Local MP) |
|--------|--------------|----------------|----------------|
| Move | WASD | WASD | IJKL |
| Aim | Mouse | Mouse | Auto-aim |
| Shoot | Click | Click | O |
| Bomb | Space | Space | P |
| Pause | ESC | ESC | - |
| Mute | M | M | - |

Additional keys: 1-5 switch surface shape, L toggles debug lines.

## Surface Shapes

sphere, cube, cylinder, torus, peanut, capsule, icosahedron, mobius, dented-sphere, sphere-tunnel

## Custom Meshes

Drag and drop an OBJ, GLB, or GLTF file onto `mesh-test.html`, or load via URL:

```
http://localhost:3000/mesh-test.html?shape=custom&url=path/to/model.glb
```

## Architecture

- **Core engine**: Game.ts loop, Entity base class, EntityManager, GameClock
- **Surface system**: 10 UV-parameterized surfaces + MeshSurface (BVH) for mesh-agnostic walking
- **Movement**: Player and bullets use MeshWalker (BVH raycasting); enemies use UV bridge
- **Enemies**: 15 types (Grunt, Weaver, Snake, Spinner, Boss, etc.) managed by EnemySpawner
- **Weapons**: 10 weapon types + WeaponManager + timed pickups
- **Drones**: 6 types (Attack, Collect, Defend, Ram, Snipe, Sweep) via DroneFactory
- **Supers**: 7 super states (QuadFire, SplitFire, ReverseFire, Missile, Magnet, TrailBomb, Shield)
- **Multiplayer**: Local splitscreen + Colyseus network; kill attribution + proximity aura buffs
- **Effects**: GPU particle system (5000), screen shake, trails, glow, chain lightning
- **Audio**: SoundEngine (11 procedural synth sounds) + BackgroundMusic (128bpm procedural beat)

## Directory Structure

```
src/           Source code (core/, entities/, surfaces/, weapons/, effects/, audio/, ui/, input/)
server/        Colyseus multiplayer server
decisions/     Architectural decision records
research/      GW3D research data and surface movement analysis
docs/          Additional documentation
```

## Tests

```bash
npm test       # 39 tests (24 MeshSurface + 15 MeshLoader)
```

## Architectural Decisions

See the `decisions/` folder for logged decisions on mesh movement integration, gameplay balance, enemy migration strategy, and more.

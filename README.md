# Geometry Wars 3D

**Play it now:** https://antoinegenesi.github.io/geometry-wars/

Geometry Wars 3D is an ambitious browser arcade-shooter prototype built with
Three.js, TypeScript, Vite, and Colyseus. The core idea is simple: take the
flat twin-stick shooter feel and put it on strange 3D surfaces: spheres, cubes,
tunnels, toruses, peanuts, Mobius strips, and imported meshes.

It is playable, technical, and weird in the best way. It is also a prototype,
not a polished commercial release.

## What It Is

- A no-install browser game with single-player and LAN multiplayer modes.
- A curved-surface shooter where movement, bullets, enemies, pickups, and zones
  are projected onto 3D battlefields.
- A large gameplay experiment with weapon mastery, enemy variety, custom maps,
  visual styles, performance telemetry, and a lot of regression harnesses.
- A codebase that was mostly built during a heavy February/March 2026 AI-agent
  development push, then substantially repaired and packaged again in late
  July/August 2026.

This project is inspired by the Geometry Wars style of arcade combat. It is not
affiliated with or endorsed by the original Geometry Wars rights holders.

## What Is Cool About It

- **Curved battlefields:** sphere, cube, pill, pipe, torus, peanut, capsule,
  icosahedron, Mobius, sphere tunnel, cube ring, and cube tunnel maps.
- **Custom maps:** OBJ, GLB, and GLTF meshes can be loaded as playable surfaces,
  with BVH-backed surface walking.
- **LAN multiplayer:** a Colyseus server path supports local network play,
  lobby hosting, QR/link joining, PvP, PvPvE, co-op-style modes, kill credit,
  assists, and shared pressure.
- **Weapons:** blaster, spread shot, piercing beam, chain lightning, homing
  missiles, plasma mortar, gravity gun, laser beam, black hole, and Tesla coil.
- **Weapon mastery:** persistent mastery points and in-match upgrade activation
  let weapons grow over time without simply handing every upgrade to the player.
- **Enemy variety:** 40+ enemy identifiers including snakes, titans, giants,
  bosses, splitters, phasers, lancers, sentinels, stealth enemies, and fractal
  variants.
- **Readable meta systems:** enemy compendium, weapon wiki/playground,
  post-game stats, score graphs, kill streaks, settings, localisation, and HUD
  visibility controls.
- **Rendering work:** WebGPU/WebGL2 paths, bloom, instanced enemy rendering,
  surface opacity/dimming work, particles, trails, shockwaves, and visual style
  presets.
- **Instrumentation:** performance logging, DDA telemetry, visual regression
  scripts, LAN/MP harnesses, and many focused tests.

## What It Does Well

The strongest part of the project is the amount of real game surface area it
tries to make playable at once. The game is not just a menu mockup or a single
arena demo: there are many maps, many enemy types, real weapons, persistent
progression, live settings, post-game screens, and multiplayer machinery.

The other strong part is the verification culture that grew around it. There
are unit tests, integration-ish tests, visual checks, performance probes,
network harnesses, and task/review records. A lot of the code exists because a
bug was seen in real play and then turned into a reusable proof.

## What It Struggles With

This is still a prototype with rough edges:

- **Single-player and multiplayer parity is hard.** They share many concepts,
  but they do not run through one perfectly unified gameplay loop. Some fixes
  have historically landed in one mode before the other.
- **LAN multiplayer is inherently fiddly.** Same-WiFi play can be affected by
  firewall rules, WSL networking, host IP selection, browser permissions, and
  server lifecycle issues.
- **Curved-surface gameplay is fragile.** Pole crossings, tunnels, Mobius-like
  surfaces, custom meshes, hit detection, camera smoothing, and render layering
  all create edge cases that flat arena games avoid.
- **Renderer behavior varies.** WebGPU, WebGL2, mobile browsers, headless test
  browsers, and desktop GPUs do not always expose the same bugs.
- **The project has history.** Some docs and old task files are historical
  rather than current. The active game is in `src/`, `server/`, and the current
  README/docs, not every old workflow note.
- **Balance is not final.** DDA, enemy mixes, weapon power, mastery pacing, and
  multiplayer pressure have all been actively tuned and may still feel uneven.

## Quick Start

Requires Node 20+.

```bash
npm install
npm run dev
```

Open:

```text
http://localhost:3000
```

## Controls

| Action | Input |
| --- | --- |
| Move | WASD |
| Aim | Mouse |
| Shoot | Mouse click / hold where supported |
| Bomb | Space |
| Pause | Esc |
| Mute | M |
| Debug overlay | F3 |

## LAN Multiplayer

For local development:

```bash
npm run dev
```

Then use the in-game LAN menu to host a game. Players need to be on the same
Wi-Fi/LAN as the host.

For server-only testing:

```bash
npm run server
```

The LAN host flow is meant for the downloadable/source version of the project.
Static web hosting can run the browser game, but it cannot host the local
Colyseus LAN server by itself.

## Windows Launchers And Repo Structure

The root `.bat` files are convenience launchers for playing from Windows:

- `WINDOWS-SETUP.bat` installs/checks Windows Node.js and dependencies.
- `Play Game.bat` starts the Colyseus server on `2567`, Vite on `3000`, opens
  the browser, and tries to prepare firewall/LAN access.
- `Play Game Debug.bat` is a wrapper that keeps the terminal open while
  diagnosing launcher crashes.
- `Stop Game.bat` stops leftover Node/Vite/Colyseus processes on the game
  ports.
- `Setup-WSL-LAN.bat` is only for forwarding WSL2 dev servers to Windows LAN
  devices. Do not use it with `Play Game.bat`; stale portproxy rules can break
  the Windows launcher path.

This repository also contains development history and agent-orchestration
material. Public/game code is mainly in `src/`, `server/`, `public/`, `docs/`,
`decisions/`, and `tests/`. Private development checkouts may also contain
`AGENTS.md`, `CODEX-ORCHESTRATION.md`, `codex/`, `tasks/`, `inbox/`,
`.claude/`, logs, reports, worker notes, and review artifacts. Those files are
for coordinating and auditing AI-agent development, not for running the game.

See [Project Structure And Workflow](docs/project-structure-and-workflow.md)
for the fuller explanation.

## Static Build

Build a static package:

```bash
npm run build -- --base=./
```

The output goes to:

```text
dist/
```

That folder can be uploaded to a static host for browser play. LAN hosting still
requires running the local source/dev server path.

## Useful Scripts

```bash
npm test
npm run test:visual
npm run test:enemy-visibility
npm run test:lan
npm run test:mp
npm run build -- --base=./
```

The full test surface is uneven: some focused harnesses are more reliable than
others. For release packaging, the important gate is that the static build
command passes from a clean checkout.

## Project Layout

```text
src/       Browser game code: gameplay, surfaces, weapons, UI, rendering, tests
server/    Colyseus LAN multiplayer server and authoritative room logic
public/    Static assets, sample meshes, flags, screenshots
docs/      Public-facing docs, architecture notes, troubleshooting, guides
decisions/ Historical architecture notes and development records
tests/     Visual, LAN, multiplayer, and surface verification harnesses
```

Private AI-agent orchestration/task files may exist in the development repo, but
they are not required to play or build the game. Public sanitized exports remove
that private workflow material while keeping the committed game code and branch
history.

## Development History

The bulk of the original project work happened in February and March 2026.
There was another major repair, balance, verification, and packaging wave in
late July and August 2026. That history matters because the game accumulated a
lot of systems quickly, then spent a lot of time paying down regressions across
single-player, multiplayer, rendering, and mobile/LAN behavior.

## Current Status

Playable prototype. Interesting enough to try, large enough to learn from, and
rough enough that you should expect bugs.

The game is best judged by running it and playing a few surfaces rather than by
assuming every documented feature is equally polished.

# Documentation Index — Where to Find What

> One-stop guide for navigating Geometry Wars 3D documentation.

---

## Quick Start

| Question | Answer |
|----------|--------|
| What is this project? | `README.md` (root) |
| How do I run it? | `CLAUDE.md` → Build / Run section |
| What's the current task backlog? | `TODO.md` |
| What's the project architecture? | `PROJECT.md` (authoritative source) |
| What rules govern this codebase? | `CLAUDE.md` + `.claude/rules/*.md` |

---

## I want to understand...

### The Multiplayer Architecture
1. `docs/MP-ARCHITECTURE.md` — Why MP ≠ SP, code path differences, entry points
2. `docs/mp-architecture-audit.md` — Deep audit (S43-09): current state of MP vs SP parity, gap analysis
3. `decisions/lan-deep-audit-2026-02-11.md` — LAN architecture analysis
4. `decisions/lan-comprehensive-fix-2026-02-11.md` — What was fixed and why

### Movement on Curved Surfaces
1. `decisions/geodesic-face-walking-2026-02-07.md` — Face-walker design (geodesic great circles)
2. `decisions/tangent-frame-dual-gram-schmidt.md` — Tangent frame continuity fix (pole crossing)
3. `decisions/torus-tangent-frame-fix.md` — Torus-specific fix
4. `decisions/surface-movement-fixes-2026-02-07.md` — General surface movement fixes

### Enemy AI & Rendering
1. `decisions/enemy-meshwalker-migration.md` — How enemies walk on surfaces
2. `decisions/instanced-enemy-rendering-2026-02-09.md` — GPU instanced rendering decision
3. `decisions/enemy-difficulty-scaling-2026-02-09.md` — Difficulty scaling system

### The Weapon Mastery System
1. `decisions/buff-system-implementation.md` — Buff pickup architecture
2. `decisions/buff-upgrade-system-design.md` — Full upgrade tree design
3. `decisions/gameplay-balance.md` — Balance decisions

### LAN Troubleshooting
1. `docs/LAN-TROUBLESHOOTING.md` — End-user troubleshooting guide
2. `decisions/lan-connectivity-wsl2-2026-02-21.md` — WSL2 LAN connection issues
3. `decisions/lan-lag-out-fix-2026-02-10.md` — Lag-out fix analysis

### Performance
1. `decisions/instanced-enemy-rendering-2026-02-09.md` — GPU instancing (draw call reduction)
2. `decisions/collision-optimization-2026-02-10.md` — SpatialHash collision system
3. `decisions/opacity-audit-2026-02-10.md` — Opacity/LOD rendering audit
4. `docs/performance-graphs-integration.md` — In-game performance graphs

### Camera System
1. `decisions/camera-relative-movement-fix.md` — Camera-relative input fix
2. `decisions/gameinstance-refactor-2026-02-17.md` — GameInstance refactor (PlaygroundGame unification)

### Why did a regression keep happening?
1. `decisions/recurring-regressions-analysis.md` — Root cause analysis of repeated regressions
2. `.claude/docs/regression-rules.md` — Rules to prevent future regressions
3. `decisions/playground-spinning-fix.md` — Playground spinning camera fix (fixed 3 times!)

### Custom Maps / Surfaces
1. `docs/CUSTOM_MAPS.md` — Adding new map surfaces
2. `docs/DEV_CUSTOM_MESHES.md` — Loading arbitrary .glb meshes
3. `decisions/arbitrary-mesh-loading.md` — Mesh loading decision

### Analytics / Telemetry
1. `docs/analytics-guide.md` — Analytics system overview
2. `docs/telemetry-schema.md` — DDA telemetry schema

---

## Testing

| Goal | Where to look |
|------|--------------|
| Manual testing after a fix | `docs/HUMAN_TEST.md` — has checkboxes for each fix |
| Unit/integration tests | `tests/` directory |
| Visual regression tests | `npm run test:visual` (Puppeteer) |
| Debugging frame-by-frame | `docs/testing/frame-by-frame-diagnostics.md` |

---

## Current Active Work

- Active tasks: `tasks/README.md`
- Task backlog: `TODO.md`
- Session state: `.claude/state/pipeline-state.md`

---

## Where Decisions Live

`decisions/` contains ~47 files with architectural reasoning. Key ones:

| Topic | File |
|-------|------|
| Geodesic movement | `geodesic-face-walking-2026-02-07.md` |
| Half-edge mesh | `HalfEdgeMesh` (see ARCHITECTURE.md) |
| Tangent frame fix | `tangent-frame-dual-gram-schmidt.md` |
| GPU instancing | `instanced-enemy-rendering-2026-02-09.md` |
| Collision system | `collision-optimization-2026-02-10.md` |
| Bloom masking | `selective-bloom-masking-2026-02-19.md` |
| MP rebuild plan | `mp-rebuild-s42-plan.md` |
| False claim hooks | `false-claim-hooks-2026-02-10.md` — critical gotcha |

---

## AI-Focused Docs (for Claude sessions)

Located in `.claude/docs/`:
- `orchestration.md` — How the pipeline orchestration system works
- `regression-rules.md` — Regression prevention patterns
- `system-operations-log.md` — Session history, failure catalog, what worked/didn't

---

## Archive

Older files that have been superseded but preserved for reference:
- `archive/tasks/` — Completed task files from sessions 1–42
- `archive/decisions/` — Superseded decision logs
- `archive/docs/` — Archived docs (superseded or research-only)
- `archive/session-docs/` — Session execution plans and triage summaries
- `archive/inbox/` — Old voice dump files

---

## File Location Quick Reference

```
Root
├── CLAUDE.md          — Agent rules, workflow, protocols
├── PROJECT.md         — Architecture, current state, gotchas
├── TODO.md            — Active task backlog
├── COMPLETED-TASKS.md — Historical task archive (session summaries)
├── DISCOVERIES.md     — Tech debt and discoveries found along the way
│
├── docs/              — Human-readable guides
│   ├── INDEX.md       — This file
│   ├── ARCHITECTURE.md
│   ├── MP-ARCHITECTURE.md
│   ├── mp-architecture-audit.md   (S43-09 deep audit)
│   ├── HUMAN_TEST.md  — Manual test checklist
│   └── ...
│
├── decisions/         — Engineering decision logs
├── tasks/             — Active tasks (current + recent sessions)
├── archive/           — Superseded/completed files
│
└── .claude/
    ├── rules/         — Agent rules (merge protocol, verification, etc.)
    ├── docs/          — AI-focused technical docs
    ├── agents/        — Agent prompt templates
    ├── commands/      — Slash commands (/inbox, /verify, /wrap-up)
    └── state/         — Pipeline state, agent registry
```

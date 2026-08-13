# Project Structure And Workflow

This project has two overlapping identities:

1. A playable browser game.
2. A heavily agent-assisted development repo with a lot of preserved task,
   review, workflow, and debugging history.

The game can be played and built without understanding the agent workflow. The
workflow files explain how the project was coordinated, verified, repaired, and
eventually sanitized for public GitHub export.

## Runtime Entry Points

The main game paths are:

```text
src/main.ts             Single-player browser entry
src/core/GameLoop.ts    Single-player runtime loop
src/multiplayer-main.ts LAN/multiplayer lobby entry
src/network-main.ts     Multiplayer browser runtime
server/index.ts         Colyseus server process
server/rooms/GameRoom.ts Server-authoritative multiplayer room
```

Static browser builds are produced from the Vite app:

```bash
npm run build -- --base=./
```

That emits `dist/`, which can be uploaded to static hosting for browser play.
Static hosting does not run the local Colyseus LAN server; LAN hosting is a
source/dev-server feature.

## Windows Batch Files

The root `.bat` files exist because this project is often played from Windows,
while a lot of development happens from WSL.

### `WINDOWS-SETUP.bat`

Installs or checks Windows Node.js and runs dependency setup. Use it when a
Windows machine has not run the project before.

### `Play Game.bat`

The normal Windows launcher. It:

- changes into the project directory;
- checks Node.js and `node_modules`;
- fixes Windows-native npm binaries if dependencies were installed from WSL;
- clears stale WSL2 portproxy rules when run as Administrator;
- creates firewall rules for ports `3000` and `2567`;
- starts the Colyseus server in a separate terminal on port `2567`;
- starts Vite on port `3000`;
- opens `http://localhost:3000`.

Run it as Administrator when LAN play matters, because firewall and portproxy
cleanup require elevated permissions.

### `Play Game Debug.bat`

A diagnostic wrapper for `Play Game.bat`. It prints basic environment checks and
keeps the terminal open so launcher failures are visible.

### `Stop Game.bat`

Stops processes occupying the game ports:

```text
3000  Vite/browser game server
2567  Colyseus multiplayer server
```

It may force-kill `node.exe` if the ports stay occupied.

### `Setup-WSL-LAN.bat`

Sets Windows portproxy rules so LAN devices can reach a game server running
inside WSL2.

Use this only when you deliberately run `npm run dev` from WSL2 and need other
devices on the LAN to connect through Windows. Do not use it with
`Play Game.bat`, because `Play Game.bat` runs the servers on Windows directly.
Stale WSL2 portproxy rules can redirect traffic away from the Windows servers.

## Public Game Directories

These directories are relevant to normal contributors and public builds:

```text
src/       Browser gameplay, rendering, UI, input, surfaces, weapons, tests
server/    Colyseus server, schemas, multiplayer room logic, server movement
public/    Static assets, sample meshes, flags, screenshots, sounds
docs/      Public documentation, architecture notes, guides, troubleshooting
decisions/ Historical design notes and architecture records
tests/     Visual, LAN, multiplayer, and surface verification harnesses
```

Some docs are historical. If a doc contradicts the current code or README,
verify against `src/`, `server/`, `package.json`, and current tests.

## Private Development And Agent Orchestration

In the private development repo, additional directories and files may exist:

```text
AGENTS.md                 Current Codex operating instructions
CODEX-ORCHESTRATION.md    Current FSM/coordinator workflow
codex/                    Codex task state, scripts, reviews, docs, artifacts
tasks/                    Task files with raw user requirements and evidence
inbox/                    Intake notes and backlog material
.claude/                  Older Claude-era workflow, logs, locks, prompts
logs/                     Runtime/performance/debug logs
reports/                  Proof artifacts, screenshots, HTML reports
.private/                 Recovery snapshots and private local evidence
```

These files are part of the private development record. They are useful for
understanding how bugs were investigated and why certain fixes exist, but they
are not required for normal play.

The current workflow is:

- The main agent acts as coordinator for non-trivial product work.
- Work is decomposed into task files when needed.
- Implementers work in isolated branches/worktrees.
- Reviewers independently verify the branch against the task.
- The coordinator merges, runs post-merge proof, records evidence, and cleans
  temporary worktrees.

Older `.claude/` workflow material is kept as historical evidence. Current
Codex workflow lives in `AGENTS.md`, `CODEX-ORCHESTRATION.md`, and `codex/`.

## Sanitized Public Repo Export

The private repo can generate a public GitHub-ready mirror. The export keeps
committed game code, branches, tags, docs, tests, and assets, but strips private
agentic material such as:

```text
AGENTS.md
CODEX-ORCHESTRATION.md
CLAUDE.md
codex/
tasks/
inbox/
.claude/
.codex/
.agents/
.private/
logs/
reports/
```

The export also applies a conservative profanity-cleaning pass to public
history and runs a build in the sanitized checkout. The intended result is a
public repo that still preserves real branch history and code evolution without
publishing the private task inbox, raw agent logs, or orchestration records.

In the private repo, the repeatable export script is:

```bash
codex/scripts/export-public-github-repo.sh --checkout --build
```

That script is private workflow tooling and is removed from the public export.

## Development History

The repo's commit history shows the densest original build-out in February and
March 2026. A later July/August 2026 wave focused on bug repair, multiplayer
parity, mobile/LAN behavior, weapon mastery, static hosting, and public repo
sanitization.

That explains the shape of the project: it has a surprisingly large amount of
game content and verification infrastructure, but also a long tail of edge
cases from trying to make curved-surface single-player, multiplayer, rendering,
and mobile browser behavior all line up.

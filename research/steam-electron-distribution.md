# Steam & Desktop Distribution: Electron, WebRTC, and Dual Architecture

**Date:** 2026-02-10
**Context:** Geometry Wars 3D browser game (Three.js + TypeScript + Vite + Colyseus) exploring desktop distribution via Steam and other platforms.

**Related Research:**
- [WebRTC Migration Plan](../docs/webrtc-migration-plan.md) -- Detailed WebRTC architecture, code examples, migration phases
- [Geckos.io / WebRTC Research](./geckos-webrtc-research.md) -- Library comparison, performance data
- [Release Strategy](./release-strategy.md) -- Marketing, launch timing, revenue expectations
- [Web vs Engines](./web-vs-engines-research.md) -- Why browser stack is optimal for this project

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Electron for Steam](#2-electron-for-steam)
3. [NW.js and Tauri Alternatives](#3-nwjs-and-tauri-alternatives)
4. [Serverless LAN via WebRTC](#4-serverless-lan-via-webrtc)
5. [Dual Architecture (Browser + Desktop)](#5-dual-architecture-browser--desktop)
6. [What Steam Expects](#6-what-steam-expects)
7. [Build Pipeline](#7-build-pipeline)
8. [Real-World Examples](#8-real-world-examples)
9. [Recommended Architecture](#9-recommended-architecture)
10. [Concrete Next Steps](#10-concrete-next-steps)
11. [Sources](#11-sources)

---

## 1. Executive Summary

### Feasibility Answers

| Question | Answer | Effort |
|----------|--------|--------|
| Can we wrap the Vite+Three.js game in Electron for Steam? | **YES** -- straightforward | 2-3 days |
| Can LAN work without a dedicated server (WebRTC P2P)? | **YES** -- one player becomes host | 6-9 days (see WebRTC migration plan) |
| Can we maintain both browser and desktop from one codebase? | **YES** -- shared game code, different entry points | 1-2 days extra setup |
| Does Steam accept Electron apps? | **YES** -- 5,700+ NW.js games, growing Electron count | N/A |
| Can Electron bundle Node.js so users don't need it? | **YES** -- Electron includes Chromium + Node.js | N/A |
| Can we embed the Colyseus server in the desktop app? | **YES** -- via child_process.fork() or utility process | 1 day |

### Recommended Path

**Phase 1 (Immediate):** Wrap in Electron with embedded Colyseus server for LAN. This gives a working Steam-ready build in 2-3 days.

**Phase 2 (Later):** Migrate LAN networking to WebRTC P2P (per the existing WebRTC migration plan). This eliminates the server process for LAN games and enables NAT traversal for internet play.

**Phase 3 (Optional):** Evaluate Tauri as a lighter alternative (10 MB vs 150 MB bundle) once Tauri's Steam overlay support matures.

---

## 2. Electron for Steam

### 2.1 How to Wrap a Vite + Three.js Game in Electron

The process is straightforward. Electron is essentially Chromium + Node.js in a desktop wrapper. Your Vite-built game (HTML + JS + CSS) loads into Electron's `BrowserWindow` exactly like it loads in a browser.

**Development mode:** Electron loads your Vite dev server URL (`http://localhost:3000`).
**Production mode:** Electron loads the built `dist/index.html` file from disk.

#### Electron Main Process (electron/main.ts)

```typescript
import { app, BrowserWindow } from 'electron';
import path from 'path';

// In production, load the built files. In dev, load the Vite dev server.
const isDev = process.env.NODE_ENV === 'development';

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1920,
    height: 1080,
    fullscreen: false,
    title: 'Geometry Wars 3D',
    icon: path.join(__dirname, '../assets/icon.png'),
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false, // Required for steamworks.js
    },
  });

  // Remove menu bar (game, not an app)
  win.setMenu(null);

  if (isDev) {
    // Load Vite dev server
    win.loadURL('http://localhost:3000');
    win.webContents.openDevTools();
  } else {
    // Load built files
    win.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  // Fullscreen toggle with F11
  win.webContents.on('before-input-event', (_event, input) => {
    if (input.key === 'F11') {
      win.setFullScreen(!win.isFullScreen());
    }
  });
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  app.quit();
});
```

### 2.2 Build Pipeline: Dev Mode vs Production

| Mode | What Happens | Performance |
|------|-------------|-------------|
| **Dev** | Vite dev server + Electron loading localhost:3000 | HMR, fast iteration |
| **Production** | `vite build` creates dist/, Electron loads dist/index.html | Optimized, minified, treeshaken |

```json
// package.json scripts (additions)
{
  "scripts": {
    "dev": "vite",
    "dev:desktop": "concurrently \"vite\" \"wait-on http://localhost:3000 && electron .\"",
    "build": "tsc && vite build",
    "build:desktop": "npm run build && electron-builder",
    "build:desktop:win": "npm run build && electron-builder --win",
    "build:desktop:mac": "npm run build && electron-builder --mac",
    "build:desktop:linux": "npm run build && electron-builder --linux"
  }
}
```

### 2.3 Bundle Size

| Component | Size |
|-----------|------|
| Electron (Chromium + Node.js) | ~120-150 MB |
| Your game code (dist/) | ~2-5 MB |
| Three.js + dependencies | ~2-3 MB (treeshaken) |
| Assets (textures, audio) | ~1-10 MB (depends on assets) |
| steamworks.js native module | ~5 MB |
| **Total Windows .exe** | **~150-180 MB** |
| **Total macOS .app (universal)** | **~200-250 MB** |
| **Total Linux .zip** | **~150-180 MB** |

For context: Vampire Survivors (Electron + Phaser) is ~250 MB on Steam. Most players don't care about download size for a desktop game. A 150 MB download is tiny compared to AAA games (50-100 GB).

### 2.4 Best Build Tools

| Tool | Recommendation | Notes |
|------|---------------|-------|
| **electron-builder** | **Recommended for games** | Most game devs use this. Simple config, handles code signing, ASAR packaging, auto-update. |
| **Electron Forge** | Good alternative | Official Electron team tool. More opinionated, has Vite plugin (experimental as of v7.5.0). |
| **electron-vite** | Good for DX | Vite-native Electron development. Uses electron-builder under the hood. |
| **electron-packager** | Legacy | Simpler but fewer features than electron-builder. |

**Recommendation: Use `electron-builder`** for its maturity, game-dev community adoption, and straightforward configuration. The `electron-vite` project provides good Vite integration but still uses electron-builder for packaging.

### 2.5 electron-builder Configuration

```json
// package.json (build section)
{
  "build": {
    "appId": "com.geometrywars3d.game",
    "productName": "Geometry Wars 3D",
    "directories": {
      "output": "release"
    },
    "files": [
      "dist/**/*",
      "electron/**/*",
      "assets/**/*",
      "steam_appid.txt",
      "!node_modules/**/*",
      "node_modules/steamworks.js/**/*"
    ],
    "asar": true,
    "asarUnpack": [
      "node_modules/steamworks.js/**/*"
    ],
    "win": {
      "target": ["nsis", "portable"],
      "icon": "assets/icon.ico"
    },
    "mac": {
      "target": ["dmg", "zip"],
      "icon": "assets/icon.icns",
      "category": "public.app-category.games"
    },
    "linux": {
      "target": ["AppImage", "zip"],
      "icon": "assets/icon.png",
      "category": "Game"
    },
    "nsis": {
      "oneClick": true,
      "perMachine": false,
      "allowElevation": true
    }
  }
}
```

**Key detail:** `steamworks.js` must be in `asarUnpack` because it contains native `.node` modules that cannot run from inside an ASAR archive.

### 2.6 Electron Bundles Node.js

**YES.** Electron bundles both Chromium and Node.js. End users do not need Node.js installed. The entire runtime is self-contained in the distributable. This is one of Electron's core value propositions.

### 2.7 Electron Dev Setup (electron-vite approach)

For the best development experience with Vite:

```bash
npm install -D electron electron-builder concurrently wait-on
```

Project structure addition:
```
electron/
  main.ts        -- Electron main process
  preload.ts     -- Preload script (if using contextIsolation)
```

---

## 3. NW.js and Tauri Alternatives

### 3.1 NW.js

NW.js (formerly node-webkit) is the veteran option for wrapping web games as desktop apps.

| Aspect | NW.js | Electron |
|--------|-------|----------|
| Games on Steam | **5,700+** | Growing (hundreds) |
| Architecture | Single-context (Node.js in renderer) | Multi-process (main + renderer) |
| Bundle size | ~118-136 MB | ~120-150 MB |
| Node.js access | Direct in frontend code | Via IPC or nodeIntegration |
| Steam overlay | Same issues as Electron | Same issues |
| steamworks.js support | **YES** (officially supported) | **YES** (officially supported) |
| Vite integration | Manual (load built files) | electron-vite, Electron Forge |
| Community/docs | Smaller, game-dev focused | Larger, general-purpose |
| Game Dev Tycoon | Used NW.js | N/A |

**NW.js advantage for games:** Simpler architecture. Node.js is directly available in the renderer process without IPC. For a game that just needs to load HTML/JS and call Steamworks, NW.js is arguably simpler.

**NW.js disadvantage:** Smaller ecosystem, fewer build tools, less tooling for auto-updates. The development experience with Vite is less polished compared to Electron.

**Verdict:** NW.js is a valid choice, especially given its 5,700+ game track record on Steam. However, Electron's larger ecosystem, better Vite integration, and more active development make it the better choice for new projects in 2026.

### 3.2 Tauri

Tauri uses the OS's native WebView (WebView2 on Windows, WebKit on macOS/Linux) instead of bundling Chromium.

| Aspect | Tauri | Electron |
|--------|-------|----------|
| Bundle size | **~5-10 MB** | ~150 MB |
| Memory usage | **~30-40 MB idle** | ~200-300 MB idle |
| Startup time | **< 0.5 sec** | 1-2 sec |
| Steam overlay | **BROKEN** (WebView2 uses separate GPU process) | **BROKEN** (same issue, but workarounds exist) |
| steamworks.js support | **NO** (not officially supported) | YES |
| WebRTC support | Depends on OS WebView | Full (Chromium) |
| WebGL/WebGPU | Depends on OS WebView | Full (Chromium) |
| Graphics performance | **Worse on macOS/Linux** (WebKit < Chromium for WebGL) | Consistent (Chromium everywhere) |
| Backend language | Rust | JavaScript/TypeScript |

**Why NOT Tauri for this project (currently):**

1. **Steam overlay does not work.** This is a fundamental WebView2 limitation -- the Steam overlay hooks into the main process's rendering, but WebView2 uses a separate GPU process. There is no known workaround.
2. **Graphics performance inconsistency.** WebKit web views on macOS and Linux are not as performant as Chromium for WebGL/WebGPU. For a Three.js game with bloom, instanced rendering, and 10K entities, this matters.
3. **No official steamworks.js support.** You would need to use Tauri's Rust backend to call the Steamworks C API, which is more complex.
4. **WebRTC reliability varies by WebView.** Chromium (Electron) has the most battle-tested WebRTC implementation.

**Future consideration:** If Tauri resolves the Steam overlay issue and WebKit performance improves, the 10x smaller bundle size makes it attractive. Monitor this for Phase 3.

### 3.3 Comparison Summary

| Framework | Bundle Size | Steam Overlay | Steamworks | WebGL Perf | Recommendation |
|-----------|-------------|---------------|------------|------------|----------------|
| **Electron** | 150 MB | Partial (workarounds) | YES | Excellent | **USE THIS** |
| **NW.js** | 130 MB | Partial | YES | Excellent | Valid alternative |
| **Tauri** | 10 MB | BROKEN | No official | Inconsistent | Wait for maturity |
| **Neutralinojs** | 5 MB | Unknown | No | Varies | Not for games |

---

## 4. Serverless LAN via WebRTC

### 4.1 The Problem

Currently, LAN multiplayer requires running the Colyseus server (`npm run server` on port 2567). In a desktop distribution:
- Players must either run the server separately (terrible UX)
- Or the app must embed and manage the server process

WebRTC P2P eliminates the server entirely for LAN play.

### 4.2 Can LAN Work Without a Server?

**YES.** WebRTC DataChannels enable direct browser-to-browser (or Electron-to-Electron) communication. One player acts as "host" and runs the game simulation. Other players connect as peers.

**For LAN specifically:** STUN/TURN servers are NOT needed. Peers connect directly via local IP addresses. Signaling can be done via:
- Broadcast/multicast UDP discovery on the local network
- Simple HTTP endpoint on the host
- Manual IP entry (fallback)

### 4.3 Library Recommendations

Based on the [geckos.io research](./geckos-webrtc-research.md), here is the current recommendation:

| Library | Weekly Downloads | Best For | Notes |
|---------|-----------------|----------|-------|
| **simple-peer** | 175K | Maximum control | Lightweight (20 KB), BYO signaling |
| **PeerJS** | 34K | Quick prototype | Free cloud signaling, easy API |
| **Trystero** | Growing | Serverless rooms | Uses BitTorrent/IPFS for signaling |
| **geckos.io** | 642 | Client-server WebRTC | Low maintenance activity -- avoid |
| **Raw RTCPeerConnection** | N/A | Full control | More code, zero dependencies |

**Recommendation:** Use **simple-peer** for the WebRTC transport layer. It provides a clean API over RTCPeerConnection without opinionated abstractions, and has the largest community.

### 4.4 Architecture Change: Host-Client Model

```
CURRENT (Colyseus):
  Dedicated Server (Node.js process)
    |-- WebSocket --> Client A (browser/Electron)
    |-- WebSocket --> Client B (browser/Electron)

NEW (WebRTC P2P):
  Host Player (browser/Electron, runs game simulation)
    |-- DataChannel --> Peer A (browser/Electron)
    |-- DataChannel --> Peer B (browser/Electron)
```

The game simulation code (`GameRoom.ts` tick loop, collision, AI, spawning) runs identically -- it just runs in the host's browser/Electron instead of a separate Node.js process. See [WebRTC Migration Plan](../docs/webrtc-migration-plan.md) for the full architecture, code examples, and migration phases.

### 4.5 Latency: WebSocket vs WebRTC DataChannel

| Metric | WebSocket (Colyseus) | DataChannel (Unreliable) | Improvement |
|--------|---------------------|-------------------------|-------------|
| LAN median | 5-8 ms | 2-4 ms | ~2x |
| Internet median | 30-50 ms | 20-40 ms | ~1.3-1.5x |
| Internet P99 | 80-200 ms (TCP retransmit) | 40-60 ms | **2-4x** |
| Jitter (stddev) | 5-15 ms | 1-3 ms | **3-5x** |

The P99 and jitter improvements are the most impactful for gameplay feel. TCP's head-of-line blocking causes visible hitches; UDP-like DataChannel eliminates them.

### 4.6 Can Colyseus Rooms Work Over WebRTC?

**Partially.** Colyseus supports custom transports. The official options are:
- **WebSocketTransport** (default, TCP)
- **WebTransport** (HTTP/3 + QUIC, UDP-like, experimental)

There is no official WebRTC transport for Colyseus. Creating one is possible but requires implementing the Colyseus Transport interface with WebRTC DataChannels. This is non-trivial and would be a custom integration.

**Better approach:** For P2P mode, bypass Colyseus entirely. Extract the game simulation logic into a transport-agnostic `GameSimulation` class (as described in the WebRTC migration plan), then use WebRTC DataChannels directly for state sync.

Keep Colyseus for dedicated server scenarios (online ranked play, tournaments).

### 4.7 Signaling for LAN Discovery in Desktop App

In a desktop Electron app, LAN discovery is simpler than in a browser:

```typescript
// Option 1: mDNS/Bonjour (Node.js, works in Electron main process)
import bonjour from 'bonjour';
const instance = bonjour();

// Host advertises
instance.publish({ name: 'GeometryWars-GameRoom', type: 'http', port: 9000 });

// Peers discover
instance.find({ type: 'http' }, (service) => {
  if (service.name.startsWith('GeometryWars-')) {
    // Connect to service.host:service.port for signaling
  }
});

// Option 2: Simple HTTP signaling on host
// Host starts a tiny HTTP server for SDP exchange
import express from 'express';
const signalingApp = express();
signalingApp.post('/offer', (req, res) => { /* relay SDP */ });
signalingApp.listen(9000);
// Peers POST to http://<host-ip>:9000/offer

// Option 3: Manual IP entry (always works, no discovery)
// User types host's IP address in the join dialog
```

---

## 5. Dual Architecture (Browser + Desktop)

### 5.1 Can We Maintain Both?

**YES.** The key insight is that 95%+ of the code is shared. Only the entry point and networking layer differ.

### 5.2 What Stays the Same (Shared Code)

Everything in the game logic and rendering pipeline is shared:

- `src/core/` -- Game loop, clock, spatial hash, player leveling
- `src/surfaces/` -- All 10 surface types
- `src/entities/` -- Player, enemies, bullets, companions
- `src/weapons/` -- All weapons, drones, super abilities
- `src/effects/` -- Particles, score popups, screen shake, glow trails
- `src/rendering/` -- InstancedMesh, LOD, adaptive quality, WebGPU
- `src/ui/` -- Start menu, pause menu, weapon wiki, settings
- `src/audio/` -- Sound engine, background music
- `src/input/` -- Input manager (keyboard, mouse, gamepad)
- `src/experimental/mesh-movement/` -- MeshWalker, geodesic face walking

**Total shared:** ~155 of ~160 source files (97%+)

### 5.3 What Changes Per Platform

| Component | Browser Version | Desktop (Electron) Version |
|-----------|----------------|---------------------------|
| **Entry point** | `index.html` + `src/main.ts` | `electron/main.ts` + same `index.html` |
| **Dev server** | `vite dev` | `vite dev` + `electron .` loading localhost |
| **Build** | `vite build` -> static files | `vite build` + `electron-builder` -> .exe/.app |
| **LAN networking** | Colyseus WebSocket | Embedded Colyseus OR WebRTC P2P |
| **Online networking** | Colyseus cloud server | Same Colyseus cloud server |
| **Steam features** | N/A | steamworks.js (achievements, overlay, etc.) |
| **Auto-updates** | Instant (redeploy) | Steam handles updates |
| **LAN discovery** | Vite plugin (HTTP broadcast) | mDNS/Bonjour + HTTP broadcast |

### 5.4 Code Organization for Dual Architecture

```
src/
  core/           -- Shared game logic
  entities/       -- Shared entity code
  ...             -- All shared game code
  network/
    NetworkClient.ts     -- Colyseus client (browser + desktop)
    LANClient.ts         -- LAN discovery (browser)
    WebRTCHost.ts        -- P2P host (future, browser + desktop)
    WebRTCPeer.ts        -- P2P peer (future, browser + desktop)
  platform/
    browser.ts           -- Browser-specific code (if any)
    desktop.ts           -- Desktop-specific code (Steam API wrapper)
  main.ts               -- Browser entry point (existing)
  main-desktop.ts       -- Desktop entry point (new, minimal)

electron/
  main.ts               -- Electron main process
  preload.ts            -- Preload script
  server-process.ts     -- Embedded Colyseus server (child process)

vite.config.ts          -- Existing (serves browser version)
electron-builder.yml    -- Electron build config
```

### 5.5 Shared Networking Layer

The cleanest approach is an abstract network interface:

```typescript
// src/network/NetworkAdapter.ts
interface NetworkAdapter {
  connect(options: ConnectionOptions): Promise<void>;
  disconnect(): void;
  sendInput(input: PlayerInput): void;
  onStateUpdate(callback: (state: GameStateSnapshot) => void): void;
  onEvent(callback: (event: GameEvent) => void): void;
  onDisconnect(callback: (reason: string) => void): void;
}

// Implementations:
// 1. ColyseusAdapter -- wraps existing NetworkClient (browser + desktop with server)
// 2. WebRTCPeerAdapter -- wraps WebRTCPeer (browser + desktop P2P)
// 3. LocalAdapter -- direct in-process (single-player, no network)
```

The game code calls `networkAdapter.sendInput()` and listens to `networkAdapter.onStateUpdate()` without knowing whether it is talking to a Colyseus server, a WebRTC host, or running locally. The adapter is selected at startup based on the game mode.

### 5.6 Feasibility: Shared Codebase with Different Networking Layer

**YES, absolutely feasible.** The networking layer is already isolated in `src/network/`. The game rendering code does not depend on the transport. Adding a `NetworkAdapter` abstraction and an Electron entry point is a clean, low-risk change.

**Estimated effort:** 1-2 days to set up the dual architecture (Electron wrapper + build scripts). The WebRTC migration is a separate, larger effort (6-9 days per the migration plan).

---

## 6. What Steam Expects

### 6.1 Steamworks SDK Integration

To publish on Steam, you need:

1. **Steam developer account** ($100 one-time fee)
2. **Steamworks app ID** (created in Steam partner dashboard)
3. **Steamworks SDK** integration for features:
   - Achievements
   - Leaderboards
   - Cloud saves
   - Overlay
   - Rich presence
   - Workshop (optional, for custom maps)
   - Multiplayer matchmaking (optional)

### 6.2 steamworks.js -- The Recommended Library

**steamworks.js** is the modern, actively maintained library for Electron/NW.js Steam integration. It replaces the older Greenworks.

| Feature | steamworks.js | Greenworks |
|---------|--------------|------------|
| Maintenance | Active (2024-2026) | Abandoned (4+ years) |
| Language | Rust (native addon) | C++ (native addon) |
| TypeScript types | YES | No |
| Build required | **No** (prebuilt binaries) | Yes (must compile) |
| npm install | `npm install steamworks.js` | Manual build |
| Electron support | Official | Community |
| NW.js support | Official | Official |

#### Basic steamworks.js Usage

```typescript
// electron/steam.ts
import steamworks from 'steamworks.js';

// Initialize Steam client (must be called before game starts)
// Use 480 for testing (Spacewar demo app), your real appId for production
const client = steamworks.init(480);

// Get player info
const playerName = client.localplayer.getName();
const steamId = client.localplayer.getSteamId();

// Achievements
function unlockAchievement(id: string): boolean {
  return client.achievement.activate(id);
}

function isAchievementUnlocked(id: string): boolean {
  return client.achievement.isActivated(id);
}

// Leaderboards
async function submitScore(leaderboardName: string, score: number): Promise<void> {
  // steamworks.js leaderboard API
  // (specific API depends on version)
}

// Cloud saves
function saveToCloud(filename: string, data: string): void {
  client.cloud.writeFile(filename, Buffer.from(data));
}

function loadFromCloud(filename: string): string | null {
  if (client.cloud.isFileExists(filename)) {
    return client.cloud.readFile(filename).toString();
  }
  return null;
}
```

#### steam_appid.txt

Create `steam_appid.txt` in your project root with your Steam app ID:

```
480
```

Use `480` (Spacewar) for development/testing. Replace with your real app ID for production builds. **Do NOT ship steam_appid.txt in the final build** -- Steam provides the app ID when launching through Steam.

### 6.3 Steam Overlay -- The Known Issue

**The Steam overlay does NOT work reliably with Electron/NW.js/Tauri apps.**

This is a fundamental limitation: Steam's overlay hooks into the application's rendering pipeline, but Chromium (and WebView2) use a multi-process architecture where rendering happens in a separate GPU process. Steam cannot hook into this.

**Workarounds:**
1. **`electronEnableSteamOverlay()`** -- steamworks.js provides this function that attempts to enable the overlay. It works on some systems but not all.
2. **Disable the overlay and use in-game UI** -- Many Electron games on Steam simply disable the overlay and implement their own shift+tab menu.
3. **NW.js has slightly better overlay support** -- Because NW.js uses a single-process model, the overlay hooks sometimes work better.

**Practical impact:** Most players use the Steam overlay for chat, screenshots, and the FPS counter. None of these are critical. The overlay issue is a known limitation of web-based Steam games and is not a blocker for publishing.

### 6.4 Steam's Requirements for Electron Apps

**There are no restrictions** on using Electron for Steam games. Steam does not dictate the technology stack. The only requirements are:
- The game must launch and run on the target platform
- The game must respond to Steam's process management (launch, shutdown)
- Steamworks API calls must work (achievements, etc.)

**Steam Deck compatibility** has additional requirements:
- Must work with gamepad controls (no mouse/keyboard requirement)
- Must respect Steam Deck's physical controls
- Controller support via Steam Input (note: Steam Input has issues with Electron 27+, may need to be disabled in favor of native gamepad API)

### 6.5 Auto-Updates Through Steam

**Steam handles all updates.** When you upload a new build to Steamworks, Steam automatically distributes it to all players. There is no need for Electron's built-in auto-update mechanism.

Upload flow:
1. Build your game: `npm run build:desktop`
2. Upload to Steamworks using `steamcmd` or the Steamworks web UI
3. Set the build live on the appropriate branch (default, beta, etc.)
4. Players receive the update automatically

This is simpler than managing your own update infrastructure. Steam's CDN is fast and reliable.

---

## 7. Build Pipeline

### 7.1 Current State

```
npm run dev     --> Vite dev server (browser, port 3000)
npm run build   --> tsc + vite build --> dist/ (static files for web hosting)
npm run server  --> Colyseus server (port 2567)
```

### 7.2 Target State

```
npm run dev              --> Browser dev (unchanged)
npm run dev:desktop      --> Electron + Vite dev server
npm run build            --> Browser production build (unchanged)
npm run build:desktop    --> Electron production build --> release/
npm run build:desktop:win   --> Windows .exe
npm run build:desktop:mac   --> macOS .app/.dmg
npm run build:desktop:linux --> Linux AppImage
```

### 7.3 What Needs to Be Added

#### New Dependencies

```bash
npm install -D electron electron-builder concurrently wait-on
npm install steamworks.js
```

#### New Files

| File | Purpose |
|------|---------|
| `electron/main.ts` | Electron main process (window creation, Steam init) |
| `electron/preload.ts` | Preload script (optional, for secure IPC) |
| `electron/server-process.ts` | Embedded Colyseus server launcher |
| `steam_appid.txt` | Steam app ID for development |
| `assets/icon.png` | Game icon (512x512) |
| `assets/icon.ico` | Windows icon |
| `assets/icon.icns` | macOS icon |

#### Vite Configuration Change

No change needed for `vite.config.ts`. The existing `vite build` output (`dist/`) is what Electron loads in production.

### 7.4 Embedded Colyseus Server in Desktop Mode

For desktop LAN play without WebRTC migration:

```typescript
// electron/server-process.ts
import { fork, ChildProcess } from 'child_process';
import path from 'path';

let serverProcess: ChildProcess | null = null;

export function startEmbeddedServer(): Promise<number> {
  return new Promise((resolve, reject) => {
    const serverScript = path.join(__dirname, '../../server/index.ts');

    // Fork the Colyseus server as a child process
    serverProcess = fork(serverScript, [], {
      env: {
        ...process.env,
        PORT: '2567',
      },
      execArgv: ['--import', 'tsx'], // Use tsx for TypeScript
    });

    serverProcess.on('message', (msg: any) => {
      if (msg.type === 'ready') {
        resolve(msg.port);
      }
    });

    serverProcess.on('error', reject);
    serverProcess.on('exit', (code) => {
      if (code !== 0) {
        console.error(`Server process exited with code ${code}`);
      }
      serverProcess = null;
    });
  });
}

export function stopEmbeddedServer(): void {
  if (serverProcess) {
    serverProcess.kill();
    serverProcess = null;
  }
}
```

```typescript
// electron/main.ts (updated with embedded server)
import { app, BrowserWindow } from 'electron';
import { startEmbeddedServer, stopEmbeddedServer } from './server-process';

let mainWindow: BrowserWindow | null = null;

async function createWindow(): Promise<void> {
  // Start embedded Colyseus server for LAN
  const serverPort = await startEmbeddedServer();
  console.log(`Embedded Colyseus server running on port ${serverPort}`);

  mainWindow = new BrowserWindow({
    width: 1920,
    height: 1080,
    title: 'Geometry Wars 3D',
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
  });

  mainWindow.setMenu(null);

  const isDev = process.env.NODE_ENV === 'development';
  if (isDev) {
    mainWindow.loadURL('http://localhost:3000');
  } else {
    mainWindow.loadFile('./dist/index.html');
  }
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  stopEmbeddedServer();
  app.quit();
});
```

### 7.5 GitHub Actions for Automated Builds

```yaml
# .github/workflows/build-desktop.yml
name: Build Desktop

on:
  push:
    tags: ['v*']

jobs:
  build-windows:
    runs-on: windows-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - run: npm ci
      - run: npm run build:desktop:win
      - uses: actions/upload-artifact@v4
        with:
          name: windows-build
          path: release/*.exe

  build-macos:
    runs-on: macos-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - run: npm ci
      - run: npm run build:desktop:mac
      - uses: actions/upload-artifact@v4
        with:
          name: macos-build
          path: release/*.dmg

  build-linux:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - run: npm ci
      - run: npm run build:desktop:linux
      - uses: actions/upload-artifact@v4
        with:
          name: linux-build
          path: release/*.AppImage
```

---

## 8. Real-World Examples

### 8.1 Successful Browser-to-Steam Games

| Game | Original Platform | Desktop Tech | Steam Revenue | Notes |
|------|-------------------|-------------|---------------|-------|
| **Vampire Survivors** | itch.io (web) | Electron + Phaser 3 | $100M+ (est.) | THE success story. Started as a browser game, became 2022's biggest indie hit. Later ported to Unity for console, but Steam version remained Electron. |
| **Game Dev Tycoon** | Browser | NW.js | $10M+ (est.) | Pioneered NW.js for Steam games. Greenworks library was created for this game. |
| **Krunker** | Browser (krunker.io) | Custom WebGL | Steam + browser | Full 3D FPS running in browser with millions of players. Steam version available. |
| **CrossCode** | Browser prototype | NW.js | Strong sales | Started as an HTML5 tech demo, grew into a full RPG on Steam via NW.js. |
| **Brotato** | Web prototype | Different | $50M+ (est.) | Originally web-based, full game in different engine. |
| **Among Us** | Mobile/PC | Unity (but web-inspired) | $500M+ (est.) | Not web-based, but shows the "simple game, massive reach" pattern. |
| **Slither.io / Agar.io** | Browser only | N/A | N/A (ad revenue) | Pure browser games with 100M+ players. Never went to Steam but prove browser game viability. |

### 8.2 NW.js Games on Steam (5,700+)

NW.js has by far the largest footprint of any web technology on Steam. Notable titles:
- Game Dev Tycoon
- Construct 3 engine games (thousands)
- RPG Maker MV/MZ games (thousands)
- Many visual novel games

### 8.3 Vampire Survivors Deep Dive

Vampire Survivors is the most relevant case study:

- **Engine:** Phaser 3 (2D JavaScript game framework) + RexPlugins
- **Desktop wrapper:** Electron
- **Launch:** itch.io first (Dec 2021), then Steam Early Access (Jan 2022)
- **Revenue trajectory:** $0 -> $1M in first month -> $100M+ lifetime
- **Bundle size:** ~250 MB (Electron overhead)
- **Performance:** Required optimization patches (lag issues noted in Steam forums)
- **Later migration:** A Unity port was created for consoles (Switch, PS, Xbox), but the Steam version stayed Electron

**Key lesson:** Electron's overhead (bundle size, memory usage) did NOT prevent Vampire Survivors from becoming one of the most successful indie games of all time. Players care about gameplay, not bundle size.

---

## 9. Recommended Architecture

### 9.1 The Dual Architecture

```
                    SHARED CODEBASE (97%)
    ┌─────────────────────────────────────────────┐
    │  src/core/ src/entities/ src/weapons/        │
    │  src/effects/ src/surfaces/ src/rendering/   │
    │  src/audio/ src/ui/ src/input/               │
    │  src/experimental/ src/agents/ src/buffs/    │
    └───────────────┬─────────────────┬────────────┘
                    │                 │
          ┌─────────┴──────┐   ┌──────┴──────────┐
          │  BROWSER MODE  │   │  DESKTOP MODE    │
          │                │   │                  │
          │  index.html    │   │  electron/       │
          │  src/main.ts   │   │    main.ts       │
          │                │   │    preload.ts     │
          │  Networking:   │   │                  │
          │  - Colyseus WS │   │  Networking:     │
          │  - WebRTC P2P  │   │  - Embedded      │
          │    (future)    │   │    Colyseus      │
          │                │   │  - WebRTC P2P    │
          │  Distribution: │   │    (future)      │
          │  - Static host │   │                  │
          │  - Netlify     │   │  Steam Features: │
          │  - GitHub Pages│   │  - steamworks.js │
          │                │   │  - Achievements  │
          └────────────────┘   │  - Leaderboards  │
                               │  - Cloud saves   │
                               │                  │
                               │  Distribution:   │
                               │  - Steam         │
                               │  - itch.io       │
                               │  - Epic (future) │
                               └──────────────────┘
```

### 9.2 Networking Layer Decision Tree

```
Player clicks "Multiplayer" -->
  |
  |-- "LAN Game" -->
  |     |
  |     |-- Desktop app? -->
  |     |     |-- Embedded Colyseus server (Phase 1)
  |     |     |-- OR WebRTC P2P (Phase 2, no server process)
  |     |
  |     |-- Browser? -->
  |           |-- Connect to host's Colyseus (current)
  |           |-- OR WebRTC P2P (Phase 2)
  |
  |-- "Online Game" -->
  |     |-- Colyseus cloud server (both platforms)
  |     |-- OR WebRTC P2P with STUN/TURN (Phase 2)
  |
  |-- "Local Split-Screen" -->
        |-- No networking needed (same as current)
```

### 9.3 Implementation Phases

#### Phase 1: Basic Electron Wrapper (2-3 days)

- Create `electron/main.ts`
- Add electron-builder configuration
- Embed Colyseus server as child process for LAN
- Add steamworks.js for achievements
- Build and test Windows .exe
- **Result:** Working Steam-ready build

#### Phase 2: WebRTC P2P Migration (6-9 days)

- Per the [WebRTC migration plan](../docs/webrtc-migration-plan.md):
  1. Extract `GameSimulation` from `GameRoom.ts`
  2. Implement binary state serialization
  3. Implement WebRTC host + peer
  4. Implement signaling (PeerJS for internet, local for LAN)
  5. UI integration (host/join in start menu)
- **Result:** Serverless LAN, improved latency, NAT traversal for internet

#### Phase 3: Polish & Platform Expansion (2-4 days)

- Steam Deck controller support
- Cloud saves via Steam
- Leaderboards
- itch.io build (same Electron, no steamworks.js)
- Linux testing and fixes
- macOS code signing

#### Phase 4: Evaluate Tauri (future, 1-2 days)

- Check if Steam overlay issue is resolved
- Benchmark WebGL performance in WebView2
- If viable, create Tauri build as a lighter alternative
- **Potential savings:** 150 MB -> 10 MB bundle size

### 9.4 Total Effort Summary

| Phase | Effort | Depends On |
|-------|--------|------------|
| Phase 1: Electron wrapper | 2-3 days | Nothing |
| Phase 2: WebRTC migration | 6-9 days | Phase 1 (optional) |
| Phase 3: Polish | 2-4 days | Phase 1 |
| Phase 4: Tauri eval | 1-2 days | Phase 3 |
| **Total to first Steam build** | **2-3 days** | |
| **Total for full dual architecture** | **11-18 days** | |

---

## 10. Concrete Next Steps

If proceeding with desktop distribution, here is the exact order of operations:

### Step 1: Install Electron Dependencies (30 min)

```bash
npm install -D electron electron-builder concurrently wait-on
npm install steamworks.js
```

### Step 2: Create Electron Main Process (1 hour)

Create `electron/main.ts` with the code from Section 2.1.

### Step 3: Add Desktop Build Scripts (30 min)

Add to `package.json`:
```json
{
  "main": "electron/main.ts",
  "scripts": {
    "dev:desktop": "concurrently \"vite\" \"wait-on http://localhost:3000 && electron .\"",
    "build:desktop": "npm run build && electron-builder",
    "build:desktop:win": "npm run build && electron-builder --win"
  }
}
```

### Step 4: Add electron-builder Config (30 min)

Add the `build` section from Section 2.5 to `package.json`.

### Step 5: Create Game Icon (1 hour)

Create 512x512 PNG icon. Generate .ico and .icns:
```bash
npx icon-gen -i assets/icon.png -o assets/
```

### Step 6: Add steam_appid.txt (5 min)

Create `steam_appid.txt` with `480` (Spacewar test ID).

### Step 7: Test Desktop Build (1 hour)

```bash
npm run dev:desktop  # Test in dev mode
npm run build:desktop:win  # Build Windows exe
# Test the .exe from release/ folder
```

### Step 8: Embed Colyseus Server (2-3 hours)

Create `electron/server-process.ts` from Section 7.4. This enables LAN play without users running a separate server.

### Step 9: Add steamworks.js Integration (2-3 hours)

Create `electron/steam.ts` from Section 6.2. Wire up achievement triggers from game events.

### Step 10: Apply for Steam Developer Account

1. Go to https://partner.steamgames.com/
2. Pay $100 registration fee
3. Set up your app page (screenshots, trailer, description)
4. Create depots for Windows, macOS, Linux
5. Upload builds via Steamworks
6. Submit for review

---

## 11. Sources

### Electron + Steam Distribution
- [Publishing Web Games on Steam with Electron (Gamedev.js)](https://gamedevjs.com/tutorials/publishing-web-games-on-steam-with-electron/)
- [Publish Web Game to Steam using Electron (DEV.to)](https://dev.to/jacklehamster/publish-your-web-game-to-steam-using-electron-670)
- [Developing Web Game on Steam with ElectronJS + Steamworks.js (Overaction)](https://www.overactiongamestudio.com/tutorials/18-developing-and-publishing-a-web-game-on-steam-with-electronjs-steamworks-js)
- [Integrate Electron Game with Steam API (Liana)](https://liana.one/integrate-electron-steam-api-steamworks)
- [Automating Steam Releases with Electron Forge (Trash Moon)](https://trashmoon.com/blog/2022/automating-steam-releases-for-html-games-with-electron-forge-and-github-actions/)

### steamworks.js and Greenworks
- [steamworks.js GitHub](https://github.com/ceifa/steamworks.js/)
- [Greenworks GitHub](https://github.com/greenheartgames/greenworks)
- [Adding Steam Achievements to Electron Game (itch.io devlog)](https://smjn.itch.io/hivepvs/devlog/364303/adding-steam-achievements-to-an-electron-game)
- [Electron Steam Notes (JamesMoulang)](https://github.com/JamesMoulang/electron-steam-notes)

### Framework Comparisons
- [Desktop Packaging for Web Games (Web Game Dev)](https://www.webgamedev.com/publishing/desktop)
- [Tauri vs Electron Comparison 2025 (RaftLabs)](https://www.raftlabs.com/blog/tauri-vs-electron-pros-cons/)
- [Tauri vs Electron Performance (Hopp)](https://www.gethopp.app/blog/tauri-vs-electron)
- [Electron vs Tauri (DoltHub)](https://www.dolthub.com/blog/2025-11-13-electron-vs-tauri/)
- [ElectronJS vs NW.js (AbdulkaderSafi)](https://abdulkadersafi.com/blog/electronjs-vs-nwjs-which-framework-should-you-use-to-build-a-desktop-app-in-2025)
- [NW.js & Electron Compared (TangibleJS)](https://tangiblejs.com/posts/nw-js-electron-compared)
- [Electron Forge vs electron-vite FAQ](https://electron-vite.github.io/faq/electron-forge.html)

### WebRTC for Games
- [WebRTC DataChannel (MDN)](https://developer.mozilla.org/en-US/docs/Games/Techniques/WebRTC_data_channels)
- [WebRTC P2P Multiplayer (webrtchacks)](https://webrtchacks.com/datachannel-multiplayer-game/)
- [NetPlayJS - P2P WebRTC Multiplayer](https://github.com/rameshvarun/netplayjs)
- [geckos.io GitHub](https://github.com/geckosio/geckos.io)
- [simple-peer GitHub](https://github.com/feross/simple-peer)

### Steam Platform
- [Steamworks Documentation](https://partner.steamgames.com/doc/home)
- [Steam Deck Compatibility (Brainhub)](https://brainhub.eu/library/making-electron-apps-steam-deck-compatible)
- [Electron Linux Runtime Issues (Valve)](https://github.com/ValveSoftware/steam-runtime/issues/579)
- [Steam Overlay WebView2 Issue (Microsoft)](https://github.com/MicrosoftEdge/WebView2Feedback/issues/3200)

### Vampire Survivors / Case Studies
- [Vampire Survivors Wikipedia](https://en.wikipedia.org/wiki/Vampire_Survivors)
- [Vampire Survivors PCGamingWiki](https://www.pcgamingwiki.com/wiki/Vampire_Survivors)
- [Vampire Survivors Electron Hacking Analysis](https://github.com/TechnoLustMatty/Electron-Game-Hacking-Vampire-Survivors-)

### Build Tools
- [electron-builder](https://www.electron.build/)
- [electron-vite](https://electron-vite.org/)
- [Electron Forge](https://www.electronforge.io/)
- [ASAR Archives (Electron docs)](https://www.electronjs.org/docs/latest/tutorial/asar-archives)
- [Electron Distribution (electron-vite)](https://electron-vite.org/guide/distribution)

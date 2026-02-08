## 2026-02-08 - LAN Hosting Implementation

**Context:** Task #9 requested peer-to-peer LAN multiplayer with no central server. Friends on same WiFi should discover and join games easily.

**Challenge:** Browsers cannot listen on ports, do mDNS, or UDP broadcast. True P2P without any server requires WebRTC with manual signaling (terrible UX).

**Options Considered:**
1. **Pure WebRTC P2P** - No server at all, manual SDP exchange. Pros: true P2P. Cons: awful UX (copy-paste offer/answer strings).
2. **Embedded server via Vite plugin** - Vite spawns Colyseus as child process on demand. Pros: one-click hosting, reuses existing network code. Cons: only works in dev mode.
3. **Standalone combined server** (`npm run lan`) - Separate command to start server+client. Pros: works in production. Cons: requires terminal command.

**Decision:** Option 2 (Vite plugin) for dev mode, with architecture that supports Option 3 later.

**Architecture:**
- `vite-plugin-lan.ts` - Vite plugin adds `/__lan/*` middleware endpoints:
  - `POST /__lan/start` - Spawns Colyseus server child process, polls health, returns LAN IPs
  - `POST /__lan/stop` - Kills child process
  - `GET /__lan/status` - Returns hosting state + LAN addresses
  - `GET /__lan/scan` - Scans local subnet (all 254 IPs on port 2567 with 400ms timeout)
- `src/network/LANClient.ts` - Client-side fetch wrapper for the plugin endpoints
- `src/ui/StartMenu.ts` - New "LAN" button + host/join sub-panel with scan results
- `server/index.ts` - Added `/api/info` endpoint for discovery identification

**LAN Scan approach:** Server-side HTTP scan. Vite plugin detects host's LAN IPs via `os.networkInterfaces()`, derives /24 subnet, hits `http://X.X.X.1-254:2567/api/info` with 400ms timeout. Any response with `game: "geometry-wars-3d"` is a valid server.

**Flow:**
- HOST: Click "HOST GAME" → plugin starts Colyseus → shows join URL → click "ENTER GAME"
- JOIN: Click "SCAN LAN" → plugin scans subnet → click on found server. Or enter IP manually.
- Both end up at `?mode=network&server=ws://IP:2567` → reuses existing `network-main.ts`

**Limitations:**
- Dev mode only (requires Vite dev server for /__lan/ endpoints)
- Scan takes ~1-2s for a /24 subnet
- No mDNS (could add `bonjour-service` later for instant discovery)

**Reversibility:** Easy - remove plugin from vite.config.ts, revert StartMenu changes, delete new files

## 2026-02-08 - LAN Server Startup Fix (CJS/ESM Interop)

**Context:** Clicking "HOST GAME" failed with "Server failed to start within 15s". The Vite plugin spawns `tsx server/index.ts`, which crashed immediately with:
```
SyntaxError: The requested module 'colyseus' does not provide an export named 'Room'
```

**Root Cause:** The project has `"type": "module"` in the root `package.json`, which forces Node.js to treat all files as ESM. When `tsx` runs the server files, it uses Node's native ESM loader. The `colyseus` package (v0.15.57) ships as CJS (`module.exports = ...`). Node 20's ESM loader can import CJS packages as a whole (default import) but cannot destructure named exports from them. So `import { Room, Client } from 'colyseus'` fails.

**Options Considered:**
1. **Change server imports to default-import pattern** (`import colyseus from 'colyseus'; const { Room, Client } = colyseus;`) - Pros: no extra files. Cons: fragile, needs changing in every server file, may break TS type checking.
2. **Add `server/package.json` with `"type": "commonjs"`** - Pros: one file, overrides parent's module type just for server directory, tsx handles CJS transpilation correctly. Cons: adds a small file.
3. **Switch server to use `ts-node` or compile to JS first** - Pros: more explicit. Cons: more moving parts, slower startup.

**Decision:** Option 2 - Added `server/package.json` with `{ "type": "commonjs" }`. This is the standard Node.js mechanism for per-directory module type override. tsx respects this and transpiles the server files to CJS, which can then `require()` the CJS colyseus package without any interop issues.

**Reversibility:** Easy - delete `server/package.json` (but server will break again)

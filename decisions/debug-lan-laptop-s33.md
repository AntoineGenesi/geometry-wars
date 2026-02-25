# LAN Laptop Connection Investigation — Session 33

## Date: 2026-02-25

## Summary

Comprehensive code-level investigation comparing v5.0 (reportedly working) against HEAD.
**Conclusion: No code-level bug found.** The code is correct for both proxy and direct paths. The issue is most likely environmental (laptop firewall, network config, or browser state).

## Key Findings

### 1. Colyseus Has Its Own CORS Handler (S32 Express Fix Was Redundant)

Colyseus 0.15.x intercepts matchmake HTTP requests at the `httpServer` level, BEFORE Express middleware runs:

```javascript
// @colyseus/core Server.js — lines 163-180
server.removeAllListeners("request");
server.on("request", (req, res) => {
  if (req.url.indexOf(`/${matchMaker.controller.matchmakeRoute}`) !== -1) {
    this.handleMatchMakeRequest(req, res);  // Colyseus handles this, NOT Express
  } else {
    // Express handles everything else
    for (let i = 0; i < listeners.length; i++) {
      listeners[i].call(server, req, res);
    }
  }
});
```

Colyseus's matchmaker controller at `@colyseus/core/build/matchmaker/controller.js`:
```javascript
getCorsHeaders(req) {
  const origin = req.headers["origin"];
  return { "Access-Control-Allow-Origin": origin || "*" };
}
// DEFAULT_CORS_HEADERS includes "Access-Control-Allow-Credentials": "true"
```

This means:
- S32's Express CORS middleware (echoing origin, handling OPTIONS) is **never invoked** for matchmake
- Colyseus handles CORS correctly: echoes origin, allows credentials
- The Express CORS fix was well-intentioned but redundant

### 2. v5.0 Had the Same CORS "Vulnerability" — It Should Have Worked Anyway

v5.0 connection flow:
- Page loads from `http://192.168.x.x:3000`
- Matchmake POST to `http://192.168.x.x:2567/matchmake/joinOrCreate/game` (cross-origin)
- Colyseus.js `httpie` sends with `credentials: 'include'` (always)
- Colyseus server echoes origin (via getCorsHeaders) + allows credentials
- Browser should accept this ✓

Current connection flow:
- Page loads from `http://192.168.x.x:3000`
- Matchmake POST to `http://192.168.x.x:3000/ws/matchmake/joinOrCreate/game` (SAME-ORIGIN via proxy)
- No CORS needed ✓

Both flows should work. The proxy approach is actually MORE robust (same-origin, no CORS at all).

### 3. Vite Proxy Configuration Is Correct

```javascript
// vite.config.ts
proxy: {
  '/ws': {
    target: 'http://localhost:2567',
    ws: true,
    rewrite: (path) => path.replace(/^\/ws/, '') || '/',
  },
}
```

- `/ws/matchmake/joinOrCreate/game` → `/matchmake/joinOrCreate/game` ✓
- `/ws/processId/roomId?sessionId=...` → `/processId/roomId?sessionId=...` ✓
- WebSocket upgrade through proxy: enabled via `ws: true` ✓

### 4. Phone vs Laptop — Same Code Path

Both phone (QR code) and laptop (lobby scan) end up with the same connection URL:
- Primary: `ws://hostname:3000/ws` (same-origin via proxy)
- Fallback: `ws://hostname:2567` (direct, Colyseus handles CORS)

The lobby scan handler correctly uses `window.location.hostname` for self-hosted entries.

### 5. Most Likely Root Causes (Environmental)

Since the code is correct, the laptop connection failure is likely caused by:

1. **Windows Firewall on the desktop** blocking port 3000 or 2567 for some but not all clients
2. **Laptop's own firewall** blocking outgoing WebSocket connections
3. **Browser on the laptop** caching old JS bundle (clear cache + hard reload)
4. **WSL2 networking** — if running `npm run dev` in WSL2 instead of `Play Game.bat`, ports aren't accessible from LAN without port forwarding
5. **Multiple network interfaces** — the desktop has WiFi + Ethernet + WSL2; the laptop might resolve to a different IP than the phone
6. **Port proxy rules** leftover from previous `Setup-WSL-LAN.bat` runs (intercepting port 3000/2567 traffic)

## Changes Made

1. **StartMenu.ts**: Changed lobby entry click to redirect for non-self servers instead of cross-origin connection
2. **network-main.ts**: Added matchmake endpoint diagnostic check and comprehensive error panel showing diagnostics
3. **This document**: Full investigation findings for future sessions

## Testing Checklist for User

- [ ] Run `Play Game.bat` as Administrator (clears stale port proxy rules + sets firewall)
- [ ] On laptop: open `http://192.168.x.x:3000/lan-test.html` — does the health check pass?
- [ ] On laptop: open browser DevTools Console, navigate to game, check for errors
- [ ] On laptop: clear browser cache (Ctrl+Shift+Delete → cached images/files)
- [ ] Check if laptop is on same WiFi/LAN as desktop (not on VPN or different subnet)
- [ ] Try from a different browser on the laptop (Edge vs Chrome vs Firefox)

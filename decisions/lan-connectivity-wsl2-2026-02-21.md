# LAN Connectivity Diagnosis — WSL2 Port Forwarding

**Date:** 2026-02-21
**Triggered by:** User cannot connect from laptop. Tried 172.28.48.1:3000, 192.168.x.x — nothing works.

---

## Root Cause: WSL2 Network Isolation

The game server runs **inside WSL2**, which uses a **virtual network adapter** (Hyper-V virtual switch). This creates a two-layer network:

```
Laptop (192.168.1.x)
    └── WiFi router / LAN
        └── Windows host (192.168.1.y, 172.28.48.1 virtual adapter)
            └── WSL2 virtual network (172.28.48.0/20)
                └── WSL2 instance (172.28.48.2) ← servers bind here
```

### Why the addresses didn't work

| Address tried | Why it failed |
|---------------|---------------|
| `172.28.48.1:3000` | That's the Windows HOST virtual adapter IP, not the WSL2 IP. From Windows it routes to WSL2, but from laptop it doesn't route anywhere useful. |
| `192.168.x.x:3000` | Windows LAN IP. Traffic arrives at Windows, but Windows doesn't forward it to WSL2 without `netsh interface portproxy`. |

### What the server actually binds to

- **Vite** (`vite.config.ts`): `host: true` → binds to `0.0.0.0` inside WSL2 ✓
- **Colyseus** (`server/index.ts`): `httpServer.listen(PORT, '0.0.0.0', ...)` ✓

Both are correctly bound to all interfaces — **inside WSL2**. The WSL2 network is simply not directly reachable from the LAN.

### Why getLANAddresses() returned the wrong IPs

`vite-plugin-lan.ts` calls Node.js `networkInterfaces()`. In WSL2, this only sees:
- `eth0`: 172.28.48.x (WSL2 internal) — filtered as "virtual" by the IP prefix check
- `lo`: 127.0.0.1 — filtered as internal

The Windows LAN IP (192.168.x.x) is **invisible to WSL2's network stack** — it lives on the Windows side only.

---

## Fix Implemented

### 1. WSL2 Detection + Windows IP Discovery (`vite-plugin-lan.ts`)

Added:
- `detectWSL2()` — reads `/proc/version` for "microsoft" keyword
- `getWindowsLANIPs()` — runs `powershell.exe` from WSL2 to query Windows adapters
- Both functions called in `/__lan/status` and `/__lan/start` responses
- New fields: `isWSL2: boolean`, `windowsAddresses: string[]`

### 2. Interface Updates (`src/network/LANClient.ts`)

Added `isWSL2?` and `windowsAddresses?` to `LANStatus` and `LANStartResult`.

### 3. WSL2-Aware Host Screen (`src/ui/StartMenu.ts`)

When hosting and `isWSL2 === true`:
- Shows "WSL2 (internal)" address — for local Windows testing only
- Shows "LAN (Windows)" address — the one laptop should use
- Shows warning with the exact `netsh interface portproxy` commands to run
- QR code uses Windows LAN IP (not WSL2 IP)

### 4. Port Forwarding Script (`Setup-WSL-LAN.bat`)

New Windows batch script that:
1. Detects WSL2 IP via `wsl hostname -I`
2. Removes stale port forwarding rules
3. Adds `netsh interface portproxy` rules to forward 3000 + 2567 from all Windows interfaces to WSL2
4. Adds Windows Firewall rules
5. Shows which Windows IPs to use

**Must be run as Administrator** (Windows limitation on `netsh interface portproxy`).

---

## Two Launch Modes: Comparison

| Mode | Where servers run | LAN device can reach at |
|------|------------------|------------------------|
| `Play Game.bat` | Windows (directly) | Windows `ipconfig` IPs (192.168.x.x:3000) — should work without portproxy |
| `npm run dev` (WSL2) | WSL2 virtual network | Requires `Setup-WSL-LAN.bat` port forwarding first |

**If the user previously used Play Game.bat, it likely worked.** If they switched to WSL2 dev mode, that's when connectivity broke.

---

## User Instructions

### Option A: Use Play Game.bat (recommended for LAN play)

1. Double-click `Play Game.bat` on the Windows host
2. Look for the IPs printed in the console
3. On laptop, go to `http://192.168.x.x:3000` (use the 192.168 address)
4. If blocked, right-click → Run as Administrator (for firewall rules)

### Option B: WSL2 dev mode (for developers)

1. Start game in WSL2: `npm run dev`
2. On Windows host, right-click `Setup-WSL-LAN.bat` → Run as Administrator
3. Note the Windows IP shown (192.168.x.x)
4. On laptop, go to `http://192.168.x.x:3000`
5. Re-run `Setup-WSL-LAN.bat` after WSL2 restarts (WSL2 IP changes on reboot)

---

## Verification Levels Achieved

- **Level 0** (code analysis): Confirmed root cause ✓
- **Level 1** (TypeScript compiles): Verified ✓
- **Level 2** (unit tests): N/A for networking
- **Level 5** (Puppeteer): Not applicable — requires real LAN device
- **Level 6** (user test): **Required** — user must test with actual laptop

**This is a Level 0-1 fix.** The networking changes cannot be verified without two physical devices on a LAN.

---

## Previous Investigation

- `lan-architectural-analysis-2026-02-09.md` — Architecture analysis, WSL2 noted as problem
- `lan-audit-systemic-failure-2026-02-10.md` — Systemic failure analysis
- Multiple rounds of LAN fixes all failed because WSL2 networking was never properly addressed

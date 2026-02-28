# LAN Troubleshooting Guide — Geometry Wars 3D

## Quick Checklist

1. Both devices on the same WiFi network
2. Run `Play Game.bat` as Administrator on the host PC
3. Use the `http://192.168.x.x:3000` address shown in the console (NOT localhost)
4. Avoid `10.x.x.x` (VPN) and `172.x.x.x` (WSL2 virtual) addresses

## Common Issues & Fixes

### "This site can't be reached" / Can't connect from laptop

**Most likely cause: Winsock corruption on the connecting device.**

Symptoms:
- Phone connects fine, but laptop can't
- `curl` from laptop gives: `getsockname() failed with errno 10022: Invalid arguments`
- Browser says "This site can't be reached" or "ERR_CONNECTION_REFUSED"

Fix (run on the **laptop** as Administrator):
```cmd
netsh winsock reset
```
Then **restart the laptop**. This resets the Windows network catalog and fixes corrupted socket states.

If still broken after restart, also run:
```cmd
netsh int ip reset
```
Then restart again.

**Causes of Winsock corruption:**
- VPN software (NordVPN, Windscribe, ExpressVPN, etc.)
- Network monitoring tools
- Antivirus with network inspection
- Windows Updates that don't complete cleanly
- Multiple network adapters fighting each other

### Firewall blocking connections

Symptoms:
- `ping` works but `curl`/browser fails
- Connection times out (not refused)

Fix (run on the **host PC** as Administrator):
```cmd
netsh advfirewall firewall add rule name="GW-AllProfiles" dir=in action=allow protocol=TCP localport=3000 profile=any
netsh advfirewall firewall add rule name="GW-AllProfiles-2567" dir=in action=allow protocol=TCP localport=2567 profile=any
```

The key is `profile=any` — Windows has three network profiles (Private, Public, Domain) and may classify your WiFi differently than expected.

To check your current profile:
```cmd
netsh advfirewall show currentprofile
```

Nuclear test (temporarily disable firewall to confirm it's the issue):
```cmd
netsh advfirewall set allprofiles state off
REM Test connection, then immediately re-enable:
netsh advfirewall set allprofiles state on
```

### Stale WSL2 port forwarding rules

Symptoms:
- Was working before, suddenly stops
- `Play Game.bat` shows warning about portproxy rules

Fix: Run `Play Game.bat` as Administrator (auto-cleans stale rules), or manually:
```cmd
netsh interface portproxy delete v4tov4 listenport=3000 listenaddress=0.0.0.0
netsh interface portproxy delete v4tov4 listenport=2567 listenaddress=0.0.0.0
```

### Wrong IP address

The host PC shows multiple IPs. Use the right one:
- `192.168.x.x` — Home WiFi (use this one)
- `10.x.x.x` — VPN (don't use)
- `172.x.x.x` — WSL2 internal (don't use)
- `169.254.x.x` — No network (broken)

### Connection works but game doesn't load

- Clear browser cache: `Ctrl+Shift+Delete` → clear cached files
- Try incognito/private window
- Try a different browser
- Check if antivirus is blocking WebSocket connections on port 2567

## Diagnostic Steps

Run these from the **connecting device** (laptop/phone):

1. **Can you reach the host at all?**
   ```cmd
   ping 192.168.x.x
   ```

2. **Can you reach the web server?**
   ```cmd
   curl http://192.168.x.x:3000
   ```

3. **Can you reach the game server?**
   ```cmd
   curl http://192.168.x.x:2567
   ```

4. **Check for Winsock issues:**
   If curl gives `getsockname() errno 10022` → run `netsh winsock reset` + restart

5. **Check firewall on host:**
   ```cmd
   netsh advfirewall show currentprofile
   ```

## Architecture

```
Host PC (runs Play Game.bat)
├── Vite dev server (port 3000) — serves the game webpage
├── Colyseus game server (port 2567) — handles multiplayer logic
└── Windows Firewall must allow both ports

Connecting Device (phone/laptop)
├── Opens http://[host-ip]:3000 in browser
├── Browser loads game, connects to ws://[host-ip]:2567
└── Must be on same WiFi subnet as host
```

## History of LAN Issues (for debugging future problems)

| Session | Issue | Root Cause | Fix |
|---------|-------|------------|-----|
| S38b | No connection | Error messages truncated | Show full errors |
| S38c | Portproxy intercepting | Stale WSL2 forwarding rules | Auto-cleanup in Play Game.bat |
| S38d | Laptop can't connect | Firewall profile-specific rules | Added `profile=any` |
| S39 | Laptop can't connect | Winsock corruption on laptop | `netsh winsock reset` + restart |

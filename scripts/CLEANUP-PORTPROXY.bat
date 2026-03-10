@echo off
REM ============================================================
REM  CLEANUP-PORTPROXY.bat
REM  One-time admin script to clear stale WSL2 port forwarding
REM  rules that break LAN laptop connections.
REM
REM  Run this ONCE as Administrator when you see the portproxy
REM  error in Play Game.bat. After cleanup, Play Game.bat can
REM  be run normally (non-admin) for future sessions.
REM ============================================================

echo.
echo  ================================================================
echo     GEOMETRY WARS - LAN PORTPROXY CLEANUP
echo  ================================================================
echo.

REM Admin check
net session >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo  [!] This script requires Administrator rights.
    echo  [!] Right-click CLEANUP-PORTPROXY.bat and choose
    echo  [!] "Run as Administrator", then try again.
    echo.
    pause
    exit /b 1
)

echo  [OK] Running as Administrator.
echo.

REM Show current portproxy state before cleanup
echo  Current port forwarding rules:
netsh interface portproxy show all
echo.

REM Delete portproxy rules for game ports
echo  Removing port forwarding rules for ports 3000 and 2567...
netsh interface portproxy delete v4tov4 listenport=3000 listenaddress=0.0.0.0 >nul 2>&1
netsh interface portproxy delete v4tov4 listenport=2567 listenaddress=0.0.0.0 >nul 2>&1
echo  [OK] Port forwarding rules removed.
echo.

REM Set up Windows Firewall rules for direct LAN access
echo  Setting Windows Firewall rules for LAN access...
netsh advfirewall firewall delete rule name="GeometryWars-Server-2567" >nul 2>&1
netsh advfirewall firewall delete rule name="GeometryWars-Web-3000" >nul 2>&1
netsh advfirewall firewall add rule name="GeometryWars-Server-2567" dir=in action=allow protocol=TCP localport=2567
netsh advfirewall firewall add rule name="GeometryWars-Web-3000" dir=in action=allow protocol=TCP localport=3000
echo  [OK] Firewall rules set for ports 3000 and 2567.
echo.

REM Verify cleanup
echo  Verifying cleanup — remaining rules (should be empty for ports 3000/2567):
netsh interface portproxy show all
echo.

echo  ================================================================
echo  Cleanup complete!
echo.
echo  You can now run Play Game.bat normally (non-admin is fine).
echo  Laptop and phone connections should work on the LAN.
echo  ================================================================
echo.
pause

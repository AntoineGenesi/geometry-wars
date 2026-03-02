@echo off
REM ============================================================
REM  BULLETPROOF: call :main then ALWAYS pause, no matter what.
REM  Even if :main crashes, errors, or exits early, the window
REM  stays open so the user can read what went wrong.
REM ============================================================

REM Force working directory to script location (fixes admin elevation changing CWD to System32)
REM pushd handles UNC paths (\\wsl$\...) which cd /d cannot
echo  [debug] Script location: %~dp0
echo  [debug] Current dir before cd: %CD%
pushd "%~dp0"
echo  [debug] Current dir after cd: %CD%
echo.

call :main %*
echo.
echo  ================================================================
echo  Window will stay open. Read any errors above.
echo  Press any key to close.
echo  ================================================================
echo.
pause
exit /b

:main
setlocal enabledelayedexpansion
title Geometry Wars 3D
color 0A

echo.
echo  ================================================================
echo     GEOMETRY WARS 3D DIMENSIONS - Browser Edition
echo  ================================================================
echo.

REM Check Node.js is available
where node >nul 2>nul
if %ERRORLEVEL% neq 0 (
    echo  [!] Node.js is not installed on Windows!
    echo  [!] Download from https://nodejs.org and install, then try again.
    echo  [!] Or run WINDOWS-SETUP.bat first.
    echo.
    goto :eof
)

REM Show versions
for /f "tokens=*" %%i in ('node --version') do echo  Node.js: %%i

REM Change to project directory (redundant with line 10, but safe)
pushd "%~dp0"
echo  Directory: %CD%
echo.

REM Check node_modules exists
if not exist "node_modules" (
    echo  [!] Dependencies not installed. Run WINDOWS-SETUP.bat first.
    echo.
    goto :eof
)

REM Fix native binaries if needed (WSL installs Linux binaries, Windows needs win32)
echo  Checking native binaries...
call node scripts\check-native-binaries.cjs
if %ERRORLEVEL% neq 0 (
    echo.
    echo  [..] Fixing Windows-specific native binaries...
    echo  [..] This may take a minute...
    echo.
    call node scripts\fix-native-binaries.cjs
    if !ERRORLEVEL! neq 0 (
        echo.
        echo  [!] Failed to fix native binaries. See output above.
        goto :eof
    )
    echo.
    echo  [OK] Native binaries fixed.
)
echo  [OK] Native binaries OK.
echo.

REM ================================================================
REM  ADMIN CHECK
REM ================================================================
set IS_ADMIN=0
net session >nul 2>&1
if %ERRORLEVEL% == 0 set IS_ADMIN=1

if %IS_ADMIN% == 1 (
    echo  [OK] Running as Administrator.
) else (
    echo  [!] NOT running as Administrator.
    echo  [!] Windows Firewall rules for LAN may not apply.
    echo  [!] For reliable LAN access: right-click this .bat and
    echo  [!] choose "Run as Administrator".
)
echo.

REM ================================================================
REM  PORTPROXY CLEANUP - subroutine avoids nested if() parsing bugs
REM ================================================================
if %IS_ADMIN% == 1 call :cleanup_portproxy_admin
if %IS_ADMIN% == 0 call :check_portproxy_nonadmin
if "!PORTPROXY_HALT!"=="1" goto :eof

REM ================================================================
REM  WINDOWS FIREWALL: Allow ports 3000 and 2567 for LAN access
REM  (Only fully effective when running as Administrator)
REM ================================================================
echo  Setting up Windows Firewall rules for LAN access...
netsh advfirewall firewall delete rule name="GeometryWars-Server-2567" >nul 2>&1
netsh advfirewall firewall delete rule name="GeometryWars-Web-3000" >nul 2>&1
netsh advfirewall firewall add rule name="GeometryWars-Server-2567" dir=in action=allow protocol=TCP localport=2567 profile=any >nul 2>&1
netsh advfirewall firewall add rule name="GeometryWars-Web-3000" dir=in action=allow protocol=TCP localport=3000 profile=any >nul 2>&1
if %IS_ADMIN% == 1 echo  [OK] Firewall rules set for ports 3000 and 2567.
if %IS_ADMIN% == 0 echo  [..] Firewall rules attempted - may need Administrator to apply.
echo.

REM Get ALL local IPs for LAN display
echo  ================================================================
echo.
echo   HOST PC LAN ADDRESSES (share with other players):
echo.
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /c:"IPv4"') do (
    for /f "tokens=*" %%b in ("%%a") do (
        echo     http://%%b:3000
    )
)
echo.
echo   Game (this PC):  http://localhost:3000
echo.
echo   TO CONNECT FROM ANOTHER DEVICE:
echo   1. Both devices on same WiFi/LAN
echo   2. Open browser on other device, go to one of the 192.168.x.x addresses above
echo   3. Avoid 10.x.x.x (VPN) and 172.x.x.x (WSL2 virtual) addresses
echo   4. Then go to LAN menu in the game and connect, OR use the QR code
echo.
echo   NOTE: This .bat runs servers on Windows (not WSL2).
echo   If you use "npm run dev" in WSL2 instead, run
echo   Setup-WSL-LAN.bat as Administrator to enable LAN access.
echo.
echo  ================================================================
echo.

REM Check key files exist before launching
if not exist "node_modules\tsx\dist\cli.mjs" (
    echo  [!] tsx not found. Run: npm install
    goto :eof
)
if not exist "node_modules\vite\bin\vite.js" (
    echo  [!] Vite not found. Run: npm install
    goto :eof
)
if not exist "server\index.ts" (
    echo  [!] server\index.ts not found. Are you in the right directory?
    goto :eof
)

REM Start Colyseus server in a SEPARATE window
echo  Starting Colyseus multiplayer server in a NEW WINDOW on port 2567...
echo.
start "Geometry Wars Server" cmd /k "node node_modules\tsx\dist\cli.mjs server\index.ts || echo SERVER CRASHED && pause"

REM Wait for Colyseus to start (5s to ensure it's fully ready)
echo  Waiting for server to initialize...
timeout /t 5 /nobreak >nul

echo  Starting Vite dev server (port 3000)...
echo.

REM Open browser after a delay
start /b cmd /c "timeout /t 5 /nobreak >nul && start http://localhost:3000"

echo  --- Vite output below ---
echo.

REM Run Vite in foreground
node node_modules\vite\bin\vite.js --host --port 3000 --open false

echo.
echo  [!] Vite exited (code: %ERRORLEVEL%). See output above.
goto :eof

REM ================================================================
REM  SUBROUTINES (outside main flow - called via "call :label")
REM ================================================================

:cleanup_portproxy_admin
echo  Removing stale WSL2 port forwarding rules if any...
netsh interface portproxy delete v4tov4 listenport=3000 listenaddress=0.0.0.0 >nul 2>&1
netsh interface portproxy delete v4tov4 listenport=2567 listenaddress=0.0.0.0 >nul 2>&1
echo  [OK] Port forwarding rules cleared.
echo.
goto :eof

:check_portproxy_nonadmin
set PORTPROXY_HALT=0
echo  [..] Checking for stale WSL2 port forwarding rules...
netsh interface portproxy show all 2>nul > "%TEMP%\gw-portproxy.txt"
set PORTPROXY_FOUND=0
findstr /c:"2567" "%TEMP%\gw-portproxy.txt" >nul 2>&1
if !ERRORLEVEL! == 0 set PORTPROXY_FOUND=1
findstr /c:"3000" "%TEMP%\gw-portproxy.txt" >nul 2>&1
if !ERRORLEVEL! == 0 set PORTPROXY_FOUND=1
del "%TEMP%\gw-portproxy.txt" >nul 2>&1
if !PORTPROXY_FOUND! == 0 (
    echo  [OK] No stale port forwarding rules found.
    echo.
    goto :eof
)
echo.
color 4E
echo  ################################################################
echo  ##  CRITICAL: WSL2 PORT FORWARDING RULES DETECTED!           ##
echo  ##                                                            ##
echo  ##  Stale portproxy rules from a previous WSL2 session are   ##
echo  ##  intercepting LAN connections on ports 3000 and/or 2567.  ##
echo  ##                                                            ##
echo  ##  EFFECT: Laptop/phone connections will FAIL because they  ##
echo  ##  get redirected to WSL2 which has no game server running. ##
echo  ##  Your own PC works because localhost bypasses portproxy.  ##
echo  ##                                                            ##
echo  ##  FIX (choose one):                                        ##
echo  ##    1. Right-click Play Game.bat, Run as Administrator     ##
echo  ##    2. OR: Run CLEANUP-PORTPROXY.bat as Administrator      ##
echo  ##       (one-time fix, then Play Game.bat works normally)   ##
echo  ##                                                            ##
echo  ##  Stopping here to prevent a broken LAN session.          ##
echo  ################################################################
echo.
color 0A
set PORTPROXY_HALT=1
goto :eof

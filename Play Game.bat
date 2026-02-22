@echo off
REM ============================================================
REM  BULLETPROOF: call :main then ALWAYS pause, no matter what.
REM  Even if :main crashes, errors, or exits early, the window
REM  stays open so the user can read what went wrong.
REM ============================================================

REM Force working directory to script location (fixes admin elevation changing CWD to System32)
echo  [debug] Script location: %~dp0
echo  [debug] Current dir before cd: %CD%
cd /d "%~dp0"
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
cd /d "%~dp0"
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
REM  ADMIN CHECK — firewall rules and portproxy cleanup require
REM  Administrator. Detect whether we have those rights now.
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
REM  PORTPROXY CLEANUP — Remove any stale WSL2 port forwarding rules
REM  that Setup-WSL-LAN.bat may have created. These rules intercept
REM  LAN traffic and redirect it to WSL2 (which has no server when
REM  using Play Game.bat), breaking laptop connections.
REM  Requires Administrator — silently skipped if not admin.
REM ================================================================
if %IS_ADMIN% == 1 (
    echo  Removing stale WSL2 port forwarding rules if any...
    netsh interface portproxy delete v4tov4 listenport=3000 listenaddress=0.0.0.0 >nul 2>&1
    netsh interface portproxy delete v4tov4 listenport=2567 listenaddress=0.0.0.0 >nul 2>&1
    echo  [OK] Port forwarding rules cleared.
    echo.
)
if %IS_ADMIN% == 0 (
    echo  [..] Checking for stale port forwarding rules...
    netsh interface portproxy show all 2>nul > "%TEMP%\gw-portproxy.txt"
    findstr /c:"2567" "%TEMP%\gw-portproxy.txt" >nul 2>&1
    if !ERRORLEVEL! == 0 (
        echo  [!] WARNING: WSL2 port forwarding rules detected for port 2567!
        echo  [!] These rules will intercept laptop connections and break LAN play.
        echo  [!] To fix: right-click this .bat and "Run as Administrator".
        echo.
    )
    findstr /c:"3000" "%TEMP%\gw-portproxy.txt" >nul 2>&1
    if !ERRORLEVEL! == 0 (
        echo  [!] WARNING: WSL2 port forwarding rules detected for port 3000!
        echo  [!] Right-click this .bat and "Run as Administrator" to fix.
        echo.
    )
    del "%TEMP%\gw-portproxy.txt" >nul 2>&1
)

REM ================================================================
REM  WINDOWS FIREWALL: Allow ports 3000 and 2567 for LAN access
REM  (Only fully effective when running as Administrator)
REM ================================================================
echo  Setting up Windows Firewall rules for LAN access...
netsh advfirewall firewall add rule name="GeometryWars-Server-2567" dir=in action=allow protocol=TCP localport=2567 >nul 2>&1
netsh advfirewall firewall add rule name="GeometryWars-Web-3000" dir=in action=allow protocol=TCP localport=3000 >nul 2>&1
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

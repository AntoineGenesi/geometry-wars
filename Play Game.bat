@echo off
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
    echo  Run WINDOWS-SETUP.bat first.
    echo.
    pause
    exit /b 1
)

REM Show versions
for /f "tokens=*" %%i in ('node --version') do echo  Node.js: %%i

REM Change to project directory
cd /d "%~dp0"

REM Check node_modules exists
if not exist "node_modules" (
    echo  [!] Dependencies not installed. Run WINDOWS-SETUP.bat first.
    echo.
    pause
    exit /b 1
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
        pause
        exit /b 1
    )
    echo.
    echo  [OK] Native binaries fixed.
)
echo  [OK] Native binaries OK.
echo.

REM ================================================================
REM  WINDOWS FIREWALL: Allow ports 3000 and 2567 for LAN access
REM  Requires Administrator. Silently skipped if not admin.
REM  Run this file as Administrator once to set up firewall rules.
REM ================================================================
echo  Setting up Windows Firewall rules for LAN access...
netsh advfirewall firewall add rule name="Geometry Wars - Game Server (2567)" dir=in action=allow protocol=TCP localport=2567 >nul 2>&1
netsh advfirewall firewall add rule name="Geometry Wars - Web Server (3000)" dir=in action=allow protocol=TCP localport=3000 >nul 2>&1
echo  [OK] Firewall rules applied (requires Administrator - may be skipped if not admin).
echo  [!] If LAN still fails: Right-click this .bat and Run as Administrator,
echo  [!] OR manually add firewall rules for TCP ports 3000 and 2567 (Inbound).
echo.

REM Get ALL local IPs for LAN display (show all so user can pick the right one)
echo  ================================================================
echo.
echo   HOST PC LAN ADDRESSES (share one of these with other players):
echo.
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /c:"IPv4"') do (
    for /f "tokens=*" %%b in ("%%a") do (
        echo     >>> http://%%b:3000 <<<
    )
)
echo.
echo   Game (this PC):  http://localhost:3000
echo.
echo   TO CONNECT FROM ANOTHER DEVICE:
echo   1. Make sure both devices are on the same WiFi/LAN
echo   2. Open a browser on the other device
echo   3. Try each address above - use 192.168.x.x (not 10.x.x.x which may be VPN)
echo   4. If it fails, check Windows Firewall - run this file as Administrator
echo.
echo  ================================================================
echo.

echo  Starting Colyseus multiplayer server in a NEW WINDOW (port 2567)...
echo  Watch the "Geometry Wars Server" window for connection logs!
echo.

REM Start Colyseus in a NEW VISIBLE window so server logs are visible
REM The window title is "Geometry Wars Server" - look for it in taskbar
start "Geometry Wars Server (port 2567)" cmd /c "npx tsx server\index.ts & echo. & echo  Server stopped. Press any key to close. & pause >nul"

REM Wait for Colyseus to start
timeout /t 3 /nobreak >nul

echo  Starting Vite dev server (port 3000)...
echo.

REM Brief delay then open browser
start /b cmd /c "timeout /t 4 /nobreak >nul && start http://localhost:3000"

echo  ================================================================
echo  Check the "Geometry Wars Server" window for your LAN IP addresses
echo  ================================================================
echo.
echo  --- Vite server output below (stays visible on crash) ---
echo.

REM Run Vite in foreground — window stays open as long as Vite runs
node node_modules\vite\bin\vite.js --host --port 3000 --open false

echo.
echo  ================================================================
echo  Server stopped or crashed. Check the output above for errors.
echo  ================================================================
echo.
pause

@echo off
REM ============================================================
REM  BULLETPROOF: call :main then ALWAYS pause, no matter what.
REM  Even if :main crashes, errors, or exits early, the window
REM  stays open so the user can read what went wrong.
REM ============================================================
call :main
echo.
echo  ================================================================
echo  Window will stay open. Read any errors above.
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

REM Change to project directory
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
REM  WINDOWS FIREWALL: Allow ports 3000 and 2567 for LAN access
REM ================================================================
echo  Setting up Windows Firewall rules for LAN access...
netsh advfirewall firewall add rule name="Geometry Wars - Game Server (2567)" dir=in action=allow protocol=TCP localport=2567 >nul 2>&1
netsh advfirewall firewall add rule name="Geometry Wars - Web Server (3000)" dir=in action=allow protocol=TCP localport=3000 >nul 2>&1
echo  [OK] Firewall rules set (requires Administrator — may be skipped).
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
echo   2. Open browser on other device, go to one of the addresses above
echo   3. Prefer 192.168.x.x addresses (not 10.x.x.x which may be VPN)
echo   4. If blocked, right-click this .bat and Run as Administrator
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

REM Start Colyseus server in a SEPARATE window (also with pause-on-crash)
echo  Starting Colyseus multiplayer server in a NEW WINDOW (port 2567)...
echo.
start "Geometry Wars Server (port 2567)" cmd /k "node node_modules\tsx\dist\cli.mjs server\index.ts || (echo. & echo [!] SERVER CRASHED - see error above & echo. & pause)"

REM Wait for Colyseus to start
timeout /t 3 /nobreak >nul

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

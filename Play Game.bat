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
call node scripts\check-native-binaries.js
if %ERRORLEVEL% neq 0 (
    echo.
    echo  [..] Fixing Windows-specific native binaries...
    echo  [..] This may take a minute...
    echo.
    call node scripts\fix-native-binaries.js
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
echo  Starting Colyseus multiplayer server (port 2567)...

REM Start Colyseus in background
start /b npx tsx server/index.ts

REM Wait for Colyseus to start
timeout /t 2 /nobreak >nul

echo  Starting Vite dev server (port 3000)...
echo.

REM Brief delay then open browser
start /b cmd /c "timeout /t 4 /nobreak >nul && start http://localhost:3000"

REM Get local IP for LAN display
set "LOCAL_IP=unknown"
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /c:"IPv4"') do (
    for /f "tokens=*" %%b in ("%%a") do set "LOCAL_IP=%%b"
)

echo  ================================================================
echo.
echo     Game:  http://localhost:3000
echo     LAN:   http://!LOCAL_IP!:3000
echo.
echo     Press F3 in-game for debug overlay
echo     Close this window to stop all servers
echo.
echo  ================================================================
echo.
echo  --- Server output below (stays visible on crash) ---
echo.

REM Run Vite in foreground — window stays open as long as Vite runs
node node_modules\vite\bin\vite.js --host --port 3000 --open false

echo.
echo  ================================================================
echo  Server stopped or crashed. Check the output above for errors.
echo  ================================================================
echo.
pause

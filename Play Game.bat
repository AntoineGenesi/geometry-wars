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
if %ERRORLEVEL% neq 0 goto :no_node

REM Show versions
for /f "tokens=*" %%i in ('node --version') do echo  Node.js: %%i

REM Change to project directory
cd /d "%~dp0"

REM Check node_modules exists
if not exist "node_modules" goto :no_modules

REM Check if Windows .cmd wrappers exist (WSL installs only create Unix symlinks)
if not exist "node_modules\.bin\tsx.cmd" goto :fix_wincmd

:start_servers

echo.
echo  Starting Colyseus multiplayer server (port 2567)...

REM Start Colyseus in background using node directly (avoids .cmd/PATH issues)
start /b node node_modules\tsx\dist\cli.mjs server/index.ts

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

REM Run Vite in foreground using node directly
REM Window close (red X) kills all child processes
REM If Vite crashes, falls through to the pause below
node node_modules\vite\bin\vite.js --host --port 3000 --open false

echo.
echo  ================================================================
echo  Server stopped or crashed. Check the output above for errors.
echo  ================================================================
echo.
goto :end_pause

REM ================================================================
REM  Error handlers (using goto to avoid parentheses parsing issues)
REM ================================================================

:no_node
echo  [!] Node.js is not installed on Windows!
echo  Run WINDOWS-SETUP.bat first.
echo.
goto :end_pause

:no_modules
echo.
echo  [!] Dependencies not installed. Run WINDOWS-SETUP.bat first.
echo.
goto :end_pause

:fix_wincmd
echo.
echo  [..] First-time Windows setup: creating binary wrappers...
echo  (Dependencies were installed in WSL - adding Windows support)
echo.
call npm install
echo.
echo  [OK] Windows binaries ready.
goto :start_servers

:end_pause
echo  Press any key to close...
pause >nul

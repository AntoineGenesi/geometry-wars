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

REM Check native binaries using a single Node script (avoids batch goto-in-parens bug)
node -e "var f=require('fs'),p=require('path'),ok=true;[['node_modules/esbuild','node_modules/@esbuild/win32-x64'],['node_modules/vite/node_modules/esbuild','node_modules/vite/node_modules/@esbuild/win32-x64']].forEach(function(x){try{var hv=JSON.parse(f.readFileSync(p.join(x[0],'package.json'))).version;try{var bv=JSON.parse(f.readFileSync(p.join(x[1],'package.json'))).version;if(hv!==bv)ok=false}catch(e){ok=false}}catch(e){}});try{var rv=JSON.parse(f.readFileSync('node_modules/rollup/package.json')).version;var rbv=JSON.parse(f.readFileSync('node_modules/@rollup/rollup-win32-x64-msvc/package.json')).version;if(rv!==rbv)ok=false}catch(e){ok=false};if(!ok)process.exit(1)" 2>nul
if %ERRORLEVEL% neq 0 goto fix_native

:start_servers

echo.
echo  Starting Colyseus multiplayer server (port 2567)...

REM Start Colyseus in background using npx tsx (resolves tsx from node_modules)
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

:fix_native
echo.
echo  [..] Fixing Windows-specific native binaries...
echo  (WSL installed Linux binaries; downloading Windows equivalents)
echo.
echo  This may take a minute (downloading from npm)...
echo.
call node scripts\fix-native-binaries.js
set FIX_ERR=%ERRORLEVEL%
echo.
if %FIX_ERR% neq 0 (
    echo  [!] Failed to fix native binaries (exit code %FIX_ERR%). See output above.
    echo.
    echo  Press any key to close...
    pause >nul
    exit /b 1
)
echo  Binaries fixed. Starting servers...
goto :start_servers

:end_pause
echo  Press any key to close...
pause >nul

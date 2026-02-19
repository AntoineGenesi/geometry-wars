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

REM Check if Windows-specific native binaries exist (WSL installs Linux-x64 only)
REM Modern npm (v7+) hoists/dedupes packages to top level when possible
REM Check both top-level (hoisted) and nested (older npm) locations
if not exist "node_modules\@esbuild\win32-x64" (
    if not exist "node_modules\vite\node_modules\@esbuild\win32-x64" goto :fix_native
)
if not exist "node_modules\@rollup\rollup-win32-x64-msvc" goto :fix_native

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
echo  [..] Installing Windows-specific native binaries...
echo  (Dependencies were installed in WSL with Linux binaries)
echo.

REM Install to a temp directory to avoid WSL file-lock conflicts.
REM npm install into node_modules directly fails because WSL holds locks
REM on Linux binaries. Instead: download to temp, copy what we need.
set "TEMP_DIR=%TEMP%\gw-native-fix-%RANDOM%"
mkdir "%TEMP_DIR%" 2>nul

echo  Downloading @esbuild/win32-x64 and @rollup/rollup-win32-x64-msvc...
echo.
call npm install --prefix "%TEMP_DIR%" --no-save @esbuild/win32-x64@0.25.12 @rollup/rollup-win32-x64-msvc@4.57.1
if %ERRORLEVEL% neq 0 (
    echo.
    echo  [!] Download failed. Check your internet connection and try again.
    rmdir /s /q "%TEMP_DIR%" 2>nul
    goto :end_pause
)

REM Copy only the platform-specific binary packages (no tree rebuild)
echo  Copying native binaries into node_modules...
if not exist "node_modules\@esbuild" mkdir "node_modules\@esbuild"
if not exist "node_modules\@rollup" mkdir "node_modules\@rollup"
xcopy /E /I /Y "%TEMP_DIR%\node_modules\@esbuild\win32-x64" "node_modules\@esbuild\win32-x64" >nul
xcopy /E /I /Y "%TEMP_DIR%\node_modules\@rollup\rollup-win32-x64-msvc" "node_modules\@rollup\rollup-win32-x64-msvc" >nul

REM Clean up temp directory
rmdir /s /q "%TEMP_DIR%" 2>nul

echo.
echo  [OK] Windows native binaries installed.
goto :start_servers

:end_pause
echo  Press any key to close...
pause >nul

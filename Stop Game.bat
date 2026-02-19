@echo off
REM ============================================================
REM  BULLETPROOF: Pause even if something fails
REM  This ensures user can read error messages
REM ============================================================
call :main
echo.
echo  ================================================================
echo  Window will stay open. Read any messages above.
echo  ================================================================
echo.
pause
exit /b

:main
setlocal enabledelayedexpansion
title Geometry Wars 3D - Server Cleanup
color 0A

echo.
echo  ================================================================
echo     GEOMETRY WARS 3D - Stop Game Servers
echo  ================================================================
echo.

REM Check for stray processes on game ports
echo  Checking for Geometry Wars servers...
echo.

REM Kill Colyseus server on port 2567
echo  [1/2] Stopping Colyseus server (port 2567)...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr :2567') do (
    taskkill /PID %%a /F >nul 2>&1
    echo    Killed process %%a
)

REM Kill Vite dev server on port 3000
echo  [2/2] Stopping Vite dev server (port 3000)...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr :3000') do (
    taskkill /PID %%a /F >nul 2>&1
    echo    Killed process %%a
)

echo.
echo  Verifying all servers are stopped...
echo.

REM Verify port 2567 is free
netstat -ano | findstr :2567 >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo  [OK] Port 2567 is free (Colyseus stopped)
) else (
    echo  [!] Port 2567 still in use. Trying force kill of all node processes...
    taskkill /IM node.exe /F >nul 2>&1
    timeout /t 1 /nobreak >nul
    netstat -ano | findstr :2567 >nul 2>&1
    if %ERRORLEVEL% neq 0 (
        echo  [OK] Port 2567 is now free
    ) else (
        echo  [!] Port 2567 still occupied — manual intervention needed
    )
)

REM Verify port 3000 is free
netstat -ano | findstr :3000 >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo  [OK] Port 3000 is free (Vite stopped)
) else (
    echo  [!] Port 3000 still in use. Trying force kill of all node processes...
    taskkill /IM node.exe /F >nul 2>&1
    timeout /t 1 /nobreak >nul
    netstat -ano | findstr :3000 >nul 2>&1
    if %ERRORLEVEL% neq 0 (
        echo  [OK] Port 3000 is now free
    ) else (
        echo  [!] Port 3000 still occupied — manual intervention needed
    )
)

REM Kill any remaining node processes if user prefers clean slate
echo.
echo  Note: You can also manually close the Geometry Wars game windows
echo  or run this again if servers don't stop completely.
echo.
echo  [OK] Cleanup complete.
goto :eof

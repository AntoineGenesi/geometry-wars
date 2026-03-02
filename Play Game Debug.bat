@echo off
echo ========================================
echo  DEBUG LAUNCHER - Finding the crash
echo ========================================
echo.
echo  Script path: %~dp0
echo  Current dir: %CD%
echo.
pushd "%~dp0"
echo  After cd: %CD%
echo.
echo  Checking node...
where node 2>&1
echo  Exit code: %ERRORLEVEL%
echo.
echo  Checking node_modules...
if exist "node_modules" (echo  node_modules: EXISTS) else (echo  node_modules: MISSING)
echo.
echo  Press any key to try running the REAL Play Game.bat...
pause
echo.
echo  ========================================
echo  Running Play Game.bat now...
echo  ========================================
echo.
cmd /k ""%~dp0Play Game.bat""

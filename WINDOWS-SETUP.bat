@echo off
setlocal enabledelayedexpansion
title Geometry Wars - Windows Node.js Setup
color 0E

echo.
echo  ================================================================
echo     GEOMETRY WARS 3D - Windows Node.js Setup
echo  ================================================================
echo.
echo  This script installs Node.js on Windows and sets up the game.
echo.

REM Check if Node.js is already available
where node >nul 2>nul
if %ERRORLEVEL% equ 0 goto :node_found

REM Node.js not found — download and install it
echo  [!] Node.js is NOT installed on Windows.
echo.
echo  Downloading Node.js v20.19.5 installer...
echo.

set "INSTALLER=%TEMP%\node-v20.19.5-x64.msi"
set "NODE_URL=https://nodejs.org/dist/v20.19.5/node-v20.19.5-x64.msi"

REM Download using PowerShell
powershell -Command "& { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; Invoke-WebRequest -Uri '%NODE_URL%' -OutFile '%INSTALLER%' -UseBasicParsing }"

if not exist "%INSTALLER%" (
    echo  [!] Download failed.
    echo  Please manually download from:
    echo  %NODE_URL%
    echo.
    goto :end_pause
)

echo  Download complete. Running installer...
echo  (Follow the installer prompts - just click Next through everything)
echo.

REM Run the MSI installer (interactive so user can see it)
msiexec /i "%INSTALLER%"

REM Clean up installer
del "%INSTALLER%" 2>nul

echo.
echo  Installer finished. Checking if Node.js is now available...
echo.

REM Refresh PATH (the installer adds Node to PATH but current shell won't see it)
REM We need to re-read the system PATH
for /f "tokens=2*" %%a in ('reg query "HKLM\SYSTEM\CurrentControlSet\Control\Session Manager\Environment" /v PATH 2^>nul') do set "SYS_PATH=%%b"
for /f "tokens=2*" %%a in ('reg query "HKCU\Environment" /v PATH 2^>nul') do set "USR_PATH=%%b"
set "PATH=%SYS_PATH%;%USR_PATH%"

where node >nul 2>nul
if %ERRORLEVEL% neq 0 (
    echo  [!] Node.js still not found after install.
    echo  Please close this window, open a NEW command prompt,
    echo  and run WINDOWS-SETUP.bat again.
    echo.
    goto :end_pause
)

:node_found
echo  [OK] Node.js found:
node --version
echo.

for /f "tokens=*" %%i in ('node --version') do set "NODE_VER=%%i"
echo  Windows Node version: !NODE_VER!
echo  Required version:     v20.19.5
echo.

REM Change to project directory
cd /d "%~dp0"

REM Check if node_modules exists
if exist "node_modules" (
    echo  [OK] node_modules already exists.
    echo.
    goto :setup_done
)

echo  [..] Installing dependencies (npm install)...
echo  This may take a few minutes on first run.
echo.

call npm install
if %ERRORLEVEL% neq 0 (
    echo.
    echo  [!] npm install failed! Check the errors above.
    echo.
    goto :end_pause
)

echo.
echo  [OK] Dependencies installed successfully.
echo.

:setup_done
echo  ================================================================
echo     Setup complete! You can now double-click "Play Game.bat"
echo  ================================================================
echo.

:end_pause
echo  Press any key to close...
pause >nul

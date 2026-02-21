@echo off
REM ============================================================
REM  Setup-WSL-LAN.bat
REM  Configures Windows port forwarding so LAN devices can
REM  reach the Geometry Wars server running inside WSL2.
REM
REM  Run this ONCE as Administrator after starting npm run dev
REM  in WSL2. The WSL2 IP changes on reboot, so re-run if
REM  other devices can't connect after restarting.
REM ============================================================
call :main
echo.
pause
exit /b

:main
setlocal enabledelayedexpansion
title Geometry Wars - WSL2 LAN Setup
color 0A

echo.
echo  ================================================================
echo     GEOMETRY WARS 3D - WSL2 LAN PORT FORWARDING SETUP
echo  ================================================================
echo.
echo  This sets up Windows port forwarding so devices on your LAN
echo  can connect to the game server running inside WSL2.
echo.
echo  *** IMPORTANT: This script is for WSL2 dev mode (npm run dev). ***
echo  *** If you use Play Game.bat, do NOT run this script.           ***
echo  *** Play Game.bat runs servers on Windows directly — portproxy  ***
echo  *** rules created here will BREAK Play Game.bat LAN access.    ***
echo.
echo  After switching back to Play Game.bat, run "Play Game.bat" as
echo  Administrator to automatically clean up these portproxy rules.
echo.

REM Detect WSL2 IP address
echo  Detecting WSL2 IP address...
for /f "tokens=1" %%i in ('wsl hostname -I 2^>nul') do set WSL_IP=%%i

if "%WSL_IP%"=="" (
    echo  [!] Could not detect WSL2 IP address.
    echo  [!] Make sure WSL2 is running and try again.
    echo  [!] Also try: wsl hostname -I
    goto :eof
)

echo  [OK] WSL2 IP: %WSL_IP%
echo.

REM Remove old forwarding rules (in case WSL2 IP changed)
echo  Removing old port forwarding rules...
netsh interface portproxy delete v4tov4 listenport=3000 listenaddress=0.0.0.0 >nul 2>&1
netsh interface portproxy delete v4tov4 listenport=2567 listenaddress=0.0.0.0 >nul 2>&1

REM Add new forwarding rules
echo  Adding port forwarding rules...
netsh interface portproxy add v4tov4 listenport=3000 listenaddress=0.0.0.0 connectaddress=%WSL_IP% connectport=3000
if %ERRORLEVEL% neq 0 (
    echo  [!] Failed to add rule for port 3000. Run as Administrator!
    goto :eof
)
netsh interface portproxy add v4tov4 listenport=2567 listenaddress=0.0.0.0 connectaddress=%WSL_IP% connectport=2567
if %ERRORLEVEL% neq 0 (
    echo  [!] Failed to add rule for port 2567. Run as Administrator!
    goto :eof
)
echo  [OK] Port forwarding configured.
echo.

REM Firewall rules
echo  Adding Windows Firewall rules...
netsh advfirewall firewall delete rule name="GW3D WSL2 Game (3000)" >nul 2>&1
netsh advfirewall firewall delete rule name="GW3D WSL2 Server (2567)" >nul 2>&1
netsh advfirewall firewall add rule name="GW3D WSL2 Game (3000)" dir=in action=allow protocol=TCP localport=3000 >nul 2>&1
netsh advfirewall firewall add rule name="GW3D WSL2 Server (2567)" dir=in action=allow protocol=TCP localport=2567 >nul 2>&1
echo  [OK] Firewall rules added.
echo.

REM Show current forwarding rules
echo  Current port forwarding:
netsh interface portproxy show all
echo.

REM Show Windows LAN IPs for the user
echo  ================================================================
echo   HOW TO CONNECT FROM ANOTHER DEVICE:
echo.
echo   1. Make sure the game is running in WSL2 (npm run dev)
echo   2. Use one of these addresses on the other device:
echo.
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /c:"IPv4"') do (
    for /f "tokens=1" %%b in ("%%a") do (
        echo       http://%%b:3000
    )
)
echo.
echo   Prefer 192.168.x.x (your WiFi) over 10.x.x.x or 172.x.x.x
echo  ================================================================
echo.
echo  [OK] Setup complete! Re-run this script if WSL2 reboots.
goto :eof

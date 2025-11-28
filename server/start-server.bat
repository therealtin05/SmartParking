@echo off
echo ========================================
echo    Smart Parking - Signaling Server
echo ========================================
echo.

cd /d %~dp0

echo Kiem tra port 3001...
netstat -ano | findstr :3001 >nul
if %errorlevel% == 0 (
    echo.
    echo ⚠️  Port 3001 dang duoc su dung!
    echo Dang kill process cu...
    for /f "tokens=5" %%a in ('netstat -ano ^| findstr :3001 ^| findstr LISTENING') do (
        echo Killing process PID: %%a
        taskkill /F /PID %%a >nul 2>&1
    )
    timeout /t 1 >nul
    echo Done!
    echo.
)

echo Dang khoi dong server...
echo.

node signaling.js

pause


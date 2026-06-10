@echo off
chcp 65001 >nul
title Fluid Simulation Kiosk

:: ============================================================
:: Fluid Simulation - Kiosk 自启脚本
:: 用法: 直接双击运行
:: ============================================================

cd /d "%~dp0"

echo ========================================
echo   WebGL Fluid Simulation - Kiosk Mode
echo ========================================
echo.

:: 1. 检查 Node.js
where node >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] Node.js not found!
    pause
    exit /b 1
)

:: 2. 终止已有的 node 进程
echo [INFO] Stopping existing server...
taskkill /f /im node.exe >nul 2>&1
timeout /t 1 /nobreak >nul

:: 3. 启动服务器
echo [INFO] Starting server on port 8083...
start "" /MIN node "%CD%\server.js"

:: 4. 等 3 秒让服务器启动
echo [INFO] Waiting 3 seconds for server...
timeout /t 3 /nobreak >nul

:: 5. 检测浏览器并启动
set "BROWSER="

:: Edge (32-bit path, most common)
if exist "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" (
    set "BROWSER=C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
    goto launch
)

:: Edge (64-bit)
if exist "C:\Program Files\Microsoft\Edge\Application\msedge.exe" (
    set "BROWSER=C:\Program Files\Microsoft\Edge\Application\msedge.exe"
    goto launch
)

:: Chrome (64-bit)
if exist "C:\Program Files\Google\Chrome\Application\chrome.exe" (
    set "BROWSER=C:\Program Files\Google\Chrome\Application\chrome.exe"
    goto launch
)

:: Chrome (32-bit)
if exist "C:\Program Files (x86)\Google\Chrome\Application\chrome.exe" (
    set "BROWSER=C:\Program Files (x86)\Google\Chrome\Application\chrome.exe"
    goto launch
)

:: Fallback: default browser
echo [WARN] Chrome/Edge not found, using default browser...
start "" http://localhost:8083/index.html?kiosk
goto done

:launch
echo [INFO] Browser: %BROWSER%
start "" "%BROWSER%" --kiosk --no-first-run --disable-infobars --disable-session-restore http://localhost:8083/index.html?kiosk

:done
echo.
echo ========================================
echo   Kiosk mode started!
echo   Press Alt+F4 to exit
echo ========================================

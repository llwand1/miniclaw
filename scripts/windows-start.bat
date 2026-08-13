@echo off
title studentbuddy Web Server (api:18791)
cd /d "%~dp0.."

where node >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo [ERROR] 请先安装 Node 20 LTS
    pause
    exit /b 1
)

if not exist "%CD%\node_modules" (
    echo [INFO] 安装依赖...
    call npm install
    if %ERRORLEVEL% neq 0 ( echo 失败 & pause & exit /b 1 )
)

if not exist "%CD%\src\office-web\node_modules" (
    echo [INFO] 安装前端依赖...
    cd src\office-web
    call npm install
    if %ERRORLEVEL% neq 0 ( echo 失败 & pause & exit /b 1 )
    cd ..\..
)

if not exist "%CD%\dist\web\index.html" (
    echo [INFO] 构建前端...
    call node scripts\build.js
    if %ERRORLEVEL% neq 0 ( echo 失败 & pause & exit /b 1 )
)

echo [INFO] 启动 studentbuddy Web 服务...
echo [INFO] 浏览器访问 http://127.0.0.1:18791
call npm run web
if %ERRORLEVEL% neq 0 ( echo 启动失败 & pause & exit /b 1 )

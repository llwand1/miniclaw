@echo off
title MiniClaw 网页调试版
cd /d "%~dp0.."
set TSX="%~dp0..\node_modules\.bin\tsx.cmd"

echo ========================================
echo   MiniClaw 网页调试版
echo ========================================
echo.

where node >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo [错误] 请先安装 Node 20 LTS
    echo 下载地址: https://nodejs.org/
    pause
    exit /b 1
)

if not exist "%CD%\node_modules" (
    echo [1/3] 安装主项目依赖...
    call npm install
    if %ERRORLEVEL% neq 0 ( echo 安装失败 & pause & exit /b 1 )
)

if not exist "%CD%\src\office-web\node_modules" (
    echo [2/3] 安装前端依赖...
    cd src\office-web
    call npm install
    if %ERRORLEVEL% neq 0 ( echo 安装失败 & pause & exit /b 1 )
    cd ..\..
)

echo [3/3] 构建并启动...
call node scripts\build.js
if %ERRORLEVEL% neq 0 ( echo 构建失败 & pause & exit /b 1 )

echo.
echo ========================================
echo   ✅ 服务器已启动！
echo.
echo   请在浏览器中访问：
echo   http://127.0.0.1:18791
echo.
echo   按 Ctrl+C 停止
echo ========================================
echo.
%TSX% scripts/dev-server.ts
if %ERRORLEVEL% neq 0 ( echo 服务器启动失败 & pause & exit /b 1 )

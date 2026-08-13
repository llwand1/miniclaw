@echo off
title studentbuddy Web Server (127.0.0.1:18791)
cd /d "%~dp0.."
echo [%date% %time%] Starting studentbuddy dev-server...
node node_modules\tsx\dist\cli.mjs scripts\dev-server.ts
pause

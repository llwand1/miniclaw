@echo off
title studentbuddy Dev Server (api:18791 ui:5173)
cd /d "%~dp0.."
npm run web:dev > logs\dev-run.log 2>&1

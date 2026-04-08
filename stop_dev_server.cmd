@echo off
setlocal

for /f "tokens=5" %%p in ('netstat -ano ^| findstr :8000') do (
    taskkill /PID %%p /F >nul 2>&1
)

echo Stopped any process listening on port 8000.


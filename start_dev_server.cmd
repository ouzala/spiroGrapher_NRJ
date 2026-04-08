@echo off
setlocal

cd /d "%~dp0"
start "coupledOscillators dev server" cmd /k "python dev_server.py"


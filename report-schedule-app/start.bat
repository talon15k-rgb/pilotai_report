@echo off
rem Report schedule board - double-click to start. Optional: start.bat 8081
set PORT=%1
if "%PORT%"=="" set PORT=8080
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0server.ps1" -Port %PORT% -Open
pause

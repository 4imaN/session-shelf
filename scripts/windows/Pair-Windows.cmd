@echo off
cd /d "%~dp0"
node scripts\windows-connector.mjs pair
pause

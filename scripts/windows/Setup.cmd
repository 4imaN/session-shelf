@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Install Node.js 22.12 or newer, then reopen this file.
  pause
  exit /b 1
)
node -e "const [major,minor]=process.versions.node.split('.').map(Number);process.exit(major>22||(major===22&&minor>=12)?0:1)"
if errorlevel 1 (
  echo Node.js 22.12 or newer is required.
  pause
  exit /b 1
)
call npm ci --omit=dev
if errorlevel 1 (
  echo Setup failed. See the error above and WINDOWS-SETUP.md.
  pause
  exit /b 1
)
echo Setup complete. Open Pair-Windows.cmd to connect to your Mac.
pause

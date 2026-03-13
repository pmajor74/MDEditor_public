@echo off
@set NODE_TLS_REJECT_UNAUTHORIZED=0
cd /d "%~dp0"
npm run make
echo.
echo Build complete! Installer is in: out\make\
pause

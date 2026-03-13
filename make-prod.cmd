@echo off
REM Production Build Script for AzureWikiEdit
REM This script builds the production version with:
REM - Dev tools disabled
REM - Longer splash screen (3 seconds)
REM - F12 key blocked

echo ========================================
echo AzureWikiEdit Production Build
echo ========================================
echo.

REM Set production environment variable
set PROD_BUILD=true

echo Building production package...
echo.

REM Run the make command
call npm run make

if %ERRORLEVEL% EQU 0 (
    echo.
    echo ========================================
    echo Production build completed successfully!
    echo Output is in the 'out' folder.
    echo ========================================
) else (
    echo.
    echo ========================================
    echo Build failed with error code %ERRORLEVEL%
    echo ========================================
    exit /b %ERRORLEVEL%
)

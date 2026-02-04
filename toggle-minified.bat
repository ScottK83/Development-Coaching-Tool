@echo off
REM Toggle between development and production (minified) script

set HTML_FILE=index.html
set CURRENT_MODE=

REM Check current mode
findstr /C:"script.min.js" %HTML_FILE% >nul
if %ERRORLEVEL% == 0 (
    set CURRENT_MODE=PRODUCTION
) else (
    set CURRENT_MODE=DEVELOPMENT
)

echo Current mode: %CURRENT_MODE%
echo.

if "%CURRENT_MODE%"=="DEVELOPMENT" (
    echo Switching to PRODUCTION mode minified script...
    powershell -Command "(Get-Content '%HTML_FILE%') -replace 'script\.js', 'script.min.js' | Set-Content '%HTML_FILE%'"
    echo ✅ Now using script.min.js (faster, minified)
) else (
    echo Switching to DEVELOPMENT mode full script...
    powershell -Command "(Get-Content '%HTML_FILE%') -replace 'script\.min\.js', 'script.js' | Set-Content '%HTML_FILE%'"
    echo ✅ Now using script.js (full, with comments)
)

echo.
echo Done! Refresh your browser to see changes.
pause

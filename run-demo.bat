@echo off
echo ====================================
echo EntglDb.NodeJs - P2P Sync Demo
echo ====================================
echo.

cd /d "%~dp0apps\demo"

echo Checking dependencies...
call pnpm install --silent
if errorlevel 1 (
    echo.
    echo ERROR: Failed to install dependencies
    echo Make sure pnpm is installed: npm install -g pnpm
    pause
    exit /b 1
)

echo.
echo Starting interactive demo...
echo.
echo [Commands available:]
echo - put ^<collection^> ^<key^> ^<json^>
echo - get ^<collection^> ^<key^>
echo - delete ^<collection^> ^<key^>
echo - peer add ^<host^> ^<port^>
echo - sync
echo - help
echo - exit
echo.
echo ====================================
echo.

call pnpm interactive

echo.
echo ====================================
echo Demo exited
echo ====================================

@echo off
echo ====================================
echo EntglDb React Native - Mobile App
echo ====================================
echo.

cd /d "%~dp0apps\sample-react-native"



:menu
echo.
echo Select platform:
echo   1. Android
echo   2. iOS
echo   3. Exit
echo.
set /p choice="Enter choice (1-3): "

if "%choice%"=="1" goto android
if "%choice%"=="2" goto ios
if "%choice%"=="3" goto end
echo Invalid choice, please try again.
goto menu

:android
echo.
echo ====================================
echo Starting Android app...
echo ====================================
echo.
echo Make sure:
echo - Android Studio is installed
echo - Android SDK is configured
echo - Android emulator is running or device is connected
echo Starting Metro bundler in a new window...
start "Metro Bundler" cmd /c "cd apps\mobile && pnpm start"

echo.
echo Waiting for Metro to initialize...
timeout /t 5

echo.
echo ====================================
echo Building and Installing on Device...
echo ====================================
echo.
cd apps\mobile
call pnpm android
if %errorlevel% neq 0 (
    echo.
    echo [ERROR] Failed to install app. Check if:
    echo  1. Android device is connected (check 'adb devices')
    echo  2. USB debugging is enabled
    echo  3. Android SDK is configured
    pause
) else (
    echo.
    echo [SUCCESS] App launched! check your device.
)
cd ..\..
pause
goto menu

:ios
echo.
echo ====================================
echo Starting iOS app...
echo ====================================
echo.
echo Make sure:
echo - Xcode is installed
echo - CocoaPods are installed
echo - iOS simulator is available
echo.
echo Installing pods...
cd ios
call pod install
cd ..
echo.
call pnpm ios
goto end

:end
echo.
echo ====================================
echo React Native app closed
echo ====================================

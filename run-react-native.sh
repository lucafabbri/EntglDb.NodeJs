#!/bin/bash
set -e

echo "===================================="
echo "EntglDb React Native - Mobile App"
echo "===================================="
echo ""

cd "$(dirname "$0")/apps/sample-react-native"

echo "Checking dependencies..."
pnpm install --silent

echo ""
echo "Select platform:"
echo "  1. Android"
echo "  2. iOS"
read -p "Enter choice (1-2): " choice

case $choice in
    1)
        echo ""
        echo "===================================="
        echo "Starting Android app..."
        echo "===================================="
        echo ""
        echo "Make sure:"
        echo "- Android Studio is installed"
        echo "- Android SDK is configured"
        echo "- Android emulator is running or device is connected"
        echo ""
        pnpm android
        ;;
    2)
        echo ""
        echo "===================================="
        echo "Starting iOS app..."
        echo "===================================="
        echo ""
        echo "Make sure:"
        echo "- Xcode is installed"
        echo "- CocoaPods are installed"
        echo "- iOS simulator is available"
        echo ""
        echo "Installing pods..."
        cd ios
        pod install
        cd ..
        echo ""
        pnpm ios
        ;;
    *)
        echo "Invalid choice"
        exit 1
        ;;
esac

echo ""
echo "===================================="
echo "React Native app closed"
echo "===================================="

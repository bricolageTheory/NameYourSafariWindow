#!/bin/bash
set -e

export DEVELOPER_DIR="/Library/Developer/CommandLineTools"

APP_NAME="Safari Window Switcher"
BUNDLE_ID="com.coolnick.SafariWindowSwitcher"
EXTENSION_BUNDLE_ID="${BUNDLE_ID}.Extension"
BUILD_DIR="$(pwd)/build"
APP_BUNDLE="/Applications/${APP_NAME}.app"
PLUGINS_DIR="${APP_BUNDLE}/Contents/PlugIns"
EXTENSION_BUNDLE="${PLUGINS_DIR}/${APP_NAME} Extension.appex"

echo "========================================================"
echo "Building Production Bundle for ${APP_NAME}..."
echo "========================================================"

rm -rf "${APP_BUNDLE}" "${BUILD_DIR}"
mkdir -p "${BUILD_DIR}"
mkdir -p "${APP_BUNDLE}/Contents/MacOS"
mkdir -p "${APP_BUNDLE}/Contents/Resources"
mkdir -p "${EXTENSION_BUNDLE}/Contents/MacOS"
mkdir -p "${EXTENSION_BUNDLE}/Contents/Resources"

# 1. Entitlements
cat <<EOF > "${BUILD_DIR}/entitlements.plist"
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>com.apple.security.app-sandbox</key>
    <true/>
    <key>com.apple.security.files.user-selected.read-only</key>
    <true/>
</dict>
</plist>
EOF

# 2. Main App Info.plist
cat <<EOF > "${APP_BUNDLE}/Contents/Info.plist"
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleDevelopmentRegion</key>
    <string>en</string>
    <key>CFBundleExecutable</key>
    <string>Safari Window Switcher</string>
    <key>CFBundleIdentifier</key>
    <string>${BUNDLE_ID}</string>
    <key>CFBundleInfoDictionaryVersion</key>
    <string>6.0</string>
    <key>CFBundleName</key>
    <string>${APP_NAME}</string>
    <key>CFBundlePackageType</key>
    <string>APPL</string>
    <key>CFBundleShortVersionString</key>
    <string>0.1.0</string>
    <key>CFBundleVersion</key>
    <string>1</string>
    <key>LSMinimumSystemVersion</key>
    <string>11.0</string>
</dict>
</plist>
EOF

# 3. Extension Appex Info.plist
cat <<EOF > "${EXTENSION_BUNDLE}/Contents/Info.plist"
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleDevelopmentRegion</key>
    <string>en</string>
    <key>CFBundleExecutable</key>
    <string>Safari Window Switcher Extension</string>
    <key>CFBundleIdentifier</key>
    <string>${EXTENSION_BUNDLE_ID}</string>
    <key>CFBundleInfoDictionaryVersion</key>
    <string>6.0</string>
    <key>CFBundleName</key>
    <string>${APP_NAME} Extension</string>
    <key>CFBundlePackageType</key>
    <string>XPC!</string>
    <key>CFBundleShortVersionString</key>
    <string>0.1.0</string>
    <key>CFBundleVersion</key>
    <string>1</string>
    <key>LSMinimumSystemVersion</key>
    <string>11.0</string>
    <key>NSExtension</key>
    <dict>
        <key>NSExtensionPointIdentifier</key>
        <string>com.apple.Safari.web-extension</string>
        <key>NSExtensionPrincipalClass</key>
        <string>SafariWebExtensionHandler</string>
    </dict>
</dict>
</plist>
EOF

# 4. Compile App Host & Extension
swiftc -target arm64-apple-macosx11.0 -parse-as-library -framework AppKit -framework SafariServices "App/AppDelegate.swift" -o "${APP_BUNDLE}/Contents/MacOS/Safari Window Switcher"
swiftc -target arm64-apple-macosx11.0 -framework Foundation -framework SafariServices "Extension/SafariWebExtensionHandler.swift" -e 'import Foundation
import SafariServices

@_silgen_name("NSExtensionMain")
func NSExtensionMain(_ argc: Int32, _ argv: UnsafeMutablePointer<UnsafeMutablePointer<CChar>?>?) -> Int32

_ = NSExtensionMain(CommandLine.argc, CommandLine.unsafeArgv)' -o "${EXTENSION_BUNDLE}/Contents/MacOS/Safari Window Switcher Extension"

# 5. Copy WebExtension resources including prompt
cp -R manifest.json background popup prompt options icons "${EXTENSION_BUNDLE}/Contents/Resources/"

# 6. Sign binaries
codesign --force --deep --options runtime --entitlements "${BUILD_DIR}/entitlements.plist" --sign - "${EXTENSION_BUNDLE}"
codesign --force --deep --options runtime --entitlements "${BUILD_DIR}/entitlements.plist" --sign - "${APP_BUNDLE}"

# 7. Register plugin with LaunchServices
/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -f "${APP_BUNDLE}"
pluginkit -a "${EXTENSION_BUNDLE}"
pluginkit -e use -i "${EXTENSION_BUNDLE_ID}"

echo "========================================================"
echo "Successfully built & installed ${APP_BUNDLE}"
echo "========================================================"

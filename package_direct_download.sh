#!/bin/bash
set -e

APP_NAME="Name Your Safari Window"
VERSION="0.3.0"
BUNDLE_ID="com.coolnick.NameYourSafariWindow"
EXTENSION_BUNDLE_ID="${BUNDLE_ID}.Extension"
BUILD_DIR="$(pwd)/build/dist"
DIST_DIR="$(pwd)/dist"
APP_BUNDLE="${BUILD_DIR}/${APP_NAME}.app"
PLUGINS_DIR="${APP_BUNDLE}/Contents/PlugIns"
EXTENSION_BUNDLE="${PLUGINS_DIR}/${APP_NAME} Extension.appex"
DMG_NAME="${DIST_DIR}/NameYourSafariWindow-v${VERSION}.dmg"
ZIP_NAME="${DIST_DIR}/NameYourSafariWindow-v${VERSION}.zip"

echo "========================================================"
echo "Packaging Direct Web Download Bundle for ${APP_NAME} v${VERSION}..."
echo "========================================================"

rm -rf "${BUILD_DIR}" "${DIST_DIR}"
mkdir -p "${BUILD_DIR}" "${DIST_DIR}"
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
    <string>${VERSION}</string>
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
    <string>${VERSION}</string>
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

# 4. Compile Host & Extension
swiftc -target arm64-apple-macosx11.0 -parse-as-library -framework AppKit -framework SafariServices "App/AppDelegate.swift" -o "${APP_BUNDLE}/Contents/MacOS/Safari Window Switcher"
swiftc -target arm64-apple-macosx11.0 -framework Foundation -framework SafariServices "Extension/SafariWebExtensionHandler.swift" -e 'import Foundation
import SafariServices

@_silgen_name("NSExtensionMain")
func NSExtensionMain(_ argc: Int32, _ argv: UnsafeMutablePointer<UnsafeMutablePointer<CChar>?>?) -> Int32

_ = NSExtensionMain(CommandLine.argc, CommandLine.unsafeArgv)' -o "${EXTENSION_BUNDLE}/Contents/MacOS/Safari Window Switcher Extension"

# 5. Copy WebExtension resources
cp -R manifest.json background popup prompt options icons "${EXTENSION_BUNDLE}/Contents/Resources/"

# 6. Check for Developer ID Certificate or fallback to ad-hoc
SIGNING_IDENTITY=$(security find-identity -v -p codesigning | grep "Developer ID Application" | head -n 1 | cut -d '"' -f 2 || true)

if [ -z "${SIGNING_IDENTITY}" ]; then
    echo "Notice: No 'Developer ID Application' certificate found in Keychain."
    echo "Signing with ad-hoc identity for local distribution testing..."
    SIGNING_IDENTITY="-"
else
    echo "Using Developer ID Application Certificate: ${SIGNING_IDENTITY}"
fi

codesign --force --deep --options runtime --entitlements "${BUILD_DIR}/entitlements.plist" --sign "${SIGNING_IDENTITY}" "${EXTENSION_BUNDLE}"
codesign --force --deep --options runtime --entitlements "${BUILD_DIR}/entitlements.plist" --sign "${SIGNING_IDENTITY}" "${APP_BUNDLE}"

# 7. Create ZIP archive and DMG for direct web download
cd "${BUILD_DIR}"
zip -r "${ZIP_NAME}" "${APP_NAME}.app" > /dev/null
hdiutil create -volname "${APP_NAME}" -srcfolder "${APP_BUNDLE}" -ov -format UDZO "${DMG_NAME}" > /dev/null
cd - > /dev/null

if [ "${SIGNING_IDENTITY}" != "-" ]; then
    echo "Signing DMG Disk Image with Developer ID Application Certificate..."
    codesign --sign "${SIGNING_IDENTITY}" "${DMG_NAME}"
fi

# 8. Notarization & Stapling (if --notarize argument passed or requested)
if [[ "$*" == *"--notarize"* ]]; then
    echo "========================================================"
    echo "Submitting ${DMG_NAME} to Apple Notary Service..."
    echo "========================================================"
    NOTARY_OUTPUT=$(xcrun notarytool submit "${DMG_NAME}" --keychain-profile "AC_NOTARY" --wait 2>&1)
    echo "${NOTARY_OUTPUT}"

    if echo "${NOTARY_OUTPUT}" | grep -q "status: Accepted"; then
        echo "Notarization Accepted! Waiting 20 seconds for Apple CloudKit CDN propagation..."
        sleep 20
        echo "Stapling notarization ticket to ${DMG_NAME}..."
        xcrun stapler staple "${DMG_NAME}"
        echo "Stapling successfully verified!"
    else
        echo "Error: Apple Notary Service submission was not accepted."
        exit 1
    fi
fi

echo "========================================================"
echo "Direct Download Packages Successfully Created:"
echo "  1. ZIP Archive: ${ZIP_NAME}"
echo "  2. DMG Installer: ${DMG_NAME}"
echo "========================================================"


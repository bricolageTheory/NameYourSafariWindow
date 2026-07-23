#!/bin/bash
set -e

APP_NAME="Safari Window Switcher"
BUNDLE_ID="com.coolnick.SafariWindowSwitcher"
EXTENSION_BUNDLE_ID="${BUNDLE_ID}.Extension"
BUILD_DIR="$(pwd)/build"
APP_BUNDLE="/Applications/${APP_NAME}.app"
PLUGINS_DIR="${APP_BUNDLE}/Contents/PlugIns"
EXTENSION_BUNDLE="${PLUGINS_DIR}/${APP_NAME} Extension.appex"

echo "Building and installing Safari Web Extension macOS App..."

rm -rf "${APP_BUNDLE}" "${BUILD_DIR}"
mkdir -p "${BUILD_DIR}"
mkdir -p "${APP_BUNDLE}/Contents/MacOS"
mkdir -p "${APP_BUNDLE}/Contents/Resources"
mkdir -p "${EXTENSION_BUNDLE}/Contents/MacOS"
mkdir -p "${EXTENSION_BUNDLE}/Contents/Resources"

# Entitlements
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

# 1. Main App Info.plist
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
    <string>1.0</string>
    <key>CFBundleVersion</key>
    <string>1</string>
    <key>LSMinimumSystemVersion</key>
    <string>11.0</string>
</dict>
</plist>
EOF

# 2. Extension Appex Info.plist
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
    <string>1.0</string>
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

# 3. Main App Swift source & compilation
cat <<'EOF' > "${BUILD_DIR}/main.swift"
import AppKit
import SafariServices

class AppDelegate: NSObject, NSApplicationDelegate {
    func applicationDidFinishLaunching(_ notification: Notification) {
        SFSafariApplication.showPreferencesForExtension(withIdentifier: "com.coolnick.SafariWindowSwitcher.Extension") { error in
            if let error = error {
                print("Error showing preferences: \(error)")
            }
            DispatchQueue.main.async {
                NSApp.terminate(nil)
            }
        }
    }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.run()
EOF

swiftc -target arm64-apple-macosx11.0 -framework AppKit -framework SafariServices "${BUILD_DIR}/main.swift" -o "${APP_BUNDLE}/Contents/MacOS/Safari Window Switcher"

# 4. Extension Swift source & compilation
cat <<'EOF' > "${BUILD_DIR}/handler.swift"
import Foundation
import SafariServices

@objc(SafariWebExtensionHandler)
class SafariWebExtensionHandler: NSObject, NSExtensionRequestHandling {
    func beginRequest(with context: NSExtensionContext) {
        let response = NSExtensionItem()
        context.completeRequest(returningItems: [response], completionHandler: nil)
    }
}

@_silgen_name("NSExtensionMain")
func NSExtensionMain(_ argc: Int32, _ argv: UnsafeMutablePointer<UnsafeMutablePointer<CChar>?>?) -> Int32

_ = NSExtensionMain(CommandLine.argc, CommandLine.unsafeArgv)
EOF

swiftc -target arm64-apple-macosx11.0 -framework Foundation -framework SafariServices "${BUILD_DIR}/handler.swift" -o "${EXTENSION_BUNDLE}/Contents/MacOS/Safari Window Switcher Extension"

# 5. Copy WebExtension resources into .appex Contents/Resources
cp -R manifest.json background popup options content icons "${EXTENSION_BUNDLE}/Contents/Resources/"

# 6. Sign both appex and app with Sandbox Entitlements
codesign --force --deep --options runtime --entitlements "${BUILD_DIR}/entitlements.plist" --sign - "${EXTENSION_BUNDLE}"
codesign --force --deep --options runtime --entitlements "${BUILD_DIR}/entitlements.plist" --sign - "${APP_BUNDLE}"

# 7. Register plugin with PlugInKit
pluginkit -a "${EXTENSION_BUNDLE}"

echo "Successfully installed ${APP_BUNDLE} and registered extension!"

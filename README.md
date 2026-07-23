# 🧭 Safari Window Switcher (v0.1.0)

> **Assign custom names to Safari windows, filter open windows instantly, and switch focus effortlessly.**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Safari WebExtension](https://img.shields.io/badge/Safari-WebExtension-000000.svg?logo=safari)](https://developer.apple.com/safari/extensions/)
[![Privacy: Zero Access](https://img.shields.io/badge/Privacy-100%25%20On--Device-success.svg)](README.md#privacy--security)

---

## ✨ Features

- 🏷️ **Custom Window Naming**: Assign distinct labels (`Work`, `Personal`, `LLM Research`, `Finance`) to any Safari window.
- 💬 **Interactive New Window Prompt**: Automatically prompts you when opening a new Safari window (`Cmd + N`) with a creative random pre-filled name, auto-highlighted for 1-click **Enter** acceptance or editing!
- ⚡ **Rapid Window Switcher**: Open the switcher popup anytime using **`Control + Option + W`** (**`^ + ⌥ + W`**), type to filter, and press Enter to jump to any window.
- 💬 **Hover Tooltip**: Hovering over the extension toolbar icon in any window displays its custom assigned name.
- 🔄 **Smart Session Restoration**: Automatically matches window names across Safari and MacBook restarts using window session fingerprinting.
- 🔒 **100% Offline & Private**: All window names stay strictly on your device (`browser.storage.local`). Zero host permissions, zero telemetry, zero external network connections.

---

## ⌨️ Keyboard Shortcut

Default Shortcut: **`Control + Option + W`** (**`^ + ⌥ + W`**)
- **Why Control + Option**: Uses the `Control (^)` and `Option (⌥)` modifiers, which are **completely unassigned by macOS system, Safari, and standard Mac applications**, guaranteeing zero keyboard shortcut conflicts!

---

## 🛠️ Building & Installation (Open Source)

This extension is 100% open source. You can build and install it locally on your Mac for free:

### Option A: 1-Click Build Script

1. Clone or download this repository.
2. Open Terminal in the project folder and run:
   ```bash
   ./build_production.sh
   ```
3. Open **Safari > Settings > Developer 🛠️** tab and check **"Allow Unsigned Extensions"**.
4. Switch to the **Extensions** tab—**Safari Window Switcher** is ready to use!

### Option B: Build in Xcode (Permanent Sign)

1. Open `xcode/Safari Window Switcher.xcodeproj` in Xcode.
2. Select your free **Personal Team** under **Signing & Capabilities** for both targets.
3. Press **`Cmd + R`** to build!

---

## 🔒 Privacy & Security

- **Permissions**: Requests **only `storage` permission**. No host permissions (`<all_urls>`), no browsing history permissions.
- **Content Security Policy (CSP)**: Strict `script-src 'self'; object-src 'none';` preventing dynamic code evaluation (`eval()`) or remote scripts.
- **XSS Immunity**: Popup UI elements are rendered strictly via safe DOM methods (`document.createElement`, `textContent`).

---

## 📄 License & Author

- **Author**: Nick Lee <coolnickldd@gmail.com>
- **Version**: 0.1.0
- **License**: MIT

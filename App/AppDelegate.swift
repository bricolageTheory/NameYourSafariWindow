import AppKit
import SafariServices

@main
class AppDelegate: NSObject, NSApplicationDelegate {

    func applicationDidFinishLaunching(_ aNotification: Notification) {
        SFSafariApplication.showPreferencesForExtension(withIdentifier: "com.coolnick.nameYourSafariWindows.Extension") { error in
            if let error = error {
                print("Error opening preferences: \(error.localizedDescription)")
            }
            DispatchQueue.main.async {
                NSApp.terminate(nil)
            }
        }
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        return true
    }
}

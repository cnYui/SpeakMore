import SwiftUI
import SpeakMoreCore

/// 应用代理：启动时开始语音链路；关掉最后一个窗口也不退出（快捷键和菜单栏要一直工作，退出走菜单栏的“退出”）。
final class AppDelegate: NSObject, NSApplicationDelegate {
    func applicationDidFinishLaunching(_ notification: Notification) {
        Task { @MainActor in AppModel.shared.startServices() }
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { false }

    func applicationWillTerminate(_ notification: Notification) {
        MainActor.assumeIsolated { AppModel.shared.stopServices() }
    }
}

@main
struct SpeakMoreApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) private var delegate
    @State private var model = AppModel.shared

    var body: some Scene {
        WindowGroup(id: "main") {
            ContentView()
                .environment(model)
                .environment(\.locale, model.locale)
                .frame(minWidth: 860, minHeight: 600)
        }
        .defaultSize(width: 1040, height: 720)
        .commands {
            // 单窗口应用：去掉“新建窗口”。
            CommandGroup(replacing: .newItem) {}
        }

        // ⌘, 打开的系统惯例设置窗口，内容和侧边栏里的“设置”页是同一个视图。
        Settings {
            SettingsView()
                .environment(model)
                .environment(\.locale, model.locale)
                .frame(width: 640, height: 640)
                .containerBackground(.ultraThinMaterial, for: .window)
        }

        // 菜单栏图标：打开主窗口、退出（和 Electron 版托盘菜单一致）。
        MenuBarExtra {
            MenuBarContent()
                .environment(model)
                .environment(\.locale, model.locale)
        } label: {
            Image("MenuBarGlyph")
        }
    }
}

private struct MenuBarContent: View {
    @Environment(AppModel.self) private var model
    @Environment(\.openWindow) private var openWindow

    var body: some View {
        let ready = model.coordinator?.hotkeysActive == true
        Text(model.t(ready ? "menubar.hotkeysReady" : "menubar.needPermissions"))
        Divider()
        Button(model.t("menubar.openMain")) {
            openWindow(id: "main")
            NSApp.activate(ignoringOtherApps: true)
        }
        if !ready {
            Button(model.t("menubar.openSettings")) {
                model.selection = .settings
                openWindow(id: "main")
                NSApp.activate(ignoringOtherApps: true)
            }
        }
        Divider()
        Button(model.t("menubar.quit")) { NSApp.terminate(nil) }
            .keyboardShortcut("q")
    }
}

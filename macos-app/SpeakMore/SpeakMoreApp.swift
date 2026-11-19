import SwiftUI
import SpeakMoreCore

@main
struct SpeakMoreApp: App {
    @State private var model = AppModel()

    var body: some Scene {
        WindowGroup {
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
        }
    }
}

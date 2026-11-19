import AppKit
import ApplicationServices
import AVFoundation

struct Microphone: Identifiable, Equatable {
    let id: String
    let name: String
}

/// 只做和 macOS 系统交互的事：剪贴板、辅助功能权限、麦克风枚举、目录选择。
enum Platform {
    static func copyToPasteboard(_ text: String) {
        guard !text.isEmpty else { return }
        let pasteboard = NSPasteboard.general
        pasteboard.clearContents()
        pasteboard.setString(text, forType: .string)
    }

    /// 辅助功能权限：全局 Option 快捷键、自动粘贴和选区上下文都依赖它。
    static func isAccessibilityTrusted() -> Bool {
        AXIsProcessTrusted()
    }

    static func openAccessibilitySettings() {
        let url = URL(string: "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility")!
        NSWorkspace.shared.open(url)
    }

    static func microphones() -> [Microphone] {
        let session = AVCaptureDevice.DiscoverySession(
            deviceTypes: [.microphone, .external],
            mediaType: .audio,
            position: .unspecified
        )
        return session.devices.map { Microphone(id: $0.uniqueID, name: $0.localizedName) }
    }

    /// 弹出系统目录选择面板，取消返回 nil。
    @MainActor
    static func chooseDirectory(startingAt path: String, prompt: String) -> String? {
        let panel = NSOpenPanel()
        panel.canChooseFiles = false
        panel.canChooseDirectories = true
        panel.canCreateDirectories = true
        panel.allowsMultipleSelection = false
        panel.prompt = prompt
        if !path.isEmpty { panel.directoryURL = URL(fileURLWithPath: path, isDirectory: true) }
        return panel.runModal() == .OK ? panel.url?.path : nil
    }
}

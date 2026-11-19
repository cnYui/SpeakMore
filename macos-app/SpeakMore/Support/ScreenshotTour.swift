import AppKit

/// 开发者工具：设置 `SPEAKMORE_SCREENSHOT_DIR` 启动时，应用依次切到各个页面，把自己的窗口渲染成 PNG 后退出。
/// 渲染的是应用自己的视图层级，不需要“屏幕录制”权限，所以可以在 SSH 会话 / CI 里用来做界面核对。
/// - `SPEAKMORE_SCREENSHOT_PAGES`：指定页面（逗号分隔，默认全部）。
/// - 每页输出 `<page>.png`（`cacheDisplay`）和 `<page>-layer.png`（`CALayer.render`），
///   以及一份 `view-tree.txt`（窗口里的文字控件内容，以及侧边栏的行数和当前选中行）。
///   注意：这两种渲染方式都画不出 SwiftUI 侧边栏的行内容，侧边栏以 `view-tree.txt` 里的行数 / 选中行为准。
/// 没设环境变量时什么都不做。
@MainActor
enum ScreenshotTour {
    static func runIfRequested(model: AppModel) async {
        let environment = ProcessInfo.processInfo.environment
        guard let directory = environment["SPEAKMORE_SCREENSHOT_DIR"], !directory.isEmpty else { return }
        let names = (environment["SPEAKMORE_SCREENSHOT_PAGES"] ?? AppPage.allCases.map(\.rawValue).joined(separator: ","))
            .split(separator: ",")
            .map { String($0).trimmingCharacters(in: .whitespaces) }
        let base = URL(fileURLWithPath: directory)

        try? FileManager.default.createDirectory(at: base, withIntermediateDirectories: true)
        try? await Task.sleep(for: .seconds(2.5))
        // 抢到前台，窗口才是“活动”状态，控件颜色（强调色、选中态）和用户实际看到的一致。
        NSApp.activate(ignoringOtherApps: true)
        mainWindow?.makeKeyAndOrderFront(nil)
        try? await Task.sleep(for: .seconds(0.5))
        let windowList = NSApp.windows.map { "\(type(of: $0)) visible=\($0.isVisible) titled=\($0.styleMask.contains(.titled)) frame=\($0.frame) content=\($0.contentView != nil)" }.joined(separator: "\n")
        try? windowList.write(to: base.appendingPathComponent("windows.txt"), atomically: true, encoding: .utf8)

        var tree = ""
        for name in names {
            guard let page = AppPage(rawValue: name) else { continue }
            model.selection = page
            try? await Task.sleep(for: .seconds(2))
            save(base: base, name: name)
            tree += "=== \(name) ===\n" + viewTree()
        }
        try? tree.write(to: base.appendingPathComponent("view-tree.txt"), atomically: true, encoding: .utf8)
        NSApp.terminate(nil)
    }


    /// 开发者工具：设置 `SPEAKMORE_CLOSE_TEST_FILE` 时，启动 3 秒后模拟点关闭按钮（performClose），把窗口状态写进这个文件后退出。
    /// 用来在没有屏幕录制 / 辅助功能权限的远程会话里验证“关闭 = 最小化”。
    static func runCloseTestIfRequested() async {
        guard let path = ProcessInfo.processInfo.environment["SPEAKMORE_CLOSE_TEST_FILE"], !path.isEmpty else { return }
        try? await Task.sleep(for: .seconds(3))
        guard let window = mainWindow else {
            try? "no-main-window".write(toFile: path, atomically: true, encoding: .utf8)
            NSApp.terminate(nil)
            return
        }
        let before = "before: miniaturized=\(window.isMiniaturized) visible=\(window.isVisible)"
        // SPEAKMORE_CLOSE_TEST_SKIP_CLOSE=1：不点关闭，只记录窗口自己的状态（用来排除“启动时就是最小化的”）。
        if ProcessInfo.processInfo.environment["SPEAKMORE_CLOSE_TEST_SKIP_CLOSE"] == nil { window.performClose(nil) }
        try? await Task.sleep(for: .seconds(2))
        let after = "after: miniaturized=\(window.isMiniaturized) alive=\(NSApp.windows.contains(window))"
        try? [before, after].joined(separator: "\n").write(toFile: path, atomically: true, encoding: .utf8)
        NSApp.terminate(nil)
    }

    /// 主窗口：有标题栏的普通窗口。菜单栏图标（MenuBarExtra）和悬浮窗口也是可见窗口，不能误选。
    private static var mainWindow: NSWindow? {
        NSApp.windows.first { $0.styleMask.contains(.titled) && $0.contentView != nil && $0.frame.width > 400 }
    }

    private static var frameView: NSView? {
        mainWindow?.contentView?.superview
    }

    private static func save(base: URL, name: String) {
        guard let frameView else { return }
        let bounds = frameView.bounds

        if let representation = frameView.bitmapImageRepForCachingDisplay(in: bounds) {
            frameView.cacheDisplay(in: bounds, to: representation)
            try? representation.representation(using: .png, properties: [:])?
                .write(to: base.appendingPathComponent("\(name).png"))
        }

        let scale = frameView.window?.backingScaleFactor ?? 2
        if let layer = frameView.layer,
           let representation = NSBitmapImageRep(
               bitmapDataPlanes: nil,
               pixelsWide: Int(bounds.width * scale),
               pixelsHigh: Int(bounds.height * scale),
               bitsPerSample: 8,
               samplesPerPixel: 4,
               hasAlpha: true,
               isPlanar: false,
               colorSpaceName: .deviceRGB,
               bytesPerRow: 0,
               bitsPerPixel: 0
           ),
           let context = NSGraphicsContext(bitmapImageRep: representation) {
            representation.size = bounds.size
            context.cgContext.scaleBy(x: scale, y: scale)
            layer.render(in: context.cgContext)
            try? representation.representation(using: .png, properties: [:])?
                .write(to: base.appendingPathComponent("\(name)-layer.png"))
        }
    }

    /// 递归列出窗口里的视图类型、文字内容，以及表格 / 侧边栏的行数和选中行。
    private static func viewTree() -> String {
        guard let root = frameView else { return "(no window)\n" }
        var lines: [String] = []
        func walk(_ view: NSView, depth: Int) {
            var text = ""
            if let field = view as? NSTextField { text = " \"\(field.stringValue)\"" }
            if let table = view as? NSTableView {
                text = " rows=\(table.numberOfRows) selectedRow=\(table.selectedRow)"
            }
            if !text.isEmpty || depth < 3 {
                lines.append(String(repeating: "  ", count: depth) + String(describing: type(of: view)) + text)
            }
            view.subviews.forEach { walk($0, depth: depth + 1) }
        }
        walk(root, depth: 0)
        return lines.joined(separator: "\n") + "\n"
    }
}

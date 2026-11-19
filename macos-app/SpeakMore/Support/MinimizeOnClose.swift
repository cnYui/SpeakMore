import AppKit
import SwiftUI

/// 点主窗口的关闭按钮（或 ⌘W）不退出，也不销毁窗口，而是最小化到 Dock；点 Dock 图标就能还原。
/// 真正退出走菜单栏图标里的“退出”或 ⌘Q。和 Windows 版（`window-manager.js` 的 close 处理）行为一致。
///
/// SwiftUI 的窗口有自己的 NSWindowDelegate，直接替换会弄坏它的状态保存等行为，所以用一个代理：
/// 只接管 `windowShouldClose`，其余所有委托方法原样转给原来的委托。
final class MinimizeOnCloseDelegate: NSObject, NSWindowDelegate {
    weak var original: NSWindowDelegate?

    func windowShouldClose(_ sender: NSWindow) -> Bool {
        sender.miniaturize(nil)
        return false
    }

    override func responds(to aSelector: Selector!) -> Bool {
        super.responds(to: aSelector) || (original?.responds(to: aSelector) ?? false)
    }

    override func forwardingTarget(for aSelector: Selector!) -> Any? {
        if let original, original.responds(to: aSelector) { return original }
        return super.forwardingTarget(for: aSelector)
    }
}

enum MinimizeOnClose {
    private nonisolated(unsafe) static var associationKey: UInt8 = 0

    @MainActor
    static func install(on window: NSWindow) {
        if window.delegate is MinimizeOnCloseDelegate { return }
        let proxy = MinimizeOnCloseDelegate()
        proxy.original = window.delegate
        // NSWindow.delegate 是弱引用：用关联对象让代理和窗口同生命周期。
        objc_setAssociatedObject(window, &associationKey, proxy, .OBJC_ASSOCIATION_RETAIN_NONATOMIC)
        window.delegate = proxy
    }
}

/// 放进主窗口视图的背景里，窗口一出现就装上“关闭 = 最小化”。
struct MinimizeOnCloseInstaller: NSViewRepresentable {
    func makeNSView(context: Context) -> NSView {
        let view = InstallerView()
        return view
    }

    func updateNSView(_ nsView: NSView, context: Context) {}

    private final class InstallerView: NSView {
        override func viewDidMoveToWindow() {
            super.viewDidMoveToWindow()
            if let window { MinimizeOnClose.install(on: window) }
        }
    }
}

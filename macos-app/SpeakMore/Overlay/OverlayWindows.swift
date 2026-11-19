import AppKit
import Observation
import SwiftUI
import SpeakMoreCore

/// 悬浮窗口不能抢走当前输入焦点（否则听写结果会粘到别处），所以用不激活的 NSPanel：
/// 不成为 key / main、不随应用失活隐藏、出现在所有桌面和全屏应用之上。
private final class OverlayPanel: NSPanel {
    override var canBecomeKey: Bool { false }
    override var canBecomeMain: Bool { false }
}

@MainActor
final class OverlayWindows {
    private let overlay: OverlayController
    private let barPanel: OverlayPanel
    private let infoPanel: OverlayPanel

    init(overlay: OverlayController) {
        self.overlay = overlay
        barPanel = Self.makePanel(
            size: OverlayLayout.barSize, ignoresMouse: true, hasShadow: false,
            content: FloatingBarView(overlay: overlay)
        )
        infoPanel = Self.makePanel(
            size: OverlayLayout.panelSize, ignoresMouse: false, hasShadow: true,
            content: FloatingPanelView(overlay: overlay)
        )
    }

    private static func makePanel<Content: View>(
        size: (width: Double, height: Double), ignoresMouse: Bool, hasShadow: Bool, content: Content
    ) -> OverlayPanel {
        let panel = OverlayPanel(
            contentRect: NSRect(x: 0, y: 0, width: size.width, height: size.height),
            styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: true
        )
        panel.contentView = NSHostingView(rootView: content)
        panel.isOpaque = false
        panel.backgroundColor = .clear
        panel.hasShadow = hasShadow
        panel.ignoresMouseEvents = ignoresMouse
        panel.level = .statusBar
        panel.hidesOnDeactivate = false
        panel.isReleasedWhenClosed = false
        panel.isMovable = false
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .stationary, .ignoresCycle]
        return panel
    }

    /// 开始跟随 `OverlayController` 的状态显示 / 隐藏窗口。
    func start() {
        apply()
        track()
    }

    private func track() {
        withObservationTracking {
            _ = overlay.barVisible
            _ = overlay.panel
        } onChange: { [weak self] in
            Task { @MainActor in
                self?.apply()
                self?.track()
            }
        }
    }

    private func apply() {
        if overlay.barVisible { show(barPanel, size: OverlayLayout.barSize) } else { barPanel.orderOut(nil) }
        if overlay.panel != nil { show(infoPanel, size: OverlayLayout.panelSize) } else { infoPanel.orderOut(nil) }
    }

    /// 每次显示都重新定位（用户可能换了屏幕）并重新提升层级，但不激活应用、不抢焦点。
    private func show(_ panel: OverlayPanel, size: (width: Double, height: Double)) {
        let work = currentWorkArea()
        let frame = OverlayLayout.bottomCenter(workArea: work, size: size)
        panel.setFrame(NSRect(x: frame.x, y: frame.y, width: frame.width, height: frame.height), display: true)
        panel.level = .statusBar
        panel.orderFrontRegardless()
    }

    /// 鼠标所在屏幕的可用区域（不含菜单栏和 Dock）。
    private func currentWorkArea() -> OverlayRect {
        let mouse = NSEvent.mouseLocation
        let screen = NSScreen.screens.first { NSMouseInRect(mouse, $0.frame, false) } ?? NSScreen.main ?? NSScreen.screens.first
        let visible = screen?.visibleFrame ?? NSRect(x: 0, y: 0, width: 1440, height: 900)
        return OverlayRect(x: visible.minX, y: visible.minY, width: visible.width, height: visible.height)
    }

    func stop() {
        barPanel.orderOut(nil)
        infoPanel.orderOut(nil)
    }

    // MARK: 开发者工具：把悬浮窗口渲染成 PNG

    /// 渲染当前可见的悬浮窗口内容（不需要屏幕录制权限）。返回写出的文件名。
    @discardableResult
    func snapshot(to directory: URL, prefix: String) -> [String] {
        var written: [String] = []
        for (name, panel, visible) in [("bar", barPanel, overlay.barVisible), ("panel", infoPanel, overlay.panel != nil)] where visible {
            guard let view = panel.contentView else { continue }
            view.layoutSubtreeIfNeeded()
            let bounds = view.bounds
            guard let representation = view.bitmapImageRepForCachingDisplay(in: bounds) else { continue }
            view.cacheDisplay(in: bounds, to: representation)
            let file = "\(prefix)-\(name).png"
            if (try? representation.representation(using: .png, properties: [:])?.write(to: directory.appendingPathComponent(file))) != nil {
                written.append(file)
            }
        }
        return written
    }
}

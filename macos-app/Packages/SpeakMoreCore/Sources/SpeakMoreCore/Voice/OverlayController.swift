import Foundation
import Observation

// 悬浮胶囊 / 悬浮面板的显示逻辑，和 `floating-window-controller.js` + `floating-window-state.js` 一致，只是把
// “显示 / 隐藏窗口”变成可观察的状态，由应用里的 NSPanel 去呈现。

public enum FloatingPanelContent: Equatable, Sendable {
    /// 长按快捷键提示。
    case shortcutHint
    /// 自由提问结果，或自动粘贴失败时的兜底展示。
    case result(String)
}

public enum OverlayStatusRules {
    public static func isActive(_ state: FloatingBarState?) -> Bool {
        guard let status = state?.status else { return false }
        return status == .connecting || status == .recording || status == .stopping || status == .transcribing
    }

    public static func isTerminal(_ state: FloatingBarState?) -> Bool {
        state?.status == .completed || state?.status == .cancelled
    }

    public static func isError(_ state: FloatingBarState?) -> Bool { state?.status == .error }

    /// 快捷键提示的优先级低于录音、转写、完成、取消和错误状态。
    public static func shouldShowShortcutHint(_ state: FloatingBarState?) -> Bool {
        guard let state else { return true }
        if isActive(state) || isError(state) { return false }
        if isTerminal(state) && state.visible { return false }
        return true
    }
}

/// 悬浮胶囊上方那行提示文字，和 `floating-bar.html` 的文案一致（悬浮窗不属于界面语言切换范围，固定中文）。
public enum FloatingBarText {
    public static let idle = "Right Option 录音"
    public static let longProcessing = "正在努力处理中..."
    public static let longProcessingDelay: TimeInterval = 3

    public static func hint(for state: FloatingBarState, longProcessingVisible: Bool) -> String {
        if let text = state.displayText, !text.isEmpty { return text }
        switch state.status {
        case .recording:
            switch state.mode {
            case .ask: return "请随意提出问题"
            case .translate: return "正在听取翻译内容..."
            case .dictate: return "正在听写..."
            }
        case .connecting:
            return "正在连接..."
        case .stopping, .transcribing:
            if longProcessingVisible { return longProcessing }
            switch state.mode {
            case .ask: return "正在处理..."
            case .translate: return "正在翻译..."
            case .dictate: return "正在转写..."
            }
        case .cancelled: return "当前转录已取消"
        case .completed: return "已完成"
        case .error: return (state.errorMessage?.isEmpty == false) ? state.errorMessage! : "发生错误"
        case .idle: return idle
        }
    }
}

/// 悬浮窗口在屏幕里的位置：屏幕可用区域（不含菜单栏和 Dock）的底部居中，距底边固定间隙，并限制在屏幕内。
/// 坐标系是 AppKit 的（原点在左下，y 向上）。
public struct OverlayRect: Equatable, Sendable {
    public var x: Double, y: Double, width: Double, height: Double
    public init(x: Double, y: Double, width: Double, height: Double) {
        self.x = x; self.y = y; self.width = width; self.height = height
    }
}

public enum OverlayLayout {
    public static let barSize = (width: 220.0, height: 224.0)
    public static let panelSize = (width: 440.0, height: 220.0)
    public static let bottomGap = 32.0

    public static func bottomCenter(workArea: OverlayRect, size: (width: Double, height: Double), bottomGap: Double = bottomGap) -> OverlayRect {
        let x = (workArea.x + (workArea.width - size.width) / 2).rounded(.down)
        let y = workArea.y + bottomGap
        let maxX = workArea.x + max(0, workArea.width - size.width)
        let maxY = workArea.y + max(0, workArea.height - size.height)
        return OverlayRect(
            x: min(max(x, workArea.x), maxX), y: min(max(y, workArea.y), maxY),
            width: size.width, height: size.height
        )
    }
}

@MainActor
@Observable
public final class OverlayController {
    public static let completedHideDelay: TimeInterval = 1

    public private(set) var barVisible = false
    public private(set) var barState = FloatingBarState.hidden
    public private(set) var longProcessingVisible = false
    public private(set) var panel: FloatingPanelContent?

    /// 用户按 Escape 且当前有未完成的语音会话（或什么都没有可关）时请求取消。
    @ObservationIgnored public var onCancelRequested: () -> Void = {}
    /// 面板被 Escape / 关闭按钮收起时通知（快捷键守卫要同步“提示已不在”）。
    @ObservationIgnored public var onPanelDismissed: () -> Void = {}

    @ObservationIgnored private let scheduler: VoiceScheduler
    @ObservationIgnored private var lastVoiceState: FloatingBarState?
    @ObservationIgnored private var completedHideTimer: VoiceCancellable?
    @ObservationIgnored private var longProcessingTimer: VoiceCancellable?

    public init(scheduler: VoiceScheduler = TaskScheduler()) {
        self.scheduler = scheduler
    }

    public var barHint: String { FloatingBarText.hint(for: barState, longProcessingVisible: longProcessingVisible) }

    // MARK: 语音状态

    public func handleVoiceState(_ state: FloatingBarState) {
        lastVoiceState = state
        barState = state
        updateLongProcessingHint(for: state.status)
        if panel != nil && OverlayStatusRules.isActive(state) { hidePanelInternal(notify: true) }
        renderBar(for: state)
    }

    private func renderBar(for state: FloatingBarState?) {
        if OverlayStatusRules.isTerminal(state) {
            clearCompletedHide()
            barVisible = true
            completedHideTimer = scheduler.schedule(after: Self.completedHideDelay) { [weak self] in
                guard let self else { return }
                self.completedHideTimer = nil
                self.lastVoiceState = nil
                self.barVisible = false
            }
            return
        }
        if state?.visible == true || OverlayStatusRules.isError(state) {
            clearCompletedHide()
            barVisible = true
            return
        }
        lastVoiceState = nil
        clearCompletedHide()
        barVisible = false
    }

    /// 任意键按下时先把胶囊亮出来（空闲提示），免得用户按了没反应。
    public func keyActivity(anyKeyDown: Bool) {
        guard panel == nil else { return }
        if anyKeyDown { barVisible = true }
    }

    // MARK: 面板

    public func showShortcutHint() {
        // 提示优先级低：正在录音 / 转写 / 刚完成 / 出错时不弹。
        guard OverlayStatusRules.shouldShowShortcutHint(lastVoiceState) else {
            hidePanelInternal(notify: false)
            renderBar(for: lastVoiceState)
            return
        }
        showPanel(.shortcutHint)
    }

    public func showResult(_ text: String) {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        showPanel(.result(trimmed))
    }

    public func hidePanel() {
        hidePanelInternal(notify: false)
    }

    /// 面板上的关闭按钮。
    public func dismissPanel() {
        hidePanelInternal(notify: true)
    }

    private func showPanel(_ content: FloatingPanelContent) {
        clearCompletedHide()
        barVisible = false
        panel = content
    }

    private func hidePanelInternal(notify: Bool) {
        guard panel != nil else { return }
        panel = nil
        if notify { onPanelDismissed() }
    }

    // MARK: Escape

    public func handleEscape() {
        if OverlayStatusRules.isActive(lastVoiceState) {
            onCancelRequested()
            return
        }
        if panel != nil {
            hidePanelInternal(notify: true)
            return
        }
        if let state = lastVoiceState,
           state.visible || OverlayStatusRules.isError(state) || OverlayStatusRules.isTerminal(state) {
            lastVoiceState = nil
            clearCompletedHide()
            barVisible = false
            return
        }
        onCancelRequested()
    }

    // MARK: 内部

    private func clearCompletedHide() {
        completedHideTimer?.cancel()
        completedHideTimer = nil
    }

    /// 转写超过 3 秒，把提示换成“正在努力处理中...”。
    private func updateLongProcessingHint(for status: VoiceStatus) {
        let processing = status == .stopping || status == .transcribing
        guard processing else {
            longProcessingTimer?.cancel()
            longProcessingTimer = nil
            longProcessingVisible = false
            return
        }
        guard longProcessingTimer == nil, !longProcessingVisible else { return }
        longProcessingTimer = scheduler.schedule(after: FloatingBarText.longProcessingDelay) { [weak self] in
            guard let self else { return }
            self.longProcessingTimer = nil
            self.longProcessingVisible = true
        }
    }
}

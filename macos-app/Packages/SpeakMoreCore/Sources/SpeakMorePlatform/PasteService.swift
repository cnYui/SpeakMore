import ApplicationServices
import CoreGraphics
import Foundation
import SpeakMoreCore

/// 发出 Cmd+V。
public protocol PasteKeystrokeSending: AnyObject {
    func sendPaste() -> Bool
}

public final class CGEventPasteKeystroke: PasteKeystrokeSending {
    private static let vKeyCode: CGKeyCode = 9

    public init() {}

    public func sendPaste() -> Bool {
        // 没有辅助功能权限，系统会静默丢掉合成按键，必须提前拦住。
        guard AXIsProcessTrusted(), let source = CGEventSource(stateID: .hidSystemState),
              let down = CGEvent(keyboardEventSource: source, virtualKey: Self.vKeyCode, keyDown: true),
              let up = CGEvent(keyboardEventSource: source, virtualKey: Self.vKeyCode, keyDown: false)
        else { return false }
        down.flags = .maskCommand
        up.flags = .maskCommand
        down.post(tap: .cghidEventTap)
        usleep(20_000)
        up.post(tap: .cghidEventTap)
        return true
    }
}

public struct PasteOutcome: Equatable, Sendable {
    public var success: Bool
    public var reason: String
    public var target: TextTarget?

    public static func failure(_ reason: String, target: TextTarget? = nil) -> PasteOutcome {
        PasteOutcome(success: false, reason: reason, target: target)
    }
}

/// 自动粘贴：确认有可信输入目标 → 保存剪贴板 → 写入结果 → Cmd+V → 等目标应用读走 → 恢复剪贴板。
/// 流程和 `macos-platform-capabilities.js` 的 `pasteText` 一致；任何一步失败都返回失败原因，由调用方把结果展示在悬浮面板。
public final class PasteService {
    /// 发出 Cmd+V 后等多久再恢复剪贴板：Chromium / Electron 应用和微信是异步读剪贴板的，立刻恢复会粘出用户原来的内容。
    public static let defaultSettleDelay: TimeInterval = 0.18

    private let accessibility: AccessibilityReading
    private let pasteboard: PasteboardProviding
    private let keystroke: PasteKeystrokeSending
    private let settleDelay: TimeInterval
    private let sleep: @Sendable (TimeInterval) async -> Void

    public init(
        accessibility: AccessibilityReading,
        pasteboard: PasteboardProviding = SystemPasteboard(),
        keystroke: PasteKeystrokeSending = CGEventPasteKeystroke(),
        settleDelay: TimeInterval = PasteService.defaultSettleDelay,
        sleep: @escaping @Sendable (TimeInterval) async -> Void = { try? await Task.sleep(nanoseconds: UInt64($0 * 1_000_000_000)) }
    ) {
        self.accessibility = accessibility
        self.pasteboard = pasteboard
        self.keystroke = keystroke
        self.settleDelay = settleDelay
        self.sleep = sleep
    }

    public func paste(_ text: String, startFocus: FocusInfo?) async -> PasteOutcome {
        guard !text.isEmpty else { return .failure("empty_text") }

        let target = PasteTargetPolicy.resolveForPaste(
            axTarget: accessibility.textTarget(), start: startFocus, readCurrentFocus: { accessibility.focusInfo() }
        )
        // 找不到可信输入目标时不能静默写剪贴板再发 Cmd+V，直接让调用方展示悬浮面板。
        guard target.success else { return .failure(target.reason, target: target) }

        let original = pasteboard.snapshot()
        let writtenChangeCount = pasteboard.write(text: text)

        guard keystroke.sendPaste() else {
            restoreIfUntouched(original, writtenChangeCount: writtenChangeCount)
            return .failure("macos_event_injection_failed", target: target)
        }
        await sleep(settleDelay)
        restoreIfUntouched(original, writtenChangeCount: writtenChangeCount)
        return PasteOutcome(success: true, reason: "pasted", target: target)
    }

    /// 等待期间用户自己改了剪贴板（changeCount 变了）就不再覆盖。
    private func restoreIfUntouched(_ original: PasteboardSnapshot, writtenChangeCount: Int) {
        guard pasteboard.changeCount == writtenChangeCount else { return }
        pasteboard.restore(original)
    }
}

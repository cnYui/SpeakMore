import Foundation

// 自动粘贴前“当前有没有可信的文本输入目标”的判定规则。
// 和 `electron-app/macos-platform-helper.m`（AX 角色判断）以及 `macos-platform-capabilities.js`
// （焦点是否换了、微信兜底）一致。这里只放纯规则，读 AX 的部分在 `SpeakMorePlatform` 里。

/// 一个 AX 元素和“能不能输入文字”有关的属性快照。
public struct AXElementSnapshot: Equatable, Sendable {
    public var role: String
    public var subrole: String
    public var enabled: Bool
    public var editable: Bool
    public var valueSettable: Bool

    public init(role: String = "", subrole: String = "", enabled: Bool = true, editable: Bool = false, valueSettable: Bool = false) {
        self.role = role
        self.subrole = subrole
        self.enabled = enabled
        self.editable = editable
        self.valueSettable = valueSettable
    }
}

public enum TextTargetSource: String, Sendable, Equatable {
    case none
    case accessibility = "macos_ax"
    /// 弱可信：应用不暴露 AX 输入框，按应用族放行（目前只有微信）。
    case appCompat = "macos_app_compat"
    /// 弱可信：AX 确认不了输入框（Chrome / Electron 类应用默认不暴露），但前台应用还是录音开始时的那个，照样粘贴。
    case sameApplication = "macos_same_app"
}

public enum TextTargetConfidence: String, Sendable, Equatable {
    case none, weak, confirmed
}

/// 粘贴目标的判定结果。`appFamily` 是前台应用 bundle id，`processId` 是前台进程 id（和 Electron 版的 foreground_hwnd / focus_hwnd 对应）。
public struct TextTarget: Equatable, Sendable {
    public var success: Bool
    public var source: TextTargetSource
    public var confidence: TextTargetConfidence
    public var reason: String
    public var appFamily: String
    public var processId: Int32
    public var role: String
    public var signals: [String]

    public init(
        success: Bool, source: TextTargetSource = .none, confidence: TextTargetConfidence = .none, reason: String,
        appFamily: String = "", processId: Int32 = 0, role: String = "", signals: [String] = []
    ) {
        self.success = success
        self.source = source
        self.confidence = confidence
        self.reason = reason
        self.appFamily = appFamily
        self.processId = processId
        self.role = role
        self.signals = signals
    }
}

public enum PasteTargetPolicy {
    public static let permissionMissingReason = "macos_accessibility_permission_missing"
    public static let targetUnavailableReason = "macos_focused_target_unavailable"
    public static let targetChangedReason = "macos_focused_target_changed"

    // MARK: AX 角色

    public static func isTextInputRole(role: String, subrole: String) -> Bool {
        if ["AXTextArea", "AXTextField", "AXComboBox", "AXSearchField"].contains(role) { return true }
        return subrole == "AXTextField" || subrole == "AXSearchField"
    }

    /// 焦点落在这类容器上时，要往下找真正的输入框（网页、分组、滚动区、窗口）。
    public static func isTextInputContainerRole(role: String, subrole: String) -> Bool {
        if ["AXWebArea", "AXGroup", "AXScrollArea", "AXWindow"].contains(role) { return true }
        return subrole == "AXStandardWindow"
    }

    /// 启用、角色是输入框、并且可写（`AXEditable` 或 value 可设置）。
    public static func isWritableTextInput(_ element: AXElementSnapshot) -> Bool {
        element.enabled && isTextInputRole(role: element.role, subrole: element.subrole) && (element.editable || element.valueSettable)
    }

    // MARK: 判定

    /// 读到了焦点元素之后的判定；`focused == nil` 表示根本没有焦点元素。
    public static func evaluate(
        focused: AXElementSnapshot?, usedDescendantScan: Bool, appFamily: String, processId: Int32
    ) -> TextTarget {
        guard let focused else {
            return TextTarget(success: false, reason: targetUnavailableReason, appFamily: appFamily, processId: processId)
        }
        let readOnly = !focused.enabled || (!focused.editable && !focused.valueSettable)
        let success = focused.enabled && !readOnly && isTextInputRole(role: focused.role, subrole: focused.subrole)

        var signals = ["frontmost_app"]
        if usedDescendantScan { signals.append("ax_descendant_scan") }
        if !focused.role.isEmpty { signals.append("role:\(focused.role)") }
        if !focused.subrole.isEmpty { signals.append("subrole:\(focused.subrole)") }
        if focused.editable { signals.append("ax_editable") }
        if focused.valueSettable { signals.append("ax_value_settable") }

        return TextTarget(
            success: success,
            source: success ? .accessibility : .none,
            confidence: success ? .confirmed : .none,
            reason: success ? "macos_focused_target_confirmed" : targetUnavailableReason,
            appFamily: appFamily, processId: processId, role: focused.role, signals: signals
        )
    }

    // MARK: 焦点有没有换

    /// 开始录音时的前台应用和现在不是同一个（bundle id 或进程 id 变了）。
    public static func hasFocusChanged(start: FocusInfo?, current: FocusInfo?) -> Bool {
        guard let start else { return true }
        guard let current else { return false }
        if !start.bundleId.isEmpty && !current.bundleId.isEmpty && start.bundleId != current.bundleId { return true }
        if start.processId != 0 && current.processId != 0 && start.processId != current.processId { return true }
        return false
    }

    /// AX 判定成功之后，再确认前台应用还是开始录音的那个。
    public static func hasTargetChanged(start: FocusInfo?, target: TextTarget) -> Bool {
        guard let start else { return false }
        if !start.bundleId.isEmpty && !target.appFamily.isEmpty && start.bundleId != target.appFamily { return true }
        if start.processId != 0 && target.processId != 0 && start.processId != target.processId { return true }
        return false
    }

    // MARK: 微信兜底

    private static let weChatBlockedTitlePatterns = ["登录", "设置", "图片查看", "文件预览", "偏好设置", "login", "sign in", "settings", "preferences", "preview"]

    public static func isWeChat(_ value: String) -> Bool {
        let normalized = value.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard !normalized.isEmpty else { return false }
        return normalized.contains("wechat") || normalized.contains("weixin") || normalized.contains("微信")
            || normalized.contains("com.tencent.xin")
    }

    public static func isWeChat(_ focus: FocusInfo?) -> Bool {
        guard let focus else { return false }
        return [focus.bundleId, focus.appName].contains(where: isWeChat)
    }

    public static func isBlockedWeChatTitle(_ title: String) -> Bool {
        let lowered = title.lowercased()
        return weChatBlockedTitlePatterns.contains { lowered.contains($0) }
    }

    /// 应用不暴露 AX 输入框时的兜底：只对微信放行，并且要求开始和现在都是同一个微信窗口、窗口标题不是登录 / 设置 / 预览这类。
    public static func weChatFallback(failedTarget: TextTarget, start: FocusInfo?, current: FocusInfo?) -> TextTarget {
        func failure(_ reason: String) -> TextTarget {
            var copy = failedTarget
            copy.success = false
            copy.source = .none
            copy.confidence = .none
            copy.reason = reason
            return copy
        }

        let currentIsWeChat = isWeChat(current) || isWeChat(failedTarget.appFamily)
        guard currentIsWeChat else {
            return failure(failedTarget.reason.isEmpty ? targetUnavailableReason : failedTarget.reason)
        }
        guard isWeChat(start) else { return failure("macos_app_compat_start_not_wechat") }
        // 微信兜底需要当前焦点信息；读不到就不放行。
        guard let current else { return failure(targetUnavailableReason) }
        if hasFocusChanged(start: start, current: current) { return failure(targetChangedReason) }
        if isBlockedWeChatTitle(current.windowTitle) || isBlockedWeChatTitle(start?.windowTitle ?? "") {
            return failure("macos_app_compat_blocked_window_title")
        }

        var signals = ["process:wechat", "same_frontmost_app"]
        if !current.windowTitle.isEmpty { signals.append("window_title_present") }
        return TextTarget(
            success: true, source: .appCompat, confidence: .weak, reason: "macos_app_compat_wechat",
            appFamily: current.bundleId, processId: current.processId, signals: signals
        )
    }

    // MARK: 同一应用兜底

    private static let blockedTitlePatterns = ["登录", "设置", "图片查看", "文件预览", "偏好设置", "login", "sign in", "settings", "preferences", "preview"]

    /// 这些前台应用不是“可以输入文字的地方”：粘贴没有意义（或者会碰到系统界面），确认不了目标时不放行。
    private static let nonTextBundleIds: Set<String> = [
        "com.apple.finder", "com.apple.dock", "com.apple.loginwindow", "com.apple.SecurityAgent",
        "com.apple.systemuiserver", "com.apple.notificationcenterui", "com.apple.controlcenter",
        "com.apple.systempreferences", "com.apple.Spotlight",
        // SpeakMore 自己（原生版和 Electron 版）：结果面板的文字不能再粘回自己。
        "cn.yui.speakmore.native", "com.github.Electron",
    ]

    /// AX 确认不了输入框时，只要前台应用和录音开始时是同一个，就照样粘贴（光标本来就锁在那个应用里）。
    /// Chrome、Electron、微信这类应用默认不向辅助功能暴露输入框，严格要求“确认输入框”会让它们永远粘不进去。
    /// 代价：如果当时光标不在输入框里，Cmd+V 什么也不会发生；听写结果仍然保存在历史记录里。
    public static func sameApplicationFallback(failedTarget: TextTarget, start: FocusInfo?, current: FocusInfo?) -> TextTarget? {
        guard let start, let current, !start.bundleId.isEmpty, !current.bundleId.isEmpty else { return nil }
        guard !hasFocusChanged(start: start, current: current) else { return nil }
        guard !nonTextBundleIds.contains(current.bundleId) else { return nil }
        let titles = [current.windowTitle, start.windowTitle].map { $0.lowercased() }
        guard !titles.contains(where: { title in blockedTitlePatterns.contains { title.contains($0) } }) else { return nil }
        var signals = ["same_frontmost_app", "bundle:\(current.bundleId)"]
        if !current.windowTitle.isEmpty { signals.append("window_title_present") }
        return TextTarget(
            success: true, source: .sameApplication, confidence: .weak, reason: "macos_same_app_weak",
            appFamily: current.bundleId, processId: current.processId, signals: signals
        )
    }

    /// 粘贴前的完整判定：AX 目标 →（失败则）微信兜底 →（再失败则）同一应用兜底；AX 成功后还要确认前台应用没换。
    public static func resolveForPaste(
        axTarget: TextTarget, start: FocusInfo?, readCurrentFocus: () -> FocusInfo?
    ) -> TextTarget {
        if !axTarget.success {
            let current = readCurrentFocus()
            let weChat = weChatFallback(failedTarget: axTarget, start: start, current: current)
            if weChat.success { return weChat }
            // 微信的“登录 / 设置 / 预览”窗口是明确拦下的，不能再被同一应用兜底放行。
            if weChat.reason == "macos_app_compat_blocked_window_title" { return weChat }
            return sameApplicationFallback(failedTarget: axTarget, start: start, current: current) ?? weChat
        }
        if hasTargetChanged(start: start, target: axTarget) {
            var changed = axTarget
            changed.success = false
            changed.source = .none
            changed.confidence = .none
            changed.reason = targetChangedReason
            return changed
        }
        return axTarget
    }
}

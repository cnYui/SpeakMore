import Foundation

/// 结果交付策略，和 `voiceResultDelivery.ts` 一致：
///   · 自由提问永远展示在悬浮面板，不自动粘贴；
///   · 听写 / 翻译先尝试自动粘贴，失败（没有可信输入目标、没有权限、注入失败）就把结果展示在悬浮面板，不能让用户丢了这一轮文字。
public struct VoiceResultDelivery: Sendable {
    /// 尝试粘贴，成功返回 true。
    public var paste: @Sendable (_ text: String, _ startFocus: FocusInfo?) async -> Bool
    /// 在悬浮面板展示结果。
    public var showPanel: @MainActor @Sendable (_ text: String) -> Void

    public init(
        paste: @escaping @Sendable (String, FocusInfo?) async -> Bool,
        showPanel: @escaping @MainActor @Sendable (String) -> Void
    ) {
        self.paste = paste
        self.showPanel = showPanel
    }

    @MainActor
    public func deliver(_ text: String, task: VoiceTask?, mode: VoiceMode) async {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        if task?.delivery == .floatingPanel || mode == .ask {
            showPanel(trimmed)
            return
        }
        if await paste(text, task?.focusInfo) { return }
        showPanel(trimmed)
    }
}

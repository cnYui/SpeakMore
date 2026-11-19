import Foundation

// 快捷键意图 → 语音任务。规则和 `voiceTaskResolver.ts` 一致：
//   · 翻译、听写：自动粘贴，不读选区（避免选区状态影响听写语义）；
//   · 自由提问：读一次选区快照，选区可信才作为上下文，结果永远展示在悬浮面板，不粘贴。

public enum VoiceTaskDelivery: String, Sendable, Equatable {
    case paste
    case floatingPanel = "floating-panel"
}

public enum SelectionSource: String, Sendable, Equatable {
    case none
    /// 辅助功能（Accessibility）读到的选区。对应 Electron 版的 `uia`。
    case accessibility
    case clipboard
}

public enum SelectionConfidence: String, Sendable, Equatable {
    case none
    case confirmed
    case fallback
}

/// 录音开始那一刻前台应用的焦点信息；粘贴前用它确认焦点没有换。
public struct FocusInfo: Equatable, Sendable {
    public var bundleId: String
    public var appName: String
    public var processId: Int32
    public var windowTitle: String
    /// 焦点输入框的稳定签名（角色 + 位置等），粘贴前和现场对比。
    public var elementSignature: String

    public init(bundleId: String = "", appName: String = "", processId: Int32 = 0, windowTitle: String = "", elementSignature: String = "") {
        self.bundleId = bundleId
        self.appName = appName
        self.processId = processId
        self.windowTitle = windowTitle
        self.elementSignature = elementSignature
    }
}

public struct SelectionSnapshot: Equatable, Sendable {
    public var selectedText: String
    public var source: SelectionSource
    public var confidence: SelectionConfidence
    public var focusInfo: FocusInfo?

    public init(
        selectedText: String = "",
        source: SelectionSource = .none,
        confidence: SelectionConfidence = .none,
        focusInfo: FocusInfo? = nil
    ) {
        self.selectedText = selectedText
        self.source = source
        self.confidence = confidence
        self.focusInfo = focusInfo
    }
}

public struct VoiceTask: Equatable, Sendable {
    public var mode: VoiceMode
    public var selectedText: String
    public var source: SelectionSource
    public var confidence: SelectionConfidence
    public var focusInfo: FocusInfo?
    public var delivery: VoiceTaskDelivery
}

public struct VoiceTaskResolver: Sendable {
    public var readSelection: @Sendable () async -> SelectionSnapshot
    public var readFocus: @Sendable () async -> FocusInfo?

    public init(
        readSelection: @escaping @Sendable () async -> SelectionSnapshot,
        readFocus: @escaping @Sendable () async -> FocusInfo?
    ) {
        self.readSelection = readSelection
        self.readFocus = readFocus
    }

    public func resolve(_ intent: ShortcutIntent) async -> VoiceTask {
        switch intent {
        case .translate:
            return await pasteTask(.translate)
        case .dictate:
            return await pasteTask(.dictate)
        case .ask:
            let snapshot = await readSelection()
            let hasText = !snapshot.selectedText.isEmpty
            let supported = hasText && (
                (snapshot.source == .accessibility && snapshot.confidence == .confirmed)
                    || (snapshot.source == .clipboard && snapshot.confidence == .fallback)
            )
            // 自由提问的结果永远展示在悬浮面板；选区不可信时当作没有选区。
            return VoiceTask(
                mode: .ask,
                selectedText: supported ? snapshot.selectedText : "",
                source: supported ? snapshot.source : .none,
                confidence: supported ? snapshot.confidence : .none,
                focusInfo: supported ? snapshot.focusInfo : nil,
                delivery: .floatingPanel
            )
        }
    }

    private func pasteTask(_ mode: VoiceMode) async -> VoiceTask {
        VoiceTask(
            mode: mode, selectedText: "", source: .none, confidence: .none,
            focusInfo: await readFocus(), delivery: .paste
        )
    }
}

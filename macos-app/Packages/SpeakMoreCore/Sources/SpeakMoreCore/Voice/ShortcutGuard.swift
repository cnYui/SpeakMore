import Foundation

// Right Option 快捷键守卫，和 `shortcutGuard.ts` + `right-alt-relay.js` 的行为一致：
//   · 按住 Right Option 开始一个“按键周期”，周期内按住 Right Shift = 翻译，按住 Space 或 Right Command = 自由提问，否则 = 听写；
//   · 意图只升不降（听写 < 自由提问 < 翻译）；
//   · 松开 Right Option 时触发一次“开始 / 停止录音”；
//   · 不在录音中时按住超过 350 ms，视为长按：弹快捷键提示，并且这个周期内松手不再触发录音。

public enum ShortcutKey: String, Sendable, CaseIterable {
    case rightAlt = "RightAlt"
    case rightShift = "RightShift"
    case rightCommand = "RightCommand"
    case space = "Space"
    case escape = "Escape"
}

/// 底层监听器（CGEventTap）送来的一次原始键盘变化。
public struct RawKeyEvent: Equatable, Sendable {
    public var key: ShortcutKey
    public var isDown: Bool

    public init(key: ShortcutKey, isDown: Bool) {
        self.key = key
        self.isDown = isDown
    }
}

public enum ShortcutIntent: String, Sendable, Equatable, CaseIterable {
    case dictate = "DictateShortcut"
    case ask = "AskShortcut"
    case translate = "TranslateShortcut"

    fileprivate var priority: Int {
        switch self {
        case .dictate: 0
        case .ask: 1
        case .translate: 2
        }
    }

    public var initialMode: VoiceMode {
        switch self {
        case .dictate: .dictate
        case .ask: .ask
        case .translate: .translate
        }
    }

    public init(mode: VoiceMode) {
        switch mode {
        case .dictate: self = .dictate
        case .ask: self = .ask
        case .translate: self = .translate
        }
    }
}

public enum ShortcutAction: Equatable, Sendable {
    case none
    case toggleRecording(ShortcutIntent)
}

public struct ShortcutGuard: Sendable {
    public static let longPressMs = 350

    /// 这一次变化之后，调用方还要做的事。
    public struct Output: Equatable, Sendable {
        public var action: ShortcutAction = .none
        /// 新周期刚开始且允许长按提示：调用方要启动 350 ms 定时器，到点调用 `longPressFired()`。
        public var startLongPressTimer = false
        /// 周期结束（松手、取消）：调用方要取消还在跑的定时器。
        public var cancelLongPressTimer = false
        /// 上一轮长按提示还显示着，而新一轮按键开始了：调用方要把它收起来（和 Electron 版一样，松手后提示会一直留着，直到下一次按键或 Escape）。
        public var hideHint = false
    }

    public private(set) var isRightAltDown = false
    public private(set) var isBlocked = false
    public private(set) var hintVisible = false
    public private(set) var activeIntent: ShortcutIntent?
    private var held: Set<ShortcutKey> = []

    public init() {}

    /// `voiceStatus`：当前语音状态；录音中不启用长按提示（用户是在停止，不是在长按）。
    public mutating func handle(_ event: RawKeyEvent, voiceStatus: VoiceStatus) -> Output {
        switch event.key {
        case .escape:
            return Output()
        case .rightAlt:
            return event.isDown ? rightAltDown(voiceStatus: voiceStatus) : rightAltUp()
        case .rightShift, .rightCommand, .space:
            // 只有 Right Option 已经按下时，这些键才有意义。
            guard held.contains(.rightAlt) else { return Output() }
            if event.isDown {
                held.insert(event.key)
                activeIntent = Self.keepHighest(activeIntent, Self.intent(for: held))
            } else {
                held.remove(event.key)
            }
            return Output()
        }
    }

    private mutating func rightAltDown(voiceStatus: VoiceStatus) -> Output {
        if isRightAltDown {
            // 键盘自动重复：保持当前周期。
            return Output()
        }
        var output = Output()
        output.hideHint = hintVisible
        held = [.rightAlt]
        isRightAltDown = true
        isBlocked = false
        hintVisible = false
        activeIntent = .dictate
        output.startLongPressTimer = voiceStatus != .recording
        return output
    }

    private mutating func rightAltUp() -> Output {
        guard isRightAltDown else { return Output() }
        var output = Output()
        output.cancelLongPressTimer = true
        if !isBlocked, let intent = activeIntent {
            output.action = .toggleRecording(intent)
        }
        endCycle()
        return output
    }

    /// 350 ms 到点：只有 Right Option 还按着、并且没有被阻塞时才生效。
    public mutating func longPressFired() -> Bool {
        guard isRightAltDown, !isBlocked else { return false }
        isBlocked = true
        hintVisible = true
        return true
    }

    /// 结束当前按键周期；长按提示是否还显示不受影响。
    private mutating func endCycle() {
        held = []
        isRightAltDown = false
        isBlocked = false
        activeIntent = nil
    }

    /// 外部强制复位（比如监听器被停掉，或用户用 Escape / 新录音收起了提示）。
    public mutating func reset() {
        endCycle()
        hintVisible = false
    }

    /// 提示面板被别处关闭了（Escape、新一轮录音开始）。
    public mutating func hintDismissed() {
        hintVisible = false
    }

    private static func intent(for keys: Set<ShortcutKey>) -> ShortcutIntent {
        if keys.contains(.rightShift) { return .translate }
        if keys.contains(.space) || keys.contains(.rightCommand) { return .ask }
        return .dictate
    }

    private static func keepHighest(_ current: ShortcutIntent?, _ next: ShortcutIntent) -> ShortcutIntent {
        guard let current else { return next }
        return next.priority > current.priority ? next : current
    }
}

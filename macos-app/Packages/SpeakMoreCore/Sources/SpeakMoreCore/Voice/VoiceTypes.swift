import Foundation

// 语音链路的共享类型，和 `electron-app/renderer/src/services/voice/voiceTypes.ts` 一一对应。
// `VoiceMode`（Dictate / Ask / Translate）在 History.swift 里已经定义。

/// 后端 `start_audio` 消息里的 mode 字段。
public enum VoiceFlowMode: String, Codable, Sendable {
    case transcript
    case askAnything = "ask_anything"
    case translation
}

extension VoiceMode {
    public var flowMode: VoiceFlowMode {
        switch self {
        case .ask: .askAnything
        case .translate: .translation
        case .dictate: .transcript
        }
    }
}

public enum VoiceStatus: String, Codable, Sendable {
    case idle, connecting, recording, stopping, transcribing, cancelled, completed, error

    /// 只有这些状态代表本轮语音还没有产出最终结果，Escape 才允许取消。
    public var isCancelable: Bool {
        switch self {
        case .connecting, .recording, .stopping, .transcribing: true
        default: false
        }
    }
}

public enum VoiceErrorCode: String, Codable, Sendable, CaseIterable {
    case backendUnavailable = "backend_unavailable"
    case voiceModelMissing = "voice_model_missing"
    case llmApiKeyMissing = "llm_api_key_missing"
    case websocketTimeout = "websocket_timeout"
    case websocketClosed = "websocket_closed"
    case microphonePermissionDenied = "microphone_permission_denied"
    case microphoneUnavailable = "microphone_unavailable"
    case recordingStartFailed = "recording_start_failed"
    case recordingStopFailed = "recording_stop_failed"
    case audioEmpty = "audio_empty"
    case asrFailed = "asr_failed"
    case refineFailed = "refine_failed"
    case pasteFailed = "paste_failed"
    case protocolInvalid = "protocol_invalid"
    case unknown

    /// 和 Electron 版一致的中文提示；原生界面用 `voice.error.<rawValue>` 这个 key 再按界面语言取文案。
    public var defaultMessage: String {
        switch self {
        case .backendUnavailable: "语音后端未就绪，首次运行可能正在下载模型，请稍后重试"
        case .voiceModelMissing: "还没有下载语音模型，请先下载模型。"
        case .llmApiKeyMissing: "还没有填写 DeepSeek API Key，请先到设置页填写后再使用。"
        case .websocketTimeout: "连接语音后端超时，请稍后重试"
        case .websocketClosed: "语音连接已断开，请重试"
        case .microphonePermissionDenied: "无法访问麦克风，请检查系统权限"
        case .microphoneUnavailable: "没有找到可用麦克风"
        case .recordingStartFailed: "录音启动失败，请重试"
        case .recordingStopFailed: "录音停止失败，请重试"
        case .audioEmpty: "没有识别到声音"
        case .asrFailed: "语音转写失败，请重试"
        case .refineFailed: "润色失败，已保留原始转写"
        case .pasteFailed: "已生成文本，但无法自动粘贴"
        case .protocolInvalid: "语音服务返回了无法识别的数据"
        case .unknown: "语音输入出现未知错误"
        }
    }

    public var localizationKey: String { "voice.error.\(rawValue)" }
}

public struct VoiceError: Error, Equatable, Sendable {
    public var code: VoiceErrorCode
    public var message: String
    public var recoverable: Bool
    public var detail: String?

    public init(_ code: VoiceErrorCode, detail: String? = nil) {
        self.code = code
        self.message = code.defaultMessage
        self.recoverable = code != .unknown
        self.detail = (detail?.isEmpty == false) ? detail : nil
    }

    /// 任意错误归一成 VoiceError：已经是 VoiceError 的直接透传，其它的包成 fallback 错误码。
    public static func normalize(_ error: Error, fallback: VoiceErrorCode) -> VoiceError {
        if let voiceError = error as? VoiceError { return voiceError }
        return VoiceError(fallback, detail: String(describing: error))
    }
}

public struct VoiceSession: Equatable, Sendable {
    public var status: VoiceStatus = .idle
    public var mode: VoiceMode = .dictate
    public var audioId: String?
    public var rawText: String = ""
    public var refinedText: String = ""
    public var durationMs: Double = 0
    public var textLength: Int = 0
    public var error: VoiceError?
    public var inputLevel: Double = 0
    public var noticeText: String = ""

    public static let initial = VoiceSession()

    public init() {}
}

/// 悬浮胶囊需要的状态切片。
public struct FloatingBarState: Equatable, Sendable {
    public var visible: Bool
    public var status: VoiceStatus
    public var mode: VoiceMode
    public var inputLevel: Double
    public var displayText: String?
    public var errorMessage: String?

    public init(
        visible: Bool,
        status: VoiceStatus,
        mode: VoiceMode,
        inputLevel: Double,
        displayText: String? = nil,
        errorMessage: String? = nil
    ) {
        self.visible = visible
        self.status = status
        self.mode = mode
        self.inputLevel = inputLevel
        self.displayText = displayText
        self.errorMessage = errorMessage
    }

    public static let hidden = FloatingBarState(visible: false, status: .idle, mode: .dictate, inputLevel: 0)
}

public enum VoiceSessionMath {
    /// 统计统一用 trim 后长度，避免首尾空白影响历史统计（JS 的 `String.length` 按 UTF-16 计，这里保持一致）。
    public static func countTextLength(_ text: String) -> Int {
        text.trimmingCharacters(in: .whitespacesAndNewlines).utf16.count
    }

    /// 连接准备阶段不计入听写时长。
    public static func recordingDurationMs(startedAt: Date?, now: Date = Date()) -> Double {
        guard let startedAt else { return 0 }
        return max(0, now.timeIntervalSince(startedAt) * 1000)
    }

    public static func floatingBarState(for session: VoiceSession) -> FloatingBarState {
        var errorMessage = session.error?.message
        if session.error?.code == .refineFailed && session.mode == .translate {
            errorMessage = "翻译失败，请检查大模型配置后重试"
        }

        if session.error?.code == .audioEmpty {
            return FloatingBarState(
                visible: true, status: .cancelled, mode: session.mode, inputLevel: 0,
                displayText: errorMessage, errorMessage: errorMessage
            )
        }

        let visibleStatuses: Set<VoiceStatus> = [.connecting, .recording, .stopping, .transcribing, .cancelled, .completed, .error]
        var displayText: String?
        if !session.noticeText.isEmpty {
            displayText = session.noticeText
        } else if session.status == .recording && session.mode == .ask {
            displayText = "请随意提出问题"
        }
        if session.status == .cancelled { displayText = "当前转录已取消" }

        return FloatingBarState(
            visible: visibleStatuses.contains(session.status),
            status: session.status,
            mode: session.mode,
            inputLevel: session.inputLevel,
            displayText: displayText,
            errorMessage: errorMessage
        )
    }
}

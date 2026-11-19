import Foundation

// 后端 WebSocket 协议：`ws://127.0.0.1:8000/ws/rt_voice_flow`。
// 客户端先发 JSON `start_audio`，再发二进制 PCM16 分片，最后发 `end_audio`；
// 服务端回复 `{K, V}` 形式的消息。解析规则和 `voiceSocket.ts` 的 `handleVoiceSocketMessage` 一致。

public enum VoiceEndpoint {
    public static let path = "/ws/rt_voice_flow"
    public static let defaultToken = "local-dev-token"

    /// 默认连接 `SPEAKMORE_BACKEND_URL`（或 127.0.0.1:8000）对应的 ws 地址。
    public static func webSocketURL(base: URL = BackendClient.defaultBaseURL) -> URL {
        var components = URLComponents(url: base, resolvingAgainstBaseURL: false) ?? URLComponents()
        components.scheme = (components.scheme == "https") ? "wss" : "ws"
        components.path = path
        components.queryItems = [
            URLQueryItem(name: "v", value: "win_local"),
            URLQueryItem(name: "t", value: defaultToken),
            URLQueryItem(name: "m", value: "0"),
        ]
        return components.url ?? base
    }
}

// MARK: - 发给后端的消息

public struct LlmRequestConfig: Codable, Equatable, Sendable {
    public var providerId: String
    public var baseUrl: String
    public var apiKey: String
    public var model: String
    public var authType: String

    enum CodingKeys: String, CodingKey {
        case providerId = "provider_id", baseUrl = "base_url", apiKey = "api_key", model, authType = "auth_type"
    }

    public init(providerId: String, baseUrl: String, apiKey: String, model: String, authType: String) {
        self.providerId = providerId
        self.baseUrl = baseUrl
        self.apiKey = apiKey
        self.model = model
        self.authType = authType
    }
}

extension LocalSettings {
    /// 当前选中的大模型配置；和 `settingsStore.getCurrentLlmConfig` 一样，找不到所选服务商就退回第一个。
    public var currentLlmRequest: LlmRequestConfig {
        let provider = llm.providers.first { $0.id == llm.providerId } ?? llm.providers.first
        guard let provider else {
            return LlmRequestConfig(providerId: "", baseUrl: "", apiKey: "", model: "", authType: "bearer")
        }
        let configuredModel = llm.models[provider.id] ?? ""
        return LlmRequestConfig(
            providerId: provider.id,
            baseUrl: provider.baseUrl,
            apiKey: llm.apiKeys[provider.id] ?? "",
            model: configuredModel.isEmpty ? provider.defaultModel : configuredModel,
            authType: provider.authType.rawValue
        )
    }
}

public struct PromptDictionaryTerm: Codable, Equatable, Sendable {
    public var phrase: String
    public var aliases: [String]

    public init(phrase: String, aliases: [String]) {
        self.phrase = phrase
        self.aliases = aliases
    }
}

public struct AudioFormat: Codable, Equatable, Sendable {
    public var type: String
    public var sampleRate: Int
    public var channels: Int

    enum CodingKeys: String, CodingKey {
        case type, sampleRate = "sample_rate", channels
    }

    public static let pcm16Mono16k = AudioFormat(type: "pcm_s16le", sampleRate: 16000, channels: 1)
}

/// `start_audio.parameters`。可选字段为 nil 时不出现在 JSON 里（和 JS 版“有才发”的行为一致）。
public struct StartAudioParameters: Encodable, Equatable, Sendable {
    public var llm: LlmRequestConfig
    public var dictionaryTerms: [PromptDictionaryTerm]
    public var audioFormat: AudioFormat = .pcm16Mono16k
    public var selectedText: String?
    public var outputLanguage: String?

    enum CodingKeys: String, CodingKey {
        case llm, dictionaryTerms = "dictionary_terms", audioFormat = "audio_format"
        case selectedText = "selected_text", outputLanguage = "output_language"
    }

    public init(
        llm: LlmRequestConfig,
        dictionaryTerms: [PromptDictionaryTerm] = [],
        selectedText: String? = nil,
        outputLanguage: String? = nil
    ) {
        self.llm = llm
        self.dictionaryTerms = dictionaryTerms
        self.selectedText = selectedText
        self.outputLanguage = outputLanguage
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(llm, forKey: .llm)
        if !dictionaryTerms.isEmpty { try container.encode(dictionaryTerms, forKey: .dictionaryTerms) }
        try container.encode(audioFormat, forKey: .audioFormat)
        if let selectedText, !selectedText.isEmpty { try container.encode(selectedText, forKey: .selectedText) }
        if let outputLanguage { try container.encode(outputLanguage, forKey: .outputLanguage) }
    }

    /// 按模式生成参数：自由提问只在有可信选区时带上选区文本，翻译带目标语言。
    public static func make(
        mode: VoiceMode,
        selectedText: String,
        llm: LlmRequestConfig,
        dictionaryTerms: [PromptDictionaryTerm],
        translationTargetLanguage: String?
    ) -> StartAudioParameters {
        var parameters = StartAudioParameters(llm: llm, dictionaryTerms: dictionaryTerms)
        switch mode {
        case .ask: parameters.selectedText = selectedText
        case .translate: parameters.outputLanguage = translationTargetLanguage ?? ""
        case .dictate: break
        }
        return parameters
    }
}

public enum VoiceClientMessage {
    private struct StartAudio: Encodable {
        let type = "start_audio"
        let audioId: String
        let mode: VoiceFlowMode
        let audioContext = EmptyObject()
        let parameters: StartAudioParameters

        enum CodingKeys: String, CodingKey { case type, audioId = "audio_id", mode, audioContext = "audio_context", parameters }
    }

    private struct EndAudio: Encodable {
        let type = "end_audio"
        let audioId: String
        enum CodingKeys: String, CodingKey { case type, audioId = "audio_id" }
    }

    private struct EmptyObject: Encodable {}

    public static func startAudio(audioId: String, mode: VoiceMode, parameters: StartAudioParameters) throws -> String {
        try encode(StartAudio(audioId: audioId, mode: mode.flowMode, parameters: parameters))
    }

    public static func endAudio(audioId: String) throws -> String {
        try encode(EndAudio(audioId: audioId))
    }

    private static func encode<T: Encodable>(_ value: T) throws -> String {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
        return String(decoding: try encoder.encode(value), as: UTF8.self)
    }
}

// MARK: - 后端回来的消息

/// 一条后端消息路由后的结果。
public enum VoiceServerEvent: Equatable, Sendable {
    case rawText(String)
    case finalText(String)
    case failure(VoiceError)
    case interrupt(String)
    /// 迟到消息、旧会话消息、空操作消息，什么都不用做。
    case ignored
}

/// 路由一条消息需要知道的当前会话事实。
public struct VoiceMessageContext: Sendable {
    public var currentAudioId: String
    public var currentRawText: String
    public var isIgnoredAudioId: @Sendable (String) -> Bool
    public var isCancelled: Bool
    public var isTerminal: Bool

    public init(
        currentAudioId: String,
        currentRawText: String,
        isIgnoredAudioId: @escaping @Sendable (String) -> Bool = { _ in false },
        isCancelled: Bool = false,
        isTerminal: Bool = false
    ) {
        self.currentAudioId = currentAudioId
        self.currentRawText = currentRawText
        self.isIgnoredAudioId = isIgnoredAudioId
        self.isCancelled = isCancelled
        self.isTerminal = isTerminal
    }
}

public enum VoiceServerMessage {
    /// 后端存在多种历史完成消息名，统一归类成最终结果。
    public static func isFinalType(_ type: String) -> Bool {
        ["audio_processing_completed", "refine_completed", "refine_selected_text"].contains(type)
    }

    /// ASR、音频处理和润色错误都属于本轮失败，但映射成不同错误码。
    public static func isErrorType(_ type: String) -> Bool {
        ["error", "transcription_error", "audio_processing_error", "refine_error", "refine_selected_text_error"].contains(type)
    }

    public static func normalizeError(type: String, payload: [String: Any]) -> VoiceError {
        let detail = (payload["detail"] as? String) ?? (payload["message"] as? String) ?? ""
        if type == "transcription_error" { return VoiceError(.asrFailed, detail: detail) }
        if ["audio_processing_error", "refine_error", "refine_selected_text_error"].contains(type) {
            return VoiceError(.refineFailed, detail: detail)
        }
        if number(payload["code"]) == 503 || detail.contains("尚未就绪") {
            return VoiceError(.backendUnavailable, detail: detail)
        }
        return VoiceError(.unknown, detail: detail)
    }

    public static func route(_ text: String, context: VoiceMessageContext) -> VoiceServerEvent {
        guard let data = text.data(using: .utf8),
              let parsed = try? JSONSerialization.jsonObject(with: data, options: [.fragmentsAllowed])
        else {
            return .failure(VoiceError(.protocolInvalid, detail: "消息不是合法的 JSON"))
        }
        // 合法 JSON 但不是对象（数组、字符串、null）：没有 K 可以路由，直接忽略。
        guard let object = parsed as? [String: Any] else { return .ignored }

        let type = stringValue(object["K"])
        let payload = (object["V"] as? [String: Any]) ?? [:]
        let audioId = (payload["audio_id"] as? String) ?? ""

        // 后端可能返回迟到消息或旧会话消息，必须先按会话边界过滤。
        if !audioId.isEmpty && context.isIgnoredAudioId(audioId) { return .ignored }
        if !audioId.isEmpty && !context.currentAudioId.isEmpty && audioId != context.currentAudioId { return .ignored }
        if context.isCancelled { return .ignored }
        if type == "error" && number(payload["code"]) == 90002 && (payload["detail"] as? String) == "Unknown message type" {
            return .ignored
        }
        if context.isTerminal && (isFinalType(type) || isErrorType(type)) { return .ignored }

        if type == "transcription" {
            return .rawText(payload["text"] as? String ?? "")
        }

        if type == "important_notification" {
            let behavior = payload["behavior"] as? [String: Any]
            if truthy(behavior?["interruptSession"]) {
                let detail = payload["detail"] as? String ?? ""
                return .interrupt(detail.isEmpty ? "会话已被中断" : detail)
            }
            return .ignored
        }

        if isFinalType(type) {
            var refined = payload["refined_text"] as? String ?? ""
            if refined.isEmpty { refined = payload["refine_text"] as? String ?? "" }
            if refined.isEmpty && context.currentRawText.isEmpty { return .failure(VoiceError(.audioEmpty)) }
            return .finalText(refined.isEmpty ? context.currentRawText : refined)
        }

        if isErrorType(type) { return .failure(normalizeError(type: type, payload: payload)) }
        return .ignored
    }

    private static func stringValue(_ value: Any?) -> String {
        if let string = value as? String { return string }
        if let value, !(value is NSNull) { return String(describing: value) }
        return ""
    }

    private static func number(_ value: Any?) -> Double? {
        if let number = value as? NSNumber { return number.doubleValue }
        if let string = value as? String { return Double(string) }
        return nil
    }

    private static func truthy(_ value: Any?) -> Bool {
        if let bool = value as? Bool { return bool }
        if let number = value as? NSNumber { return number.doubleValue != 0 }
        if let string = value as? String { return !string.isEmpty }
        return false
    }
}

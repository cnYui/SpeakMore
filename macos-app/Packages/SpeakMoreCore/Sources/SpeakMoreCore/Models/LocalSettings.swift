import Foundation

public enum InterfaceLanguage: String, Codable, CaseIterable, Sendable {
    case zhCN = "zh-CN"
    case enUS = "en-US"

    /// SwiftUI / Bundle 用的本地化标识。
    public var localeIdentifier: String {
        switch self {
        case .zhCN: return "zh-Hans"
        case .enUS: return "en"
        }
    }
}

public enum AsrDeviceMode: String, Codable, CaseIterable, Sendable {
    case `default`
    case mps
    case cuda
    case cpu
}

public enum LlmAuthType: String, Codable, Sendable {
    case bearer
    case anthropic
}

public struct LlmProvider: Codable, Equatable, Identifiable, Sendable {
    public var id: String
    public var label: String
    public var baseUrl: String
    public var defaultModel: String
    public var allowBaseUrlEdit: Bool
    public var authType: LlmAuthType

    public init(
        id: String,
        label: String,
        baseUrl: String,
        defaultModel: String,
        allowBaseUrlEdit: Bool,
        authType: LlmAuthType
    ) {
        self.id = id
        self.label = label
        self.baseUrl = baseUrl
        self.defaultModel = defaultModel
        self.allowBaseUrlEdit = allowBaseUrlEdit
        self.authType = authType
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = (try? container.decodeIfPresent(String.self, forKey: .id)) ?? ""
        label = (try? container.decodeIfPresent(String.self, forKey: .label)) ?? ""
        baseUrl = (try? container.decodeIfPresent(String.self, forKey: .baseUrl)) ?? ""
        defaultModel = (try? container.decodeIfPresent(String.self, forKey: .defaultModel)) ?? ""
        allowBaseUrlEdit = (try? container.decodeIfPresent(Bool.self, forKey: .allowBaseUrlEdit)) ?? false
        authType = (try? container.decodeIfPresent(LlmAuthType.self, forKey: .authType)) ?? .bearer
    }
}

public struct LlmSettings: Codable, Equatable, Sendable {
    public static let defaultProviderId = "deepseek"

    public var providerId: String
    public var providers: [LlmProvider]
    public var apiKeys: [String: String]
    public var models: [String: String]

    enum CodingKeys: String, CodingKey {
        case providerId, providers, apiKeys, models
    }

    public init(providerId: String, providers: [LlmProvider], apiKeys: [String: String], models: [String: String]) {
        self.providerId = providerId
        self.providers = providers
        self.apiKeys = apiKeys
        self.models = models
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        providerId = (try? container.decodeIfPresent(String.self, forKey: .providerId)) ?? Self.defaultProviderId
        providers = (try? container.decodeIfPresent([LlmProvider].self, forKey: .providers)) ?? []
        apiKeys = Self.stringMap(container, .apiKeys)
        models = Self.stringMap(container, .models)
    }

    /// 只保留字符串值，和 JS 里的 `normalizeStringMap` 一致。
    private static func stringMap(
        _ container: KeyedDecodingContainer<CodingKeys>,
        _ key: CodingKeys
    ) -> [String: String] {
        guard let raw = try? container.decodeIfPresent([String: LossyString].self, forKey: key) else { return [:] }
        return raw.compactMapValues { $0.value }
    }

    public static func makeDefault() -> LlmSettings {
        LlmSettings(providerId: defaultProviderId, providers: [], apiKeys: [:], models: [:]).normalized()
    }

    /// 与 `electron-app/settings-store.js` 的 `normalizeLlmSettings` 规则一致：provider 列表以共享元数据为准，
    /// 只有允许编辑 Base URL 的 provider 才保留用户改过的地址。
    public func normalized() -> LlmSettings {
        let providers = SharedMetadata.llmProviders.map { fallback -> LlmProvider in
            guard let existing = self.providers.first(where: { $0.id == fallback.id }) else { return fallback }
            let label = existing.label.trimmingCharacters(in: .whitespaces)
            let baseUrl = existing.baseUrl.trimmingCharacters(in: .whitespaces)
            let defaultModel = existing.defaultModel.trimmingCharacters(in: .whitespaces)
            return LlmProvider(
                id: fallback.id,
                label: label.isEmpty ? fallback.label : label,
                baseUrl: fallback.allowBaseUrlEdit ? (baseUrl.isEmpty ? fallback.baseUrl : baseUrl) : fallback.baseUrl,
                defaultModel: defaultModel.isEmpty ? fallback.defaultModel : defaultModel,
                allowBaseUrlEdit: fallback.allowBaseUrlEdit,
                authType: existing.authType == .anthropic ? .anthropic : fallback.authType
            )
        }
        let providerId = providers.contains(where: { $0.id == self.providerId }) ? self.providerId : Self.defaultProviderId
        let apiKeys = Dictionary(uniqueKeysWithValues: providers.map { ($0.id, self.apiKeys[$0.id] ?? "") })
        let models = Dictionary(uniqueKeysWithValues: providers.map { provider -> (String, String) in
            // JS: `(models[id] || provider.defaultModel || '').trim()`——空串走默认值，纯空白会被 trim 成空串。
            let stored = self.models[provider.id] ?? ""
            let value = stored.isEmpty ? provider.defaultModel : stored
            return (provider.id, value.trimmingCharacters(in: .whitespaces))
        })
        return LlmSettings(providerId: providerId, providers: providers, apiKeys: apiKeys, models: models)
    }

    public var currentProvider: LlmProvider? {
        providers.first(where: { $0.id == providerId }) ?? providers.first
    }
}

/// 解码时把非字符串值当作缺失，而不是让整份设置解码失败。
private struct LossyString: Decodable {
    let value: String?

    init(from decoder: Decoder) throws {
        value = try? decoder.singleValueContainer().decode(String.self)
    }
}

/// 本地设置，字段和落盘 JSON 与 Electron 版的 `settings.json` 完全一致，两个版本可以共用同一份文件。
public struct LocalSettings: Codable, Equatable, Sendable {
    public var preferredLanguage: InterfaceLanguage
    public var translationTargetLanguage: String
    public var launchAtSystemStartup: Bool
    public var selectedAudioDeviceId: String
    public var modelCacheDir: String
    public var asrDeviceMode: AsrDeviceMode
    public var asrModelId: String
    public var llm: LlmSettings

    public init(
        preferredLanguage: InterfaceLanguage = .zhCN,
        translationTargetLanguage: String = SharedMetadata.defaultTranslationLanguageId,
        launchAtSystemStartup: Bool = false,
        selectedAudioDeviceId: String = "default",
        modelCacheDir: String = "",
        asrDeviceMode: AsrDeviceMode = .default,
        asrModelId: String = SharedMetadata.defaultAsrModelId,
        llm: LlmSettings = .makeDefault()
    ) {
        self.preferredLanguage = preferredLanguage
        self.translationTargetLanguage = translationTargetLanguage
        self.launchAtSystemStartup = launchAtSystemStartup
        self.selectedAudioDeviceId = selectedAudioDeviceId
        self.modelCacheDir = modelCacheDir
        self.asrDeviceMode = asrDeviceMode
        self.asrModelId = asrModelId
        self.llm = llm
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        preferredLanguage = (try? container.decodeIfPresent(InterfaceLanguage.self, forKey: .preferredLanguage)) ?? .zhCN
        translationTargetLanguage = (try? container.decodeIfPresent(String.self, forKey: .translationTargetLanguage))
            ?? SharedMetadata.defaultTranslationLanguageId
        launchAtSystemStartup = (try? container.decodeIfPresent(Bool.self, forKey: .launchAtSystemStartup)) ?? false
        selectedAudioDeviceId = (try? container.decodeIfPresent(String.self, forKey: .selectedAudioDeviceId)) ?? "default"
        modelCacheDir = (try? container.decodeIfPresent(String.self, forKey: .modelCacheDir)) ?? ""
        asrDeviceMode = (try? container.decodeIfPresent(AsrDeviceMode.self, forKey: .asrDeviceMode)) ?? .default
        asrModelId = (try? container.decodeIfPresent(String.self, forKey: .asrModelId)) ?? SharedMetadata.defaultAsrModelId
        llm = (try? container.decodeIfPresent(LlmSettings.self, forKey: .llm)) ?? .makeDefault()
        self = normalized()
    }

    /// 与 JS `normalizeLocalSettings` 一致：未知语言、模型 id 回退默认值，路径去空白。
    public func normalized() -> LocalSettings {
        var next = self
        if !SharedMetadata.translationLanguages.contains(where: { $0.id == next.translationTargetLanguage }) {
            next.translationTargetLanguage = SharedMetadata.defaultTranslationLanguageId
        }
        if !SharedMetadata.asrModels.contains(where: { $0.id == next.asrModelId }) {
            next.asrModelId = SharedMetadata.defaultAsrModelId
        }
        if next.selectedAudioDeviceId.isEmpty { next.selectedAudioDeviceId = "default" }
        next.modelCacheDir = next.modelCacheDir.trimmingCharacters(in: .whitespaces)
        next.llm = next.llm.normalized()
        return next
    }
}

import Foundation

/// 翻译目标语言（与 `shared/translation-target-languages.json` 一致）。
public struct TranslationLanguage: Codable, Equatable, Identifiable, Sendable {
    public let id: String
    public let label: String
    public let displayName: String
    public let promptName: String
}

/// 语音模型元数据（与 `shared/asr-models.json` 一致）。
public struct AsrModelInfo: Codable, Equatable, Identifiable, Sendable {
    public let id: String
    public let label: String
    public let variant: String
    public let repoId: String
    public let runtime: String
    public let sizeBytes: Int
    public let isDefault: Bool

    enum CodingKeys: String, CodingKey {
        case id, label, variant, repoId, runtime, sizeBytes
        case isDefault = "default"
    }
}

/// 前后端共用的元数据。三份 JSON 从仓库根目录的 `shared/` 复制到 `Resources/`
/// （`macos-app/Tools/sync-shared.sh`），测试会校验两边内容一致。
public enum SharedMetadata {
    public static let llmProviders: [LlmProvider] = load("llm-providers")
    public static let translationLanguages: [TranslationLanguage] = load("translation-target-languages")
    public static let asrModels: [AsrModelInfo] = load("asr-models")

    public static var defaultAsrModelId: String {
        (asrModels.first(where: { $0.isDefault }) ?? asrModels[0]).id
    }

    public static var defaultTranslationLanguageId: String {
        translationLanguages.first?.id ?? "en"
    }

    /// 随包打进去的元数据文件，测试用它和仓库 `shared/` 比对。
    public static func bundledResourceURL(_ name: String) -> URL? {
        Bundle.module.url(forResource: name, withExtension: "json")
    }

    private static func load<T: Decodable>(_ name: String) -> T {
        guard let url = bundledResourceURL(name),
              let data = try? Data(contentsOf: url),
              let value = try? JSONDecoder().decode(T.self, from: data)
        else {
            fatalError("缺少共享元数据资源: \(name).json")
        }
        return value
    }
}

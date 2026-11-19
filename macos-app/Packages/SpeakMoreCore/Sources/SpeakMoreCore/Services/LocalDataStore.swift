import Foundation

/// 本地 JSON 数据目录。路径与 Electron 版打包态一致（`~/Library/Application Support/SpeakMore/local-data`），
/// 文件名和结构也一致，所以原生版和 Electron 版可以读写同一份设置、历史和词典。
public struct LocalDataStore: Sendable {
    public static let directoryEnvironmentKey = "SPEAKMORE_LOCAL_DATA_DIR"

    public let directory: URL

    public init(directory: URL? = nil) {
        if let directory {
            self.directory = directory
        } else if let override = ProcessInfo.processInfo.environment[Self.directoryEnvironmentKey], !override.isEmpty {
            self.directory = URL(fileURLWithPath: override, isDirectory: true)
        } else {
            self.directory = FileManager.default
                .urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
                .appendingPathComponent("SpeakMore", isDirectory: true)
                .appendingPathComponent("local-data", isDirectory: true)
        }
    }

    public func fileURL(_ fileName: String) -> URL {
        directory.appendingPathComponent(fileName)
    }

    /// 读不到或解码失败时返回 `fallback`，和 JS 版 `readJsonFile` 的容错一致。
    public func read<T: Decodable>(_ type: T.Type, _ fileName: String, fallback: T) -> T {
        guard let data = try? Data(contentsOf: fileURL(fileName)),
              let value = try? JSONDecoder().decode(type, from: data)
        else { return fallback }
        return value
    }

    public func write<T: Encodable>(_ value: T, _ fileName: String) throws {
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .withoutEscapingSlashes]
        try encoder.encode(value).write(to: fileURL(fileName), options: .atomic)
    }

    public func fileModificationDate(_ fileName: String) -> Date? {
        (try? FileManager.default.attributesOfItem(atPath: fileURL(fileName).path))?[.modificationDate] as? Date
    }
}

public enum LocalDataFile {
    public static let settings = "settings.json"
    public static let history = "history.json"
    public static let historyStats = "history-stats.json"
    public static let dictionary = "dictionary.json"
    public static let dictionaryCandidates = "dictionary-candidates.json"
}

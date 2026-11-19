import Foundation

public enum VoiceMode: String, Codable, Sendable {
    case dictate = "Dictate"
    case ask = "Ask"
    case translate = "Translate"
}

public enum HistoryStatus: String, Codable, Sendable {
    case completed
    case error
}

/// 一条听写历史，字段与 Electron 版 `history.json` 一致。
public struct HistoryItem: Codable, Equatable, Identifiable, Sendable {
    public var id: String
    public var createdAt: String
    public var mode: VoiceMode
    public var status: HistoryStatus
    public var rawText: String
    public var refinedText: String
    public var isTestRecord: Bool
    public var errorCode: String?
    public var durationMs: Double
    public var textLength: Int

    enum CodingKeys: String, CodingKey {
        case id, createdAt, mode, status, rawText, refinedText, isTestRecord, errorCode, durationMs, textLength
    }

    public init(
        id: String = UUID().uuidString.lowercased(),
        createdAt: String = ISO8601.string(from: Date()),
        mode: VoiceMode = .dictate,
        status: HistoryStatus = .completed,
        rawText: String = "",
        refinedText: String = "",
        isTestRecord: Bool = false,
        errorCode: String? = nil,
        durationMs: Double = 0,
        textLength: Int? = nil
    ) {
        self.id = id
        self.createdAt = createdAt
        self.mode = mode
        self.status = status
        self.rawText = rawText
        self.refinedText = refinedText
        self.isTestRecord = isTestRecord
        self.errorCode = errorCode
        self.durationMs = max(0, durationMs)
        let finalText = refinedText.isEmpty ? rawText : refinedText
        self.textLength = max(0, textLength ?? 0) > 0 ? max(0, textLength ?? 0) : HistoryItem.countTextLength(finalText)
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let id = try container.decodeIfPresent(String.self, forKey: .id)
        let createdAt = try container.decodeIfPresent(String.self, forKey: .createdAt)
        let modeValue = try container.decodeIfPresent(String.self, forKey: .mode) ?? ""
        let statusValue = try container.decodeIfPresent(String.self, forKey: .status) ?? ""
        let errorCode = try container.decodeIfPresent(String.self, forKey: .errorCode)
        self.init(
            id: (id?.isEmpty == false ? id : nil) ?? UUID().uuidString.lowercased(),
            createdAt: (createdAt?.isEmpty == false ? createdAt : nil) ?? ISO8601.string(from: Date()),
            mode: VoiceMode(rawValue: modeValue) ?? .dictate,
            status: statusValue == "error" ? .error : .completed,
            rawText: try container.decodeIfPresent(String.self, forKey: .rawText) ?? "",
            refinedText: try container.decodeIfPresent(String.self, forKey: .refinedText) ?? "",
            isTestRecord: try container.decodeIfPresent(Bool.self, forKey: .isTestRecord) ?? false,
            errorCode: (errorCode?.isEmpty == false) ? errorCode : nil,
            durationMs: Self.number(container, .durationMs),
            textLength: Int(Self.number(container, .textLength))
        )
    }

    /// 最终展示给用户的文字：润色结果优先，没有就用识别原文。
    public var finalText: String { refinedText.isEmpty ? rawText : refinedText }

    public var createdDate: Date? { ISO8601.date(from: createdAt) }

    /// JS 的 `String.prototype.length` 按 UTF-16 码元计数，这里保持一致，累计字数才和 Electron 版对得上。
    static func countTextLength(_ text: String) -> Int {
        text.trimmingCharacters(in: .whitespacesAndNewlines).utf16.count
    }

    private static func number(_ container: KeyedDecodingContainer<CodingKeys>, _ key: CodingKeys) -> Double {
        if let value = try? container.decodeIfPresent(Double.self, forKey: key) { return value }
        if let text = try? container.decodeIfPresent(String.self, forKey: key), let value = Double(text) { return value }
        return 0
    }
}

/// `history-stats.json`：累计统计，独立于最多 200 条的历史列表。
public struct PersistedHistoryStats: Codable, Equatable, Sendable {
    public static let maxCountedIds = 5000

    public var schemaVersion: Int
    public var completedCount: Int
    public var totalDurationMs: Double
    public var totalTextLength: Int
    public var countedHistoryIds: [String]

    public init(
        schemaVersion: Int = 1,
        completedCount: Int = 0,
        totalDurationMs: Double = 0,
        totalTextLength: Int = 0,
        countedHistoryIds: [String] = []
    ) {
        self.schemaVersion = schemaVersion
        self.completedCount = max(0, completedCount)
        self.totalDurationMs = max(0, totalDurationMs)
        self.totalTextLength = max(0, totalTextLength)
        self.countedHistoryIds = Array(countedHistoryIds.filter { !$0.isEmpty }.prefix(Self.maxCountedIds))
    }

    /// 没有 `countedHistoryIds` 数组就当作旧格式，由调用方从历史列表重新迁移。
    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let ids = try container.decode([String].self, forKey: .countedHistoryIds)
        self.init(
            completedCount: Int((try? container.decodeIfPresent(Double.self, forKey: .completedCount)) ?? 0),
            totalDurationMs: (try? container.decodeIfPresent(Double.self, forKey: .totalDurationMs)) ?? 0,
            totalTextLength: Int((try? container.decodeIfPresent(Double.self, forKey: .totalTextLength)) ?? 0),
            countedHistoryIds: ids
        )
    }
}

/// 首页展示用的统计。
public struct DashboardStats: Equatable, Sendable {
    public var totalCount: Int
    public var completedCount: Int
    public var totalDurationMs: Double
    public var totalTextLength: Int
    public var averageCharsPerMinute: Int
    public var savedMs: Double

    public static let empty = DashboardStats(
        totalCount: 0,
        completedCount: 0,
        totalDurationMs: 0,
        totalTextLength: 0,
        averageCharsPerMinute: 0,
        savedMs: 0
    )

    public var durationMinutes: Int { Int(max(0, totalDurationMs) / 60000) }
    public var savedMinutes: Int { Int(max(0, savedMs) / 60000) }
}

public struct RecentResult: Equatable, Identifiable, Sendable {
    public let id: String
    public let text: String
}

/// 历史和统计的纯计算，规则与 `electron-app/history-stats-store.js` 一致。
public enum HistoryMath {
    public static let maxHistoryItems = 200
    public static let handTypedCharsPerMinute = 60.0
    public static let recentResultLimit = 3

    public static func updateStats(_ stats: PersistedHistoryStats, with item: HistoryItem) -> PersistedHistoryStats {
        guard item.status == .completed, !stats.countedHistoryIds.contains(item.id) else { return stats }
        return PersistedHistoryStats(
            schemaVersion: 1,
            completedCount: stats.completedCount + 1,
            totalDurationMs: stats.totalDurationMs + item.durationMs,
            totalTextLength: stats.totalTextLength + item.textLength,
            countedHistoryIds: [item.id] + stats.countedHistoryIds
        )
    }

    public static func stats(from items: [HistoryItem]) -> PersistedHistoryStats {
        items.reduce(PersistedHistoryStats()) { updateStats($0, with: $1) }
    }

    public static func dashboardStats(from stats: PersistedHistoryStats) -> DashboardStats {
        let totalMinutes = stats.totalDurationMs / 60000
        let average = totalMinutes > 0 ? (Double(stats.totalTextLength) / totalMinutes).rounded() : 0
        let savedMinutes = max(Double(stats.totalTextLength) / handTypedCharsPerMinute - totalMinutes, 0)
        return DashboardStats(
            totalCount: stats.completedCount,
            completedCount: stats.completedCount,
            totalDurationMs: stats.totalDurationMs,
            totalTextLength: stats.totalTextLength,
            averageCharsPerMinute: Int(average),
            savedMs: (savedMinutes * 60000).rounded()
        )
    }

    public static func upsert(
        items: [HistoryItem],
        stats: PersistedHistoryStats,
        item: HistoryItem
    ) -> (items: [HistoryItem], stats: PersistedHistoryStats) {
        let remaining = items.filter { $0.id != item.id }
        return (
            Array(([item] + remaining).prefix(maxHistoryItems)),
            updateStats(stats, with: item)
        )
    }

    /// 首页“最近结果”：最近完成、非自由提问、有文字的前几条。
    public static func recentResults(from items: [HistoryItem], limit: Int = recentResultLimit) -> [RecentResult] {
        var results: [RecentResult] = []
        for item in items {
            if results.count >= limit { break }
            guard item.status == .completed, item.mode != .ask else { continue }
            let text = item.finalText.trimmingCharacters(in: .whitespacesAndNewlines)
            if !text.isEmpty { results.append(RecentResult(id: item.id, text: text)) }
        }
        return results
    }

    /// 历史搜索：原文或润色结果包含关键字（不区分大小写）。
    public static func filter(_ items: [HistoryItem], query: String) -> [HistoryItem] {
        let keyword = query.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard !keyword.isEmpty else { return items }
        return items.filter {
            $0.rawText.lowercased().contains(keyword) || $0.refinedText.lowercased().contains(keyword)
        }
    }
}

/// JS `toISOString()` 风格的时间戳（带毫秒和 Z）。
public enum ISO8601 {
    private static let withFraction: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter
    }()

    private static let plain: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime]
        return formatter
    }()

    public static func string(from date: Date) -> String {
        withFraction.string(from: date)
    }

    public static func date(from string: String) -> Date? {
        withFraction.date(from: string) ?? plain.date(from: string)
    }
}

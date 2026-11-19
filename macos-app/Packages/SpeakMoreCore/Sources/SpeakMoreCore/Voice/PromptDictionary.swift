import Foundation

/// 传给后端 prompt 的词典：只含启用词条，按“来源 × 命中次数 × 新近度”打分裁剪。
/// 规则和 `electron-app/dictionary-store.js` 的 `buildPromptDictionaryTerms` 一致。
public enum PromptDictionary {
    public static let defaultLimit = 24
    public static let minimumLimit = 8
    public static let hardMaximumLimit = 40
    public static let halfLifeDays = 30.0

    public static func clampLimit(_ limit: Double = Double(defaultLimit)) -> Int {
        guard limit.isFinite else { return defaultLimit }
        return min(hardMaximumLimit, max(minimumLimit, Int(limit.rounded(.down))))
    }

    private static func timestamp(_ value: String) -> Double? {
        ISO8601.date(from: value).map { $0.timeIntervalSince1970 * 1000 }
    }

    static func effectiveTime(_ entry: DictionaryEntry) -> Double {
        let created = timestamp(entry.createdAt) ?? 0
        let updated = timestamp(entry.updatedAt) ?? created
        return timestamp(entry.lastLearnedAt) ?? updated
    }

    static func recencyWeight(_ entry: DictionaryEntry, now: Double) -> Double {
        let time = effectiveTime(entry)
        if time == 0 || time >= now { return 1 }
        let ageDays = (now - time) / 86_400_000
        return pow(0.5, ageDays / halfLifeDays)
    }

    public static func score(_ entry: DictionaryEntry, now: Date = Date()) -> Double {
        let nowMs = now.timeIntervalSince1970 * 1000
        let typeWeight = entry.source == .manual ? 1.05 : 1.0
        let frequencyWeight = 1 + log1p(Double(entry.hitCount))
        return typeWeight * frequencyWeight * recencyWeight(entry, now: nowMs)
    }

    public static func terms(
        from entries: [DictionaryEntry],
        limit: Int = defaultLimit,
        now: Date = Date()
    ) -> [PromptDictionaryTerm] {
        let capped = clampLimit(Double(limit))
        let ranked = entries
            .filter { $0.status == .active && !$0.phrase.isEmpty }
            .map { (entry: $0, score: score($0, now: now), time: effectiveTime($0)) }
            .sorted { left, right in
                if left.score != right.score { return left.score > right.score }
                if left.time != right.time { return left.time > right.time }
                if left.entry.updatedAt != right.entry.updatedAt { return left.entry.updatedAt > right.entry.updatedAt }
                return left.entry.phrase.localizedCompare(right.entry.phrase) == .orderedAscending
            }
        return ranked.prefix(capped).map { PromptDictionaryTerm(phrase: $0.entry.phrase, aliases: $0.entry.aliases) }
    }
}

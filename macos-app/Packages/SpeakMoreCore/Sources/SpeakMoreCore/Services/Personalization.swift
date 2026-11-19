import Foundation

/// 首页“整体个性化”分数，公式和锚点与 `dashboardPersonalization.ts` 一致：
/// `score(value, anchor) = min(1, (value / anchor) ^ 0.55)`，时长 25%、字数 30%、启用词条 45%。
public enum Personalization {
    public static let durationAnchorMinutes = 60000.0
    public static let textLengthAnchor = 10_000_000.0
    public static let dictionaryCountAnchor = 2000.0

    private static func normalizedScore(_ value: Double, anchor: Double) -> Double {
        let ratio = max(0, value.isFinite ? value : 0) / anchor
        return min(1, pow(ratio, 0.55))
    }

    public static func percent(totalDurationMs: Double, totalTextLength: Int, activeDictionaryCount: Int) -> Int {
        let durationMinutes = max(0, totalDurationMs.isFinite ? totalDurationMs : 0) / 60000
        let durationScore = normalizedScore(durationMinutes, anchor: durationAnchorMinutes)
        let textScore = normalizedScore(Double(totalTextLength), anchor: textLengthAnchor)
        let dictionaryScore = normalizedScore(Double(activeDictionaryCount), anchor: dictionaryCountAnchor)
        let value = 100 * (0.25 * durationScore + 0.30 * textScore + 0.45 * dictionaryScore)
        return Int(value.rounded())
    }
}

/// 快捷键展示文案（原生版只有 macOS）。
public struct ShortcutLabelSet: Equatable, Sendable {
    public var dictation: [String]
    public var ask: [String]
    public var translate: [String]

    public static let macOS = ShortcutLabelSet(
        dictation: ["Right Option"],
        ask: ["Right Option", "Right Command"],
        translate: ["Right Option", "Shift"]
    )

    public static func format(_ keys: [String]) -> String {
        keys.joined(separator: " + ")
    }
}

import XCTest
@testable import SpeakMoreCore

/// 用 Electron 版 JS / TS 实现生成的夹具（`Tools/generate-parity-fixtures.mjs`）校验原生实现的规则一致。
final class ParityTests: XCTestCase {
    private var fixture: [String: Any]!

    override func setUpWithError() throws {
        fixture = try XCTUnwrap(Fixture.json("parity.json") as? [String: Any])
    }

    func testPersonalizationScoreMatchesJavaScript() throws {
        let cases = try XCTUnwrap(fixture["personalization"] as? [[String: Any]])
        XCTAssertFalse(cases.isEmpty)
        for item in cases {
            let input = try XCTUnwrap(item["input"] as? [String: Any])
            let expected = try XCTUnwrap(item["expected"] as? Int)
            let actual = Personalization.percent(
                totalDurationMs: try XCTUnwrap(input["totalDurationMs"] as? Double),
                totalTextLength: Int(try XCTUnwrap(input["totalTextLength"] as? Double)),
                activeDictionaryCount: Int(try XCTUnwrap(input["activeDictionaryCount"] as? Double))
            )
            XCTAssertEqual(actual, expected, "输入 \(input)")
        }
    }

    func testHistoryNormalizationMatchesJavaScript() throws {
        let history = try XCTUnwrap(fixture["history"] as? [String: Any])
        let raw = try JSONSerialization.data(withJSONObject: try XCTUnwrap(history["raw"]))
        let items = try JSONDecoder().decode([HistoryItem].self, from: raw)
        let expected = try XCTUnwrap(history["normalized"] as? [[String: Any]])
        XCTAssertEqual(items.count, expected.count)
        for (item, expectedItem) in zip(items, expected) {
            let actual = try XCTUnwrap(jsonObject(item) as? [String: Any])
            XCTAssertEqual(actual as NSDictionary, expectedItem as NSDictionary, "历史项 \(item.id)")
        }
    }

    func testHistoryStatsAndDashboardMatchJavaScript() throws {
        let history = try XCTUnwrap(fixture["history"] as? [String: Any])
        let raw = try JSONSerialization.data(withJSONObject: try XCTUnwrap(history["raw"]))
        let items = try JSONDecoder().decode([HistoryItem].self, from: raw)

        let stats = HistoryMath.stats(from: items)
        let expectedStats = try XCTUnwrap(history["stats"] as? [String: Any])
        XCTAssertEqual(stats.completedCount, expectedStats["completedCount"] as? Int)
        XCTAssertEqual(stats.totalTextLength, expectedStats["totalTextLength"] as? Int)
        XCTAssertEqual(stats.totalDurationMs, try XCTUnwrap(expectedStats["totalDurationMs"] as? Double), accuracy: 0.0001)
        XCTAssertEqual(stats.countedHistoryIds, expectedStats["countedHistoryIds"] as? [String])

        let dashboard = HistoryMath.dashboardStats(from: stats)
        let expectedDashboard = try XCTUnwrap(history["dashboard"] as? [String: Any])
        XCTAssertEqual(dashboard.totalCount, expectedDashboard["totalCount"] as? Int)
        XCTAssertEqual(dashboard.averageCharsPerMinute, expectedDashboard["averageCharsPerMinute"] as? Int)
        XCTAssertEqual(dashboard.savedMs, try XCTUnwrap(expectedDashboard["savedMs"] as? Double), accuracy: 0.5)
    }

    func testRecentResultsMatchJavaScript() throws {
        let history = try XCTUnwrap(fixture["history"] as? [String: Any])
        let raw = try JSONSerialization.data(withJSONObject: try XCTUnwrap(history["raw"]))
        let items = try JSONDecoder().decode([HistoryItem].self, from: raw)

        for (key, limit) in [("recent", HistoryMath.recentResultLimit), ("recentLimit1", 1)] {
            let expected = try XCTUnwrap(history[key] as? [[String: String]])
            let actual = HistoryMath.recentResults(from: items, limit: limit)
            XCTAssertEqual(actual.map(\.id), expected.map { $0["id"] })
            XCTAssertEqual(actual.map(\.text), expected.map { $0["text"] })
        }
    }

    func testSettingsNormalizationMatchesJavaScript() throws {
        let cases = try XCTUnwrap(fixture["settings"] as? [[String: Any]])
        XCTAssertFalse(cases.isEmpty)
        for (index, item) in cases.enumerated() {
            let input = try JSONSerialization.data(withJSONObject: try XCTUnwrap(item["input"]))
            let settings = try JSONDecoder().decode(LocalSettings.self, from: input)
            let actual = try XCTUnwrap(jsonObject(settings) as? [String: Any])
            let expected = try XCTUnwrap(item["expected"] as? [String: Any])
            XCTAssertEqual(actual as NSDictionary, expected as NSDictionary, "设置用例 #\(index)")
        }
    }

    func testDictionaryScriptMatchesJavaScript() throws {
        let expected = try XCTUnwrap(fixture["dictionary"] as? [String: Any])
        func stamp(_ n: Int) -> String { "2026-11-19T0\(n):00:00.000Z" }

        var entries: [DictionaryEntry] = []
        var candidates = [
            DictionaryCandidate(id: "c1", wrong: "open eye", correct: "OpenAI", count: 4, firstSeenAt: stamp(1), lastSeenAt: stamp(2)),
            DictionaryCandidate(id: "c2", wrong: "Gemini", correct: "Gemma", count: 2, firstSeenAt: stamp(1), lastSeenAt: stamp(2)),
            DictionaryCandidate(id: "c3", wrong: "a", correct: "b", count: 1, status: .ignored, firstSeenAt: stamp(1), lastSeenAt: stamp(1)),
        ]
        var outcomes: [(Bool, String?)] = []

        func create(_ phrase: String, _ aliases: [String], _ n: Int) {
            do {
                entries = try DictionaryLogic.create(entries, new: .init(phrase: phrase, aliases: aliases), now: stamp(n)).entries
                outcomes.append((true, nil))
            } catch {
                outcomes.append((false, "dictionary_entry_invalid"))
            }
        }

        create("  Claude   Code ", ["cloud code", "Cloud Code", "claude code", " ", "clawd"], 1)
        create("claude code", ["clawd code"], 2)
        create("DeepSeek", ["deep sick"], 3)
        create("   ", ["x"], 3)
        let deepSeekId = try XCTUnwrap(entries.first(where: { $0.phrase == "DeepSeek" })?.id)
        entries = try DictionaryLogic.setStatus(entries, id: deepSeekId, status: .disabled, now: stamp(4))
        outcomes.append((true, nil))
        let promoted = try DictionaryLogic.promote(candidates: candidates, entries: entries, id: "c1", now: stamp(5))
        entries = promoted.entries
        candidates = promoted.candidates
        outcomes.append((true, nil))
        XCTAssertThrowsError(try DictionaryLogic.promote(candidates: candidates, entries: entries, id: "missing", now: stamp(5))) {
            XCTAssertEqual($0 as? DictionaryError, .candidateNotFound)
        }
        outcomes.append((false, "dictionary_candidate_not_found"))
        candidates = DictionaryLogic.ignore(candidates: candidates, id: "c2")
        outcomes.append((true, nil))
        create("openai", ["open a i"], 6)
        let claudeId = try XCTUnwrap(entries.first(where: { $0.phrase == "Claude Code" })?.id)
        entries.removeAll { $0.id == claudeId }

        let steps = try XCTUnwrap(expected["steps"] as? [[String: Any]])
        XCTAssertEqual(outcomes.map(\.0), steps.map { $0["success"] as? Bool })
        XCTAssertEqual(outcomes.map(\.1), steps.map { $0["code"] as? String })

        // 词条 id 是随机的：和夹具一样，把 id 换成词条文本再比较。
        let actualEntries = try entries.map { entry -> [String: Any] in
            var object = try XCTUnwrap(jsonObject(entry) as? [String: Any])
            object.removeValue(forKey: "id")
            object["key"] = entry.phrase
            return object
        }
        let expectedEntries = try XCTUnwrap(expected["entries"] as? [[String: Any]])
        XCTAssertEqual(actualEntries as NSArray, expectedEntries as NSArray)

        let actualCandidates = try jsonObject(candidates)
        XCTAssertEqual(actualCandidates as? NSArray, try XCTUnwrap(expected["candidates"] as? NSArray))
    }

    func testAliasSplittingMatchesJavaScript() throws {
        let dictionary = try XCTUnwrap(fixture["dictionary"] as? [String: Any])
        let cases = try XCTUnwrap(dictionary["aliasSplits"] as? [[String: Any]])
        for item in cases {
            let input = try XCTUnwrap(item["input"] as? String)
            XCTAssertEqual(DictionaryLogic.splitAliases(input), item["expected"] as? [String], "输入 \(input)")
        }
    }
}

import XCTest
@testable import SpeakMoreCore

final class SharedMetadataTests: XCTestCase {
    /// `Resources/` 里的三份 JSON 必须和仓库根目录 `shared/` 一致（改了 shared 之后要运行 Tools/sync-shared.sh）。
    func testBundledMetadataMatchesRepositoryShared() throws {
        var root = URL(fileURLWithPath: #filePath)
        for _ in 0..<6 { root.deleteLastPathComponent() }
        for name in ["llm-providers", "translation-target-languages", "asr-models"] {
            let shared = try Data(contentsOf: root.appendingPathComponent("shared/\(name).json"))
            let bundled = try Data(contentsOf: XCTUnwrap(SharedMetadata.bundledResourceURL(name)))
            XCTAssertEqual(
                try JSONSerialization.jsonObject(with: shared) as? NSObject,
                try JSONSerialization.jsonObject(with: bundled) as? NSObject,
                "\(name).json 和 shared/ 不一致，请运行 macos-app/Tools/sync-shared.sh"
            )
        }
    }

    func testDefaultsComeFromMetadata() {
        XCTAssertEqual(SharedMetadata.defaultAsrModelId, "sensevoice-small")
        XCTAssertEqual(SharedMetadata.asrModels.map(\.id), ["sensevoice-small", "sensevoice-small-int8"])
        XCTAssertEqual(SharedMetadata.defaultTranslationLanguageId, "en")
        XCTAssertTrue(SharedMetadata.llmProviders.contains { $0.id == "deepseek" })
    }
}

final class LocalDataStoreTests: XCTestCase {
    func testWriteAndReadRoundTrip() throws {
        let (store, directory) = try temporaryDataStore()
        defer { try? FileManager.default.removeItem(at: directory) }

        var settings = LocalSettings()
        settings.preferredLanguage = .enUS
        settings.asrModelId = "sensevoice-small-int8"
        try store.write(settings, LocalDataFile.settings)

        XCTAssertEqual(store.read(LocalSettings.self, LocalDataFile.settings, fallback: LocalSettings()), settings)
    }

    func testReadFallsBackOnMissingOrCorruptFile() throws {
        let (store, directory) = try temporaryDataStore()
        defer { try? FileManager.default.removeItem(at: directory) }

        XCTAssertEqual(store.read([HistoryItem].self, LocalDataFile.history, fallback: []).count, 0)
        try Data("not json".utf8).write(to: store.fileURL(LocalDataFile.history))
        XCTAssertEqual(store.read([HistoryItem].self, LocalDataFile.history, fallback: []).count, 0)
    }

    func testDefaultDirectoryMatchesElectronPackagedPath() {
        let store = LocalDataStore()
        if ProcessInfo.processInfo.environment[LocalDataStore.directoryEnvironmentKey] == nil {
            XCTAssertTrue(store.directory.path.hasSuffix("Library/Application Support/SpeakMore/local-data"))
        }
    }
}

final class BackendClientTests: XCTestCase {
    private let base = URL(string: "http://127.0.0.1:8000")!

    func testStatusRequestCarriesCacheDirAndModelId() async throws {
        let transport = FakeTransport([.success((try Fixture.data("model-status-ready.json"), 200))])
        let client = BackendClient(baseURL: base, transport: transport)

        let status = await client.modelStatus(cacheDir: "/Users/me/My Models", modelId: "sensevoice-small-int8")

        let request = try XCTUnwrap(transport.requests.first)
        let components = try XCTUnwrap(URLComponents(url: request.url, resolvingAgainstBaseURL: false))
        XCTAssertEqual(components.path, "/model/status")
        XCTAssertEqual(components.queryItems?.first { $0.name == "cache_dir" }?.value, "/Users/me/My Models")
        XCTAssertEqual(components.queryItems?.first { $0.name == "model_id" }?.value, "sensevoice-small-int8")
        XCTAssertEqual(request.method, "GET")
        XCTAssertEqual(status.status, .ready)
    }

    func testStatusWithoutOptionsHasNoQuery() async throws {
        let transport = FakeTransport([.success((try Fixture.data("model-status-ready.json"), 200))])
        _ = await BackendClient(baseURL: base, transport: transport).modelStatus()
        XCTAssertNil(transport.requests.first?.url.query)
    }

    func testDownloadBodyMatchesElectronClient() async throws {
        let transport = FakeTransport([
            .success((try Fixture.data("model-status-ready.json"), 200)),
            .success((try Fixture.data("model-status-ready.json"), 200)),
            .success((try Fixture.data("model-status-ready.json"), 200)),
        ])
        let client = BackendClient(baseURL: base, transport: transport)

        _ = await client.startDownload(cacheDir: "/models", modelId: "sensevoice-small-int8", load: false)
        _ = await client.startDownload(modelId: "sensevoice-small")
        _ = await client.startDownload()

        let bodies = try transport.requests.map { request -> [String: Any]? in
            try request.body.map { try XCTUnwrap(JSONSerialization.jsonObject(with: $0) as? [String: Any]) }
        }
        XCTAssertEqual(bodies[0] as NSDictionary?, ["cache_dir": "/models", "model_id": "sensevoice-small-int8", "load": false] as NSDictionary)
        XCTAssertEqual(bodies[1] as NSDictionary?, ["model_id": "sensevoice-small"] as NSDictionary)
        XCTAssertNil(bodies[2])
        XCTAssertEqual(transport.requests.map(\.method), ["POST", "POST", "POST"])
        XCTAssertEqual(transport.requests[0].contentType, "application/json")
    }

    func testUnreachableBackendIsReportedAsUnavailable() async {
        let client = BackendClient(baseURL: base, transport: FakeTransport([.failure(URLError(.cannotConnectToHost))]))
        let status = await client.modelStatus()
        XCTAssertEqual(status.status, .unavailable)
        XCTAssertFalse(status.ready)
    }

    func testReloadConfigResults() async {
        let ok = FakeTransport([.success((Data(#"{"status":"ok","detail":"大模型配置已重载"}"#.utf8), 200))])
        let success = await BackendClient(baseURL: base, transport: ok).reloadConfig()
        XCTAssertEqual(success, ConfigReloadResult(success: true, detail: "大模型配置已重载"))

        let failed = FakeTransport([.success((Data(#"{"detail":"boom"}"#.utf8), 500))])
        let failure = await BackendClient(baseURL: base, transport: failed).reloadConfig()
        XCTAssertEqual(failure, ConfigReloadResult(success: false, detail: "boom"))

        let down = FakeTransport([.failure(URLError(.cannotConnectToHost))])
        let unreachable = await BackendClient(baseURL: base, transport: down).reloadConfig()
        XCTAssertFalse(unreachable.success)
    }

    func testRealBackendStatusSampleDecodes() throws {
        let status = VoiceModelStatus(json: try Fixture.json("model-status-ready.json"))

        XCTAssertEqual(status.status, .ready)
        XCTAssertTrue(status.ready)
        XCTAssertEqual(status.activeModelId, "sensevoice-small-int8")
        XCTAssertEqual(status.device, "cpu")
        XCTAssertNil(status.fallbackReason)
        XCTAssertEqual(status.models.map(\.modelId), ["sensevoice-small", "sensevoice-small-int8"])
        XCTAssertEqual(status.models.map(\.active), [false, true])
        XCTAssertEqual(status.models[1].variant, "ONNX")
        XCTAssertEqual(status.models[1].sizeBytes, 239_549_806)
        XCTAssertNil(status.progressPercent)
    }

    func testDownloadProgressAndTolerantDecoding() throws {
        let status = VoiceModelStatus(json: [
            "status": "downloading",
            "downloaded_bytes": 25,
            "total_bytes": 100,
            "progress_percent": 250,
            "downloaded_files": "bad",
            "total_files": NSNull(),
            "file_progress_percent": 33.4,
            "models": [["model_id": "", "status": "idle"], ["model_id": "m", "status": "weird"]],
        ])

        XCTAssertEqual(status.status, .downloading)
        XCTAssertTrue(status.hasByteProgress)
        XCTAssertEqual(status.progressPercent, 100)
        XCTAssertEqual(status.downloadedFiles, 0)
        XCTAssertEqual(status.fileProgressPercent, 33)
        XCTAssertFalse(status.hasFileProgress)
        XCTAssertEqual(status.models.map(\.modelId), ["m"])
        XCTAssertEqual(status.models.first?.status, .unavailable)
        XCTAssertEqual(VoiceModelStatus(json: "garbage").status, .unavailable)
        XCTAssertEqual(VoiceModelStatus(json: ["status": "nonsense"]).status, .unavailable)
    }

    func testFallbackOptionsListBothModels() {
        let options = VoiceModelOption.fallbackOptions(activeModelId: "sensevoice-small-int8")
        XCTAssertEqual(options.map(\.modelId), ["sensevoice-small", "sensevoice-small-int8"])
        XCTAssertEqual(options.map(\.active), [false, true])
        XCTAssertTrue(options.allSatisfy { $0.sizeBytes > 0 && !$0.cached })
    }
}

@MainActor
final class StoreTests: XCTestCase {
    func testSettingsUpdateMergesWithChangesWrittenElsewhere() throws {
        let (data, directory) = try temporaryDataStore()
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = SettingsStore(data: data)

        // 另一个进程（比如 Electron 版）在我们不知情时改了模型缓存目录。
        var external = LocalSettings()
        external.modelCacheDir = "/external/models"
        try data.write(external, LocalDataFile.settings)

        store.update { $0.preferredLanguage = .enUS }

        XCTAssertEqual(store.settings.preferredLanguage, .enUS)
        XCTAssertEqual(store.settings.modelCacheDir, "/external/models")
        XCTAssertEqual(data.read(LocalSettings.self, LocalDataFile.settings, fallback: LocalSettings()).modelCacheDir, "/external/models")
    }

    func testSettingsStoreNormalizesInvalidValues() throws {
        let (data, directory) = try temporaryDataStore()
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = SettingsStore(data: data)

        store.update {
            $0.asrModelId = "unknown"
            $0.translationTargetLanguage = "zz"
            $0.selectedAudioDeviceId = ""
        }

        XCTAssertEqual(store.settings.asrModelId, SharedMetadata.defaultAsrModelId)
        XCTAssertEqual(store.settings.translationTargetLanguage, SharedMetadata.defaultTranslationLanguageId)
        XCTAssertEqual(store.settings.selectedAudioDeviceId, "default")
    }

    func testHistoryClearKeepsAccumulatedStats() throws {
        let (data, directory) = try temporaryDataStore()
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = HistoryStore(data: data)

        store.upsert(HistoryItem(id: "a", rawText: "你好", refinedText: "你好。", durationMs: 60000))
        store.upsert(HistoryItem(id: "b", mode: .ask, rawText: "问题", durationMs: 30000))
        XCTAssertEqual(store.items.map(\.id), ["b", "a"])
        XCTAssertEqual(store.stats.completedCount, 2)
        XCTAssertEqual(store.recentResults.map(\.id), ["a"])

        store.clear()

        XCTAssertTrue(store.items.isEmpty)
        XCTAssertEqual(store.stats.completedCount, 2)
        XCTAssertEqual(store.stats.totalDurationMs, 90000)
        XCTAssertTrue(store.recentResults.isEmpty)
    }

    func testHistoryMigratesStatsFromExistingListWhenStatsFileIsMissing() throws {
        let (data, directory) = try temporaryDataStore()
        defer { try? FileManager.default.removeItem(at: directory) }
        try data.write(
            [HistoryItem(id: "x", rawText: "abc", durationMs: 1000), HistoryItem(id: "y", status: .error, durationMs: 500)],
            LocalDataFile.history
        )

        let store = HistoryStore(data: data)

        XCTAssertEqual(store.stats.completedCount, 1)
        XCTAssertTrue(FileManager.default.fileExists(atPath: data.fileURL(LocalDataFile.historyStats).path))
    }

    func testHistoryCapsListAtTwoHundredItems() throws {
        let (data, directory) = try temporaryDataStore()
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = HistoryStore(data: data)
        for index in 0..<205 {
            store.upsert(HistoryItem(id: "id-\(index)", rawText: "t\(index)", durationMs: 1))
        }
        XCTAssertEqual(store.items.count, HistoryMath.maxHistoryItems)
        XCTAssertEqual(store.items.first?.id, "id-204")
        XCTAssertEqual(store.stats.completedCount, 205)
    }

    func testDictionaryLifecycle() throws {
        let (data, directory) = try temporaryDataStore()
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = DictionaryStore(data: data)

        XCTAssertFalse(store.create(phrase: "   ", aliasesText: "x"))
        XCTAssertTrue(store.create(phrase: "Claude Code", aliasesText: "cloud code，clawd code"))
        XCTAssertEqual(store.entries.first?.aliases, ["cloud code", "clawd code"])
        XCTAssertEqual(store.activeEntryCount, 1)

        let entry = try XCTUnwrap(store.entries.first)
        store.toggle(entry)
        XCTAssertEqual(store.entries.first?.status, .disabled)
        XCTAssertEqual(store.activeEntryCount, 0)

        store.delete(id: entry.id)
        XCTAssertTrue(store.entries.isEmpty)
    }

    func testDictionaryCandidatePromoteAndIgnore() throws {
        let (data, directory) = try temporaryDataStore()
        defer { try? FileManager.default.removeItem(at: directory) }
        try data.write([
            DictionaryCandidate(id: "c1", wrong: "open eye", correct: "OpenAI", count: 3, firstSeenAt: "2026-11-19T00:00:00.000Z"),
            DictionaryCandidate(id: "c2", wrong: "Gemini", correct: "Gemma", count: 1, firstSeenAt: "2026-11-19T00:00:00.000Z"),
        ], LocalDataFile.dictionaryCandidates)
        let store = DictionaryStore(data: data)
        XCTAssertEqual(store.pendingCandidates.map(\.id), ["c1", "c2"])

        store.promoteCandidate(id: "c1")
        store.ignoreCandidate(id: "c2")

        XCTAssertTrue(store.pendingCandidates.isEmpty)
        XCTAssertEqual(store.entries.map(\.phrase), ["OpenAI"])
        XCTAssertEqual(store.entries.first?.source, .auto)
        XCTAssertEqual(store.entries.first?.aliases, ["open eye"])
        XCTAssertEqual(store.entries.first?.hitCount, 3)
    }

    func testStoresPickUpChangesMadeByAnotherProcess() throws {
        let (data, directory) = try temporaryDataStore()
        defer { try? FileManager.default.removeItem(at: directory) }
        let dictionary = DictionaryStore(data: data)
        XCTAssertTrue(dictionary.entries.isEmpty)

        let now = ISO8601.string(from: Date())
        try data.write([DictionaryEntry(phrase: "新词", createdAt: now)], LocalDataFile.dictionary)
        dictionary.reloadIfChanged()

        XCTAssertEqual(dictionary.entries.map(\.phrase), ["新词"])
    }
}

final class ShortcutTests: XCTestCase {
    func testMacShortcutLabels() {
        XCTAssertEqual(ShortcutLabelSet.format(ShortcutLabelSet.macOS.dictation), "Right Option")
        XCTAssertEqual(ShortcutLabelSet.format(ShortcutLabelSet.macOS.ask), "Right Option + Right Command")
        XCTAssertEqual(ShortcutLabelSet.format(ShortcutLabelSet.macOS.translate), "Right Option + Shift")
    }
}

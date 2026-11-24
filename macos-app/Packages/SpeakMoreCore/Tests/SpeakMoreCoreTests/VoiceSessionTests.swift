import XCTest
@testable import SpeakMoreCore

// MARK: - 假的外部依赖

final class FakeAudioSource: AudioSource, @unchecked Sendable {
    private let lock = NSLock()
    var prepareError: Error?
    private(set) var prepared = false
    private(set) var started = false
    private(set) var stopCount = 0
    private var handler: (@Sendable (AudioChunk) -> Void)?

    func prepare() async throws {
        if let prepareError { throw prepareError }
        lock.lock(); prepared = true; lock.unlock()
    }

    func begin(onChunk: @escaping @Sendable (AudioChunk) -> Void) throws {
        lock.lock(); started = true; handler = onChunk; lock.unlock()
    }

    func stop() {
        lock.lock(); stopCount += 1; handler = nil; lock.unlock()
    }

    /// 模拟麦克风送来一段 16 kHz 单声道音频。
    func emit(_ samples: [Float], sampleRate: Double = 16000) {
        lock.lock(); let current = handler; lock.unlock()
        current?(AudioChunk(channels: [samples], sampleRate: sampleRate))
    }
}

final class FakeVoiceTransport: VoiceTransport, @unchecked Sendable {
    enum Sent: Equatable {
        case text(String)
        case binary(Int)
    }

    private let lock = NSLock()
    private var open = false
    private var messageHandler: (@Sendable (String) -> Void)?
    private var closeHandler: (@Sendable () -> Void)?
    private var sentItems: [Sent] = []
    var connectError: Error?
    var sendError: Error?
    private(set) var closeCount = 0

    var isOpen: Bool { lock.lock(); defer { lock.unlock() }; return open }
    var onMessage: (@Sendable (String) -> Void)? {
        get { lock.lock(); defer { lock.unlock() }; return messageHandler }
        set { lock.lock(); messageHandler = newValue; lock.unlock() }
    }
    var onClose: (@Sendable () -> Void)? {
        get { lock.lock(); defer { lock.unlock() }; return closeHandler }
        set { lock.lock(); closeHandler = newValue; lock.unlock() }
    }

    var sent: [Sent] { lock.lock(); defer { lock.unlock() }; return sentItems }
    var texts: [String] { sent.compactMap { if case .text(let text) = $0 { text } else { nil } } }

    func connect(timeout: TimeInterval) async throws {
        if let connectError { throw connectError }
        lock.lock(); open = true; lock.unlock()
    }

    func send(text: String) async throws {
        if let sendError { throw sendError }
        lock.lock(); sentItems.append(.text(text)); lock.unlock()
    }

    func send(binary: Data) async throws {
        if let sendError { throw sendError }
        lock.lock(); sentItems.append(.binary(binary.count)); lock.unlock()
    }

    func close() {
        lock.lock(); open = false; closeCount += 1; lock.unlock()
    }

    // 模拟服务端
    func serve(_ type: String, _ payload: [String: Any]) {
        let data = try! JSONSerialization.data(withJSONObject: ["K": type, "V": payload])
        onMessage?(String(decoding: data, as: UTF8.self))
    }

    func drop() {
        lock.lock(); open = false; let handler = closeHandler; lock.unlock()
        handler?()
    }
}

final class ManualScheduler: VoiceScheduler, @unchecked Sendable {
    private final class Entry: VoiceCancellable, @unchecked Sendable {
        let delay: TimeInterval
        let action: @MainActor @Sendable () -> Void
        var cancelled = false
        init(delay: TimeInterval, action: @escaping @MainActor @Sendable () -> Void) { self.delay = delay; self.action = action }
        func cancel() { cancelled = true }
    }

    private let lock = NSLock()
    private var entries: [Entry] = []

    func schedule(after seconds: TimeInterval, _ action: @escaping @MainActor @Sendable () -> Void) -> VoiceCancellable {
        let entry = Entry(delay: seconds, action: action)
        lock.lock(); entries.append(entry); lock.unlock()
        return entry
    }

    func pendingDelays() -> [TimeInterval] {
        lock.lock(); defer { lock.unlock() }
        return entries.filter { !$0.cancelled }.map(\.delay)
    }

    @MainActor func fire(delay: TimeInterval) {
        lock.lock(); let due = entries.filter { !$0.cancelled && $0.delay == delay }; lock.unlock()
        for entry in due { entry.cancelled = true; entry.action() }
    }
}

@MainActor
final class VoiceHarness {
    let transport = FakeVoiceTransport()
    let audio = FakeAudioSource()
    let scheduler = ManualScheduler()
    var settings = LocalSettings()
    var terms: [PromptDictionaryTerm] = [PromptDictionaryTerm(phrase: "Claude Code", aliases: ["cloud code"])]
    var task: VoiceTask?
    var readyError: Error?
    private(set) var delivered: [(text: String, task: VoiceTask?, mode: VoiceMode)] = []
    private(set) var history: [HistoryItem] = []
    private(set) var hideCount = 0
    private(set) var sessions: [VoiceSession] = []
    private(set) var transportsMade = 0
    var controller: VoiceSessionController!

    init(apiKey: String = "sk-test") {
        settings.llm.apiKeys[settings.llm.providerId] = apiKey
        let resolver = VoiceTaskResolver(
            readSelection: { SelectionSnapshot(selectedText: "选中的内容", source: .accessibility, confidence: .confirmed, focusInfo: FocusInfo(bundleId: "com.test")) },
            readFocus: { FocusInfo(bundleId: "com.test") }
        )
        controller = VoiceSessionController(dependencies: VoiceDependencies(
            settings: { [unowned self] in self.settings },
            promptTerms: { [unowned self] in self.terms },
            ensureBackendReady: { [unowned self] in if let error = await MainActor.run(body: { self.readyError }) { throw error } },
            makeTransport: { [unowned self] in self.transportsMade += 1; return self.transport },
            makeAudioSource: { [unowned self] _ in self.audio },
            resolver: resolver,
            deliver: { [unowned self] text, task, mode in self.delivered.append((text, task, mode)) },
            saveHistory: { [unowned self] item in self.history.append(item) },
            hideFloatingPanel: { [unowned self] in self.hideCount += 1 },
            scheduler: scheduler
        ))
        controller.observe { [unowned self] session in self.sessions.append(session) }
    }

    var status: VoiceStatus { controller.session.status }

    func eventually(_ label: String, timeout: TimeInterval = 3, file: StaticString = #filePath, line: UInt = #line, _ condition: () -> Bool) async {
        let deadline = Date().addingTimeInterval(timeout)
        while !condition() {
            if Date() > deadline { return XCTFail("等待超时：\(label)（当前状态 \(status)）", file: file, line: line) }
            try? await Task.sleep(nanoseconds: 5_000_000)
        }
    }

    /// 从空闲走到“正在录音”。
    func startAndRecord(_ intent: ShortcutIntent = .dictate) async {
        await controller.startRecording(intent: intent)
        await eventually("进入录音") { self.status == .recording }
    }
}

// MARK: - 状态机测试

@MainActor
final class VoiceSessionTests: XCTestCase {
    private func startPayload(_ harness: VoiceHarness) throws -> [String: Any] {
        let text = try XCTUnwrap(harness.transport.texts.first)
        return try XCTUnwrap(JSONSerialization.jsonObject(with: Data(text.utf8)) as? [String: Any])
    }

    func testDictationEndToEnd() async throws {
        let harness = VoiceHarness()
        await harness.startAndRecord()

        // start_audio 在麦克风就绪、连接就绪之后发出，带上词典和 LLM 配置。
        let start = try startPayload(harness)
        XCTAssertEqual(start["type"] as? String, "start_audio")
        XCTAssertEqual(start["mode"] as? String, "transcript")
        let audioId = try XCTUnwrap(start["audio_id"] as? String)
        XCTAssertEqual(harness.controller.session.audioId, audioId)
        let parameters = try XCTUnwrap(start["parameters"] as? [String: Any])
        XCTAssertEqual((parameters["llm"] as? [String: Any])?["api_key"] as? String, "sk-test")
        XCTAssertEqual((parameters["dictionary_terms"] as? [[String: Any]])?.first?["phrase"] as? String, "Claude Code")
        XCTAssertNil(parameters["selected_text"])
        XCTAssertEqual(harness.hideCount, 1, "新录音开始前要收起旧面板")

        // 音频：16 kHz 单声道，每个采样 2 字节。
        harness.audio.emit([Float](repeating: 0.05, count: 800))
        await harness.eventually("音频发出") { harness.transport.sent.contains(.binary(1600)) }

        harness.controller.stopRecording()
        XCTAssertEqual(harness.status, .stopping)
        await harness.eventually("进入转写") { harness.status == .transcribing }
        let sent = harness.transport.sent
        let endIndex = try XCTUnwrap(sent.firstIndex { if case .text(let text) = $0 { text.contains("end_audio") } else { false } })
        let lastBinary = try XCTUnwrap(sent.lastIndex { if case .binary = $0 { true } else { false } })
        XCTAssertGreaterThan(endIndex, lastBinary, "end_audio 必须在所有音频之后")
        XCTAssertEqual(harness.audio.stopCount >= 1, true)
        XCTAssertEqual(harness.scheduler.pendingDelays(), [60], "转写等待定时器")

        harness.transport.serve("transcription", ["audio_id": audioId, "text": "你好世界"])
        await harness.eventually("原文更新") { harness.controller.session.rawText == "你好世界" }
        harness.transport.serve("audio_processing_completed", ["audio_id": audioId, "refined_text": "你好，世界。"])
        await harness.eventually("完成") { harness.status == .completed }

        XCTAssertEqual(harness.controller.session.refinedText, "你好，世界。")
        XCTAssertEqual(harness.controller.session.textLength, 6)
        await harness.eventually("交付") { harness.delivered.count == 1 }
        XCTAssertEqual(harness.delivered.first?.text, "你好，世界。")
        XCTAssertEqual(harness.delivered.first?.task?.delivery, .paste)
        XCTAssertEqual(harness.delivered.first?.mode, .dictate)

        XCTAssertEqual(harness.history.count, 1)
        let item = try XCTUnwrap(harness.history.first)
        XCTAssertEqual(item.id, audioId)
        XCTAssertEqual(item.status, .completed)
        XCTAssertEqual(item.refinedText, "你好，世界。")
        XCTAssertEqual(item.rawText, "你好世界")
        XCTAssertEqual(item.mode, .dictate)
    }

    func testMissingApiKeyFailsBeforeOpeningAnything() async throws {
        let harness = VoiceHarness(apiKey: "   ")
        await harness.controller.startRecording(intent: .dictate)
        XCTAssertEqual(harness.status, .error)
        XCTAssertEqual(harness.controller.session.error?.code, .llmApiKeyMissing)
        XCTAssertTrue(harness.transport.sent.isEmpty)
        XCTAssertFalse(harness.audio.prepared)
        XCTAssertEqual(harness.history.first?.errorCode, "llm_api_key_missing")
        XCTAssertEqual(harness.history.first?.status, .error)
    }

    func testBackendNotReadyReleasesResources() async throws {
        let harness = VoiceHarness()
        harness.readyError = VoiceError(.voiceModelMissing, detail: "还没有下载")
        await harness.controller.startRecording(intent: .dictate)
        XCTAssertEqual(harness.status, .error)
        XCTAssertEqual(harness.controller.session.error?.code, .voiceModelMissing)
        XCTAssertGreaterThanOrEqual(harness.audio.stopCount, 1, "麦克风要被收掉")
        XCTAssertGreaterThanOrEqual(harness.transport.closeCount, 1, "连接要被关掉")
        XCTAssertFalse(harness.audio.started)
    }

    func testMicrophonePermissionDenied() async throws {
        let harness = VoiceHarness()
        harness.audio.prepareError = VoiceError(.microphonePermissionDenied)
        await harness.controller.startRecording(intent: .dictate)
        XCTAssertEqual(harness.controller.session.error?.code, .microphonePermissionDenied)
        XCTAssertTrue(harness.transport.texts.isEmpty, "没拿到麦克风不能发 start_audio")
    }

    func testConnectFailure() async throws {
        let harness = VoiceHarness()
        harness.transport.connectError = VoiceError(.websocketTimeout)
        await harness.controller.startRecording(intent: .dictate)
        XCTAssertEqual(harness.controller.session.error?.code, .websocketTimeout)
    }

    func testCancelDoesNotSendEndAudioAndIgnoresLateResult() async throws {
        let harness = VoiceHarness()
        await harness.startAndRecord()
        let audioId = try XCTUnwrap(harness.controller.session.audioId)

        harness.controller.cancelRecording()
        XCTAssertEqual(harness.status, .cancelled)
        XCTAssertFalse(harness.transport.texts.contains { $0.contains("end_audio") })
        XCTAssertGreaterThanOrEqual(harness.transport.closeCount, 1)
        XCTAssertTrue(harness.scheduler.pendingDelays().isEmpty, "取消后不应留下定时器")

        // 迟到的结果（来自旧连接）不能触发粘贴，也不能改状态。
        harness.transport.serve("audio_processing_completed", ["audio_id": audioId, "refined_text": "迟到"])
        try await Task.sleep(nanoseconds: 50_000_000)
        XCTAssertEqual(harness.status, .cancelled)
        XCTAssertTrue(harness.delivered.isEmpty)
        XCTAssertTrue(harness.history.isEmpty, "取消的录音不进历史")
    }

    func testCancelWhileConnectingStopsStartup() async throws {
        let harness = VoiceHarness()
        let start = Task { await harness.controller.startRecording(intent: .dictate) }
        await harness.eventually("连接中") { harness.status == .connecting || harness.status == .recording }
        harness.controller.cancelRecording()
        await start.value
        XCTAssertEqual(harness.status, .cancelled)
        XCTAssertFalse(harness.audio.started && harness.status == .recording)
    }

    func testRecordingLimitWarningAndAutoStop() async throws {
        let harness = VoiceHarness()
        await harness.startAndRecord()
        XCTAssertEqual(Set(harness.scheduler.pendingDelays()), [29 * 60, 30 * 60])

        harness.scheduler.fire(delay: 29 * 60)
        XCTAssertEqual(harness.controller.session.noticeText, "录音将在 1 分钟后自动结束")
        XCTAssertEqual(harness.controller.floatingBarState.displayText, "录音将在 1 分钟后自动结束")

        harness.scheduler.fire(delay: 30 * 60)
        await harness.eventually("自动停止进入转写") { harness.status == .transcribing }
        XCTAssertTrue(harness.transport.texts.contains { $0.contains("end_audio") })
        XCTAssertEqual(harness.controller.session.noticeText, "")
    }

    func testTranscribeTimeout() async throws {
        let harness = VoiceHarness()
        await harness.startAndRecord()
        harness.controller.stopRecording()
        await harness.eventually("转写中") { harness.status == .transcribing }
        harness.scheduler.fire(delay: 60)
        XCTAssertEqual(harness.status, .error)
        XCTAssertEqual(harness.controller.session.error?.code, .websocketTimeout)
    }

    func testConnectionDropWhileRecordingIsAnError() async throws {
        let harness = VoiceHarness()
        await harness.startAndRecord()
        harness.transport.drop()
        await harness.eventually("连接断开报错") { harness.status == .error }
        XCTAssertEqual(harness.controller.session.error?.code, .websocketClosed)
        XCTAssertGreaterThanOrEqual(harness.audio.stopCount, 1)
    }

    func testServerErrorMapsToVoiceError() async throws {
        let harness = VoiceHarness()
        await harness.startAndRecord()
        let audioId = try XCTUnwrap(harness.controller.session.audioId)
        harness.controller.stopRecording()
        await harness.eventually("转写中") { harness.status == .transcribing }
        harness.transport.serve("transcription_error", ["audio_id": audioId, "detail": "模型崩了"])
        await harness.eventually("报错") { harness.status == .error }
        XCTAssertEqual(harness.controller.session.error?.code, .asrFailed)
        XCTAssertEqual(harness.controller.session.error?.detail, "模型崩了")
        XCTAssertTrue(harness.delivered.isEmpty)
        XCTAssertEqual(harness.history.first?.errorCode, "asr_failed")
    }

    func testEmptyResultIsAudioEmpty() async throws {
        let harness = VoiceHarness()
        await harness.startAndRecord()
        let audioId = try XCTUnwrap(harness.controller.session.audioId)
        harness.controller.stopRecording()
        await harness.eventually("转写中") { harness.status == .transcribing }
        harness.transport.serve("audio_processing_completed", ["audio_id": audioId])
        await harness.eventually("空结果") { harness.status == .error }
        XCTAssertEqual(harness.controller.session.error?.code, .audioEmpty)
        // 悬浮胶囊把“没有识别到声音”显示成取消态，而不是红色错误。
        XCTAssertEqual(harness.controller.floatingBarState.status, .cancelled)
    }

    func testAskModeSendsSelectionAndNeverPastes() async throws {
        let harness = VoiceHarness()
        await harness.startAndRecord(.ask)
        let start = try startPayload(harness)
        XCTAssertEqual(start["mode"] as? String, "ask_anything")
        XCTAssertEqual((start["parameters"] as? [String: Any])?["selected_text"] as? String, "选中的内容")
        XCTAssertEqual(harness.controller.floatingBarState.displayText, "请随意提出问题")

        let audioId = try XCTUnwrap(harness.controller.session.audioId)
        harness.controller.stopRecording()
        await harness.eventually("转写中") { harness.status == .transcribing }
        harness.transport.serve("refine_selected_text", ["audio_id": audioId, "refined_text": "答案"])
        await harness.eventually("交付") { harness.delivered.count == 1 }
        XCTAssertEqual(harness.delivered.first?.task?.delivery, .floatingPanel)
        XCTAssertEqual(harness.delivered.first?.mode, .ask)
    }

    func testTranslateModeSendsOutputLanguage() async throws {
        let harness = VoiceHarness()
        harness.settings.translationTargetLanguage = "ja"
        await harness.startAndRecord(.translate)
        let parameters = try XCTUnwrap(try startPayload(harness)["parameters"] as? [String: Any])
        XCTAssertEqual(parameters["output_language"] as? String, "ja")
        XCTAssertEqual(harness.controller.session.mode, .translate)
    }

    func testToggleIgnoredWhileBusyAndStopsWhenRecording() async throws {
        let harness = VoiceHarness()
        await harness.startAndRecord()
        await harness.controller.toggle(intent: .dictate)  // 录音中 = 停止
        XCTAssertTrue([.stopping, .transcribing].contains(harness.status))
        await harness.eventually("转写中") { harness.status == .transcribing }
        let before = harness.transport.sent.count
        await harness.controller.toggle(intent: .dictate)  // 转写中：忽略
        XCTAssertEqual(harness.status, .transcribing)
        XCTAssertEqual(harness.transport.sent.count, before)
    }

    func testSecondRecordingReusesOpenConnection() async throws {
        let harness = VoiceHarness()
        await harness.startAndRecord()
        let firstId = try XCTUnwrap(harness.controller.session.audioId)
        harness.controller.stopRecording()
        await harness.eventually("转写中") { harness.status == .transcribing }
        harness.transport.serve("audio_processing_completed", ["audio_id": firstId, "refined_text": "第一句"])
        await harness.eventually("完成") { harness.status == .completed }

        await harness.startAndRecord()
        XCTAssertNotEqual(harness.controller.session.audioId, firstId)
        XCTAssertEqual(harness.transportsMade, 1, "连接还开着就复用")
        // 旧会话的消息按 audioId 被过滤。
        harness.transport.serve("transcription", ["audio_id": firstId, "text": "旧的"])
        try await Task.sleep(nanoseconds: 30_000_000)
        XCTAssertEqual(harness.controller.session.rawText, "")
    }

    func testHistorySavedOncePerSession() async throws {
        let harness = VoiceHarness()
        await harness.startAndRecord()
        let audioId = try XCTUnwrap(harness.controller.session.audioId)
        harness.controller.stopRecording()
        await harness.eventually("转写中") { harness.status == .transcribing }
        harness.transport.serve("audio_processing_completed", ["audio_id": audioId, "refined_text": "一次"])
        await harness.eventually("完成") { harness.status == .completed }
        harness.transport.serve("audio_processing_completed", ["audio_id": audioId, "refined_text": "重复"])
        try await Task.sleep(nanoseconds: 30_000_000)
        XCTAssertEqual(harness.history.count, 1)
        XCTAssertEqual(harness.history.first?.refinedText, "一次")
    }

    func testObserversSeeEveryTransition() async throws {
        let harness = VoiceHarness()
        await harness.startAndRecord()
        let statuses = harness.sessions.map(\.status)
        XCTAssertEqual(statuses.first, .idle)
        XCTAssertTrue(statuses.contains(.connecting))
        XCTAssertEqual(statuses.last, .recording)
    }
}

// MARK: - 任务解析、后端就绪

final class VoiceTaskResolverTests: XCTestCase {
    private func resolver(_ snapshot: SelectionSnapshot) -> VoiceTaskResolver {
        VoiceTaskResolver(readSelection: { snapshot }, readFocus: { FocusInfo(bundleId: "focus") })
    }

    func testDictateAndTranslateNeverReadSelection() async {
        let snapshot = SelectionSnapshot(selectedText: "选区", source: .accessibility, confidence: .confirmed)
        for (intent, mode) in [(ShortcutIntent.dictate, VoiceMode.dictate), (.translate, .translate)] {
            let task = await resolver(snapshot).resolve(intent)
            XCTAssertEqual(task.mode, mode)
            XCTAssertEqual(task.selectedText, "")
            XCTAssertEqual(task.delivery, .paste)
            XCTAssertEqual(task.focusInfo?.bundleId, "focus")
        }
    }

    func testAskUsesTrustedSelectionOnly() async {
        let trusted = await resolver(SelectionSnapshot(selectedText: "选区", source: .accessibility, confidence: .confirmed, focusInfo: FocusInfo(bundleId: "a"))).resolve(.ask)
        XCTAssertEqual(trusted.selectedText, "选区")
        XCTAssertEqual(trusted.delivery, .floatingPanel)

        let clipboard = await resolver(SelectionSnapshot(selectedText: "剪贴板", source: .clipboard, confidence: .fallback)).resolve(.ask)
        XCTAssertEqual(clipboard.selectedText, "剪贴板")

        for untrusted in [
            SelectionSnapshot(selectedText: "猜的", source: .accessibility, confidence: .fallback),
            SelectionSnapshot(selectedText: "猜的", source: .clipboard, confidence: .confirmed),
            SelectionSnapshot(selectedText: "", source: .accessibility, confidence: .confirmed),
        ] {
            let task = await resolver(untrusted).resolve(.ask)
            XCTAssertEqual(task.selectedText, "")
            XCTAssertEqual(task.source, .none)
            XCTAssertNil(task.focusInfo)
            XCTAssertEqual(task.delivery, .floatingPanel, "自由提问永远不粘贴")
        }
    }
}

final class BackendReadinessTests: XCTestCase {
    final class FakeLauncher: BackendProcessControlling, @unchecked Sendable {
        var started = 0
        var exit: String?
        func start() async throws { started += 1 }
        var exitDescription: String? { exit }
    }

    private func ready(_ status: Int, _ json: String) -> Result<(Data, Int), Error> {
        .success((Data(json.utf8), status))
    }

    func testReturnsOnceReady() async throws {
        let transport = FakeTransport([
            ready(503, #"{"status":"loading","detail":"ASR 模型加载中"}"#),
            ready(200, #"{"status":"ready"}"#),
        ])
        let launcher = FakeLauncher()
        try await BackendReadiness.ensureReady(
            client: BackendClient(baseURL: URL(string: "http://127.0.0.1:1")!, transport: transport),
            launcher: launcher, timeout: 5, interval: 0, sleep: { _ in }
        )
        XCTAssertEqual(launcher.started, 1)
        XCTAssertEqual(transport.requests.map(\.url.path), ["/ready", "/ready"])
    }

    func testModelMissingStopsWaiting() async {
        let transport = FakeTransport([ready(503, #"{"status":"idle","cached":false,"detail":"语音模型尚未下载"}"#)])
        do {
            try await BackendReadiness.ensureReady(
                client: BackendClient(baseURL: URL(string: "http://127.0.0.1:1")!, transport: transport),
                timeout: 5, interval: 0, sleep: { _ in }
            )
            XCTFail("应当抛出 voice_model_missing")
        } catch let error as VoiceError {
            XCTAssertEqual(error.code, .voiceModelMissing)
        } catch {
            XCTFail("\(error)")
        }
    }

    func testDownloadingIsNotMissing() {
        XCTAssertFalse(ReadyProbe(success: false, httpStatus: 503, state: "downloading", detail: "", cached: false).isModelMissing)
        XCTAssertTrue(ReadyProbe(success: false, httpStatus: 503, state: "idle", detail: "", cached: false).isModelMissing)
        XCTAssertFalse(ReadyProbe(success: false, httpStatus: 503, state: "idle", detail: "", cached: true).isModelMissing)
    }

    func testExitedProcessFailsFast() async {
        let launcher = FakeLauncher()
        launcher.exit = "code 1"
        let transport = FakeTransport([ready(503, #"{"status":"loading"}"#)])
        do {
            try await BackendReadiness.ensureReady(
                client: BackendClient(baseURL: URL(string: "http://127.0.0.1:1")!, transport: transport),
                launcher: launcher, timeout: 5, interval: 0, sleep: { _ in }
            )
            XCTFail("应当抛出 backend_unavailable")
        } catch let error as VoiceError {
            XCTAssertEqual(error.code, .backendUnavailable)
            XCTAssertTrue(error.detail?.contains("code 1") == true)
        } catch {
            XCTFail("\(error)")
        }
    }

    func testTimeoutReportsLatestDetail() async {
        let transport = FakeTransport(Array(repeating: ready(503, #"{"status":"loading","detail":"还在加载"}"#), count: 50))
        do {
            try await BackendReadiness.ensureReady(
                client: BackendClient(baseURL: URL(string: "http://127.0.0.1:1")!, transport: transport),
                timeout: 0.05, interval: 0.02, sleep: { try? await Task.sleep(nanoseconds: UInt64($0 * 1_000_000_000)) }
            )
            XCTFail("应当超时")
        } catch let error as VoiceError {
            XCTAssertEqual(error.code, .backendUnavailable)
            XCTAssertEqual(error.detail, "还在加载")
        } catch {
            XCTFail("\(error)")
        }
    }
}

final class LlmRequestConfigTests: XCTestCase {
    func testCurrentLlmRequestUsesSelectedProviderAndModelFallback() {
        var settings = LocalSettings()
        let provider = settings.llm.providers.first { $0.id == settings.llm.providerId }!
        settings.llm.apiKeys[provider.id] = "sk-x"
        settings.llm.models[provider.id] = ""
        let request = settings.currentLlmRequest
        XCTAssertEqual(request.providerId, provider.id)
        XCTAssertEqual(request.baseUrl, provider.baseUrl)
        XCTAssertEqual(request.model, provider.defaultModel, "模型留空就用默认模型")
        XCTAssertEqual(request.apiKey, "sk-x")
        XCTAssertEqual(request.authType, provider.authType.rawValue)

        settings.llm.models[provider.id] = "my-model"
        XCTAssertEqual(settings.currentLlmRequest.model, "my-model")
    }
}

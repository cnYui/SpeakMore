import Foundation
import Observation

// 一轮语音输入的状态机：快捷键意图 → 解析任务 → 就绪检查 / 连接 / 麦克风 → 录音 → end_audio → 等结果 → 交付（粘贴或悬浮面板）→ 写历史。
// 流程、状态、时限和 `recorder.ts` 一致；所有和系统打交道的部分（麦克风、WebSocket、粘贴、悬浮面板）都通过协议注入，
// 所以整条状态机可以用假的实现在 `swift test` 里跑完。

// MARK: - 注入的协议

/// 一段音频：每个声道一个数组，浮点采样 [-1, 1]。
public struct AudioChunk: Sendable {
    public var channels: [[Float]]
    public var sampleRate: Double

    public init(channels: [[Float]], sampleRate: Double) {
        self.channels = channels
        self.sampleRate = sampleRate
    }
}

public protocol AudioSource: AnyObject, Sendable {
    /// 申请权限、准备设备；失败抛 `VoiceError`（`microphone_permission_denied` / `microphone_unavailable`）。
    func prepare() async throws
    /// 开始送音频；`onChunk` 可能在任意线程被调用。
    func begin(onChunk: @escaping @Sendable (AudioChunk) -> Void) throws
    func stop()
}

public protocol VoiceTransport: AnyObject, Sendable {
    var isOpen: Bool { get }
    var onMessage: (@Sendable (String) -> Void)? { get set }
    var onClose: (@Sendable () -> Void)? { get set }
    /// 连接失败抛 `VoiceError`（`backend_unavailable` / `websocket_timeout`）。
    func connect(timeout: TimeInterval) async throws
    func send(text: String) async throws
    func send(binary: Data) async throws
    func close()
}

public protocol VoiceCancellable: Sendable {
    func cancel()
}

public protocol VoiceScheduler: Sendable {
    func schedule(after seconds: TimeInterval, _ action: @escaping @MainActor @Sendable () -> Void) -> VoiceCancellable
}

public struct TaskScheduler: VoiceScheduler {
    private final class Handle: VoiceCancellable, @unchecked Sendable {
        var task: Task<Void, Never>?
        func cancel() { task?.cancel() }
    }

    public init() {}

    public func schedule(after seconds: TimeInterval, _ action: @escaping @MainActor @Sendable () -> Void) -> VoiceCancellable {
        let handle = Handle()
        handle.task = Task { @MainActor in
            try? await Task.sleep(nanoseconds: UInt64(max(0, seconds) * 1_000_000_000))
            guard !Task.isCancelled else { return }
            action()
        }
        return handle
    }
}

public struct VoiceTimings: Sendable {
    /// end_audio 后必须有最终结果或错误，否则按 WebSocket 超时处理。
    /// 后端按 30 秒一段边说边识别、润色，说完只剩最后一段，所以不用跟着录音长度走。
    public var transcribeTimeout: TimeInterval = 60
    /// 录音到这个时长弹“1 分钟后自动结束”（上限前 1 分钟）。
    public var recordingLimitWarning: TimeInterval = 29 * 60
    /// 录音到这个时长自动停止：30 分钟（后端分段处理，长度不再受单次识别能力限制）。
    public var recordingLimit: TimeInterval = 30 * 60
    public var connectTimeout: TimeInterval = 2.5

    public init() {}
}

public struct VoiceDependencies {
    public var settings: @MainActor () -> LocalSettings
    public var promptTerms: @MainActor () -> [PromptDictionaryTerm]
    public var ensureBackendReady: @Sendable () async throws -> Void
    public var makeTransport: @MainActor () -> VoiceTransport
    public var makeAudioSource: @MainActor (LocalSettings) -> AudioSource
    public var resolver: VoiceTaskResolver
    /// 交付结果：听写 / 翻译尝试自动粘贴，失败要自己兜底展示；自由提问展示在悬浮面板。
    public var deliver: @MainActor (_ text: String, _ task: VoiceTask?, _ mode: VoiceMode) async -> Void
    public var saveHistory: @MainActor (HistoryItem) -> Void
    public var hideFloatingPanel: @MainActor () -> Void
    public var scheduler: VoiceScheduler
    public var timings: VoiceTimings
    public var now: @Sendable () -> Date

    public init(
        settings: @escaping @MainActor () -> LocalSettings,
        promptTerms: @escaping @MainActor () -> [PromptDictionaryTerm],
        ensureBackendReady: @escaping @Sendable () async throws -> Void,
        makeTransport: @escaping @MainActor () -> VoiceTransport,
        makeAudioSource: @escaping @MainActor (LocalSettings) -> AudioSource,
        resolver: VoiceTaskResolver,
        deliver: @escaping @MainActor (String, VoiceTask?, VoiceMode) async -> Void,
        saveHistory: @escaping @MainActor (HistoryItem) -> Void,
        hideFloatingPanel: @escaping @MainActor () -> Void = {},
        scheduler: VoiceScheduler = TaskScheduler(),
        timings: VoiceTimings = VoiceTimings(),
        now: @escaping @Sendable () -> Date = { Date() }
    ) {
        self.settings = settings
        self.promptTerms = promptTerms
        self.ensureBackendReady = ensureBackendReady
        self.makeTransport = makeTransport
        self.makeAudioSource = makeAudioSource
        self.resolver = resolver
        self.deliver = deliver
        self.saveHistory = saveHistory
        self.hideFloatingPanel = hideFloatingPanel
        self.scheduler = scheduler
        self.timings = timings
        self.now = now
    }
}

// MARK: - 状态机

@MainActor
@Observable
public final class VoiceSessionController {
    public static let recordingLimitWarningText = "录音将在 1 分钟后自动结束"

    public private(set) var session = VoiceSession.initial

    @ObservationIgnored private let deps: VoiceDependencies
    @ObservationIgnored private var listeners: [UUID: (VoiceSession) -> Void] = [:]
    @ObservationIgnored private var activeSessionId: String?
    @ObservationIgnored private var ignoredAudioIds: Set<String> = []
    @ObservationIgnored private var savedAudioIds: Set<String> = []
    @ObservationIgnored private var recordingStartedAt: Date?
    @ObservationIgnored private var activeTask: VoiceTask?
    @ObservationIgnored private var transport: VoiceTransport?
    @ObservationIgnored private var audioSource: AudioSource?
    @ObservationIgnored private var chunkContinuation: AsyncStream<Data>.Continuation?
    @ObservationIgnored private var senderTask: Task<Void, Never>?
    @ObservationIgnored private var levelMeter = AudioLevelMeter()
    @ObservationIgnored private var warningTimer: VoiceCancellable?
    @ObservationIgnored private var limitTimer: VoiceCancellable?
    @ObservationIgnored private var transcribeTimer: VoiceCancellable?

    public init(dependencies: VoiceDependencies) {
        self.deps = dependencies
    }

    // MARK: 订阅

    /// 订阅会话快照；立刻回调一次当前状态。返回的 token 调 `cancel()` 取消订阅。
    @discardableResult
    public func observe(_ listener: @escaping (VoiceSession) -> Void) -> VoiceCancellable {
        let id = UUID()
        listeners[id] = listener
        listener(session)
        return ListenerToken { [weak self] in
            Task { @MainActor in self?.listeners[id] = nil }
        }
    }

    private struct ListenerToken: VoiceCancellable {
        let onCancel: @Sendable () -> Void
        func cancel() { onCancel() }
    }

    public var floatingBarState: FloatingBarState { VoiceSessionMath.floatingBarState(for: session) }

    // MARK: 对外入口

    /// 快捷键 / 按钮入口：录音中 = 停止；准备 / 转写中忽略；空闲 = 开始。
    public func toggle(intent: ShortcutIntent) async {
        switch session.status {
        case .recording:
            stopRecording()
        case .connecting, .stopping, .transcribing:
            return
        default:
            await startRecording(intent: intent)
        }
    }

    public func toggle(mode: VoiceMode) async {
        await toggle(intent: ShortcutIntent(mode: mode))
    }

    public func startRecording(intent: ShortcutIntent) async {
        // 新录音开始前先收起旧结果面板，避免用户把上一轮结果当成这一轮。
        deps.hideFloatingPanel()
        let audioId = UUID().uuidString.lowercased()
        activeSessionId = audioId
        recordingStartedAt = nil
        clearRecordingLimitTimers()
        levelMeter.reset()

        var next = VoiceSession.initial
        next.status = .connecting
        next.mode = intent.initialMode
        next.audioId = audioId
        setSession(next)

        do {
            // 快捷键只表达意图，真正的模式、选区上下文和交付方式在这里解析。
            let task = await deps.resolver.resolve(intent)
            guard isActive(audioId) else { return }
            activeTask = task
            if session.mode != task.mode {
                var updated = session
                updated.mode = task.mode
                setSession(updated)
            }

            let prepared = try await prepare(task: task)
            guard isActive(audioId) else {
                prepared.source.stop()
                closeTransportSilently()
                return
            }
            try await begin(prepared, task: task, audioId: audioId)
        } catch {
            guard isActive(audioId), !ignoredAudioIds.contains(audioId) else { return }
            cleanupRecording()
            activeTask = nil
            fail(VoiceError.normalize(error, fallback: .recordingStartFailed))
        }
    }

    public func stopRecording() {
        guard session.status == .recording, let audioId = session.audioId else { return }
        clearRecordingLimitTimers()
        setStatus(.stopping)

        // 先停麦克风、等排队的音频发完，再发 end_audio；顺序错了后端会丢尾音。
        audioSource?.stop()
        audioSource = nil
        chunkContinuation?.finish()
        chunkContinuation = nil
        let drain = senderTask
        senderTask = nil

        Task { @MainActor [weak self] in
            await drain?.value
            guard let self, self.isActive(audioId) else { return }
            guard let transport = self.transport, transport.isOpen else {
                self.fail(VoiceError(.websocketClosed))
                return
            }
            do {
                try await transport.send(text: try VoiceClientMessage.endAudio(audioId: audioId))
                // 等 send 返回的这一小段时间里结果可能已经到了，只有仍处于 stopping 才进入转写。
                guard self.isActive(audioId), self.session.status == .stopping else { return }
                self.setStatus(.transcribing)
                self.startTranscribeTimeout()
            } catch {
                guard self.isActive(audioId) else { return }
                self.fail(VoiceError.normalize(error, fallback: .recordingStopFailed))
            }
        }
    }

    public func cancelRecording() {
        guard session.status.isCancelable else { return }
        // 取消不是正常结束，不能发 end_audio，否则后端可能继续返回结果并触发粘贴。
        let durationMs = currentDurationMs()
        let audioId = session.audioId
        activeSessionId = nil
        clearRecordingLimitTimers()
        activeTask = nil
        // 取消后可能还有迟到的后端消息，按 audioId 忽略避免旧结果污染新会话。
        if let audioId { ignoredAudioIds.insert(audioId) }
        clearTranscribeTimeout()
        cleanupRecording()
        closeTransportSilently()
        recordingStartedAt = nil

        var next = session
        next.status = .cancelled
        next.refinedText = ""
        next.durationMs = durationMs
        next.error = nil
        next.inputLevel = 0
        next.noticeText = ""
        setSession(next)
    }

    /// 应用退出：释放麦克风、连接和定时器。
    public func dispose() {
        activeSessionId = nil
        activeTask = nil
        ignoredAudioIds.removeAll()
        clearRecordingLimitTimers()
        clearTranscribeTimeout()
        cleanupRecording()
        closeTransportSilently()
        listeners.removeAll()
    }

    // MARK: 启动准备

    private struct Prepared {
        let source: AudioSource
        let parameters: StartAudioParameters
    }

    private func prepare(task: VoiceTask) async throws -> Prepared {
        let settings = deps.settings()
        let llm = settings.currentLlmRequest
        if llm.apiKey.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            throw VoiceError(.llmApiKeyMissing)
        }

        let source = deps.makeAudioSource(settings)
        let connection = openTransport()
        let ready = deps.ensureBackendReady
        let timeout = deps.timings.connectTimeout

        do {
            // 就绪检查、连接、麦克风互相独立，并行准备；任何一个失败，其余已打开的资源都要收掉。
            async let readyResult: Void = ready()
            async let connectResult: Void = Self.connectIfNeeded(connection, timeout: timeout)
            async let audioResult: Void = source.prepare()
            try await readyResult
            try await connectResult
            try await audioResult
        } catch {
            source.stop()
            closeTransportSilently()
            throw error
        }

        let parameters = StartAudioParameters.make(
            mode: task.mode,
            selectedText: task.selectedText,
            llm: llm,
            dictionaryTerms: deps.promptTerms(),
            translationTargetLanguage: task.mode == .translate ? settings.translationTargetLanguage : nil
        )
        return Prepared(source: source, parameters: parameters)
    }

    nonisolated private static func connectIfNeeded(_ transport: VoiceTransport, timeout: TimeInterval) async throws {
        if transport.isOpen { return }
        try await transport.connect(timeout: timeout)
    }

    private func openTransport() -> VoiceTransport {
        if let transport, transport.isOpen { return transport }
        closeTransportSilently()
        let created = deps.makeTransport()
        created.onMessage = { [weak self] text in
            Task { @MainActor in self?.handleMessage(text) }
        }
        created.onClose = { [weak self, weak created] in
            Task { @MainActor in
                guard let self, let created, self.transport === created else { return }
                self.transport = nil
                let status = self.session.status
                // 录音 / 等结果期间连接断了就是失败；其余阶段（取消、已完成）断开无所谓。
                if status == .recording || status == .stopping || status == .transcribing {
                    self.fail(VoiceError(.websocketClosed))
                }
            }
        }
        transport = created
        return created
    }

    private func begin(_ prepared: Prepared, task: VoiceTask, audioId: String) async throws {
        guard let transport else { throw VoiceError(.websocketClosed) }

        // start_audio 必须在后端就绪、连接、麦克风和参数都准备好之后再发。
        try await transport.send(text: VoiceClientMessage.startAudio(audioId: audioId, mode: task.mode, parameters: prepared.parameters))
        guard isActive(audioId) else {
            prepared.source.stop()
            closeTransportSilently()
            return
        }

        let (stream, continuation) = AsyncStream<Data>.makeStream(bufferingPolicy: .unbounded)
        chunkContinuation = continuation
        senderTask = Task { [weak self, weak transport] in
            for await data in stream {
                guard let transport else { return }
                do {
                    try await transport.send(binary: data)
                } catch {
                    await MainActor.run { [weak self] in
                        guard let self, self.isActive(audioId) else { return }
                        self.fail(VoiceError(.websocketClosed))
                    }
                    return
                }
            }
        }

        audioSource = prepared.source
        do {
            try prepared.source.begin { [weak self] chunk in
                continuation.yield(AudioConditioning.pcm16Chunk(channels: chunk.channels, sampleRate: chunk.sampleRate))
                let level = AudioConditioning.rms(AudioConditioning.mixToMono(chunk.channels))
                Task { @MainActor in self?.applyInputLevel(rms: level, audioId: audioId) }
            }
        } catch {
            throw VoiceError.normalize(error, fallback: .recordingStartFailed)
        }

        recordingStartedAt = deps.now()
        startRecordingLimitTimers()
        setStatus(.recording)
    }

    // MARK: 后端消息

    private func handleMessage(_ text: String) {
        // 空闲时不会有进行中的会话，残留连接上的迟到消息直接丢掉。
        guard session.status != .idle else { return }
        let ignored = ignoredAudioIds
        let context = VoiceMessageContext(
            currentAudioId: session.audioId ?? "",
            currentRawText: session.rawText,
            isIgnoredAudioId: { ignored.contains($0) },
            isCancelled: session.status == .cancelled,
            isTerminal: session.status == .completed || session.status == .error
        )
        switch VoiceServerMessage.route(text, context: context) {
        case .rawText(let raw):
            // 流式转写会多次更新 rawText，最终结果仍以后端完成消息为准。
            var updated = session
            updated.rawText = raw
            updated.textLength = VoiceSessionMath.countTextLength(raw)
            setSession(updated)
        case .finalText(let text):
            Task { await completeSession(text) }
        case .failure(let error):
            fail(error)
        case .interrupt(let detail):
            fail(VoiceError(.backendUnavailable, detail: detail))
        case .ignored:
            break
        }
    }

    // MARK: 结束

    private func fail(_ error: VoiceError) {
        // 失败路径统一回收资源，避免麦克风、连接或定时器泄漏。
        activeSessionId = nil
        clearRecordingLimitTimers()
        activeTask = nil
        clearTranscribeTimeout()
        let durationMs = currentDurationMs()
        cleanupRecording()
        var next = session
        next.status = .error
        next.durationMs = durationMs
        next.error = error
        next.noticeText = ""
        setSession(next)
        recordingStartedAt = nil
    }

    private func completeSession(_ refinedText: String) async {
        // 完成路径先冻结本轮结果，再决定展示 / 粘贴方式。
        activeSessionId = nil
        clearRecordingLimitTimers()
        clearTranscribeTimeout()
        let durationMs = currentDurationMs()
        let resultText = refinedText.isEmpty ? session.rawText : refinedText

        var completed = session
        completed.status = .completed
        completed.refinedText = resultText
        completed.durationMs = durationMs
        completed.textLength = VoiceSessionMath.countTextLength(resultText)
        completed.error = nil
        completed.noticeText = ""
        setSession(completed)
        recordingStartedAt = nil
        cleanupRecording()

        let task = activeTask
        activeTask = nil
        guard !resultText.isEmpty else { return }
        await deps.deliver(resultText, task, completed.mode)
    }

    // MARK: 辅助

    private func isActive(_ audioId: String) -> Bool {
        activeSessionId == audioId && session.audioId == audioId
    }

    private func currentDurationMs() -> Double {
        VoiceSessionMath.recordingDurationMs(startedAt: recordingStartedAt, now: deps.now())
    }

    private func setStatus(_ status: VoiceStatus) {
        // 进入新状态时清掉旧错误，避免界面在恢复流程里展示过期错误。
        var next = session
        next.status = status
        next.error = nil
        if status != .recording { next.noticeText = "" }
        setSession(next)
    }

    private func applyInputLevel(rms: Float, audioId: String) {
        guard session.audioId == audioId, session.status == .recording else { return }
        let level = min(1, max(0, levelMeter.update(rms: rms)))
        // 变化太小不广播，避免悬浮胶囊被高频微小波动拖慢。
        if abs(session.inputLevel - level) < 0.005 { return }
        var next = session
        next.inputLevel = level
        setSession(next)
    }

    private func setSession(_ next: VoiceSession) {
        session = next
        listeners.values.forEach { $0(next) }
        persistIfTerminal(next)
    }

    private func persistIfTerminal(_ session: VoiceSession) {
        guard let audioId = session.audioId else { return }
        guard session.status == .completed || session.status == .error else { return }
        guard savedAudioIds.insert(audioId).inserted else { return }
        deps.saveHistory(HistoryItem(
            id: audioId,
            createdAt: ISO8601.string(from: deps.now()),
            mode: session.mode,
            status: session.status == .completed ? .completed : .error,
            rawText: session.rawText,
            refinedText: session.refinedText,
            errorCode: session.error?.code.rawValue,
            durationMs: session.durationMs,
            textLength: session.textLength
        ))
    }

    private func cleanupRecording() {
        audioSource?.stop()
        audioSource = nil
        chunkContinuation?.finish()
        chunkContinuation = nil
        senderTask?.cancel()
        senderTask = nil
    }

    private func closeTransportSilently() {
        guard let transport else { return }
        self.transport = nil
        // 主动关闭先解绑回调，避免清理动作又触发失败状态。
        transport.onMessage = nil
        transport.onClose = nil
        transport.close()
    }

    private func startRecordingLimitTimers() {
        clearRecordingLimitTimers()
        let timings = deps.timings
        if timings.recordingLimitWarning > 0 {
            warningTimer = deps.scheduler.schedule(after: timings.recordingLimitWarning) { [weak self] in
                guard let self, self.session.status == .recording else { return }
                var next = self.session
                next.noticeText = Self.recordingLimitWarningText
                self.setSession(next)
            }
        }
        if timings.recordingLimit > 0 {
            limitTimer = deps.scheduler.schedule(after: timings.recordingLimit) { [weak self] in
                self?.stopRecording()
            }
        }
    }

    private func clearRecordingLimitTimers() {
        warningTimer?.cancel()
        limitTimer?.cancel()
        warningTimer = nil
        limitTimer = nil
    }

    private func startTranscribeTimeout() {
        clearTranscribeTimeout()
        transcribeTimer = deps.scheduler.schedule(after: deps.timings.transcribeTimeout) { [weak self] in
            self?.fail(VoiceError(.websocketTimeout))
        }
    }

    private func clearTranscribeTimeout() {
        transcribeTimer?.cancel()
        transcribeTimer = nil
    }
}

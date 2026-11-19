import AppKit
import Observation
import SwiftUI
import SpeakMoreCore
import SpeakMorePlatform

/// 把各个部件接成一条完整的语音输入链路：
///   全局快捷键（CGEventTap）→ 快捷键守卫 → 语音会话状态机（麦克风 / WebSocket）→ 结果交付（自动粘贴 / 悬浮面板）→ 历史记录，
///   同时驱动悬浮胶囊和悬浮面板。应用启动时开始工作，不依赖主窗口是否打开。
@MainActor
@Observable
final class VoiceCoordinator {
    private(set) var permissions = Permissions.current()
    private(set) var hotkeysActive = false

    @ObservationIgnored let overlay = OverlayController()
    @ObservationIgnored private(set) var controller: VoiceSessionController!
    @ObservationIgnored private let accessibility = SystemAccessibility()
    @ObservationIgnored private let scheduler = TaskScheduler()
    @ObservationIgnored private var guardState = ShortcutGuard()
    @ObservationIgnored private var listener: GlobalHotkeyListener?
    @ObservationIgnored private var longPressTimer: VoiceCancellable?
    @ObservationIgnored private var windows: OverlayWindows?
    @ObservationIgnored private var pollTask: Task<Void, Never>?
    @ObservationIgnored private var observation: VoiceCancellable?

    init(
        settings: SettingsStore, history: HistoryStore, dictionary: DictionaryStore,
        backend: BackendClient, launcher: BackendProcessControlling?
    ) {
        let accessibility = self.accessibility
        let paste = PasteService(accessibility: accessibility)
        let delivery = VoiceResultDelivery(
            paste: { text, focus in await paste.paste(text, startFocus: focus).success },
            showPanel: { [overlay] text in overlay.showResult(text) }
        )
        // AX 调用可能被卡住的目标应用拖慢，放到后台线程读，不堵主线程。
        let resolver = VoiceTaskResolver(
            readSelection: { await Task.detached { accessibility.selectionSnapshot() }.value },
            readFocus: { await Task.detached { accessibility.focusInfo() }.value }
        )
        let overlay = self.overlay

        controller = VoiceSessionController(dependencies: VoiceDependencies(
            settings: { settings.settings },
            promptTerms: { PromptDictionary.terms(from: dictionary.entries) },
            ensureBackendReady: { try await BackendReadiness.ensureReady(client: backend, launcher: launcher) },
            makeTransport: { URLSessionVoiceTransport(url: VoiceEndpoint.webSocketURL(base: backend.baseURL)) },
            makeAudioSource: { settings in Self.makeAudioSource(deviceUID: settings.selectedAudioDeviceId) },
            resolver: resolver,
            deliver: { text, task, mode in await delivery.deliver(text, task: task, mode: mode) },
            saveHistory: { history.upsert($0) },
            hideFloatingPanel: { overlay.hidePanel() }
        ))
    }

    /// 开发 / 测试：设置了 `SPEAKMORE_VOICE_WAV` 就用这个音频文件代替麦克风。
    private static func makeAudioSource(deviceUID: String) -> AudioSource {
        if let path = ProcessInfo.processInfo.environment["SPEAKMORE_VOICE_WAV"], !path.isEmpty {
            return WavFileAudioSource(url: URL(fileURLWithPath: path), realtimeFactor: 1)
        }
        return MicrophoneAudioSource(deviceUID: deviceUID)
    }

    // MARK: 生命周期

    func start() {
        overlay.onCancelRequested = { [weak self] in self?.controller.cancelRecording() }
        overlay.onPanelDismissed = { [weak self] in self?.guardState.hintDismissed() }
        observation = controller.observe { [weak self] session in
            self?.overlay.handleVoiceState(VoiceSessionMath.floatingBarState(for: session))
        }
        let windows = OverlayWindows(overlay: overlay)
        windows.start()
        self.windows = windows

        startHotkeysIfPossible()
        // 用户可能稍后才去系统设置里授权：每 2 秒看一次，授权后自动开始监听，不需要重启应用。
        pollTask = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(2))
                self?.refreshPermissions()
            }
        }
        DemoDriver.runIfRequested(coordinator: self, windows: windows)
    }

    func stop() {
        pollTask?.cancel()
        listener?.stop()
        controller.dispose()
        windows?.stop()
    }

    func refreshPermissions() {
        permissions = Permissions.current()
        if !hotkeysActive { startHotkeysIfPossible() }
    }

    private func startHotkeysIfPossible() {
        guard !hotkeysActive else { return }
        let listener = self.listener ?? GlobalHotkeyListener { [weak self] event in
            Task { @MainActor in self?.handle(event) }
        }
        self.listener = listener
        hotkeysActive = listener.start()
    }

    // MARK: 键盘事件

    private func handle(_ event: RawKeyEvent) {
        if event.key == .escape {
            if event.isDown { overlay.handleEscape() }
            return
        }
        overlay.keyActivity(anyKeyDown: event.isDown)

        let output = guardState.handle(event, voiceStatus: controller.session.status)
        if output.hideHint { overlay.hidePanel() }
        if output.cancelLongPressTimer {
            longPressTimer?.cancel()
            longPressTimer = nil
        }
        if output.startLongPressTimer {
            longPressTimer = scheduler.schedule(after: Double(ShortcutGuard.longPressMs) / 1000) { [weak self] in
                guard let self, self.guardState.longPressFired() else { return }
                self.overlay.showShortcutHint()
            }
        }
        if case .toggleRecording(let intent) = output.action {
            Task { await controller.toggle(intent: intent) }
        }
    }

    // MARK: 菜单 / 界面入口

    /// 主窗口里的按钮等入口：和快捷键走同一条路径。
    func toggle(mode: VoiceMode) {
        Task { await controller.toggle(mode: mode) }
    }
}

/// 开发者工具：用环境变量在没有任何系统权限的情况下驱动一轮听写，并把悬浮窗口渲染成 PNG，用来远程核对整条链路。
///   - `SPEAKMORE_DEMO_DICTATION=<秒>`：启动 2 秒后开始听写，录这么多秒后停止；
///   - `SPEAKMORE_DEMO_MODE=Dictate|Ask|Translate`：模式，默认听写；
///   - `SPEAKMORE_OVERLAY_SNAPSHOT_DIR=<目录>`：每 0.5 秒渲染一次可见的悬浮窗口，结束后退出应用（等 4 秒让结果面板出现）。
@MainActor
private enum DemoDriver {
    static func runIfRequested(coordinator: VoiceCoordinator, windows: OverlayWindows) {
        let environment = ProcessInfo.processInfo.environment
        guard let seconds = environment["SPEAKMORE_DEMO_DICTATION"].flatMap(Double.init) else { return }
        let mode = VoiceMode(rawValue: environment["SPEAKMORE_DEMO_MODE"] ?? "Dictate") ?? .dictate
        let snapshotDir = environment["SPEAKMORE_OVERLAY_SNAPSHOT_DIR"].map { URL(fileURLWithPath: $0, isDirectory: true) }
        if let snapshotDir { try? FileManager.default.createDirectory(at: snapshotDir, withIntermediateDirectories: true) }

        Task { @MainActor in
            var log = ""
            func note(_ text: String) { log += text + "\n" }
            try? await Task.sleep(for: .seconds(2))
            await coordinator.controller.toggle(mode: mode)
            note("started status=\(coordinator.controller.session.status)")

            var index = 0
            var stopped = false
            let begin = Date()
            var finishedAt: Date?
            while Date().timeIntervalSince(begin) < seconds + 90 {
                if let snapshotDir {
                    let files = windows.snapshot(to: snapshotDir, prefix: String(format: "%03d", index))
                    if !files.isEmpty { note("\(index) \(coordinator.controller.session.status) \(files.joined(separator: ","))") }
                }
                index += 1
                if !stopped, Date().timeIntervalSince(begin) >= seconds {
                    stopped = true
                    coordinator.controller.stopRecording()
                }
                let status = coordinator.controller.session.status
                if stopped, [.completed, .error, .cancelled].contains(status) {
                    finishedAt = finishedAt ?? Date()
                    if Date().timeIntervalSince(finishedAt!) > 4 { break }
                }
                try? await Task.sleep(for: .milliseconds(500))
            }
            let session = coordinator.controller.session
            note("final status=\(session.status) raw=\(session.rawText) refined=\(session.refinedText) error=\(session.error?.code.rawValue ?? "-")")
            note("panel=\(String(describing: coordinator.overlay.panel))")
            if let snapshotDir { try? log.write(to: snapshotDir.appendingPathComponent("demo-log.txt"), atomically: true, encoding: .utf8) }
            NSApp.terminate(nil)
        }
    }
}

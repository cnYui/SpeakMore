import Foundation

// 原生版自己拉起 / 关闭语音后端进程，和 Electron 打包态主进程（`voice-backend-service.js`）做的事一致：
//   · 已经有后端在监听（开发时手动起的、Electron 版起的、用户自己的）就直接用，不再起第二个；
//   · 否则从 App 包里的 `backend/speakmore-backend`（PyInstaller onedir）启动，环境变量按设置注入；
//   · 启动后如果本机已缓存模型，主动让后端加载，第一次录音就不用等；
//   · 退出时关掉自己起的那个。

public struct BackendLaunch: Equatable, Sendable {
    public var executable: URL
    public var arguments: [String]
    public var workingDirectory: URL?
    /// ffmpeg 所在目录，加到 PATH 最前面（后端转码要用）。
    public var ffmpegDirectory: URL?

    public init(executable: URL, arguments: [String] = [], workingDirectory: URL? = nil, ffmpegDirectory: URL? = nil) {
        self.executable = executable
        self.arguments = arguments
        self.workingDirectory = workingDirectory
        self.ffmpegDirectory = ffmpegDirectory
    }
}

public enum BackendLocator {
    public static let developmentDirectoryEnvironmentKey = "SPEAKMORE_BACKEND_DEV_DIR"

    /// 打包后的位置：`SpeakMore.app/Contents/Resources/backend/speakmore-backend`，ffmpeg 在 `ffmpeg/bin`。
    public static func bundled(resourceURL: URL?, fileManager: FileManager = .default) -> BackendLaunch? {
        guard let resourceURL else { return nil }
        let executable = resourceURL.appendingPathComponent("backend/speakmore-backend")
        guard fileManager.isExecutableFile(atPath: executable.path) else { return nil }
        let ffmpegDirectory = resourceURL.appendingPathComponent("ffmpeg/bin")
        return BackendLaunch(
            executable: executable, workingDirectory: executable.deletingLastPathComponent(),
            ffmpegDirectory: fileManager.fileExists(atPath: ffmpegDirectory.path) ? ffmpegDirectory : nil
        )
    }

    /// 开发时：`SPEAKMORE_BACKEND_DEV_DIR` 指向仓库的 `server/`，用它里面的 `.venv` 运行 `main.py`（对应 Electron 开发态的 `npm run server`）。
    public static func development(environment: [String: String], fileManager: FileManager = .default) -> BackendLaunch? {
        guard let directory = environment[developmentDirectoryEnvironmentKey], !directory.isEmpty else { return nil }
        let server = URL(fileURLWithPath: directory, isDirectory: true)
        let python = server.appendingPathComponent(".venv/bin/python")
        guard fileManager.isExecutableFile(atPath: python.path) else { return nil }
        return BackendLaunch(executable: python, arguments: ["main.py"], workingDirectory: server)
    }

    public static func locate(resourceURL: URL?, environment: [String: String] = ProcessInfo.processInfo.environment) -> BackendLaunch? {
        development(environment: environment) ?? bundled(resourceURL: resourceURL)
    }
}

public enum BackendEnvironment {
    /// 后端进程的环境变量，规则和 `voice-backend-service.js` 的 `buildEnv` 一致：
    ///   PATH 前面加 ffmpeg 目录；HOST / PORT；`TYPELESS_MODEL_CACHE_DIR`（设置里选了模型目录才注入）；
    ///   `FUNASR_DEVICE`（mps / cpu / cuda:0，默认不注入）；`SPEAKMORE_ASR_MODEL_ID`。
    public static func make(
        base: [String: String], settings: LocalSettings, port: Int, ffmpegDirectory: URL?
    ) -> [String: String] {
        var env = base
        env["PATH"] = [ffmpegDirectory?.path, base["PATH"]].compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: ":")
        env["HOST"] = base["HOST"] ?? "127.0.0.1"
        env["PORT"] = base["PORT"] ?? String(port)

        let cacheDir = settings.modelCacheDir.trimmingCharacters(in: .whitespacesAndNewlines)
        if !cacheDir.isEmpty { env["TYPELESS_MODEL_CACHE_DIR"] = cacheDir }

        env["FUNASR_DEVICE"] = nil
        switch settings.asrDeviceMode {
        case .mps: env["FUNASR_DEVICE"] = "mps"
        case .cuda: env["FUNASR_DEVICE"] = "cuda:0"
        case .cpu: env["FUNASR_DEVICE"] = "cpu"
        case .default: break
        }

        env["SPEAKMORE_ASR_MODEL_ID"] = nil
        let modelId = settings.asrModelId.trimmingCharacters(in: .whitespacesAndNewlines)
        if !modelId.isEmpty { env["SPEAKMORE_ASR_MODEL_ID"] = modelId }
        return env
    }
}

extension BackendClient {
    /// `/health` 只说明后端进程活着；模型有没有加载好要看 `/ready`。
    public func probeHealth(timeout: TimeInterval = 0.7) async -> Bool {
        var request = URLRequest(url: baseURL.appendingPathComponent("health"), timeoutInterval: timeout)
        request.httpMethod = "GET"
        guard let (_, status) = try? await transport.send(request) else { return false }
        return (200..<300).contains(status)
    }
}

public enum BackendPreload {
    public enum Result: Equatable, Sendable {
        /// 本机有缓存的模型，已经让后端开始加载。
        case started
        /// 不需要预加载（已就绪 / 正在加载 / 正在下载 / 本机没有这个模型）。
        case skipped
        case processExited(String)
        case timedOut
    }

    /// 等后端起来，如果本机已经缓存了当前选用的模型、但后端还没加载，就让它加载（`POST /model/download`）。
    /// 和 `voice-backend-service.js` 的 `startAndPreloadCachedModel` 一致。
    public static func run(
        client: BackendClient, cacheDir: String, modelId: String,
        exitDescription: @Sendable () -> String? = { nil },
        timeout: TimeInterval = 60, interval: TimeInterval = 0.7,
        sleep: @Sendable (TimeInterval) async -> Void = { try? await Task.sleep(nanoseconds: UInt64($0 * 1_000_000_000)) }
    ) async -> Result {
        let deadline = Date().addingTimeInterval(timeout)
        while Date() <= deadline {
            let status = await client.modelStatus(cacheDir: cacheDir, modelId: modelId)
            if status.status != .unavailable {
                if status.cached && !status.ready && status.status == .idle {
                    _ = await client.startDownload(cacheDir: cacheDir, modelId: modelId)
                    return .started
                }
                if status.ready || [.ready, .loading, .downloading].contains(status.status) || !status.cached {
                    return .skipped
                }
            }
            if let exit = exitDescription() { return .processExited(exit) }
            if Task.isCancelled { return .timedOut }
            await sleep(interval)
        }
        return .timedOut
    }
}

public final class BackendProcessManager: BackendProcessControlling, @unchecked Sendable {
    private let client: BackendClient
    private let locate: @Sendable () -> BackendLaunch?
    private let settings: @Sendable () async -> LocalSettings
    private let logURL: URL?
    private let lock = NSLock()
    private var process: Process?
    private var exitText: String?

    /// - Parameters:
    ///   - locate: 找后端可执行文件（打包 / 开发）；找不到返回 nil。
    ///   - settings: 启动时读取当前设置（模型目录、识别设备、模型 id）。
    ///   - logURL: 后端 stdout / stderr 的日志文件，nil 表示丢弃。
    public init(
        client: BackendClient = BackendClient(),
        locate: @escaping @Sendable () -> BackendLaunch?,
        settings: @escaping @Sendable () async -> LocalSettings,
        logURL: URL? = nil
    ) {
        self.client = client
        self.locate = locate
        self.settings = settings
        self.logURL = logURL
    }

    public var exitDescription: String? {
        lock.lock(); defer { lock.unlock() }
        return exitText
    }

    public var isRunningOwnProcess: Bool {
        lock.lock(); defer { lock.unlock() }
        return process?.isRunning == true
    }

    public func start() async throws {
        // 已经有后端在监听就直接用（开发时手动起的、别的客户端起的）。
        if await client.probeHealth() { return }
        if isRunningOwnProcess { return }
        guard let launch = locate() else {
            throw VoiceError(.backendUnavailable, detail: "找不到内置语音后端，也没有已运行的后端（\(client.baseURL.absoluteString)）")
        }
        let current = await settings()
        try spawn(launch, settings: current)
    }

    private func spawn(_ launch: BackendLaunch, settings: LocalSettings) throws {
        let task = Process()
        task.executableURL = launch.executable
        task.arguments = launch.arguments
        task.currentDirectoryURL = launch.workingDirectory
        task.environment = BackendEnvironment.make(
            base: ProcessInfo.processInfo.environment, settings: settings,
            port: client.baseURL.port ?? 8000, ffmpegDirectory: launch.ffmpegDirectory
        )
        if let logURL {
            try? FileManager.default.createDirectory(at: logURL.deletingLastPathComponent(), withIntermediateDirectories: true)
            if !FileManager.default.fileExists(atPath: logURL.path) { FileManager.default.createFile(atPath: logURL.path, contents: nil) }
            if let handle = try? FileHandle(forWritingTo: logURL) {
                handle.seekToEndOfFile()
                task.standardOutput = handle
                task.standardError = handle
            }
        } else {
            task.standardOutput = FileHandle.nullDevice
            task.standardError = FileHandle.nullDevice
        }
        task.terminationHandler = { [weak self] finished in
            guard let self else { return }
            self.lock.lock()
            self.exitText = "code \(finished.terminationStatus), reason \(finished.terminationReason.rawValue)"
            if self.process === finished { self.process = nil }
            self.lock.unlock()
        }
        lock.lock(); exitText = nil; lock.unlock()
        do {
            try task.run()
        } catch {
            throw VoiceError(.backendUnavailable, detail: "后端启动失败：\(error.localizedDescription)")
        }
        lock.lock(); process = task; lock.unlock()
    }

    /// 应用退出时关掉自己起的后端（别人起的不动）。
    public func stop() {
        lock.lock()
        let task = process
        process = nil
        lock.unlock()
        if let task, task.isRunning { task.terminate() }
    }
}

import Foundation
import Observation
import SpeakMoreCore
import SpeakMorePlatform

enum AppPage: String, CaseIterable, Identifiable {
    case setup, home, history, dictionary, settings

    var id: String { rawValue }

    /// 和 Electron 版导航文案同一套 key。
    var titleKey: String { "nav.\(rawValue)" }

    var symbol: String {
        switch self {
        case .setup: return "arrow.down.circle"
        case .home: return "house"
        case .history: return "clock.arrow.circlepath"
        case .dictionary: return "character.book.closed"
        case .settings: return "gearshape"
        }
    }
}

/// 整个窗口共用的状态：本地数据、后端连接、模型状态。页面只读它、调它的方法。
@MainActor
@Observable
final class AppModel {
    /// 应用只有一个模型：窗口、菜单栏、应用代理（启动 / 退出）共用。
    static let shared = AppModel()

    let settings: SettingsStore
    let history: HistoryStore
    let dictionary: DictionaryStore
    let backend: BackendClient
    let l10n: Localizer

    var selection: AppPage? = .setup
    var modelStatus: VoiceModelStatus?
    var isModelActionRunning = false
    /// 最近一次删除模型的结果提示（失败原因 / 别处还有一份），初始化页展示。
    var modelDeleteNotice: ModelDeleteNotice?
    var accessibilityTrusted = Platform.isAccessibilityTrusted()
    var microphones: [Microphone] = []
    /// 语音链路（快捷键、录音、粘贴、悬浮窗口），应用启动后创建。
    private(set) var coordinator: VoiceCoordinator?

    /// 自己拉起 / 关闭的语音后端进程；已经有后端在监听时不会重复启动。
    @ObservationIgnored let backendProcess: BackendProcessManager
    var launchAtLoginError: String?

    init(data: LocalDataStore = LocalDataStore(), backend: BackendClient = BackendClient()) {
        let settings = SettingsStore(data: data)
        self.settings = settings
        self.history = HistoryStore(data: data)
        self.dictionary = DictionaryStore(data: data)
        self.backend = backend
        self.l10n = Localizer(settings: settings)
        let logs = FileManager.default.urls(for: .libraryDirectory, in: .userDomainMask).first?
            .appendingPathComponent("Logs/SpeakMore/backend.log")
        self.backendProcess = BackendProcessManager(
            client: backend,
            locate: { BackendLocator.locate(resourceURL: Bundle.main.resourceURL) },
            settings: { await MainActor.run { settings.settings } },
            logURL: logs
        )
    }

    /// 应用启动时调用：开始监听快捷键，语音输入不依赖主窗口是否打开。
    func startServices() {
        guard coordinator == nil else { return }
        let coordinator = VoiceCoordinator(settings: settings, history: history, dictionary: dictionary, backend: backend, launcher: backendProcess)
        self.coordinator = coordinator
        coordinator.start()

        // 拉起内置后端；本机已经缓存了模型就让它提前加载，第一次录音不用等。
        let launcher = backendProcess
        let client = backend
        let current = settings.settings
        Task.detached {
            try? await launcher.start()
            _ = await BackendPreload.run(
                client: client, cacheDir: current.modelCacheDir, modelId: current.asrModelId,
                exitDescription: { launcher.exitDescription }
            )
        }
        launchAtLoginError = LaunchAtLogin.reconcile(desired: current.launchAtSystemStartup)
    }

    func stopServices() {
        coordinator?.stop()
        backendProcess.stop()
    }

    var permissions: PermissionSnapshot { coordinator?.permissions ?? Permissions.current() }

    /// 设置页的“登录时自动启动”开关：先改系统登录项，成功了才写进设置；失败时保持原样并给出原因。
    func setLaunchAtLogin(_ enabled: Bool) {
        do {
            try LaunchAtLogin.set(enabled)
            settings.update { $0.launchAtSystemStartup = enabled }
            launchAtLoginError = nil
        } catch {
            launchAtLoginError = error.localizedDescription
        }
    }

    func t(_ key: String) -> String { l10n.t(key) }

    func format(_ key: String, _ arguments: CVarArg...) -> String {
        String(format: l10n.t(key), locale: l10n.locale, arguments: arguments)
    }

    var locale: Locale { l10n.locale }

    // MARK: 后台刷新

    /// 其它进程（比如 Electron 版、自动学习）改了本地文件时，界面跟着刷新。
    func monitorLocalChanges() async {
        while !Task.isCancelled {
            settings.reloadIfChanged()
            history.reloadIfChanged()
            dictionary.reloadIfChanged()
            accessibilityTrusted = Platform.isAccessibilityTrusted()
            try? await Task.sleep(for: .seconds(1.5))
        }
    }

    func refreshMicrophones() {
        microphones = Platform.microphones()
    }

    // MARK: 语音模型

    /// 模型保存目录：设置里选过就用设置，否则用后端报告的默认目录。
    var effectiveCacheDir: String {
        let configured = settings.settings.modelCacheDir
        return configured.isEmpty ? (modelStatus?.cacheDir ?? "") : configured
    }

    var modelOptions: [VoiceModelOption] {
        if let models = modelStatus?.models, !models.isEmpty { return models }
        return VoiceModelOption.fallbackOptions(activeModelId: settings.settings.asrModelId)
    }

    func refreshModelStatus() async {
        let current = settings.settings
        modelStatus = await backend.modelStatus(cacheDir: current.modelCacheDir, modelId: current.asrModelId)
    }

    /// 下载（如果还没下载）并加载当前选用的模型。
    func loadActiveModel() async {
        isModelActionRunning = true
        defer { isModelActionRunning = false }
        modelStatus = await backend.startDownload(cacheDir: effectiveCacheDir, modelId: settings.settings.asrModelId)
    }

    /// 只下载、不切换当前模型。
    func downloadOnly(_ modelId: String) async {
        modelStatus = await backend.startDownload(cacheDir: effectiveCacheDir, modelId: modelId, load: false)
    }

    func downloadAll() async {
        for option in modelOptions where !option.cached && option.status != .downloading {
            modelStatus = await backend.startDownload(cacheDir: effectiveCacheDir, modelId: option.modelId, load: false)
        }
    }

    /// 切换到某个模型：先保存设置（之后的状态查询都带新模型），再让后端加载它。
    func useModel(_ modelId: String) async {
        isModelActionRunning = true
        defer { isModelActionRunning = false }
        settings.update { $0.asrModelId = modelId }
        modelStatus = await backend.startDownload(cacheDir: effectiveCacheDir, modelId: modelId)
    }

    /// 删除一个已下载的模型（初始化页的“删除”）。失败原因 / 别处还有一份的提示放进 `modelDeleteNotice`。
    func deleteModel(_ option: VoiceModelOption) async {
        isModelActionRunning = true
        defer { isModelActionRunning = false }
        modelDeleteNotice = nil
        let result = await backend.deleteModel(cacheDir: effectiveCacheDir, modelId: option.modelId)
        guard result.ok else {
            modelDeleteNotice = ModelDeleteNotice(isError: true, text: t("setup.deleteModelFailed") + result.detail)
            return
        }
        if let status = result.status { modelStatus = status }
        if !result.externalLocations.isEmpty {
            let text = t("setup.deleteModelExternal").replacingOccurrences(of: "{paths}", with: result.externalLocations.joined(separator: "、"))
            modelDeleteNotice = ModelDeleteNotice(isError: false, text: text)
        }
    }

    func chooseCacheDirectory() async {
        guard let path = Platform.chooseDirectory(startingAt: effectiveCacheDir, prompt: t("setup.choosePrompt")) else { return }
        settings.update { $0.modelCacheDir = path }
        await refreshModelStatus()
    }
}

/// 初始化页“删除模型”后的提示（失败原因，或别处还有一份、应用不会删的位置）。
struct ModelDeleteNotice: Equatable {
    var isError: Bool
    var text: String
}

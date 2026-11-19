import Foundation

public enum VoiceModelSetupStatus: String, Equatable, Sendable {
    case idle
    case downloading
    case loading
    case ready
    case failed
    case unavailable
}

/// 初始化页“可选模型”列表里的一项（后端 `/model/status` 的 `models`）。
public struct VoiceModelOption: Equatable, Identifiable, Sendable {
    public var modelId: String
    public var repoId: String
    public var label: String
    public var variant: String
    public var runtime: String
    public var sizeBytes: Int
    public var active: Bool
    public var cached: Bool
    public var status: VoiceModelSetupStatus
    public var detail: String
    public var downloadedBytes: Int
    public var totalBytes: Int
    public var progressPercent: Int?
    public var downloadedFiles: Int
    public var totalFiles: Int
    public var fileProgressPercent: Int?

    public var id: String { modelId }

    public init(
        modelId: String,
        repoId: String = "",
        label: String = "",
        variant: String = "",
        runtime: String = "",
        sizeBytes: Int = 0,
        active: Bool = false,
        cached: Bool = false,
        status: VoiceModelSetupStatus = .idle,
        detail: String = "",
        downloadedBytes: Int = 0,
        totalBytes: Int = 0,
        progressPercent: Int? = nil,
        downloadedFiles: Int = 0,
        totalFiles: Int = 0,
        fileProgressPercent: Int? = nil
    ) {
        self.modelId = modelId
        self.repoId = repoId
        self.label = label.isEmpty ? modelId : label
        self.variant = variant
        self.runtime = runtime
        self.sizeBytes = sizeBytes
        self.active = active
        self.cached = cached
        self.status = status
        self.detail = detail
        self.downloadedBytes = downloadedBytes
        self.totalBytes = totalBytes
        self.progressPercent = progressPercent
        self.downloadedFiles = downloadedFiles
        self.totalFiles = totalFiles
        self.fileProgressPercent = fileProgressPercent
    }

    /// 后端不可用时用共享元数据兜底，初始化页仍然能列出两个模型。
    public static func fallbackOptions(activeModelId: String) -> [VoiceModelOption] {
        SharedMetadata.asrModels.map { model in
            VoiceModelOption(
                modelId: model.id,
                repoId: model.repoId,
                label: model.label,
                variant: model.variant,
                runtime: model.runtime,
                sizeBytes: model.sizeBytes,
                active: model.id == activeModelId
            )
        }
    }
}

/// 后端 `/model/status`、`/model/download` 的响应。解码规则与渲染进程的 `normalizeModelStatus` 一致：
/// 字段缺失、类型不对一律回退默认值，不让界面因为后端少一个字段就崩。
public struct VoiceModelStatus: Equatable, Sendable {
    public var status: VoiceModelSetupStatus
    public var detail: String
    public var modelId: String
    public var repoId: String
    public var cacheDir: String
    public var cached: Bool
    public var ready: Bool
    public var device: String
    public var requestedDevice: String
    public var deviceSource: String
    public var fallbackReason: String?
    public var downloadedBytes: Int
    public var totalBytes: Int
    public var progressPercent: Int?
    public var downloadedFiles: Int
    public var totalFiles: Int
    public var fileProgressPercent: Int?
    public var activeModelId: String
    public var models: [VoiceModelOption]

    public static let unavailable = VoiceModelStatus(status: .unavailable, detail: "无法连接语音后端")

    public init(
        status: VoiceModelSetupStatus,
        detail: String = "",
        modelId: String = "",
        repoId: String = "",
        cacheDir: String = "",
        cached: Bool = false,
        ready: Bool = false,
        device: String = "",
        requestedDevice: String = "",
        deviceSource: String = "",
        fallbackReason: String? = nil,
        downloadedBytes: Int = 0,
        totalBytes: Int = 0,
        progressPercent: Int? = nil,
        downloadedFiles: Int = 0,
        totalFiles: Int = 0,
        fileProgressPercent: Int? = nil,
        activeModelId: String = "",
        models: [VoiceModelOption] = []
    ) {
        self.status = status
        self.detail = detail
        self.modelId = modelId
        self.repoId = repoId
        self.cacheDir = cacheDir
        self.cached = cached
        self.ready = ready || status == .ready
        self.device = device
        self.requestedDevice = requestedDevice
        self.deviceSource = deviceSource
        self.fallbackReason = fallbackReason
        self.downloadedBytes = downloadedBytes
        self.totalBytes = totalBytes
        self.progressPercent = progressPercent
        self.downloadedFiles = downloadedFiles
        self.totalFiles = totalFiles
        self.fileProgressPercent = fileProgressPercent
        self.activeModelId = activeModelId
        self.models = models
    }

    public init(json: Any?) {
        guard let object = json as? [String: Any] else {
            self = .unavailable
            return
        }
        let rawStatus = (object["status"] as? String) ?? "unavailable"
        let status = VoiceModelSetupStatus(rawValue: rawStatus) ?? .unavailable
        let models = ((object["models"] as? [Any]) ?? []).compactMap { VoiceModelOption(json: $0) }
        self.init(
            status: status,
            detail: Self.string(object["detail"]),
            modelId: Self.string(object["model_id"]),
            repoId: Self.string(object["repo_id"]),
            cacheDir: Self.string(object["cache_dir"]),
            cached: Self.bool(object["cached"]),
            ready: Self.bool(object["ready"]),
            device: Self.string(object["device"]),
            requestedDevice: Self.string(object["requested_device"]),
            deviceSource: Self.string(object["device_source"]),
            fallbackReason: (object["fallback_reason"] as? String).flatMap { $0.isEmpty ? nil : $0 },
            downloadedBytes: Self.int(object["downloaded_bytes"]),
            totalBytes: Self.int(object["total_bytes"]),
            progressPercent: Self.percent(object["progress_percent"]),
            downloadedFiles: Self.int(object["downloaded_files"]),
            totalFiles: Self.int(object["total_files"]),
            fileProgressPercent: Self.percent(object["file_progress_percent"]),
            activeModelId: Self.string(object["active_model_id"]),
            models: models
        )
    }

    static func string(_ value: Any?) -> String { value as? String ?? "" }

    static func bool(_ value: Any?) -> Bool { value as? Bool ?? false }

    static func int(_ value: Any?) -> Int {
        guard let number = value as? NSNumber, !(value is Bool) else { return 0 }
        let double = number.doubleValue
        return double.isFinite ? max(0, Int(double)) : 0
    }

    static func percent(_ value: Any?) -> Int? {
        guard let number = value as? NSNumber, !(value is Bool) else { return nil }
        let double = number.doubleValue
        return double.isFinite ? max(0, min(100, Int(double.rounded()))) : nil
    }

    /// 当前正在下载文件，并且后端给出了字节进度。
    public var hasByteProgress: Bool {
        status == .downloading && progressPercent != nil && totalBytes > 0
    }

    public var hasFileProgress: Bool {
        status == .downloading && fileProgressPercent != nil && totalFiles > 0
    }

    public var isBusy: Bool { status == .downloading || status == .loading }
}

extension VoiceModelOption {
    init?(json: Any) {
        guard let object = json as? [String: Any],
              let modelId = object["model_id"] as? String, !modelId.isEmpty
        else { return nil }
        self.init(
            modelId: modelId,
            repoId: VoiceModelStatus.string(object["repo_id"]),
            label: VoiceModelStatus.string(object["label"]),
            variant: VoiceModelStatus.string(object["variant"]),
            runtime: VoiceModelStatus.string(object["runtime"]),
            sizeBytes: VoiceModelStatus.int(object["size_bytes"]),
            active: VoiceModelStatus.bool(object["active"]),
            cached: VoiceModelStatus.bool(object["cached"]),
            status: VoiceModelSetupStatus(rawValue: VoiceModelStatus.string(object["status"])) ?? .unavailable,
            detail: VoiceModelStatus.string(object["detail"]),
            downloadedBytes: VoiceModelStatus.int(object["downloaded_bytes"]),
            totalBytes: VoiceModelStatus.int(object["total_bytes"]),
            progressPercent: VoiceModelStatus.percent(object["progress_percent"]),
            downloadedFiles: VoiceModelStatus.int(object["downloaded_files"]),
            totalFiles: VoiceModelStatus.int(object["total_files"]),
            fileProgressPercent: VoiceModelStatus.percent(object["file_progress_percent"])
        )
    }
}

import SwiftUI
import SpeakMoreCore

/// 初始化页：语音模型的下载、全部下载、切换，以及 API Key 状态。
struct SetupView: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        let status = model.modelStatus
        let busy = (status?.isBusy ?? false) || model.isModelActionRunning
        let options = model.modelOptions
        let isReady = status?.ready ?? false
        let isDownloaded = status?.cached ?? false

        Form {
            Section {
                Text(model.t("setup.subtitle")).foregroundStyle(.secondary)
            }

            currentModelSection(status: status, options: options, busy: busy, isReady: isReady, isDownloaded: isDownloaded)
            modelListSection(options: options, status: status, busy: busy)
            apiKeySection
        }
        .formStyle(.grouped)
        .scrollContentBackground(.hidden)
        .task {
            // 和 Electron 版一样每秒刷新一次，下载进度才会动起来。
            while !Task.isCancelled {
                await model.refreshModelStatus()
                try? await Task.sleep(for: .seconds(1))
            }
        }
    }

    // MARK: 当前模型

    @ViewBuilder
    private func currentModelSection(
        status: VoiceModelStatus?, options: [VoiceModelOption], busy: Bool, isReady: Bool, isDownloaded: Bool
    ) -> some View {
        let active = options.first(where: { $0.active })
        let anyDownloaded = isDownloaded || options.contains(where: { $0.cached })
        let anyDownloading = options.contains(where: { $0.status == .downloading })
        let canChooseDir = !anyDownloaded && !isReady && !busy && !anyDownloading

        Section {
            LabeledContent(model.t("setup.modelName")) {
                Text(active.map { $0.variant.isEmpty ? $0.label : "\($0.label) · \($0.variant)" } ?? status?.repoId ?? "-")
            }
            LabeledContent(model.t("setup.cacheDir")) {
                HStack(spacing: 8) {
                    Text(model.effectiveCacheDir.isEmpty ? "-" : model.effectiveCacheDir)
                        .foregroundStyle(.secondary)
                        .lineLimit(2)
                        .truncationMode(.middle)
                        .textSelection(.enabled)
                    if canChooseDir {
                        Button(model.t("setup.chooseCacheDir")) { Task { await model.chooseCacheDirectory() } }
                    }
                }
            }

            if status?.status == .unavailable {
                Label(model.t("setup.backendDown"), systemImage: "exclamationmark.triangle")
                    .foregroundStyle(.orange)
            } else if let detail = status?.detail, !detail.isEmpty {
                Text(detail)
                    .font(AppFont.caption)
                    .foregroundStyle(status?.status == .failed ? Color.red : Color.secondary)
            }

            if busy, let status { progress(for: status) }

            HStack {
                Button {
                    Task { await model.loadActiveModel() }
                } label: {
                    Label(actionTitle(isReady: isReady, isDownloaded: isDownloaded), systemImage: "arrow.down.circle")
                }
                .buttonStyle(.glassProminent)
                .disabled(busy || isReady || status?.status == .unavailable)

                Button {
                    Task { await model.refreshModelStatus() }
                } label: {
                    Label(model.t("setup.refresh"), systemImage: "arrow.clockwise")
                }
                .disabled(busy)
            }
        } header: {
            HStack {
                Text(model.t("setup.model"))
                Spacer()
                StatusBadge(text: model.t(statusKey(status)), tint: statusTint(status))
            }
        }
    }

    private func actionTitle(isReady: Bool, isDownloaded: Bool) -> String {
        if isReady { return model.t("setup.modelReady") }
        return model.t(isDownloaded ? "setup.loadModel" : "setup.startDownload")
    }

    @ViewBuilder
    private func progress(for status: VoiceModelStatus) -> some View {
        if status.hasByteProgress, let percent = status.progressPercent {
            VStack(alignment: .leading, spacing: 4) {
                ProgressView(value: Double(percent), total: 100)
                Text(model.format("setup.progressFormat", percent, formatBytes(status.downloadedBytes), formatBytes(status.totalBytes)))
                    .font(AppFont.caption).foregroundStyle(.secondary)
            }
        } else {
            VStack(alignment: .leading, spacing: 4) {
                ProgressView()
                    .progressViewStyle(.linear)
                if status.hasFileProgress {
                    Text(model.format("setup.filesFormat", status.downloadedFiles, status.totalFiles)
                         + (status.downloadedFiles == 0 ? " · " + model.t("setup.modelFilesProgressHint") : ""))
                        .font(AppFont.caption).foregroundStyle(.secondary)
                }
            }
        }
    }

    // MARK: 可选模型

    @ViewBuilder
    private func modelListSection(options: [VoiceModelOption], status: VoiceModelStatus?, busy: Bool) -> some View {
        let backendDown = status?.status == .unavailable
        let canDownloadAll = options.contains(where: { !$0.cached && $0.status != .downloading })

        Section {
            ForEach(options) { option in
                ModelRow(option: option, busy: busy, backendDown: backendDown)
            }
        } header: {
            HStack {
                Text(model.t("setup.modelList"))
                Spacer()
                Button {
                    Task { await model.downloadAll() }
                } label: {
                    Label(model.t("setup.downloadAll"), systemImage: "arrow.down.to.line")
                }
                .controlSize(.small)
                .disabled(!canDownloadAll || backendDown)
            }
        } footer: {
            Text(model.t("setup.modelListHint"))
        }
    }

    // MARK: API Key

    private var apiKeySection: some View {
        let settings = model.settings.settings
        let provider = settings.llm.currentProvider
        let configured = provider.map { !(settings.llm.apiKeys[$0.id] ?? "").trimmingCharacters(in: .whitespaces).isEmpty } ?? false

        return Section {
            Text(configured ? "\(provider?.label ?? "DeepSeek") \(model.t("setup.apiConfigured"))" : model.t("setup.apiRequired"))
                .foregroundStyle(.secondary)
            Button {
                model.selection = .settings
            } label: {
                Label(model.t("setup.openSettings"), systemImage: "gearshape")
            }
        } header: {
            HStack {
                Text(model.t("setup.api"))
                Spacer()
                StatusBadge(text: model.t(configured ? "setup.apiReady" : "setup.apiMissing"), tint: configured ? .green : .orange)
            }
        }
    }

    // MARK: 状态展示

    private func statusKey(_ status: VoiceModelStatus?) -> String {
        guard let status else { return "setup.modelStatus.idle" }
        switch status.status {
        case .downloading: return "setup.modelStatus.downloading"
        case .loading: return "setup.modelStatus.loading"
        case .ready: return "setup.modelStatus.ready"
        case .failed: return "setup.modelStatus.failed"
        case .unavailable: return "setup.modelStatus.unavailable"
        case .idle: return status.cached ? "setup.modelStatus.cached" : "setup.modelStatus.idle"
        }
    }

    private func statusTint(_ status: VoiceModelStatus?) -> Color {
        switch status?.status {
        case .ready: return .green
        case .failed: return .red
        case .unavailable: return .orange
        case .downloading, .loading: return .blue
        default: return .secondary
        }
    }
}

/// 可选模型列表里的一行。
private struct ModelRow: View {
    @Environment(AppModel.self) private var model
    let option: VoiceModelOption
    let busy: Bool
    let backendDown: Bool

    var body: some View {
        let downloading = option.status == .downloading

        VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .firstTextBaseline) {
                Text(option.variant.isEmpty ? option.label : "\(option.label) · \(option.variant)")
                    .font(AppFont.heading)
                Text(model.format("setup.sizeFormat", formatBytes(option.sizeBytes)))
                    .font(AppFont.caption).foregroundStyle(.secondary)
                Spacer()
                if option.active { StatusBadge(text: model.t("setup.modelInUse"), tint: .accentColor) }
                StatusBadge(text: model.t(statusKey), tint: tint)
            }

            if let description = descriptionKey {
                Text(model.t(description)).font(AppFont.caption).foregroundStyle(.secondary)
            }
            if !option.active, option.status == .failed, !option.detail.isEmpty {
                Text(option.detail).font(AppFont.caption).foregroundStyle(.red)
            }
            if downloading, !option.active {
                if let percent = option.progressPercent, option.totalBytes > 0 {
                    ProgressView(value: Double(percent), total: 100)
                    Text(model.format("setup.progressFormat", percent, formatBytes(option.downloadedBytes), formatBytes(option.totalBytes)))
                        .font(AppFont.caption).foregroundStyle(.secondary)
                } else {
                    ProgressView().progressViewStyle(.linear)
                }
            }

            if !option.active {
                HStack {
                    if !option.cached {
                        Button {
                            Task { await model.downloadOnly(option.modelId) }
                        } label: {
                            Label(model.t("setup.downloadModel"), systemImage: "arrow.down.circle")
                        }
                        .disabled(downloading || backendDown)
                    }
                    Button(model.t("setup.useModel")) {
                        Task { await model.useModel(option.modelId) }
                    }
                    .buttonStyle(.glassProminent)
                    .disabled(busy || downloading || backendDown)
                }
                .controlSize(.small)
                .padding(.top, 2)
            }
        }
        .padding(.vertical, 4)
    }

    private var descriptionKey: String? {
        switch option.modelId {
        case "sensevoice-small": return "setup.modelDesc.sensevoice-small"
        case "sensevoice-small-int8": return "setup.modelDesc.sensevoice-small-int8"
        default: return nil
        }
    }

    private var statusKey: String {
        switch option.status {
        case .downloading: return "setup.modelStatus.downloading"
        case .loading: return "setup.modelStatus.loading"
        case .failed: return "setup.modelStatus.failed"
        case .ready where option.active: return "setup.modelStatus.ready"
        default: return option.cached ? "setup.modelStatus.cached" : "setup.modelNotDownloaded"
        }
    }

    private var tint: Color {
        if option.status == .failed { return .red }
        if option.status == .downloading || option.status == .loading { return .blue }
        return option.cached ? .green : .secondary
    }
}

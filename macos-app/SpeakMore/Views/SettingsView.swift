import SwiftUI
import SpeakMoreCore
import SpeakMorePlatform

/// 设置：快捷键、macOS 权限、麦克风、识别设备、语言、大模型。
/// 侧边栏里的“设置”页和 ⌘, 打开的设置窗口共用这个视图。
struct SettingsView: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        Form {
            ShortcutsSection()
            PermissionSection()
            LaunchAtLoginSection()
            MicrophoneSection()
            RuntimeSection()
            LanguageSection()
            LlmSection()
        }
        .formStyle(.grouped)
        .scrollContentBackground(.hidden)
        .navigationTitle(model.t("settings.title"))
        .task { model.refreshMicrophones() }
    }
}

// MARK: 快捷键

private struct ShortcutsSection: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        let shortcuts = ShortcutLabelSet.macOS
        Section {
            LabeledContent(model.t("settings.shortcut.dictation")) { KeyChips(keys: shortcuts.dictation) }
            LabeledContent(model.t("settings.shortcut.ask")) { KeyChips(keys: shortcuts.ask) }
            LabeledContent(model.t("settings.shortcut.translate")) { KeyChips(keys: shortcuts.translate) }
        } header: {
            Text(model.t("settings.shortcuts"))
        } footer: {
            Text(model.t("settings.shortcutsFooter"))
        }
    }
}

// MARK: 辅助功能权限

private struct PermissionSection: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        let snapshot = model.permissions
        Section {
            PermissionRow(
                permission: .microphone, granted: snapshot.microphone == .granted,
                title: model.t("settings.permission.microphone"), hint: model.t("settings.permission.microphoneHint")
            )
            PermissionRow(
                permission: .accessibility, granted: snapshot.accessibility,
                title: model.t("settings.macosAccessibility"),
                hint: model.t(snapshot.accessibility ? "settings.macosAccessibility.readyHint" : "settings.macosAccessibility.missingHint")
            )
            PermissionRow(
                permission: .inputMonitoring, granted: snapshot.inputMonitoring,
                title: model.t("settings.permission.inputMonitoring"), hint: model.t("settings.permission.inputMonitoringHint")
            )
            Button {
                model.coordinator?.refreshPermissions()
            } label: {
                Label(model.t("settings.macosAccessibility.refresh"), systemImage: "arrow.clockwise")
            }
        } header: {
            Text(model.t("settings.macosPermissions"))
        }
    }
}

/// 一项系统权限：状态标签 +（未授权时）“授权…”按钮。点按钮先触发系统的授权提示，仍没授权就直接打开对应的系统设置面板。
private struct PermissionRow: View {
    @Environment(AppModel.self) private var model
    let permission: SystemPermission
    let granted: Bool
    let title: String
    let hint: String

    var body: some View {
        LabeledContent {
            HStack(spacing: 8) {
                StatusBadge(
                    text: model.t(granted ? "settings.permission.granted" : "settings.permission.missing"),
                    tint: granted ? .green : .orange
                )
                if !granted {
                    Button(model.t("settings.permission.grant")) {
                        Task {
                            let ok = await Permissions.request(permission)
                            model.coordinator?.refreshPermissions()
                            if !ok { Permissions.openSettings(for: permission) }
                        }
                    }
                }
            }
        } label: {
            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                Text(hint).font(AppFont.caption).foregroundStyle(.secondary)
            }
        }
    }
}

// MARK: 登录时自动启动

private struct LaunchAtLoginSection: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        let state = LaunchAtLogin.state
        Section {
            Toggle(model.t("settings.launchAtLogin"), isOn: Binding(
                get: { model.settings.settings.launchAtSystemStartup },
                set: { model.setLaunchAtLogin($0) }
            ))
            if state == .requiresApproval {
                Text(model.t("settings.launchAtLogin.requiresApproval")).font(AppFont.caption).foregroundStyle(.orange)
            }
            if let error = model.launchAtLoginError {
                Text(model.t("settings.launchAtLogin.failed") + error).font(AppFont.caption).foregroundStyle(.red)
            }
        } footer: {
            Text(model.t("settings.launchAtLogin.hint"))
        }
    }
}

// MARK: 麦克风

private struct MicrophoneSection: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        let selected = model.settings.settings.selectedAudioDeviceId
        let known = model.microphones.contains { $0.id == selected }

        Section {
            Picker(model.t("settings.microphone"), selection: Binding(
                get: { selected },
                set: { value in model.settings.update { $0.selectedAudioDeviceId = value } }
            )) {
                Text(model.t("settings.systemDefault")).tag("default")
                ForEach(model.microphones) { microphone in
                    Text(microphone.name).tag(microphone.id)
                }
                // 设置里记着的设备当前不在线（比如从 Electron 版沿用来的 id）：保留这一项，避免选择被悄悄改掉。
                if selected != "default" && !known {
                    Text("\(model.t("settings.inputDevice")) \(selected)\(model.t("settings.micMissing"))").tag(selected)
                }
            }
        } header: {
            Text(model.t("settings.microphone"))
        }
    }
}

// MARK: 识别运行设备

private struct RuntimeSection: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        let mode = model.settings.settings.asrDeviceMode
        let status = model.modelStatus
        let device = deviceText(status)
        let fallback = status?.fallbackReason ?? ""

        Section {
            LabeledContent {
                Picker(model.t("settings.asrRuntime.mode"), selection: Binding(
                    get: { mode == .cuda ? AsrDeviceMode.default : mode },
                    set: { value in model.settings.update { $0.asrDeviceMode = value } }
                )) {
                    Text(model.t("settings.asrRuntime.default")).tag(AsrDeviceMode.default)
                    Text(model.t("settings.asrRuntime.mps")).tag(AsrDeviceMode.mps)
                    Text(model.t("settings.asrRuntime.cpu")).tag(AsrDeviceMode.cpu)
                }
                .pickerStyle(.segmented)
                .labelsHidden()
                .frame(maxWidth: 260)
            } label: {
                VStack(alignment: .leading, spacing: 2) {
                    Text(model.t("settings.asrRuntime.mode"))
                    Text(model.t("settings.asrRuntime.restartRequired")).font(AppFont.caption).foregroundStyle(.secondary)
                }
            }

            LabeledContent {
                HStack(spacing: 8) {
                    StatusBadge(
                        text: device.isEmpty ? model.t("settings.asrRuntime.unavailable") : device,
                        tint: fallback.isEmpty ? .secondary : .orange
                    )
                    Button {
                        Task { await model.refreshModelStatus() }
                    } label: {
                        Label(model.t("settings.asrRuntime.refresh"), systemImage: "arrow.clockwise")
                    }
                    .controlSize(.small)
                }
            } label: {
                VStack(alignment: .leading, spacing: 2) {
                    Text(model.t("settings.asrRuntime.currentDevice"))
                    if !fallback.isEmpty {
                        Text("\(model.t("settings.asrRuntime.fallbackReason"))：\(fallback)")
                            .font(AppFont.caption)
                            .foregroundStyle(.orange)
                    }
                }
            }
        } header: {
            Text(model.t("settings.asrRuntime.title"))
        }
        .task { await model.refreshModelStatus() }
    }

    private func deviceText(_ status: VoiceModelStatus?) -> String {
        guard let status, !status.device.isEmpty else { return "" }
        let requested = !status.requestedDevice.isEmpty && status.requestedDevice != status.device
            ? " / \(status.requestedDevice)" : ""
        return status.device + requested
    }
}

// MARK: 语言

private struct LanguageSection: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        let settings = model.settings.settings

        Section {
            Picker(model.t("settings.interfaceLanguage"), selection: Binding(
                get: { settings.preferredLanguage },
                set: { value in model.settings.update { $0.preferredLanguage = value } }
            )) {
                Text(model.t("settings.zhCn")).tag(InterfaceLanguage.zhCN)
                Text(model.t("settings.enUs")).tag(InterfaceLanguage.enUS)
            }
            Picker(model.t("settings.translationTargetLanguage"), selection: Binding(
                get: { settings.translationTargetLanguage },
                set: { value in model.settings.update { $0.translationTargetLanguage = value } }
            )) {
                ForEach(SharedMetadata.translationLanguages) { language in
                    Text(model.t("settings.translationTarget.\(language.id)")).tag(language.id)
                }
            }
        } header: {
            Text(model.t("settings.language"))
        }
    }
}

// MARK: 大模型

private struct LlmSection: View {
    @Environment(AppModel.self) private var model
    @State private var draft = LlmSettings.makeDefault()
    @State private var isEditing = false
    @State private var isSaving = false
    @State private var message = ""
    @State private var messageIsError = false

    var body: some View {
        let view = isEditing ? draft : model.settings.settings.llm
        let provider = view.currentProvider

        Section {
            Picker(model.t("settings.provider"), selection: Binding(
                get: { view.providerId },
                set: { draft.providerId = $0 }
            )) {
                ForEach(view.providers) { provider in
                    Text(provider.label).tag(provider.id)
                }
            }
            .disabled(!isEditing || isSaving)

            if let provider, provider.allowBaseUrlEdit {
                TextField("Base URL", text: Binding(
                    get: { provider.baseUrl },
                    set: { value in updateProvider(provider.id) { $0.baseUrl = value } }
                ), prompt: Text(model.t("settings.openAiBaseUrlPlaceholder")))
                .disabled(!isEditing || isSaving)
            }

            SecureField("API Key", text: Binding(
                get: { provider.map { view.apiKeys[$0.id] ?? "" } ?? "" },
                set: { value in if let id = provider?.id { draft.apiKeys[id] = value } }
            ), prompt: Text(model.t("settings.apiKeyPlaceholder")))
            .disabled(!isEditing || isSaving)

            TextField(model.t("settings.model"), text: Binding(
                get: { provider.map { view.models[$0.id] ?? $0.defaultModel } ?? "" },
                set: { value in if let id = provider?.id { draft.models[id] = value } }
            ), prompt: Text(model.t("settings.modelPlaceholder")))
            .disabled(!isEditing || isSaving)

            if !message.isEmpty {
                Text(message)
                    .font(AppFont.caption)
                    .foregroundStyle(messageIsError ? Color.red : Color.green)
            }
        } header: {
            HStack {
                Text(model.t("settings.llm"))
                Spacer()
                if isEditing {
                    Button(model.t("settings.cancel"), action: cancel).disabled(isSaving)
                    Button(model.t("settings.save")) { Task { await save() } }
                        .buttonStyle(.glassProminent)
                        .disabled(isSaving)
                } else {
                    Button(model.t("settings.edit"), action: beginEditing)
                }
            }
            .controlSize(.small)
        }
    }

    private func updateProvider(_ id: String, _ change: (inout LlmProvider) -> Void) {
        guard let index = draft.providers.firstIndex(where: { $0.id == id }) else { return }
        change(&draft.providers[index])
    }

    private func beginEditing() {
        draft = model.settings.settings.llm
        message = ""
        isEditing = true
    }

    private func cancel() {
        draft = model.settings.settings.llm
        message = ""
        isEditing = false
    }

    /// 先落盘，再让后端重新读取配置；后端重载失败时保留编辑状态并显示原因。
    private func save() async {
        isSaving = true
        defer { isSaving = false }
        message = ""

        let saved = model.settings.update { $0.llm = draft }
        draft = saved.llm
        let result = await model.backend.reloadConfig()
        if result.success {
            isEditing = false
            messageIsError = false
            message = model.t("settings.saved")
        } else {
            messageIsError = true
            message = model.format("settings.reloadFailedFormat", result.detail.isEmpty ? model.t("settings.unknownError") : result.detail)
        }
    }
}

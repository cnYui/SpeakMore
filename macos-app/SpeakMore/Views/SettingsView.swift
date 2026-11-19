import SwiftUI
import SpeakMoreCore

/// 设置：快捷键、macOS 权限、麦克风、识别设备、语言、大模型。
/// 侧边栏里的“设置”页和 ⌘, 打开的设置窗口共用这个视图。
struct SettingsView: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        Form {
            ShortcutsSection()
            PermissionSection()
            MicrophoneSection()
            RuntimeSection()
            LanguageSection()
            LlmSection()
        }
        .formStyle(.grouped)
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
        let trusted = model.accessibilityTrusted
        Section {
            LabeledContent {
                StatusBadge(
                    text: model.t(trusted ? "settings.macosAccessibility.trusted" : "settings.macosAccessibility.missing"),
                    tint: trusted ? .green : .orange
                )
            } label: {
                VStack(alignment: .leading, spacing: 2) {
                    Text(model.t("settings.macosAccessibility"))
                    Text(model.t(trusted ? "settings.macosAccessibility.readyHint" : "settings.macosAccessibility.missingHint"))
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
            HStack {
                Button {
                    model.accessibilityTrusted = Platform.isAccessibilityTrusted()
                } label: {
                    Label(model.t("settings.macosAccessibility.refresh"), systemImage: "arrow.clockwise")
                }
                if !trusted {
                    Button {
                        Platform.openAccessibilitySettings()
                    } label: {
                        Label(model.t("settings.macosAccessibility.openSettings"), systemImage: "gearshape")
                    }
                    .buttonStyle(.borderedProminent)
                }
            }
        } header: {
            Text(model.t("settings.macosPermissions"))
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
                    Text(model.t("settings.asrRuntime.restartRequired")).font(.caption).foregroundStyle(.secondary)
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
                            .font(.caption)
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
                    .font(.callout)
                    .foregroundStyle(messageIsError ? Color.red : Color.green)
            }
        } header: {
            HStack {
                Text(model.t("settings.llm"))
                Spacer()
                if isEditing {
                    Button(model.t("settings.cancel"), action: cancel).disabled(isSaving)
                    Button(model.t("settings.save")) { Task { await save() } }
                        .buttonStyle(.borderedProminent)
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

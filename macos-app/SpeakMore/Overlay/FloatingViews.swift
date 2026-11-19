import SwiftUI
import SpeakMoreCore

/// 悬浮胶囊：提示文字 + 粒子球，透明背景（只有文字和粒子，不拦截背后应用的点击）。
struct FloatingBarView: View {
    let overlay: OverlayController

    private var tone: SphereTone { SphereTone(status: overlay.barState.status) }

    private var hintColor: Color {
        switch tone {
        case .idle: .white.opacity(0.72)
        case .recording: Color(red: 0.49, green: 0.83, blue: 0.99)
        case .processing, .completed: Color(red: 0.29, green: 0.87, blue: 0.50)
        case .cancelled, .error: Color(red: 0.97, green: 0.44, blue: 0.44)
        }
    }

    var body: some View {
        VStack(spacing: 10) {
            Text(overlay.barHint)
                .font(.system(size: 12))
                .foregroundStyle(hintColor)
                .multilineTextAlignment(.center)
                .lineLimit(2)
                .frame(maxWidth: 200, minHeight: 18)
                // 背后可能是白色文档，加一圈深色柔光保证文字可读。
                .shadow(color: .black.opacity(0.55), radius: 5)
                .shadow(color: hintColor.opacity(0.35), radius: 9)
            ParticleSphereView(tone: tone, level: overlay.barState.inputLevel)
                .frame(width: 120, height: 120)
        }
        .frame(width: OverlayLayout.barSize.width, height: OverlayLayout.barSize.height)
        .animation(.easeOut(duration: 0.18), value: overlay.barHint)
    }
}

/// 悬浮面板：长按快捷键提示，或自由提问 / 粘贴失败时的结果卡片（可复制、可关闭）。
struct FloatingPanelView: View {
    let overlay: OverlayController
    var copyAction: (String) -> Void = { Platform.copyToPasteboard($0) }

    var body: some View {
        Group {
            switch overlay.panel {
            case .shortcutHint: ShortcutHintCard(onClose: overlay.dismissPanel)
            case .result(let text): ResultCard(text: text, onCopy: { copyAction(text) }, onClose: overlay.dismissPanel)
            case nil: Color.clear
            }
        }
        .padding(.horizontal, 18)
        .padding(.top, 16)
        .padding(.bottom, 15)
        .frame(width: OverlayLayout.panelSize.width, height: OverlayLayout.panelSize.height, alignment: .topLeading)
        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).strokeBorder(.separator, lineWidth: 0.5))
    }
}

private struct CloseButton: View {
    let onClose: () -> Void

    var body: some View {
        Button(action: onClose) {
            Image(systemName: "xmark")
                .font(.system(size: 11, weight: .semibold))
                .frame(width: 22, height: 22)
                .contentShape(Circle())
        }
        .buttonStyle(.plain)
        .foregroundStyle(.secondary)
        .help("关闭")
        .accessibilityLabel("关闭")
    }
}

private struct ShortcutHintCard: View {
    let onClose: () -> Void

    var body: some View {
        let shortcuts = ShortcutLabelSet.macOS
        HStack(alignment: .top, spacing: 12) {
            VStack(alignment: .leading, spacing: 8) {
                Text("检测到长按快捷键").font(.headline)
                Text("长按 Right Option 不会开始语音输入。请短按 Right Option，或使用 Right Option + Right Command / Right Option + Shift。")
                    .font(.callout)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.bottom, 2)
                HStack(spacing: 8) {
                    KeyCap(text: ShortcutLabelSet.format(shortcuts.dictation))
                    KeyCap(text: ShortcutLabelSet.format(shortcuts.ask))
                    KeyCap(text: ShortcutLabelSet.format(shortcuts.translate))
                }
                .font(.caption)
            }
            Spacer(minLength: 0)
            CloseButton(onClose: onClose)
        }
    }
}

private struct ResultCard: View {
    let text: String
    let onCopy: () -> Void
    let onClose: () -> Void

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            ScrollView {
                Text(text)
                    .font(.system(size: 14))
                    .lineSpacing(3)
                    .textSelection(.enabled)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            HStack(spacing: 2) {
                Button(action: onCopy) {
                    Image(systemName: "doc.on.doc")
                        .font(.system(size: 12))
                        .frame(width: 22, height: 22)
                        .contentShape(Circle())
                }
                .buttonStyle(.plain)
                .foregroundStyle(.secondary)
                .help("复制结果")
                .accessibilityLabel("复制结果")
                CloseButton(onClose: onClose)
            }
        }
    }
}

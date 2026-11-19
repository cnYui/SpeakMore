import SwiftUI

/// 键帽样式的快捷键标签（和系统设置里的快捷键展示一致）。
struct KeyCap: View {
    let text: String

    var body: some View {
        Text(text)
            .font(AppFont.captionMedium)
            .padding(.horizontal, 10)
            .padding(.vertical, 4)
            .glassEffect(.regular, in: .rect(cornerRadius: 9))
            .accessibilityLabel(text)
    }
}

struct KeyChips: View {
    let keys: [String]

    var body: some View {
        HStack(spacing: 4) {
            ForEach(Array(keys.enumerated()), id: \.offset) { index, key in
                if index > 0 { Text("+").foregroundStyle(.secondary) }
                KeyCap(text: key)
            }
        }
    }
}

/// 状态标签：色调胶囊 + 同色文字。表单行里不用 glassEffect：玻璃层在离屏渲染里会把整段行盖成空白，系统设置的表单行也是平的。
struct StatusBadge: View {
    let text: String
    var tint: Color = .secondary

    var body: some View {
        Text(text)
            .font(AppFont.captionMedium)
            .padding(.horizontal, 10)
            .padding(.vertical, 3)
            .foregroundStyle(tint)
            .background(tint.opacity(0.16), in: Capsule())
            .overlay(Capsule().strokeBorder(tint.opacity(0.28), lineWidth: 0.5))
    }
}

/// 点一下复制，图标短暂变成对勾作为反馈。
struct CopyButton: View {
    let text: String
    let help: String
    @State private var copied = false

    var body: some View {
        Button {
            Platform.copyToPasteboard(text)
            copied = true
            Task {
                try? await Task.sleep(for: .seconds(1.2))
                copied = false
            }
        } label: {
            Image(systemName: copied ? "checkmark" : "doc.on.doc")
                .foregroundStyle(copied ? Color.green : Color.secondary)
                .contentTransition(.symbolEffect(.replace))
        }
        .buttonStyle(.borderless)
        .help(help)
        .accessibilityLabel(help)
        .disabled(text.isEmpty)
    }
}

func formatBytes(_ bytes: Int) -> String {
    ByteCountFormatter.string(fromByteCount: Int64(max(0, bytes)), countStyle: .file)
}

/// 玻璃卡片（Liquid Glass）：用于首页的统计、最近结果等内容块。
/// 多张卡片并排时放进 `GlassEffectContainer`，玻璃之间会按系统的方式融合、采样同一片背景。
struct GlassCard<Content: View>: View {
    var title: String?
    @ViewBuilder var content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            if let title {
                Text(title).font(AppFont.heading)
            }
            content
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .glassEffect(.regular, in: .rect(cornerRadius: 22))
    }
}

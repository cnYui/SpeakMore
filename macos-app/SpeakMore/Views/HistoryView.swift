import SwiftUI
import SpeakMoreCore

/// 历史记录：搜索、复制、清除。
struct HistoryView: View {
    @Environment(AppModel.self) private var model
    @State private var query = ""
    @State private var confirmingClear = false

    var body: some View {
        let items = HistoryMath.filter(model.history.items, query: query)

        List(items) { item in
            HistoryRow(item: item)
        }
        .listStyle(.inset)
        .alternatingRowBackgrounds()
        .overlay {
            if model.history.items.isEmpty {
                ContentUnavailableView(model.t("history.empty"), systemImage: "clock.arrow.circlepath")
            } else if items.isEmpty {
                ContentUnavailableView.search(text: query)
            }
        }
        .searchable(text: $query, prompt: Text(model.t("history.searchPlaceholder")))
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button(role: .destructive) {
                    confirmingClear = true
                } label: {
                    Label(model.t("history.clearAll"), systemImage: "trash")
                }
                .help(model.t("history.clearAll"))
                .disabled(model.history.items.isEmpty)
            }
        }
        .confirmationDialog(
            model.t("history.clearConfirmTitle"),
            isPresented: $confirmingClear,
            titleVisibility: .visible
        ) {
            Button(model.t("history.clearAll"), role: .destructive) { model.history.clear() }
            Button(model.t("settings.cancel"), role: .cancel) {}
        } message: {
            Text(model.t("history.clearConfirmMessage"))
        }
    }
}

private struct HistoryRow: View {
    @Environment(AppModel.self) private var model
    let item: HistoryItem

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 8) {
                if let date = item.createdDate {
                    Text(date, format: .dateTime.year().month().day().hour().minute())
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                if item.mode != .dictate {
                    StatusBadge(text: model.t("history.mode.\(item.mode.rawValue)"), tint: .accentColor)
                }
                if item.status == .error {
                    StatusBadge(text: model.t("history.error"), tint: .red)
                }
                Spacer()
                CopyButton(text: item.finalText, help: model.t("history.copyResult"))
            }
            // 有润色结果且和识别原文不同时，原文用次要样式放在上面；否则只显示最终文字。
            if !item.refinedText.isEmpty && !item.rawText.isEmpty && item.rawText != item.refinedText {
                Text(item.rawText)
                    .font(.callout)
                    .foregroundStyle(.secondary)
                    .textSelection(.enabled)
            }
            Text(item.finalText.isEmpty ? "-" : item.finalText)
                .textSelection(.enabled)
        }
        .padding(.vertical, 6)
        .contextMenu {
            Button(model.t("history.copyResult")) { Platform.copyToPasteboard(item.finalText) }
        }
    }
}

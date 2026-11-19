import SwiftUI
import SpeakMoreCore

/// 首页：快捷键提示、个性化分数、累计统计、最近结果。
struct DashboardView: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        let stats = model.history.stats
        let personalization = Personalization.percent(
            totalDurationMs: stats.totalDurationMs,
            totalTextLength: stats.totalTextLength,
            activeDictionaryCount: model.dictionary.activeEntryCount
        )

        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                shortcutHint
                personalizationAndStats(stats: stats, personalization: personalization)
                recentResults
            }
            .padding(24)
            .frame(maxWidth: 820, alignment: .leading)
            .frame(maxWidth: .infinity)
        }
    }

    // MARK: 快捷键提示

    private var shortcutHint: some View {
        let shortcuts = ShortcutLabelSet.macOS
        return HStack(spacing: 6) {
            Text(model.t("dashboard.shortcut.prefix"))
            KeyChips(keys: shortcuts.dictation)
            Text(model.t("dashboard.shortcut.orPress"))
            KeyChips(keys: shortcuts.translate)
            Text(model.t("dashboard.shortcut.orPress"))
            KeyChips(keys: shortcuts.ask)
            Text(model.t("dashboard.shortcut.suffix"))
        }
        .foregroundStyle(.secondary)
        .fixedSize(horizontal: false, vertical: true)
    }

    // MARK: 个性化 + 统计

    private func personalizationAndStats(stats: DashboardStats, personalization: Int) -> some View {
        GlassEffectContainer(spacing: 12) {
          Grid(horizontalSpacing: 12, verticalSpacing: 12) {
            GridRow {
                GlassCard {
                    HStack(spacing: 16) {
                        VStack(alignment: .leading, spacing: 10) {
                            Text(model.t("dashboard.personalization.label"))
                                .font(.subheadline)
                                .foregroundStyle(.secondary)
                            ProgressView(value: Double(personalization), total: 100)
                                .tint(.blue)
                        }
                        Gauge(value: Double(personalization), in: 0...100) {
                            Text(model.t("dashboard.personalization.label"))
                        } currentValueLabel: {
                            Text("\(personalization)%")
                                .font(.system(.callout, design: .rounded).weight(.semibold))
                        }
                        .gaugeStyle(.accessoryCircularCapacity)
                        .tint(.blue)
                        .frame(width: 56, height: 56)
                    }
                }
                .gridCellColumns(2)
            }

            GridRow {
                StatCard(
                    value: model.format("dashboard.minutesFormat", stats.durationMinutes),
                    label: model.t("dashboard.stats.totalDuration")
                )
                StatCard(
                    value: stats.totalTextLength.formatted(.number.locale(model.locale)),
                    label: model.t("dashboard.stats.totalTextLength")
                )
            }
            GridRow {
                StatCard(
                    value: model.format("dashboard.minutesFormat", stats.savedMinutes),
                    label: model.t("dashboard.stats.savedTime")
                )
                StatCard(
                    value: stats.averageCharsPerMinute > 0
                        ? model.format("dashboard.speedFormat", stats.averageCharsPerMinute)
                        : "--",
                    label: model.t("dashboard.stats.averageSpeed")
                )
            }
          }
        }
    }

    // MARK: 最近结果

    private var recentResults: some View {
        let results = model.history.recentResults
        return GlassCard(title: model.t("dashboard.recentResults")) {
            if results.isEmpty {
                Text(model.t("dashboard.noResults"))
                    .foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity, minHeight: 56, alignment: .center)
            } else {
                VStack(spacing: 0) {
                    ForEach(Array(results.enumerated()), id: \.element.id) { index, result in
                        if index > 0 { Divider() }
                        HStack(alignment: .top, spacing: 8) {
                            Text(result.text)
                                .textSelection(.enabled)
                                .frame(maxWidth: .infinity, alignment: .leading)
                            CopyButton(text: result.text, help: "\(model.t("dashboard.copyRecentResult")) \(index + 1)")
                        }
                        .padding(.vertical, 8)
                    }
                }
            }
        }
    }
}

private struct StatCard: View {
    let value: String
    let label: String

    var body: some View {
        GlassCard {
            VStack(alignment: .leading, spacing: 2) {
                Text(value)
                    .font(.title2.weight(.semibold))
                    .monospacedDigit()
                Text(label)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
    }
}

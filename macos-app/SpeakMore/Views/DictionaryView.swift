import SwiftUI
import SpeakMoreCore

private enum DictionaryFilter: String, CaseIterable, Identifiable {
    case all, auto, manual, candidate

    var id: String { rawValue }

    var titleKey: String {
        switch self {
        case .all: return "dictionary.filterAll"
        case .auto: return "dictionary.filterAuto"
        case .manual: return "dictionary.filterManual"
        case .candidate: return "dictionary.filterCandidate"
        }
    }
}

/// 词典：手动词条、自动添加词条和自动学习候选。
struct DictionaryView: View {
    @Environment(AppModel.self) private var model
    @State private var phrase = ""
    @State private var aliases = ""
    @State private var saveFailed = false
    @State private var filter: DictionaryFilter = .all
    @State private var query = ""

    var body: some View {
        let entries = visibleEntries
        let candidates = visibleCandidates

        VStack(spacing: 0) {
            addForm
            Divider()
            filterBar
            List {
                if !candidates.isEmpty {
                    Section {
                        ForEach(candidates) { candidate in CandidateRow(candidate: candidate) }
                    }
                }
                if !entries.isEmpty {
                    Section {
                        ForEach(entries) { entry in EntryRow(entry: entry) }
                    }
                }
            }
            .listStyle(.inset)
            .scrollContentBackground(.hidden)
            .overlay {
                if entries.isEmpty && candidates.isEmpty {
                    if query.isEmpty {
                        ContentUnavailableView(model.t("dictionary.empty"), systemImage: "character.book.closed")
                    } else {
                        ContentUnavailableView.search(text: query)
                    }
                }
            }
        }
        .searchable(text: $query, prompt: Text(model.t("dictionary.searchPlaceholder")))
    }

    // MARK: 新增词条

    private var addForm: some View {
        let canSave = !phrase.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty

        return VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .firstTextBaseline, spacing: 10) {
                TextField(model.t("dictionary.correctLabel"), text: $phrase)
                TextField(model.t("dictionary.aliasLabel"), text: $aliases, prompt: Text(model.t("dictionary.aliasPlaceholder")))
                Button(model.t("dictionary.saveEntry"), action: save)
                    .buttonStyle(.glassProminent)
                    .keyboardShortcut(.defaultAction)
                    .disabled(!canSave)
            }
            .textFieldStyle(.roundedBorder)

            if !canSave {
                Text(model.t("dictionary.correctHelper")).font(.caption).foregroundStyle(.secondary)
            }
            if saveFailed {
                Label(model.t("dictionary.saveError"), systemImage: "exclamationmark.triangle.fill")
                    .font(.callout)
                    .foregroundStyle(.red)
            }
        }
        .padding(16)
    }

    private func save() {
        saveFailed = false
        if model.dictionary.create(phrase: phrase, aliasesText: aliases) {
            phrase = ""
            aliases = ""
        } else {
            saveFailed = true
        }
    }

    // MARK: 过滤

    private var filterBar: some View {
        Picker("", selection: $filter) {
            ForEach(DictionaryFilter.allCases) { item in
                Text(model.t(item.titleKey)).tag(item)
            }
        }
        .pickerStyle(.segmented)
        .labelsHidden()
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
    }

    private var visibleEntries: [DictionaryEntry] {
        let keyword = query.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        return model.dictionary.entries
            .filter { entry in
                switch filter {
                case .all: return true
                case .candidate: return true
                case .auto: return entry.source == .auto
                case .manual: return entry.source == .manual
                }
            }
            .filter { entry in
                keyword.isEmpty
                    || entry.phrase.lowercased().contains(keyword)
                    || entry.aliases.contains { $0.lowercased().contains(keyword) }
            }
    }

    private var visibleCandidates: [DictionaryCandidate] {
        guard filter == .all || filter == .candidate else { return [] }
        let keyword = query.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        return model.dictionary.pendingCandidates.filter {
            keyword.isEmpty || $0.wrong.lowercased().contains(keyword) || $0.correct.lowercased().contains(keyword)
        }
    }
}

private struct CandidateRow: View {
    @Environment(AppModel.self) private var model
    let candidate: DictionaryCandidate

    var body: some View {
        HStack(spacing: 10) {
            VStack(alignment: .leading, spacing: 3) {
                Text("\(candidate.wrong) → \(candidate.correct)").fontWeight(.medium)
                if let date = ISO8601.date(from: candidate.lastSeenAt) {
                    Text(model.format("dictionary.seenFormat", candidate.count, date.formatted(.dateTime.year().month().day().hour().minute().locale(model.locale))))
                        .font(.caption).foregroundStyle(.secondary)
                }
            }
            Spacer()
            Button {
                model.dictionary.promoteCandidate(id: candidate.id)
            } label: {
                Image(systemName: "checkmark.circle")
            }
            .help(model.t("dictionary.confirmCandidate"))
            .accessibilityLabel(model.t("dictionary.confirmCandidate"))

            Button {
                model.dictionary.ignoreCandidate(id: candidate.id)
            } label: {
                Image(systemName: "xmark.circle")
            }
            .help(model.t("dictionary.ignoreCandidate"))
            .accessibilityLabel(model.t("dictionary.ignoreCandidate"))
        }
        .buttonStyle(.borderless)
        .imageScale(.large)
        .padding(.vertical, 4)
    }
}

private struct EntryRow: View {
    @Environment(AppModel.self) private var model
    let entry: DictionaryEntry

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 6) {
                    Text(entry.phrase).fontWeight(.medium)
                    StatusBadge(text: model.t(entry.source == .auto ? "dictionary.autoAdded" : "dictionary.manualAdded"))
                    if entry.status == .disabled { StatusBadge(text: model.t("dictionary.disabled"), tint: .orange) }
                }
                Text(aliasLine).font(.caption).foregroundStyle(.secondary)
                Text(model.format("dictionary.hitFormat", entry.hitCount, updatedText))
                    .font(.caption).foregroundStyle(.secondary)
            }
            Spacer()
            Toggle(model.t("dictionary.enabled"), isOn: Binding(
                get: { entry.status == .active },
                set: { _ in model.dictionary.toggle(entry) }
            ))
            .toggleStyle(.switch)
            .labelsHidden()
            .help(model.t("dictionary.enabled"))

            Button {
                model.dictionary.delete(id: entry.id)
            } label: {
                Image(systemName: "trash")
            }
            .buttonStyle(.borderless)
            .help(model.t("dictionary.deleteEntry"))
            .accessibilityLabel(model.t("dictionary.deleteEntry"))
        }
        .padding(.vertical, 4)
        .contextMenu {
            Button(model.t("dictionary.deleteEntry"), role: .destructive) { model.dictionary.delete(id: entry.id) }
        }
    }

    private var aliasLine: String {
        guard !entry.aliases.isEmpty else { return model.t("dictionary.noAliases") }
        return model.format("dictionary.aliasesFormat", entry.aliases.joined(separator: model.t("dictionary.aliasSeparator")))
    }

    private var updatedText: String {
        guard let date = ISO8601.date(from: entry.updatedAt) else { return "-" }
        return date.formatted(.dateTime.year().month().day().hour().minute().locale(model.locale))
    }
}

import Foundation
import Observation

/// 设置。写入时先重新读盘再合并改动，和 Electron 版 `settings:update` 一样，避免覆盖别处刚写入的内容。
@MainActor
@Observable
public final class SettingsStore {
    public private(set) var settings: LocalSettings
    public private(set) var lastWriteError: String?

    private let data: LocalDataStore
    private var lastSeenModification: Date?

    public init(data: LocalDataStore) {
        self.data = data
        self.settings = data.read(LocalSettings.self, LocalDataFile.settings, fallback: LocalSettings()).normalized()
        self.lastSeenModification = data.fileModificationDate(LocalDataFile.settings)
    }

    public func reload() {
        settings = data.read(LocalSettings.self, LocalDataFile.settings, fallback: LocalSettings()).normalized()
        lastSeenModification = data.fileModificationDate(LocalDataFile.settings)
    }

    /// 文件被别的进程（比如 Electron 版）改过就重新读取。
    public func reloadIfChanged() {
        let modification = data.fileModificationDate(LocalDataFile.settings)
        if modification != lastSeenModification { reload() }
    }

    @discardableResult
    public func update(_ change: (inout LocalSettings) -> Void) -> LocalSettings {
        var next = data.read(LocalSettings.self, LocalDataFile.settings, fallback: settings)
        change(&next)
        next = next.normalized()
        do {
            try data.write(next, LocalDataFile.settings)
            lastWriteError = nil
        } catch {
            lastWriteError = error.localizedDescription
        }
        settings = next
        lastSeenModification = data.fileModificationDate(LocalDataFile.settings)
        return next
    }
}

/// 听写历史和累计统计。
@MainActor
@Observable
public final class HistoryStore {
    public private(set) var items: [HistoryItem] = []
    public private(set) var stats: DashboardStats = .empty

    private let data: LocalDataStore
    private var lastSeen: [Date?] = []

    public init(data: LocalDataStore) {
        self.data = data
        reload()
    }

    public var recentResults: [RecentResult] { HistoryMath.recentResults(from: items) }

    public func reload() {
        let stored = data.read([HistoryItem].self, LocalDataFile.history, fallback: [])
        items = Array(stored.prefix(HistoryMath.maxHistoryItems))
        stats = HistoryMath.dashboardStats(from: readPersistedStats())
        lastSeen = modificationDates()
    }

    public func reloadIfChanged() {
        if modificationDates() != lastSeen { reload() }
    }

    /// 清空历史列表；累计统计单独保存，清空历史不会让首页累计数字归零。
    public func clear() {
        _ = readPersistedStats()
        try? data.write([HistoryItem](), LocalDataFile.history)
        reload()
    }

    public func upsert(_ item: HistoryItem) {
        let result = HistoryMath.upsert(items: items, stats: readPersistedStats(), item: item)
        try? data.write(result.items, LocalDataFile.history)
        try? data.write(result.stats, LocalDataFile.historyStats)
        reload()
    }

    private func readPersistedStats() -> PersistedHistoryStats {
        if let stats = try? JSONDecoder().decode(
            PersistedHistoryStats.self,
            from: (try? Data(contentsOf: data.fileURL(LocalDataFile.historyStats))) ?? Data()
        ) {
            return stats
        }
        // 旧数据没有统计文件：从历史列表迁移一份并落盘。
        let migrated = HistoryMath.stats(from: data.read([HistoryItem].self, LocalDataFile.history, fallback: []))
        try? data.write(migrated, LocalDataFile.historyStats)
        return migrated
    }

    private func modificationDates() -> [Date?] {
        [data.fileModificationDate(LocalDataFile.history), data.fileModificationDate(LocalDataFile.historyStats)]
    }
}

/// 词典：正式词条 + 自动学习候选。
@MainActor
@Observable
public final class DictionaryStore {
    public private(set) var entries: [DictionaryEntry] = []
    public private(set) var candidates: [DictionaryCandidate] = []

    private let data: LocalDataStore
    private var lastSeen: [Date?] = []

    public init(data: LocalDataStore) {
        self.data = data
        reload()
    }

    public var activeEntryCount: Int { entries.filter { $0.status == .active }.count }

    public var pendingCandidates: [DictionaryCandidate] { candidates.filter { $0.status == .candidate } }

    public func reload() {
        entries = data.read([DictionaryEntry].self, LocalDataFile.dictionary, fallback: []).filter { !$0.phrase.isEmpty }
        candidates = data.read([DictionaryCandidate].self, LocalDataFile.dictionaryCandidates, fallback: [])
            .filter { !$0.wrong.isEmpty && !$0.correct.isEmpty }
        lastSeen = modificationDates()
    }

    public func reloadIfChanged() {
        if modificationDates() != lastSeen { reload() }
    }

    /// 新增手动词条；正确写法为空返回 `false`。
    @discardableResult
    public func create(phrase: String, aliasesText: String, now: Date = Date()) -> Bool {
        let timestamp = ISO8601.string(from: now)
        do {
            let result = try DictionaryLogic.create(
                currentEntries(),
                new: .init(phrase: phrase, aliases: DictionaryLogic.splitAliases(aliasesText)),
                now: timestamp
            )
            try write(entries: result.entries)
            reload()
            return true
        } catch {
            return false
        }
    }

    public func toggle(_ entry: DictionaryEntry, now: Date = Date()) {
        let status: DictionaryEntryStatus = entry.status == .active ? .disabled : .active
        guard let next = try? DictionaryLogic.setStatus(
            currentEntries(), id: entry.id, status: status, now: ISO8601.string(from: now)
        ) else { return }
        try? write(entries: next)
        reload()
    }

    public func delete(id: String) {
        try? write(entries: currentEntries().filter { $0.id != id })
        reload()
    }

    public func promoteCandidate(id: String, now: Date = Date()) {
        guard let result = try? DictionaryLogic.promote(
            candidates: currentCandidates(), entries: currentEntries(), id: id, now: ISO8601.string(from: now)
        ) else { return }
        try? write(entries: result.entries)
        try? data.write(result.candidates, LocalDataFile.dictionaryCandidates)
        reload()
    }

    public func ignoreCandidate(id: String) {
        try? data.write(DictionaryLogic.ignore(candidates: currentCandidates(), id: id), LocalDataFile.dictionaryCandidates)
        reload()
    }

    private func currentEntries() -> [DictionaryEntry] {
        data.read([DictionaryEntry].self, LocalDataFile.dictionary, fallback: []).filter { !$0.phrase.isEmpty }
    }

    private func currentCandidates() -> [DictionaryCandidate] {
        data.read([DictionaryCandidate].self, LocalDataFile.dictionaryCandidates, fallback: [])
    }

    private func write(entries: [DictionaryEntry]) throws {
        try data.write(entries, LocalDataFile.dictionary)
    }

    private func modificationDates() -> [Date?] {
        [data.fileModificationDate(LocalDataFile.dictionary), data.fileModificationDate(LocalDataFile.dictionaryCandidates)]
    }
}

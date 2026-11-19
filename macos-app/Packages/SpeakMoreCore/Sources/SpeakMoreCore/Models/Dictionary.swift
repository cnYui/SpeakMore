import Foundation

public enum DictionaryEntrySource: String, Codable, Sendable {
    case manual
    case auto
}

public enum DictionaryEntryStatus: String, Codable, Sendable {
    case active
    case disabled
}

public enum DictionaryCandidateStatus: String, Codable, Sendable {
    case candidate
    case ignored
    case promoted
}

/// 正式词条，字段与 Electron 版 `dictionary.json` 一致。
public struct DictionaryEntry: Codable, Equatable, Identifiable, Sendable {
    public var id: String
    public var phrase: String
    public var aliases: [String]
    public var source: DictionaryEntrySource
    public var status: DictionaryEntryStatus
    public var hitCount: Int
    public var createdAt: String
    public var updatedAt: String
    public var lastLearnedAt: String

    public init(
        id: String = "dict_" + UUID().uuidString.lowercased(),
        phrase: String,
        aliases: [String] = [],
        source: DictionaryEntrySource = .manual,
        status: DictionaryEntryStatus = .active,
        hitCount: Int = 0,
        createdAt: String,
        updatedAt: String? = nil,
        lastLearnedAt: String = ""
    ) {
        let normalizedPhrase = DictionaryLogic.normalizePhrase(phrase)
        self.id = id
        self.phrase = normalizedPhrase
        self.aliases = DictionaryLogic.uniqueAliases(aliases, phrase: normalizedPhrase)
        self.source = source
        self.status = status
        self.hitCount = max(0, hitCount)
        self.createdAt = createdAt
        self.updatedAt = updatedAt ?? createdAt
        self.lastLearnedAt = lastLearnedAt
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let now = ISO8601.string(from: Date())
        let createdAt = try container.decodeIfPresent(String.self, forKey: .createdAt)
        let id = try container.decodeIfPresent(String.self, forKey: .id)
        let updatedAt = try container.decodeIfPresent(String.self, forKey: .updatedAt)
        self.init(
            id: (id?.isEmpty == false ? id : nil) ?? "dict_" + UUID().uuidString.lowercased(),
            phrase: try container.decodeIfPresent(String.self, forKey: .phrase) ?? "",
            aliases: (try? container.decodeIfPresent([String].self, forKey: .aliases)) ?? [],
            source: (try? container.decodeIfPresent(DictionaryEntrySource.self, forKey: .source)) ?? .manual,
            status: (try? container.decodeIfPresent(DictionaryEntryStatus.self, forKey: .status)) ?? .active,
            hitCount: Int((try? container.decodeIfPresent(Double.self, forKey: .hitCount)) ?? 0),
            createdAt: (createdAt?.isEmpty == false ? createdAt : nil) ?? now,
            updatedAt: (updatedAt?.isEmpty == false ? updatedAt : nil),
            lastLearnedAt: try container.decodeIfPresent(String.self, forKey: .lastLearnedAt) ?? ""
        )
    }
}

/// 自动学习候选：用户反复把 `wrong` 改成 `correct` 时记录。
public struct DictionaryCandidate: Codable, Equatable, Identifiable, Sendable {
    public var id: String
    public var wrong: String
    public var correct: String
    public var count: Int
    public var status: DictionaryCandidateStatus
    public var firstSeenAt: String
    public var lastSeenAt: String

    public init(
        id: String = "candidate_" + UUID().uuidString.lowercased(),
        wrong: String,
        correct: String,
        count: Int = 0,
        status: DictionaryCandidateStatus = .candidate,
        firstSeenAt: String,
        lastSeenAt: String? = nil
    ) {
        self.id = id
        self.wrong = DictionaryLogic.normalizePhrase(wrong)
        self.correct = DictionaryLogic.normalizePhrase(correct)
        self.count = max(0, count)
        self.status = status
        self.firstSeenAt = firstSeenAt
        self.lastSeenAt = lastSeenAt ?? firstSeenAt
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let now = ISO8601.string(from: Date())
        let id = try container.decodeIfPresent(String.self, forKey: .id)
        let firstSeenAt = try container.decodeIfPresent(String.self, forKey: .firstSeenAt)
        let lastSeenAt = try container.decodeIfPresent(String.self, forKey: .lastSeenAt)
        self.init(
            id: (id?.isEmpty == false ? id : nil) ?? "candidate_" + UUID().uuidString.lowercased(),
            wrong: try container.decodeIfPresent(String.self, forKey: .wrong) ?? "",
            correct: try container.decodeIfPresent(String.self, forKey: .correct) ?? "",
            count: Int((try? container.decodeIfPresent(Double.self, forKey: .count)) ?? 0),
            status: (try? container.decodeIfPresent(DictionaryCandidateStatus.self, forKey: .status)) ?? .candidate,
            firstSeenAt: (firstSeenAt?.isEmpty == false ? firstSeenAt : nil) ?? now,
            lastSeenAt: (lastSeenAt?.isEmpty == false ? lastSeenAt : nil)
        )
    }
}

public enum DictionaryError: Error, Equatable, Sendable {
    case entryInvalid
    case entryNotFound
    case candidateNotFound
}

/// 词典的纯规则，行为和 `electron-app/dictionary-store.js`、`dictionary-actions.js`、`dictionary-repository.js` 一致。
public enum DictionaryLogic {
    /// 合并空白、去首尾空白，让“同一个词的不同空格写法”落到同一个比较维度。
    public static func normalizePhrase(_ value: String) -> String {
        value.components(separatedBy: .whitespacesAndNewlines)
            .filter { !$0.isEmpty }
            .joined(separator: " ")
    }

    /// 别名不能和正确写法相同，也不能重复（不区分大小写）。
    public static func uniqueAliases(_ aliases: [String], phrase: String = "") -> [String] {
        let phraseKey = normalizePhrase(phrase).lowercased()
        var seen = Set<String>()
        return aliases
            .map(normalizePhrase)
            .filter { !$0.isEmpty && $0.lowercased() != phraseKey }
            .filter { seen.insert($0.lowercased()).inserted }
    }

    /// 设置表单里的“错误写法或别名”输入：逗号、顿号、分号、换行都能分隔。
    public static func splitAliases(_ value: String) -> [String] {
        let separators = CharacterSet(charactersIn: ",\n，、;；")
        var seen = Set<String>()
        return value.components(separatedBy: separators)
            .map(normalizePhrase)
            .filter { !$0.isEmpty }
            .filter { seen.insert($0.lowercased()).inserted }
    }

    private static func sameEntry(_ left: DictionaryEntry, _ right: DictionaryEntry) -> Bool {
        normalizePhrase(left.phrase).lowercased() == normalizePhrase(right.phrase).lowercased()
    }

    /// 按正确写法合并词条；手动词条不会被自动学习改成 auto。
    public static func upsert(_ entries: [DictionaryEntry], _ entry: DictionaryEntry, now: String) -> [DictionaryEntry] {
        var incoming = entry
        incoming.updatedAt = now
        guard !incoming.phrase.isEmpty else { return entries }

        guard let index = entries.firstIndex(where: { sameEntry($0, incoming) }) else {
            return [incoming] + entries
        }
        var next = entries
        let existing = entries[index]
        next[index] = DictionaryEntry(
            id: existing.id,
            phrase: existing.phrase,
            aliases: existing.aliases + incoming.aliases,
            source: existing.source == .manual ? .manual : incoming.source,
            status: incoming.status,
            hitCount: max(existing.hitCount, incoming.hitCount),
            createdAt: existing.createdAt,
            updatedAt: now,
            lastLearnedAt: incoming.lastLearnedAt
        )
        return next
    }

    public struct NewEntry: Equatable, Sendable {
        public var phrase: String
        public var aliases: [String]
        public var source: DictionaryEntrySource
        public var status: DictionaryEntryStatus

        public init(
            phrase: String,
            aliases: [String] = [],
            source: DictionaryEntrySource = .manual,
            status: DictionaryEntryStatus = .active
        ) {
            self.phrase = phrase
            self.aliases = aliases
            self.source = source
            self.status = status
        }
    }

    public static func create(_ entries: [DictionaryEntry], new: NewEntry, now: String) throws
        -> (entries: [DictionaryEntry], created: DictionaryEntry) {
        let entry = DictionaryEntry(
            phrase: new.phrase,
            aliases: new.aliases,
            source: new.source,
            status: new.status,
            createdAt: now
        )
        guard !entry.phrase.isEmpty else { throw DictionaryError.entryInvalid }
        let next = upsert(entries, entry, now: now)
        guard let created = next.first(where: { $0.phrase.lowercased() == entry.phrase.lowercased() }) else {
            throw DictionaryError.entryInvalid
        }
        return (next, created)
    }

    public static func setStatus(_ entries: [DictionaryEntry], id: String, status: DictionaryEntryStatus, now: String) throws
        -> [DictionaryEntry] {
        guard let index = entries.firstIndex(where: { $0.id == id }) else { throw DictionaryError.entryNotFound }
        var next = entries
        next[index] = DictionaryEntry(
            id: entries[index].id,
            phrase: entries[index].phrase,
            aliases: entries[index].aliases,
            source: entries[index].source,
            status: status,
            hitCount: entries[index].hitCount,
            createdAt: entries[index].createdAt,
            updatedAt: now,
            lastLearnedAt: entries[index].lastLearnedAt
        )
        return next
    }

    /// 确认候选：wrong 成为别名、correct 成为正确写法，候选标记为 promoted。
    public static func promote(
        candidates: [DictionaryCandidate],
        entries: [DictionaryEntry],
        id: String,
        now: String
    ) throws -> (candidates: [DictionaryCandidate], entries: [DictionaryEntry]) {
        guard let candidate = candidates.first(where: { $0.id == id }) else { throw DictionaryError.candidateNotFound }
        let entry = DictionaryEntry(
            phrase: candidate.correct,
            aliases: [candidate.wrong],
            source: .auto,
            status: .active,
            hitCount: candidate.count,
            createdAt: now,
            lastLearnedAt: now
        )
        let nextEntries = upsert(entries, entry, now: now)
        let nextCandidates = candidates.map { item -> DictionaryCandidate in
            guard item.id == id else { return item }
            var promoted = item
            promoted.status = .promoted
            promoted.lastSeenAt = now
            return promoted
        }
        return (nextCandidates, nextEntries)
    }

    public static func ignore(candidates: [DictionaryCandidate], id: String) -> [DictionaryCandidate] {
        candidates.map { item in
            guard item.id == id else { return item }
            var ignored = item
            ignored.status = .ignored
            return ignored
        }
    }
}

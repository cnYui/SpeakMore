import AppKit

/// 剪贴板某一时刻的完整内容：每个条目的每种类型都存一份原始数据，恢复时原样写回（文字、图片、文件都不丢）。
public struct PasteboardSnapshot: Equatable, Sendable {
    public struct Entry: Equatable, Sendable {
        public var type: String
        public var data: Data
    }

    public var items: [[Entry]]
    public var changeCount: Int

    public init(items: [[Entry]], changeCount: Int) {
        self.items = items
        self.changeCount = changeCount
    }
}

public protocol PasteboardProviding: AnyObject {
    var changeCount: Int { get }
    func snapshot() -> PasteboardSnapshot
    /// 写入一段文字，返回写入后的 changeCount。
    @discardableResult func write(text: String) -> Int
    func restore(_ snapshot: PasteboardSnapshot)
}

public final class SystemPasteboard: PasteboardProviding {
    private let pasteboard: NSPasteboard

    public init(pasteboard: NSPasteboard = .general) {
        self.pasteboard = pasteboard
    }

    public var changeCount: Int { pasteboard.changeCount }

    public func snapshot() -> PasteboardSnapshot {
        let items = (pasteboard.pasteboardItems ?? []).map { item in
            item.types.compactMap { type -> PasteboardSnapshot.Entry? in
                guard let data = item.data(forType: type) else { return nil }
                return PasteboardSnapshot.Entry(type: type.rawValue, data: data)
            }
        }
        return PasteboardSnapshot(items: items.filter { !$0.isEmpty }, changeCount: pasteboard.changeCount)
    }

    @discardableResult
    public func write(text: String) -> Int {
        pasteboard.clearContents()
        pasteboard.setString(text, forType: .string)
        return pasteboard.changeCount
    }

    public func restore(_ snapshot: PasteboardSnapshot) {
        pasteboard.clearContents()
        guard !snapshot.items.isEmpty else { return }
        let items = snapshot.items.map { entries -> NSPasteboardItem in
            let item = NSPasteboardItem()
            for entry in entries { item.setData(entry.data, forType: NSPasteboard.PasteboardType(entry.type)) }
            return item
        }
        pasteboard.writeObjects(items)
    }
}

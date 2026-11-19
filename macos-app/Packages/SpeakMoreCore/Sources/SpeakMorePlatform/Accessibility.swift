import AppKit
import ApplicationServices
import SpeakMoreCore

/// 读前台应用的焦点、可输入目标和选区。所有判定规则在 `PasteTargetPolicy`，这里只负责从辅助功能（AX）接口取属性。
public protocol AccessibilityReading: AnyObject {
    var isTrusted: Bool { get }
    /// 前台应用 + 焦点窗口标题（不需要辅助功能权限也能拿到应用信息，窗口标题需要）。
    func focusInfo() -> FocusInfo?
    /// 当前焦点是不是可写的文本输入框（含“焦点在容器上就往下找”的扫描）。
    func textTarget() -> TextTarget
    /// 自由提问用的选区快照：只认 AX 确认的选中文字。
    func selectionSnapshot() -> SelectionSnapshot
}

public final class SystemAccessibility: AccessibilityReading {
    /// 往下找输入框最多看多少个节点，防止遇到巨大的网页树时卡住。
    static let maxDescendantScanNodes = 1500
    /// 单次 AX 调用的超时：目标应用卡住时不能拖住听写流程。
    static let messagingTimeout: Float = 0.4

    public init() {}

    public var isTrusted: Bool { AXIsProcessTrusted() }

    // MARK: AX 属性读取

    private func copy(_ element: AXUIElement, _ attribute: String) -> CFTypeRef? {
        var value: CFTypeRef?
        guard AXUIElementCopyAttributeValue(element, attribute as CFString, &value) == .success else { return nil }
        return value
    }

    private func string(_ element: AXUIElement, _ attribute: String) -> String {
        (copy(element, attribute) as? String) ?? ""
    }

    private func bool(_ element: AXUIElement, _ attribute: String, default fallback: Bool) -> Bool {
        guard let value = copy(element, attribute) else { return fallback }
        if let number = value as? NSNumber { return number.boolValue }
        return fallback
    }

    private func isSettable(_ element: AXUIElement, _ attribute: String) -> Bool {
        var settable: DarwinBoolean = false
        guard AXUIElementIsAttributeSettable(element, attribute as CFString, &settable) == .success else { return false }
        return settable.boolValue
    }

    private func children(_ element: AXUIElement) -> [AXUIElement] {
        (copy(element, kAXChildrenAttribute) as? [AXUIElement]) ?? []
    }

    private func snapshot(_ element: AXUIElement) -> AXElementSnapshot {
        AXElementSnapshot(
            role: string(element, kAXRoleAttribute),
            subrole: string(element, kAXSubroleAttribute),
            enabled: bool(element, kAXEnabledAttribute, default: true),
            editable: bool(element, "AXEditable", default: false),
            valueSettable: isSettable(element, kAXValueAttribute)
        )
    }

    private func hasSelectedTextRange(_ element: AXUIElement) -> Bool {
        copy(element, kAXSelectedTextRangeAttribute) != nil
    }

    private func isActiveTextInput(_ element: AXUIElement) -> Bool {
        guard PasteTargetPolicy.isWritableTextInput(snapshot(element)) else { return false }
        return bool(element, kAXFocusedAttribute, default: false) || hasSelectedTextRange(element)
    }

    // MARK: 找焦点元素

    private func frontmostApplication() -> NSRunningApplication? {
        NSWorkspace.shared.frontmostApplication
    }

    private func applicationElement(_ app: NSRunningApplication) -> AXUIElement {
        let element = AXUIElementCreateApplication(app.processIdentifier)
        AXUIElementSetMessagingTimeout(element, Self.messagingTimeout)
        return element
    }

    private func focusedElement() -> AXUIElement? {
        let systemWide = AXUIElementCreateSystemWide()
        AXUIElementSetMessagingTimeout(systemWide, Self.messagingTimeout)
        if let value = copy(systemWide, kAXFocusedUIElementAttribute) { return (value as! AXUIElement) }
        if let app = frontmostApplication(), let value = copy(applicationElement(app), kAXFocusedUIElementAttribute) {
            return (value as! AXUIElement)
        }
        return nil
    }

    /// 广度优先找第一个“正在编辑”的输入框；`allowInactiveFallback` 时没找到就退而求其次用第一个可写的。
    private func firstTextInputDescendant(of root: AXUIElement, allowInactiveFallback: Bool) -> AXUIElement? {
        var queue = [root]
        var fallback: AXUIElement?
        var scanned = 0
        var head = 0
        while head < queue.count && scanned < Self.maxDescendantScanNodes {
            let element = queue[head]
            head += 1
            scanned += 1
            if isActiveTextInput(element) { return element }
            if allowInactiveFallback && fallback == nil && PasteTargetPolicy.isWritableTextInput(snapshot(element)) {
                fallback = element
            }
            queue.append(contentsOf: children(element))
        }
        return fallback
    }

    private func textInputFromFrontmostApp() -> AXUIElement? {
        guard let app = frontmostApplication() else { return nil }
        let appElement = applicationElement(app)
        if let window = copy(appElement, kAXFocusedWindowAttribute),
           let found = firstTextInputDescendant(of: window as! AXUIElement, allowInactiveFallback: true) {
            return found
        }
        return firstTextInputDescendant(of: appElement, allowInactiveFallback: true)
    }

    /// 焦点元素本身可写就用它；焦点在容器（网页、分组、滚动区、窗口）上就往下找；没有焦点元素就扫前台应用。
    private func focusedElementForTextOperations() -> (element: AXUIElement, usedDescendantScan: Bool)? {
        if let focused = focusedElement() {
            if PasteTargetPolicy.isWritableTextInput(snapshot(focused)) { return (focused, false) }
            let info = snapshot(focused)
            if PasteTargetPolicy.isTextInputContainerRole(role: info.role, subrole: info.subrole),
               let descendant = firstTextInputDescendant(of: focused, allowInactiveFallback: false) {
                return (descendant, true)
            }
            return (focused, false)
        }
        if let scanned = textInputFromFrontmostApp() { return (scanned, true) }
        return nil
    }

    // MARK: AccessibilityReading

    public func focusInfo() -> FocusInfo? {
        guard let app = frontmostApplication() else { return nil }
        var title = ""
        if isTrusted, let window = copy(applicationElement(app), kAXFocusedWindowAttribute) {
            title = string(window as! AXUIElement, kAXTitleAttribute)
        }
        return FocusInfo(
            bundleId: app.bundleIdentifier ?? "", appName: app.localizedName ?? "",
            processId: app.processIdentifier, windowTitle: title
        )
    }

    public func textTarget() -> TextTarget {
        let app = frontmostApplication()
        let appFamily = app?.bundleIdentifier ?? app?.localizedName ?? ""
        let processId = app?.processIdentifier ?? 0
        guard isTrusted else {
            return TextTarget(success: false, reason: PasteTargetPolicy.permissionMissingReason, appFamily: appFamily, processId: processId)
        }
        let found = focusedElementForTextOperations()
        return PasteTargetPolicy.evaluate(
            focused: found.map { snapshot($0.element) }, usedDescendantScan: found?.usedDescendantScan ?? false,
            appFamily: appFamily, processId: processId
        )
    }

    public func selectionSnapshot() -> SelectionSnapshot {
        let info = focusInfo()
        guard isTrusted else { return SelectionSnapshot(focusInfo: info) }
        // 读选区时，没有焦点元素就退到“扫前台应用里的输入框”。
        guard let element = focusedElement() ?? textInputFromFrontmostApp() else { return SelectionSnapshot(focusInfo: info) }
        let selected = string(element, kAXSelectedTextAttribute)
        let hasText = !selected.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        guard hasText else { return SelectionSnapshot(focusInfo: info) }
        return SelectionSnapshot(selectedText: selected, source: .accessibility, confidence: .confirmed, focusInfo: info)
    }
}

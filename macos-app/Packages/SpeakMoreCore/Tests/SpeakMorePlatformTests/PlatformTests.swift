import XCTest
import AppKit
@testable import SpeakMorePlatform
@testable import SpeakMoreCore

// MARK: - 假的系统接口

final class FakeAccessibility: AccessibilityReading, @unchecked Sendable {
    var isTrusted = true
    var target = TextTarget(success: true, source: .accessibility, confidence: .confirmed, reason: "ok", appFamily: "com.test", processId: 5)
    var focus: FocusInfo? = FocusInfo(bundleId: "com.test", appName: "Test", processId: 5)
    var selection = SelectionSnapshot()
    /// 切回应用后前台变成这个（nil = 切不回去）。
    var focusAfterActivation: FocusInfo?
    private(set) var activatedProcessIds: [Int32] = []
    func focusInfo() -> FocusInfo? { focus }
    func activateApplication(processId: Int32) async -> Bool {
        activatedProcessIds.append(processId)
        guard let focusAfterActivation else { return false }
        focus = focusAfterActivation
        target = TextTarget(success: true, source: .accessibility, confidence: .confirmed, reason: "ok", appFamily: focusAfterActivation.bundleId, processId: focusAfterActivation.processId)
        return true
    }
    func textTarget() -> TextTarget { target }
    func selectionSnapshot() -> SelectionSnapshot { selection }
}

final class FakePasteboard: PasteboardProviding, @unchecked Sendable {
    var text: String?
    var changeCount = 0
    private(set) var writes: [String] = []
    private(set) var restoreCount = 0
    /// 在“写入之后、恢复之前”替用户改剪贴板。
    var userCopiesDuringPaste: String?

    func snapshot() -> PasteboardSnapshot {
        PasteboardSnapshot(items: text.map { [[.init(type: "public.utf8-plain-text", data: Data($0.utf8))]] } ?? [], changeCount: changeCount)
    }

    func write(text: String) -> Int {
        self.text = text
        writes.append(text)
        changeCount += 1
        return changeCount
    }

    func restore(_ snapshot: PasteboardSnapshot) {
        restoreCount += 1
        text = snapshot.items.first?.first.map { String(decoding: $0.data, as: UTF8.self) }
        changeCount += 1
    }
}

final class FakeKeystroke: PasteKeystrokeSending, @unchecked Sendable {
    var succeeds = true
    private(set) var sent = 0
    var onSend: (() -> Void)?
    func sendPaste() -> Bool { sent += 1; onSend?(); return succeeds }
}

final class PasteServiceTests: XCTestCase {
    private func makeService(
        _ accessibility: FakeAccessibility, _ pasteboard: FakePasteboard, _ keystroke: FakeKeystroke,
        sleeps: SleepRecorder = SleepRecorder()
    ) -> PasteService {
        PasteService(accessibility: accessibility, pasteboard: pasteboard, keystroke: keystroke, settleDelay: 0.18, sleep: { await sleeps.record($0) })
    }

    actor SleepRecorder {
        private(set) var delays: [TimeInterval] = []
        func record(_ value: TimeInterval) { delays.append(value) }
    }

    func testPasteWritesTextSendsCommandVThenRestoresClipboard() async {
        let accessibility = FakeAccessibility()
        let pasteboard = FakePasteboard()
        pasteboard.text = "用户原来复制的内容"
        let keystroke = FakeKeystroke()
        var seenDuringPaste: String?
        keystroke.onSend = { seenDuringPaste = pasteboard.text }
        let sleeps = SleepRecorder()

        let outcome = await makeService(accessibility, pasteboard, keystroke, sleeps: sleeps)
            .paste("听写结果", startFocus: FocusInfo(bundleId: "com.test", processId: 5))

        XCTAssertTrue(outcome.success)
        XCTAssertEqual(seenDuringPaste, "听写结果", "按下 Cmd+V 的时候剪贴板里必须是结果")
        XCTAssertEqual(pasteboard.text, "用户原来复制的内容", "之后要恢复")
        XCTAssertEqual(keystroke.sent, 1)
        let delays = await sleeps.delays
        XCTAssertEqual(delays, [0.18], "要等目标应用读走剪贴板再恢复")
    }

    func testNoTrustedTargetNeverTouchesClipboardOrKeys() async {
        let accessibility = FakeAccessibility()
        accessibility.target = TextTarget(success: false, reason: PasteTargetPolicy.targetUnavailableReason, appFamily: "com.test", processId: 5)
        // 前台已经换成别的应用，而且切不回去：不放行。
        accessibility.focus = FocusInfo(bundleId: "com.other", processId: 9)
        let pasteboard = FakePasteboard()
        pasteboard.text = "原内容"
        let keystroke = FakeKeystroke()

        let outcome = await makeService(accessibility, pasteboard, keystroke).paste("x", startFocus: FocusInfo(bundleId: "com.test", processId: 5))

        XCTAssertFalse(outcome.success)
        XCTAssertEqual(outcome.reason, PasteTargetPolicy.targetUnavailableReason)
        XCTAssertTrue(pasteboard.writes.isEmpty)
        XCTAssertEqual(keystroke.sent, 0)
        XCTAssertEqual(pasteboard.text, "原内容")
    }

    func testFocusChangedSinceRecordingStartedBlocksPaste() async {
        let accessibility = FakeAccessibility()
        let pasteboard = FakePasteboard()
        let keystroke = FakeKeystroke()
        let outcome = await makeService(accessibility, pasteboard, keystroke)
            .paste("x", startFocus: FocusInfo(bundleId: "com.other", processId: 9))
        XCTAssertFalse(outcome.success)
        XCTAssertEqual(outcome.reason, PasteTargetPolicy.targetChangedReason)
        XCTAssertEqual(keystroke.sent, 0)
    }

    func testInjectionFailureRestoresImmediately() async {
        let pasteboard = FakePasteboard()
        pasteboard.text = "原内容"
        let keystroke = FakeKeystroke()
        keystroke.succeeds = false
        let sleeps = SleepRecorder()

        let outcome = await makeService(FakeAccessibility(), pasteboard, keystroke, sleeps: sleeps).paste("结果", startFocus: nil)

        XCTAssertFalse(outcome.success)
        XCTAssertEqual(outcome.reason, "macos_event_injection_failed")
        XCTAssertEqual(pasteboard.text, "原内容")
        let delays = await sleeps.delays
        XCTAssertTrue(delays.isEmpty, "注入失败没必要再等")
    }

    func testClipboardChangedByUserIsNotOverwritten() async {
        let pasteboard = FakePasteboard()
        pasteboard.text = "原内容"
        let keystroke = FakeKeystroke()
        // 粘贴等待期间用户自己复制了别的东西。
        keystroke.onSend = { pasteboard.text = "用户刚复制的"; pasteboard.changeCount += 1 }

        let outcome = await makeService(FakeAccessibility(), pasteboard, keystroke).paste("结果", startFocus: nil)

        XCTAssertTrue(outcome.success)
        XCTAssertEqual(pasteboard.text, "用户刚复制的")
        XCTAssertEqual(pasteboard.restoreCount, 0)
    }

    func testFocusDriftedAwayReactivatesLockedAppThenPastes() async {
        let locked = FocusInfo(bundleId: "com.google.Chrome", appName: "Chrome", processId: 20)
        let accessibility = FakeAccessibility()
        // 现在前台是别的应用；AX 在那个应用里也确认不了输入框。
        accessibility.focus = FocusInfo(bundleId: "com.apple.Safari", appName: "Safari", processId: 30)
        accessibility.target = TextTarget(success: false, reason: PasteTargetPolicy.targetUnavailableReason, appFamily: "com.apple.Safari", processId: 30)
        accessibility.focusAfterActivation = locked
        let pasteboard = FakePasteboard()
        pasteboard.text = "原内容"
        let keystroke = FakeKeystroke()
        let sleeps = SleepRecorder()

        let outcome = await makeService(accessibility, pasteboard, keystroke, sleeps: sleeps).paste("听写结果", startFocus: locked)

        XCTAssertTrue(outcome.success)
        XCTAssertEqual(accessibility.activatedProcessIds, [20], "要先把录音开始时的应用切回前台")
        XCTAssertEqual(keystroke.sent, 1)
        XCTAssertEqual(pasteboard.text, "原内容")
        let delays = await sleeps.delays
        XCTAssertEqual(delays, [PasteService.reactivateDelay, 0.18], "切回后先等应用恢复焦点，再发 Cmd+V，最后等它读走剪贴板")
    }

    func testCannotReactivateLockedAppFallsBackToPanel() async {
        let locked = FocusInfo(bundleId: "com.google.Chrome", appName: "Chrome", processId: 20)
        let accessibility = FakeAccessibility()
        accessibility.focus = FocusInfo(bundleId: "com.apple.Safari", appName: "Safari", processId: 30)
        accessibility.target = TextTarget(success: false, reason: PasteTargetPolicy.targetUnavailableReason, appFamily: "com.apple.Safari", processId: 30)
        accessibility.focusAfterActivation = nil  // 应用关了 / 系统不让切
        let pasteboard = FakePasteboard()
        pasteboard.text = "原内容"
        let keystroke = FakeKeystroke()

        let outcome = await makeService(accessibility, pasteboard, keystroke).paste("听写结果", startFocus: locked)

        XCTAssertFalse(outcome.success)
        XCTAssertEqual(accessibility.activatedProcessIds, [20])
        XCTAssertEqual(keystroke.sent, 0, "前台不是锁定的应用时不能发 Cmd+V")
        XCTAssertTrue(pasteboard.writes.isEmpty)
    }

    func testNoReactivationWhenAppUnchanged() async {
        let accessibility = FakeAccessibility()
        accessibility.target = TextTarget(success: false, reason: PasteTargetPolicy.targetUnavailableReason, appFamily: "com.test", processId: 5)
        let outcome = await makeService(accessibility, FakePasteboard(), FakeKeystroke()).paste("x", startFocus: FocusInfo(bundleId: "com.test", appName: "Test", processId: 5))
        XCTAssertTrue(outcome.success, "前台没换：AX 确认不了也走同一应用兜底直接粘贴")
        XCTAssertTrue(accessibility.activatedProcessIds.isEmpty)
    }

    func testEmptyTextRejected() async {
        let outcome = await makeService(FakeAccessibility(), FakePasteboard(), FakeKeystroke()).paste("", startFocus: nil)
        XCTAssertEqual(outcome, .failure("empty_text"))
    }
}

// MARK: - 真实剪贴板（用私有命名剪贴板，不动用户的）

final class SystemPasteboardTests: XCTestCase {
    private func makePasteboard() -> (NSPasteboard, SystemPasteboard) {
        let native = NSPasteboard(name: NSPasteboard.Name("cn.yui.speakmore.tests.\(UUID().uuidString)"))
        return (native, SystemPasteboard(pasteboard: native))
    }

    func testSnapshotRestoreKeepsMultipleTypesAndItems() {
        let (native, board) = makePasteboard()
        defer { native.releaseGlobally() }

        let first = NSPasteboardItem()
        first.setString("纯文本", forType: .string)
        first.setData(Data("<b>富文本</b>".utf8), forType: .html)
        let second = NSPasteboardItem()
        second.setData(Data([0x89, 0x50, 0x4E, 0x47]), forType: .png)
        native.clearContents()
        native.writeObjects([first, second])

        let snapshot = board.snapshot()
        XCTAssertEqual(snapshot.items.count, 2)

        let written = board.write(text: "听写结果")
        XCTAssertEqual(native.string(forType: .string), "听写结果")
        XCTAssertEqual(written, native.changeCount)

        board.restore(snapshot)
        let restored = native.pasteboardItems ?? []
        XCTAssertEqual(restored.count, 2)
        XCTAssertEqual(restored[0].string(forType: .string), "纯文本")
        XCTAssertEqual(restored[0].data(forType: .html), Data("<b>富文本</b>".utf8))
        XCTAssertEqual(restored[1].data(forType: .png), Data([0x89, 0x50, 0x4E, 0x47]))
    }

    func testRestoreEmptyClipboardClearsIt() {
        let (native, board) = makePasteboard()
        defer { native.releaseGlobally() }
        native.clearContents()
        let empty = board.snapshot()
        XCTAssertTrue(empty.items.isEmpty)
        board.write(text: "临时")
        board.restore(empty)
        XCTAssertNil(native.string(forType: .string))
    }
}

// MARK: - 需要系统权限的部分：没有权限时必须优雅失败

final class SystemIntegrationSmokeTests: XCTestCase {
    func testAccessibilityWithoutTrustFailsGracefully() {
        let accessibility = SystemAccessibility()
        guard !accessibility.isTrusted else { return }  // 开发机上授权过就不测这一条
        let target = accessibility.textTarget()
        XCTAssertFalse(target.success)
        XCTAssertEqual(target.reason, PasteTargetPolicy.permissionMissingReason)
        XCTAssertEqual(accessibility.selectionSnapshot().selectedText, "")
    }

    func testFocusInfoDoesNotCrash() {
        _ = SystemAccessibility().focusInfo()
    }

    func testPermissionsSnapshotAndSettingsLinks() {
        let snapshot = Permissions.current()
        XCTAssertEqual(snapshot.isComplete, snapshot.microphone == .granted && snapshot.accessibility && snapshot.inputMonitoring)
        XCTAssertEqual(SystemPermission.accessibility.settingsURL.absoluteString, "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility")
        XCTAssertEqual(SystemPermission.inputMonitoring.settingsURL.absoluteString, "x-apple.systempreferences:com.apple.preference.security?Privacy_ListenEvent")
        XCTAssertEqual(SystemPermission.microphone.settingsURL.absoluteString, "x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone")
    }

    func testHotkeyListenerStartStopIsSafeWithAndWithoutPermission() {
        let listener = GlobalHotkeyListener { _ in }
        if CGPreflightListenEventAccess() {
            XCTAssertTrue(listener.start())
            XCTAssertTrue(listener.isRunning)
            XCTAssertTrue(listener.start(), "重复启动是空操作")
        } else {
            XCTAssertFalse(listener.start(), "没有输入监控权限时应返回 false 而不是崩溃")
            XCTAssertFalse(listener.isRunning)
        }
        listener.stop()
        XCTAssertFalse(listener.isRunning)
        listener.stop()
    }

    func testPasteKeystrokeRefusedWithoutAccessibility() {
        guard !AXIsProcessTrusted() else { return }
        XCTAssertFalse(CGEventPasteKeystroke().sendPaste(), "没有辅助功能权限时不能假装发出了按键")
    }
}

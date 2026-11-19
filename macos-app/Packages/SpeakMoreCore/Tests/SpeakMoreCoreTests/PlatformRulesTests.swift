import XCTest
@testable import SpeakMoreCore

/// 键盘事件翻译：期望值来自 Electron 版 `macos-option-listener.c` 原样回放同一组事件的输出（在 Mac 上编译运行得到）。
final class MacKeyInterpreterTests: XCTestCase {
    private typealias Mask = MacKeyInterpreter.FlagMask
    private let ralt = Mask.rightOption
    private let rcmd = Mask.rightCommand
    private let shift = Mask.shift
    private let altMask: UInt64 = 0x80000
    private let cmdMask: UInt64 = 0x100000

    private func names(_ events: [RawKeyEvent]) -> [String] {
        events.map { "\($0.key.rawValue):\($0.isDown ? "down" : "up")" }
    }

    private func run(_ steps: [(code: Int64, flags: UInt64)]) -> [String] {
        var interpreter = MacKeyInterpreter()
        return steps.flatMap { names(interpreter.flagsChanged(keyCode: $0.code, flags: $0.flags)) }
    }

    func testOptionOnly() {
        XCTAssertEqual(run([(61, ralt | altMask), (61, 0)]), ["RightAlt:down", "RightAlt:up"])
    }

    func testLeftOptionIgnored() {
        XCTAssertEqual(run([(58, 0x20 | altMask), (58, 0)]), [])
    }

    func testOptionPlusRightCommand() {
        XCTAssertEqual(
            run([(61, ralt | altMask), (54, ralt | rcmd | altMask | cmdMask), (54, ralt | altMask), (61, 0)]),
            ["RightAlt:down", "RightCommand:down", "RightCommand:up", "RightAlt:up"]
        )
    }

    func testReleasingOptionFirstReleasesShift() {
        XCTAssertEqual(
            run([(61, ralt | altMask), (60, ralt | altMask | shift), (61, shift), (56, 0)]),
            ["RightAlt:down", "RightShift:down", "RightAlt:up", "RightShift:up"]
        )
    }

    func testLeftCommandWithOptionIgnored() {
        XCTAssertEqual(
            run([(61, ralt | altMask), (55, ralt | altMask | 0x8 | cmdMask), (55, ralt | altMask), (61, 0)]),
            ["RightAlt:down", "RightAlt:up"]
        )
    }

    func testShiftWithoutOptionProducesNothing() {
        XCTAssertEqual(run([(56, shift), (56, 0)]), [])
    }

    func testCommandHeldThenOptionReleased() {
        XCTAssertEqual(
            run([(61, ralt | altMask), (54, ralt | rcmd | altMask | cmdMask), (61, rcmd | cmdMask), (54, 0)]),
            ["RightAlt:down", "RightCommand:down", "RightAlt:up", "RightCommand:up"]
        )
    }

    func testBothModifiers() {
        XCTAssertEqual(
            run([
                (61, ralt | altMask), (60, ralt | altMask | shift), (54, ralt | rcmd | altMask | cmdMask | shift),
                (60, ralt | rcmd | altMask | cmdMask), (61, 0), (54, 0),
            ]),
            ["RightAlt:down", "RightShift:down", "RightCommand:down", "RightShift:up", "RightAlt:up", "RightCommand:up"]
        )
    }

    func testEscapeOnlyFiresOnFirstPress() {
        var interpreter = MacKeyInterpreter()
        XCTAssertEqual(names(interpreter.keyEvent(keyCode: 53, isDown: true, isRepeat: false)), ["Escape:down"])
        XCTAssertEqual(names(interpreter.keyEvent(keyCode: 53, isDown: true, isRepeat: true)), [])
        XCTAssertEqual(names(interpreter.keyEvent(keyCode: 53, isDown: false, isRepeat: false)), ["Escape:up"])
        XCTAssertEqual(names(interpreter.keyEvent(keyCode: 53, isDown: false, isRepeat: false)), [])
    }

    func testOtherKeysIgnored() {
        var interpreter = MacKeyInterpreter()
        XCTAssertEqual(interpreter.keyEvent(keyCode: 49, isDown: true, isRepeat: false), [])
        XCTAssertEqual(interpreter.keyEvent(keyCode: 49, isDown: false, isRepeat: false), [])
    }

    /// 解释器 + 快捷键守卫串起来：右 Option + 右 Command 松手 = 自由提问；右 Option + Shift = 翻译。
    func testInterpreterFeedsGuardIntoIntents() {
        func intent(after steps: [(Int64, UInt64)]) -> ShortcutIntent? {
            var interpreter = MacKeyInterpreter()
            var guardState = ShortcutGuard()
            var result: ShortcutIntent?
            for step in steps {
                for event in interpreter.flagsChanged(keyCode: step.0, flags: step.1) {
                    if case .toggleRecording(let intent) = guardState.handle(event, voiceStatus: .idle).action { result = intent }
                }
            }
            return result
        }
        XCTAssertEqual(intent(after: [(61, ralt | altMask), (61, 0)]), .dictate)
        XCTAssertEqual(intent(after: [(61, ralt | altMask), (54, ralt | rcmd | altMask | cmdMask), (54, ralt | altMask), (61, 0)]), .ask)
        XCTAssertEqual(intent(after: [(61, ralt | altMask), (60, ralt | altMask | shift), (60, ralt | altMask), (61, 0)]), .translate)
        XCTAssertNil(intent(after: [(58, 0x20 | altMask), (58, 0)]), "左侧 Option 不触发任何操作")
        XCTAssertEqual(intent(after: [(61, ralt | altMask), (55, ralt | altMask | 0x8 | cmdMask), (55, ralt | altMask), (61, 0)]), .dictate, "左侧 Command 不能触发自由提问")
    }
}

final class PasteTargetPolicyTests: XCTestCase {
    private func element(_ role: String, subrole: String = "", enabled: Bool = true, editable: Bool = false, settable: Bool = false) -> AXElementSnapshot {
        AXElementSnapshot(role: role, subrole: subrole, enabled: enabled, editable: editable, valueSettable: settable)
    }

    func testTextInputRoles() {
        for role in ["AXTextArea", "AXTextField", "AXComboBox", "AXSearchField"] {
            XCTAssertTrue(PasteTargetPolicy.isTextInputRole(role: role, subrole: ""), role)
        }
        XCTAssertTrue(PasteTargetPolicy.isTextInputRole(role: "AXGroup", subrole: "AXSearchField"))
        XCTAssertFalse(PasteTargetPolicy.isTextInputRole(role: "AXButton", subrole: ""))
        XCTAssertTrue(PasteTargetPolicy.isTextInputContainerRole(role: "AXWebArea", subrole: ""))
        XCTAssertTrue(PasteTargetPolicy.isTextInputContainerRole(role: "AXUnknown", subrole: "AXStandardWindow"))
    }

    func testWritableNeedsEnabledRoleAndEditable() {
        XCTAssertTrue(PasteTargetPolicy.isWritableTextInput(element("AXTextField", editable: true)))
        XCTAssertTrue(PasteTargetPolicy.isWritableTextInput(element("AXTextArea", settable: true)))
        XCTAssertFalse(PasteTargetPolicy.isWritableTextInput(element("AXTextArea")), "只读")
        XCTAssertFalse(PasteTargetPolicy.isWritableTextInput(element("AXTextArea", enabled: false, editable: true)), "未启用")
        XCTAssertFalse(PasteTargetPolicy.isWritableTextInput(element("AXButton", editable: true)), "不是输入框")
    }

    func testEvaluateConfirmedTarget() {
        let target = PasteTargetPolicy.evaluate(
            focused: element("AXTextArea", editable: true, settable: true), usedDescendantScan: true,
            appFamily: "com.apple.Notes", processId: 42
        )
        XCTAssertTrue(target.success)
        XCTAssertEqual(target.source, .accessibility)
        XCTAssertEqual(target.confidence, .confirmed)
        XCTAssertEqual(target.signals, ["frontmost_app", "ax_descendant_scan", "role:AXTextArea", "ax_editable", "ax_value_settable"])
    }

    func testEvaluateRejectsReadOnlyAndMissing() {
        let readOnly = PasteTargetPolicy.evaluate(focused: element("AXTextArea"), usedDescendantScan: false, appFamily: "a", processId: 1)
        XCTAssertFalse(readOnly.success)
        XCTAssertEqual(readOnly.reason, PasteTargetPolicy.targetUnavailableReason)
        let none = PasteTargetPolicy.evaluate(focused: nil, usedDescendantScan: false, appFamily: "a", processId: 1)
        XCTAssertFalse(none.success)
        XCTAssertEqual(none.reason, PasteTargetPolicy.targetUnavailableReason)
    }

    private func confirmed(app: String, pid: Int32) -> TextTarget {
        TextTarget(success: true, source: .accessibility, confidence: .confirmed, reason: "ok", appFamily: app, processId: pid)
    }

    func testFocusChangeAfterRecordingStartBlocksPaste() {
        let start = FocusInfo(bundleId: "com.apple.Notes", appName: "Notes", processId: 10)
        XCTAssertTrue(PasteTargetPolicy.resolveForPaste(axTarget: confirmed(app: "com.apple.Notes", pid: 10), start: start, readCurrentFocus: { nil }).success)

        let switchedApp = PasteTargetPolicy.resolveForPaste(axTarget: confirmed(app: "com.apple.Safari", pid: 11), start: start, readCurrentFocus: { nil })
        XCTAssertFalse(switchedApp.success)
        XCTAssertEqual(switchedApp.reason, PasteTargetPolicy.targetChangedReason)

        let sameBundleNewProcess = PasteTargetPolicy.resolveForPaste(axTarget: confirmed(app: "com.apple.Notes", pid: 99), start: start, readCurrentFocus: { nil })
        XCTAssertFalse(sameBundleNewProcess.success)

        // 没有开始时的焦点信息（比如开始时没权限）就不做“换没换”的比较。
        XCTAssertTrue(PasteTargetPolicy.resolveForPaste(axTarget: confirmed(app: "x", pid: 1), start: nil, readCurrentFocus: { nil }).success)
    }

    private let failed = TextTarget(success: false, reason: PasteTargetPolicy.targetUnavailableReason, appFamily: "com.tencent.xinWeChat", processId: 7)

    func testWeChatFallbackAllowedForSameWindow() {
        let focus = FocusInfo(bundleId: "com.tencent.xinWeChat", appName: "微信", processId: 7, windowTitle: "文件传输助手")
        let result = PasteTargetPolicy.resolveForPaste(axTarget: failed, start: focus, readCurrentFocus: { focus })
        XCTAssertTrue(result.success)
        XCTAssertEqual(result.source, .appCompat)
        XCTAssertEqual(result.confidence, .weak)
        XCTAssertEqual(result.signals, ["process:wechat", "same_frontmost_app", "window_title_present"])
    }

    func testWeChatFallbackBlockedCases() {
        let chat = FocusInfo(bundleId: "com.tencent.xinWeChat", appName: "微信", processId: 7, windowTitle: "聊天")
        let settings = FocusInfo(bundleId: "com.tencent.xinWeChat", appName: "微信", processId: 7, windowTitle: "设置")
        let login = FocusInfo(bundleId: "com.tencent.xinWeChat", appName: "WeChat", processId: 7, windowTitle: "Sign in")
        let other = FocusInfo(bundleId: "com.apple.Notes", appName: "Notes", processId: 3)
        let relaunched = FocusInfo(bundleId: "com.tencent.xinWeChat", appName: "微信", processId: 8, windowTitle: "聊天")

        XCTAssertEqual(PasteTargetPolicy.resolveForPaste(axTarget: failed, start: chat, readCurrentFocus: { settings }).reason, "macos_app_compat_blocked_window_title")
        XCTAssertEqual(PasteTargetPolicy.resolveForPaste(axTarget: failed, start: chat, readCurrentFocus: { login }).reason, "macos_app_compat_blocked_window_title")
        XCTAssertEqual(PasteTargetPolicy.resolveForPaste(axTarget: failed, start: other, readCurrentFocus: { chat }).reason, "macos_app_compat_start_not_wechat")
        XCTAssertEqual(PasteTargetPolicy.resolveForPaste(axTarget: failed, start: chat, readCurrentFocus: { relaunched }).reason, PasteTargetPolicy.targetChangedReason)
        XCTAssertEqual(PasteTargetPolicy.resolveForPaste(axTarget: failed, start: nil, readCurrentFocus: { chat }).reason, "macos_app_compat_start_not_wechat")

        // 不是微信：同一个应用没变就走“同一应用兜底”放行（见下面的专门测试）；前台换了就不放行。
        let notes = TextTarget(success: false, reason: PasteTargetPolicy.targetUnavailableReason, appFamily: "com.apple.Notes", processId: 3)
        let switched = FocusInfo(bundleId: "com.apple.Safari", appName: "Safari", processId: 4)
        let denied = PasteTargetPolicy.resolveForPaste(axTarget: notes, start: other, readCurrentFocus: { switched })
        XCTAssertFalse(denied.success)
        XCTAssertEqual(denied.reason, PasteTargetPolicy.targetUnavailableReason)
    }

    func testSameApplicationFallbackPastesWhenAXCannotConfirmButAppUnchanged() {
        // Chrome / Electron 类应用默认不向辅助功能暴露输入框：AX 确认不了，但前台还是录音开始时的应用，照样放行。
        let chrome = FocusInfo(bundleId: "com.google.Chrome", appName: "Chrome", processId: 20, windowTitle: "某个网页")
        let unconfirmed = TextTarget(success: false, reason: PasteTargetPolicy.targetUnavailableReason, appFamily: "com.google.Chrome", processId: 20)
        let result = PasteTargetPolicy.resolveForPaste(axTarget: unconfirmed, start: chrome, readCurrentFocus: { chrome })
        XCTAssertTrue(result.success)
        XCTAssertEqual(result.source, .sameApplication)
        XCTAssertEqual(result.confidence, .weak)
        XCTAssertEqual(result.reason, "macos_same_app_weak")
    }

    func testSameApplicationFallbackRefusesSystemSurfacesAndBlockedTitles() {
        func resolve(_ bundle: String, title: String = "窗口") -> TextTarget {
            let focus = FocusInfo(bundleId: bundle, appName: "x", processId: 5, windowTitle: title)
            let failed = TextTarget(success: false, reason: PasteTargetPolicy.targetUnavailableReason, appFamily: bundle, processId: 5)
            return PasteTargetPolicy.resolveForPaste(axTarget: failed, start: focus, readCurrentFocus: { focus })
        }
        for bundle in ["com.apple.finder", "com.apple.dock", "com.apple.loginwindow", "cn.yui.speakmore.native", "com.github.Electron"] {
            XCTAssertFalse(resolve(bundle).success, bundle)
        }
        for title in ["设置", "登录", "Sign in to continue", "Preferences", "文件预览"] {
            XCTAssertFalse(resolve("com.google.Chrome", title: title).success, title)
        }
        XCTAssertTrue(resolve("com.google.Chrome", title: "普通网页").success)
    }

    func testSameApplicationFallbackNeedsBothFocusSnapshots() {
        let failed = TextTarget(success: false, reason: PasteTargetPolicy.targetUnavailableReason, appFamily: "com.google.Chrome", processId: 20)
        let chrome = FocusInfo(bundleId: "com.google.Chrome", appName: "Chrome", processId: 20)
        XCTAssertFalse(PasteTargetPolicy.resolveForPaste(axTarget: failed, start: nil, readCurrentFocus: { chrome }).success, "录音开始时没拿到前台信息，不能凭空放行")
        XCTAssertFalse(PasteTargetPolicy.resolveForPaste(axTarget: failed, start: chrome, readCurrentFocus: { nil }).success)
    }

    func testWeChatBlockedTitleIsNotOverriddenBySameApplicationFallback() {
        let failed = TextTarget(success: false, reason: PasteTargetPolicy.targetUnavailableReason, appFamily: "com.tencent.xinWeChat", processId: 7)
        let settings = FocusInfo(bundleId: "com.tencent.xinWeChat", appName: "微信", processId: 7, windowTitle: "设置")
        let result = PasteTargetPolicy.resolveForPaste(axTarget: failed, start: settings, readCurrentFocus: { settings })
        XCTAssertFalse(result.success)
        XCTAssertEqual(result.reason, "macos_app_compat_blocked_window_title")
    }

    func testWeChatIdentification() {
        for value in ["com.tencent.xinWeChat", "WeChat", "微信", "Weixin", "com.tencent.xin"] {
            XCTAssertTrue(PasteTargetPolicy.isWeChat(value), value)
        }
        XCTAssertFalse(PasteTargetPolicy.isWeChat("com.apple.Notes"))
        XCTAssertFalse(PasteTargetPolicy.isWeChat(""))
    }
}

@MainActor
final class VoiceDeliveryTests: XCTestCase {
    private final class Recorder: @unchecked Sendable {
        var pasted: [(String, FocusInfo?)] = []
        var panel: [String] = []
        var pasteResult = true
    }

    private func delivery(_ recorder: Recorder) -> VoiceResultDelivery {
        VoiceResultDelivery(
            paste: { text, focus in recorder.pasted.append((text, focus)); return recorder.pasteResult },
            showPanel: { recorder.panel.append($0) }
        )
    }

    private func task(_ mode: VoiceMode, _ delivery: VoiceTaskDelivery, focus: FocusInfo? = FocusInfo(bundleId: "a")) -> VoiceTask {
        VoiceTask(mode: mode, selectedText: "", source: .none, confidence: .none, focusInfo: focus, delivery: delivery)
    }

    func testDictationPastesAndSkipsPanel() async {
        let recorder = Recorder()
        await delivery(recorder).deliver("你好", task: task(.dictate, .paste), mode: .dictate)
        XCTAssertEqual(recorder.pasted.map(\.0), ["你好"])
        XCTAssertEqual(recorder.pasted.first?.1?.bundleId, "a")
        XCTAssertTrue(recorder.panel.isEmpty)
    }

    func testPasteFailureFallsBackToPanel() async {
        let recorder = Recorder()
        recorder.pasteResult = false
        await delivery(recorder).deliver("  结果 \n", task: task(.translate, .paste), mode: .translate)
        XCTAssertEqual(recorder.pasted.count, 1)
        XCTAssertEqual(recorder.panel, ["结果"], "面板里的文字要去掉首尾空白")
    }

    func testAskNeverPastes() async {
        let recorder = Recorder()
        await delivery(recorder).deliver("答案", task: task(.ask, .floatingPanel), mode: .ask)
        XCTAssertTrue(recorder.pasted.isEmpty)
        XCTAssertEqual(recorder.panel, ["答案"])
        // 即使任务丢了，Ask 模式也不粘贴。
        await delivery(recorder).deliver("再来", task: nil, mode: .ask)
        XCTAssertTrue(recorder.pasted.isEmpty)
    }

    func testBlankResultIsIgnored() async {
        let recorder = Recorder()
        await delivery(recorder).deliver("  \n ", task: task(.dictate, .paste), mode: .dictate)
        XCTAssertTrue(recorder.pasted.isEmpty && recorder.panel.isEmpty)
    }
}

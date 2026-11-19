import XCTest
@testable import SpeakMoreCore

@MainActor
final class OverlayControllerTests: XCTestCase {
    private func state(_ status: VoiceStatus, mode: VoiceMode = .dictate, visible: Bool? = nil, text: String? = nil, error: String? = nil) -> FloatingBarState {
        let hiddenStatuses: Set<VoiceStatus> = [.idle]
        return FloatingBarState(
            visible: visible ?? !hiddenStatuses.contains(status), status: status, mode: mode,
            inputLevel: 0, displayText: text, errorMessage: error
        )
    }

    private func make() -> (OverlayController, ManualScheduler) {
        let scheduler = ManualScheduler()
        return (OverlayController(scheduler: scheduler), scheduler)
    }

    func testRecordingShowsBarAndCompletionHidesAfterOneSecond() {
        let (overlay, scheduler) = make()
        overlay.handleVoiceState(state(.recording))
        XCTAssertTrue(overlay.barVisible)
        overlay.handleVoiceState(state(.completed))
        XCTAssertTrue(overlay.barVisible, "完成后还要显示一会儿")
        XCTAssertEqual(scheduler.pendingDelays(), [1])
        scheduler.fire(delay: 1)
        XCTAssertFalse(overlay.barVisible)
    }

    func testNewRecordingCancelsPendingHide() {
        let (overlay, scheduler) = make()
        overlay.handleVoiceState(state(.completed))
        overlay.handleVoiceState(state(.connecting))
        XCTAssertTrue(scheduler.pendingDelays().isEmpty)
        XCTAssertTrue(overlay.barVisible)
    }

    func testErrorStaysUntilEscape() {
        let (overlay, scheduler) = make()
        overlay.handleVoiceState(state(.error, error: "语音转写失败，请重试"))
        XCTAssertTrue(overlay.barVisible)
        XCTAssertTrue(scheduler.pendingDelays().isEmpty, "错误不自动消失")
        XCTAssertEqual(overlay.barHint, "语音转写失败，请重试")
        overlay.handleEscape()
        XCTAssertFalse(overlay.barVisible)
    }

    func testIdleHidesBar() {
        let (overlay, _) = make()
        overlay.handleVoiceState(state(.recording))
        overlay.handleVoiceState(state(.idle))
        XCTAssertFalse(overlay.barVisible)
    }

    func testEscapeWhileActiveRequestsCancel() {
        let (overlay, _) = make()
        var cancels = 0
        overlay.onCancelRequested = { cancels += 1 }
        overlay.handleVoiceState(state(.recording))
        overlay.handleEscape()
        XCTAssertEqual(cancels, 1)
        XCTAssertTrue(overlay.barVisible, "是否隐藏由取消后的状态决定，Escape 本身不隐藏")
    }

    func testEscapeClosesPanelBeforeAnythingElse() {
        let (overlay, _) = make()
        var dismissed = 0
        var cancels = 0
        overlay.onPanelDismissed = { dismissed += 1 }
        overlay.onCancelRequested = { cancels += 1 }
        overlay.showResult("结果")
        XCTAssertEqual(overlay.panel, .result("结果"))
        overlay.handleEscape()
        XCTAssertNil(overlay.panel)
        XCTAssertEqual(dismissed, 1)
        XCTAssertEqual(cancels, 0)
    }

    func testEscapeWithNothingVisibleStillSendsCancel() {
        let (overlay, _) = make()
        var cancels = 0
        overlay.onCancelRequested = { cancels += 1 }
        overlay.handleEscape()
        XCTAssertEqual(cancels, 1)
    }

    func testShowingPanelHidesBarAndActiveVoiceHidesPanel() {
        let (overlay, _) = make()
        overlay.keyActivity(anyKeyDown: true)
        XCTAssertTrue(overlay.barVisible)
        overlay.showResult(" 答案 ")
        XCTAssertFalse(overlay.barVisible)
        XCTAssertEqual(overlay.panel, .result("答案"))
        overlay.keyActivity(anyKeyDown: true)
        XCTAssertFalse(overlay.barVisible, "面板显示时按键不再亮出胶囊")

        overlay.handleVoiceState(state(.connecting))
        XCTAssertNil(overlay.panel, "新一轮录音开始，旧结果面板收起")
        XCTAssertTrue(overlay.barVisible)
    }

    func testShortcutHintHasLowPriority() {
        let (overlay, _) = make()
        overlay.handleVoiceState(state(.recording))
        overlay.showShortcutHint()
        XCTAssertNil(overlay.panel, "录音中不弹快捷键提示")

        overlay.handleVoiceState(state(.error, error: "x"))
        overlay.showShortcutHint()
        XCTAssertNil(overlay.panel)

        overlay.handleVoiceState(state(.idle))
        overlay.showShortcutHint()
        XCTAssertEqual(overlay.panel, .shortcutHint)
        XCTAssertFalse(overlay.barVisible)
    }

    func testBlankResultNotShown() {
        let (overlay, _) = make()
        overlay.showResult("  \n ")
        XCTAssertNil(overlay.panel)
    }

    func testLongProcessingHintAfterThreeSeconds() {
        let (overlay, scheduler) = make()
        overlay.handleVoiceState(state(.transcribing))
        XCTAssertEqual(overlay.barHint, "正在转写...")
        XCTAssertEqual(scheduler.pendingDelays(), [3])
        scheduler.fire(delay: 3)
        XCTAssertEqual(overlay.barHint, "正在努力处理中...")
        overlay.handleVoiceState(state(.completed))
        XCTAssertEqual(overlay.barHint, "已完成")
    }

    func testKeyActivityShowsIdleHint() {
        let (overlay, _) = make()
        overlay.keyActivity(anyKeyDown: true)
        XCTAssertTrue(overlay.barVisible)
        XCTAssertEqual(overlay.barHint, "Right Option 录音")
    }
}

final class FloatingBarTextTests: XCTestCase {
    private func hint(_ status: VoiceStatus, _ mode: VoiceMode = .dictate, text: String? = nil, error: String? = nil) -> String {
        FloatingBarText.hint(
            for: FloatingBarState(visible: true, status: status, mode: mode, inputLevel: 0, displayText: text, errorMessage: error),
            longProcessingVisible: false
        )
    }

    func testTextPerStatusAndMode() {
        XCTAssertEqual(hint(.recording, .dictate), "正在听写...")
        XCTAssertEqual(hint(.recording, .translate), "正在听取翻译内容...")
        XCTAssertEqual(hint(.recording, .ask), "请随意提出问题")
        XCTAssertEqual(hint(.connecting), "正在连接...")
        XCTAssertEqual(hint(.transcribing, .translate), "正在翻译...")
        XCTAssertEqual(hint(.stopping, .ask), "正在处理...")
        XCTAssertEqual(hint(.cancelled), "当前转录已取消")
        XCTAssertEqual(hint(.completed), "已完成")
        XCTAssertEqual(hint(.error), "发生错误")
        XCTAssertEqual(hint(.error, error: "连接断了"), "连接断了")
        XCTAssertEqual(hint(.recording, text: "录音将在 10 秒后自动结束"), "录音将在 10 秒后自动结束")
    }

    func testFloatingStateFromSessionFeedsText() {
        var session = VoiceSession()
        session.status = .recording
        session.mode = .ask
        XCTAssertEqual(FloatingBarText.hint(for: VoiceSessionMath.floatingBarState(for: session), longProcessingVisible: false), "请随意提出问题")
    }
}

final class OverlayLayoutTests: XCTestCase {
    func testBottomCenterOfWorkArea() {
        // 工作区不含菜单栏 / Dock：原点在左下，y 向上。
        let work = OverlayRect(x: 0, y: 80, width: 1440, height: 800)
        let bar = OverlayLayout.bottomCenter(workArea: work, size: OverlayLayout.barSize)
        XCTAssertEqual(bar, OverlayRect(x: 610, y: 112, width: 220, height: 224))
        let panel = OverlayLayout.bottomCenter(workArea: work, size: OverlayLayout.panelSize)
        XCTAssertEqual(panel, OverlayRect(x: 500, y: 112, width: 440, height: 220))
    }

    func testSecondDisplayWithOffsetOrigin() {
        let work = OverlayRect(x: -1920, y: 0, width: 1920, height: 1055)
        let bar = OverlayLayout.bottomCenter(workArea: work, size: OverlayLayout.barSize)
        XCTAssertEqual(bar.x, -1920 + 850)
        XCTAssertEqual(bar.y, 32)
    }

    func testClampedIntoTinyWorkArea() {
        let work = OverlayRect(x: 100, y: 100, width: 150, height: 150)
        let bar = OverlayLayout.bottomCenter(workArea: work, size: OverlayLayout.barSize)
        XCTAssertEqual(bar.x, 100)
        XCTAssertEqual(bar.y, 100)
    }
}

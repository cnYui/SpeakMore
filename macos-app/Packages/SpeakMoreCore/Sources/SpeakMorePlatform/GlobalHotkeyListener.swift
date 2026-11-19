import ApplicationServices
import CoreGraphics
import Foundation
import SpeakMoreCore

/// 全局键盘监听（CGEventTap，只听不改）。需要“输入监控”权限；没有权限时 `start()` 返回 false。
/// 事件在专用线程上由 `MacKeyInterpreter` 翻译成 RightAlt / RightShift / RightCommand / Escape，再交给 `handler`。
/// `handler` 在监听线程上被调用，调用方自己切回主线程。
public final class GlobalHotkeyListener: @unchecked Sendable {
    public typealias Handler = @Sendable (RawKeyEvent) -> Void

    private let handler: Handler
    private let lock = NSLock()
    private var tap: CFMachPort?
    private var runLoop: CFRunLoop?
    private var thread: Thread?
    private var interpreter = MacKeyInterpreter()

    public init(handler: @escaping Handler) {
        self.handler = handler
    }

    deinit { stop() }

    public var isRunning: Bool {
        lock.lock(); defer { lock.unlock() }
        return tap != nil
    }

    /// 创建并启用监听；已经在运行就直接返回 true。没有输入监控权限（创建失败）返回 false。
    @discardableResult
    public func start() -> Bool {
        lock.lock()
        if tap != nil { lock.unlock(); return true }
        lock.unlock()

        let mask: CGEventMask = (1 << CGEventType.flagsChanged.rawValue)
            | (1 << CGEventType.keyDown.rawValue)
            | (1 << CGEventType.keyUp.rawValue)
        let callback: CGEventTapCallBack = { _, type, event, userInfo in
            guard let userInfo else { return Unmanaged.passUnretained(event) }
            let listener = Unmanaged<GlobalHotkeyListener>.fromOpaque(userInfo).takeUnretainedValue()
            listener.receive(type: type, event: event)
            return Unmanaged.passUnretained(event)
        }
        guard let created = CGEvent.tapCreate(
            tap: .cgSessionEventTap, place: .headInsertEventTap, options: .listenOnly,
            eventsOfInterest: mask, callback: callback, userInfo: Unmanaged.passUnretained(self).toOpaque()
        ) else { return false }

        lock.lock()
        tap = created
        interpreter = MacKeyInterpreter()
        lock.unlock()

        let ready = DispatchSemaphore(value: 0)
        let worker = Thread { [weak self] in
            guard let self else { ready.signal(); return }
            let source = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, created, 0)
            let current = CFRunLoopGetCurrent()
            CFRunLoopAddSource(current, source, .commonModes)
            CGEvent.tapEnable(tap: created, enable: true)
            self.lock.lock(); self.runLoop = current; self.lock.unlock()
            ready.signal()
            CFRunLoopRun()
            CFRunLoopRemoveSource(current, source, .commonModes)
        }
        worker.name = "cn.yui.speakmore.hotkeys"
        worker.qualityOfService = .userInteractive
        lock.lock(); thread = worker; lock.unlock()
        worker.start()
        ready.wait()
        return true
    }

    public func stop() {
        lock.lock()
        let current = tap
        let loop = runLoop
        tap = nil
        runLoop = nil
        thread = nil
        lock.unlock()
        if let current { CGEvent.tapEnable(tap: current, enable: false); CFMachPortInvalidate(current) }
        if let loop { CFRunLoopStop(loop) }
    }

    fileprivate func receive(type: CGEventType, event: CGEvent) {
        // 系统会在回调太慢或用户输入被打断时停掉监听，必须自己重新启用。
        if type == .tapDisabledByTimeout || type == .tapDisabledByUserInput {
            lock.lock(); let current = tap; lock.unlock()
            if let current { CGEvent.tapEnable(tap: current, enable: true) }
            return
        }

        let keyCode = event.getIntegerValueField(.keyboardEventKeycode)
        let events: [RawKeyEvent]
        lock.lock()
        switch type {
        case .flagsChanged:
            events = interpreter.flagsChanged(keyCode: keyCode, flags: event.flags.rawValue)
        case .keyDown, .keyUp:
            let isRepeat = event.getIntegerValueField(.keyboardEventAutorepeat) != 0
            events = interpreter.keyEvent(keyCode: keyCode, isDown: type == .keyDown, isRepeat: isRepeat)
        default:
            events = []
        }
        lock.unlock()
        for item in events { handler(item) }
    }
}

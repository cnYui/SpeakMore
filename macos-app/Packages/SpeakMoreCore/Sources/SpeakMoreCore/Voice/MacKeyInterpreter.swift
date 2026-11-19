import Foundation

/// 把 CGEventTap 送来的底层键盘事件翻译成 `RawKeyEvent`（RightAlt / RightShift / RightCommand / Escape）。
/// 逻辑和 `electron-app/macos-option-listener.c` 一致，但是不依赖系统头文件，所以可以直接单元测试：
///   · 只认右侧 Option（keycode 61 + 设备位掩码），左侧 Option 没有任何效果；
///   · 右侧 Option 按住期间，任意 Shift 视为 RightShift（翻译），右侧 Command 视为 RightCommand（自由提问）；
///   · 松开右侧 Option 时，先补发还按着的 Shift / Command 的松开事件；
///   · 右侧 Option 没按下时，Shift / Command 的变化不产生任何事件（只清理遗留的按下状态）；
///   · Escape 只在首次按下（非自动重复）时发按下，松开时发松开。
public struct MacKeyInterpreter: Sendable {
    public enum KeyCode {
        public static let escape: Int64 = 53
        public static let rightCommand: Int64 = 54
        public static let leftCommand: Int64 = 55
        public static let rightOption: Int64 = 61
    }

    /// `CGEventFlags` 里的设备相关位（`IOLLEvent.h`：NX_DEVICERALTKEYMASK / NX_DEVICERCMDKEYMASK）和 Shift 位。
    public enum FlagMask {
        public static let rightOption: UInt64 = 0x0000_0040
        public static let rightCommand: UInt64 = 0x0000_0010
        public static let shift: UInt64 = 0x0002_0000
    }

    private var optionIsDown = false
    private var shiftIsDown = false
    private var rightCommandIsDown = false
    private var escapeIsDown = false

    public init() {}

    public mutating func flagsChanged(keyCode: Int64, flags: UInt64) -> [RawKeyEvent] {
        var events: [RawKeyEvent] = []
        let rightOptionNow = flags & FlagMask.rightOption != 0
        let shiftNow = flags & FlagMask.shift != 0
        let rightCommandNow = flags & FlagMask.rightCommand != 0

        if keyCode == KeyCode.rightOption && rightOptionNow != optionIsDown {
            optionIsDown = rightOptionNow
            events.append(RawKeyEvent(key: .rightAlt, isDown: optionIsDown))

            if !optionIsDown {
                if shiftIsDown {
                    shiftIsDown = false
                    events.append(RawKeyEvent(key: .rightShift, isDown: false))
                }
                if rightCommandIsDown {
                    rightCommandIsDown = false
                    events.append(RawKeyEvent(key: .rightCommand, isDown: false))
                }
            }
        }

        if optionIsDown {
            if shiftNow != shiftIsDown {
                shiftIsDown = shiftNow
                events.append(RawKeyEvent(key: .rightShift, isDown: shiftNow))
            }
            if (keyCode == KeyCode.rightCommand || keyCode == KeyCode.rightOption) && rightCommandNow != rightCommandIsDown {
                rightCommandIsDown = rightCommandNow
                events.append(RawKeyEvent(key: .rightCommand, isDown: rightCommandIsDown))
            }
        } else {
            if shiftIsDown {
                shiftIsDown = false
                events.append(RawKeyEvent(key: .rightShift, isDown: false))
            }
            if rightCommandIsDown {
                rightCommandIsDown = false
                events.append(RawKeyEvent(key: .rightCommand, isDown: false))
            }
        }
        return events
    }

    public mutating func keyEvent(keyCode: Int64, isDown: Bool, isRepeat: Bool) -> [RawKeyEvent] {
        guard keyCode == KeyCode.escape else { return [] }
        if isDown && !escapeIsDown && !isRepeat {
            escapeIsDown = true
            return [RawKeyEvent(key: .escape, isDown: true)]
        }
        if !isDown && escapeIsDown {
            escapeIsDown = false
            return [RawKeyEvent(key: .escape, isDown: false)]
        }
        return []
    }
}

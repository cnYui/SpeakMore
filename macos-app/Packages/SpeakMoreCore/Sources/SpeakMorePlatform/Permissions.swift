import AppKit
import ApplicationServices
import AVFoundation
import CoreGraphics

/// 原生版用到的三项系统权限：
///   · 麦克风：录音；
///   · 辅助功能：读焦点 / 选区、模拟 Cmd+V 粘贴；
///   · 输入监控：全局监听右侧 Option / Command / Shift（CGEventTap）。
public enum SystemPermission: String, CaseIterable, Sendable {
    case microphone
    case accessibility
    case inputMonitoring

    var settingsAnchor: String {
        switch self {
        case .microphone: "Privacy_Microphone"
        case .accessibility: "Privacy_Accessibility"
        case .inputMonitoring: "Privacy_ListenEvent"
        }
    }

    public var settingsURL: URL {
        URL(string: "x-apple.systempreferences:com.apple.preference.security?\(settingsAnchor)")!
    }
}

public struct PermissionSnapshot: Equatable, Sendable {
    public enum MicrophoneState: String, Sendable { case granted, denied, notDetermined }

    public var microphone: MicrophoneState
    public var accessibility: Bool
    public var inputMonitoring: Bool

    /// 三项都齐了，快捷键 + 录音 + 自动粘贴才能完整工作。
    public var isComplete: Bool { microphone == .granted && accessibility && inputMonitoring }
}

public enum Permissions {
    public static func current() -> PermissionSnapshot {
        let microphone: PermissionSnapshot.MicrophoneState
        switch AVCaptureDevice.authorizationStatus(for: .audio) {
        case .authorized: microphone = .granted
        case .notDetermined: microphone = .notDetermined
        default: microphone = .denied
        }
        return PermissionSnapshot(
            microphone: microphone,
            accessibility: AXIsProcessTrusted(),
            inputMonitoring: CGPreflightListenEventAccess()
        )
    }

    /// 请求权限：系统会弹出授权提示（辅助功能 / 输入监控要用户去系统设置里勾选），返回请求时的状态。
    @discardableResult
    public static func request(_ permission: SystemPermission) async -> Bool {
        switch permission {
        case .microphone:
            return await AVCaptureDevice.requestAccess(for: .audio)
        case .accessibility:
            let options = ["AXTrustedCheckOptionPrompt": true] as CFDictionary
            return AXIsProcessTrustedWithOptions(options)
        case .inputMonitoring:
            return CGRequestListenEventAccess()
        }
    }

    @MainActor
    public static func openSettings(for permission: SystemPermission) {
        NSWorkspace.shared.open(permission.settingsURL)
    }
}

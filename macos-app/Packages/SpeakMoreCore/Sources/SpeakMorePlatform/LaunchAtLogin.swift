import ServiceManagement

/// 开机自动启动（登录项）。用系统的 `SMAppService`，开关会出现在“系统设置 → 通用 → 登录项”里，用户随时能在那边关掉。
public enum LaunchAtLogin {
    public enum State: Equatable, Sendable {
        case enabled
        case disabled
        /// 已注册，但需要用户在系统设置里点一下允许。
        case requiresApproval
        /// 系统找不到这个应用（比如没有从正式位置运行）。
        case unavailable
    }

    public static var state: State {
        switch SMAppService.mainApp.status {
        case .enabled: .enabled
        case .notRegistered: .disabled
        case .requiresApproval: .requiresApproval
        case .notFound: .unavailable
        @unknown default: .unavailable
        }
    }

    public static func set(_ enabled: Bool) throws {
        let service = SMAppService.mainApp
        if enabled {
            if service.status != .enabled { try service.register() }
        } else if service.status == .enabled || service.status == .requiresApproval {
            try service.unregister()
        }
    }

    /// 启动时让系统状态和设置一致：设置里开着但系统里没注册（比如用户在系统设置里关过再改了应用位置）就补注册；
    /// 设置里关着但系统里还开着就取消。失败时返回错误说明，不抛出。
    @discardableResult
    public static func reconcile(desired: Bool) -> String? {
        let current = state
        if desired == (current == .enabled || current == .requiresApproval) { return nil }
        do {
            try set(desired)
            return nil
        } catch {
            return error.localizedDescription
        }
    }
}

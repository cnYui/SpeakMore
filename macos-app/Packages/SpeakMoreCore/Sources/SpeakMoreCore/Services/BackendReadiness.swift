import Foundation

/// `/ready` 一次探测的结果。`/ready` 返回 200 才代表当前 ASR 模型可以接收请求；`/health` 只说明进程活着。
public struct ReadyProbe: Equatable, Sendable {
    public var success: Bool
    public var httpStatus: Int
    public var state: String
    public var detail: String
    public var cached: Bool?

    public init(success: Bool, httpStatus: Int, state: String = "", detail: String = "", cached: Bool? = nil) {
        self.success = success
        self.httpStatus = httpStatus
        self.state = state
        self.detail = detail
        self.cached = cached
    }

    /// 模型还没下载（而且没在下载 / 加载）：这种情况等下去没有意义，要提示用户去下载。
    public var isModelMissing: Bool {
        if state == "downloading" || state == "loading" { return false }
        return cached == false && (state == "idle" || detail.contains("尚未下载"))
    }
}

extension BackendClient {
    public func probeReady(timeout: TimeInterval = 0.7) async -> ReadyProbe {
        var request = URLRequest(url: baseURL.appendingPathComponent("ready"), timeoutInterval: timeout)
        request.httpMethod = "GET"
        do {
            let (data, statusCode) = try await transport.send(request)
            let payload = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
            let state = payload?["status"] as? String ?? ""
            let detail = (payload?["detail"] as? String).flatMap { $0.isEmpty ? nil : $0 }
                ?? (state.isEmpty ? (statusCode > 0 ? "\(request.url?.absoluteString ?? "") 返回 \(statusCode)" : "") : state)
            return ReadyProbe(
                success: (200..<300).contains(statusCode), httpStatus: statusCode,
                state: state, detail: detail, cached: payload?["cached"] as? Bool
            )
        } catch {
            return ReadyProbe(success: false, httpStatus: 0, detail: "无法连接 \(baseURL.absoluteString)/ready")
        }
    }
}

/// 后端进程的启动 / 退出信息（实现在应用里；测试里用假的）。
public protocol BackendProcessControlling: AnyObject, Sendable {
    /// 保证后端进程已经在跑（已经在跑就什么都不做）；开发模式 / 外部自己启动的后端可以直接返回。
    func start() async throws
    /// 进程已经退出时的说明；还在跑返回 nil。
    var exitDescription: String? { get }
}

public enum BackendReadiness {
    /// 等后端 `/ready`：必要时先拉起进程，然后每 `interval` 秒探测一次，直到就绪、模型缺失、进程退出或超时。
    public static func ensureReady(
        client: BackendClient = BackendClient(),
        launcher: BackendProcessControlling? = nil,
        timeout: TimeInterval = 120,
        interval: TimeInterval = 0.7,
        sleep: @Sendable (TimeInterval) async -> Void = { try? await Task.sleep(nanoseconds: UInt64($0 * 1_000_000_000)) }
    ) async throws {
        if let launcher {
            do { try await launcher.start() } catch {
                throw VoiceError(.backendUnavailable, detail: error.localizedDescription)
            }
        }

        let deadline = Date().addingTimeInterval(timeout)
        var latest: ReadyProbe?
        while Date() <= deadline {
            let probe = await client.probeReady()
            if probe.success { return }
            latest = probe
            if probe.isModelMissing {
                throw VoiceError(.voiceModelMissing, detail: probe.detail)
            }
            if let exit = launcher?.exitDescription {
                throw VoiceError(.backendUnavailable, detail: "语音后端已退出: \(exit)")
            }
            try Task.checkCancellation()
            await sleep(interval)
        }
        throw VoiceError(.backendUnavailable, detail: latest?.detail ?? "语音后端启动超时")
    }
}

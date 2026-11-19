import Foundation

public protocol HTTPTransport: Sendable {
    func send(_ request: URLRequest) async throws -> (data: Data, statusCode: Int)
}

public struct URLSessionTransport: HTTPTransport {
    public init() {}

    public func send(_ request: URLRequest) async throws -> (data: Data, statusCode: Int) {
        let (data, response) = try await URLSession.shared.data(for: request)
        return (data, (response as? HTTPURLResponse)?.statusCode ?? 0)
    }
}

public struct ConfigReloadResult: Equatable, Sendable {
    public var success: Bool
    public var detail: String
}

/// 本地 FastAPI 语音后端（默认 `http://127.0.0.1:8000`）的 HTTP 客户端，接口和 Electron 版主进程用的一致。
public struct BackendClient: Sendable {
    public static let baseURLEnvironmentKey = "SPEAKMORE_BACKEND_URL"
    public static let defaultBaseURL = URL(string: "http://127.0.0.1:8000")!

    public let baseURL: URL
    private let transport: HTTPTransport

    public init(baseURL: URL? = nil, transport: HTTPTransport = URLSessionTransport()) {
        let environmentURL = ProcessInfo.processInfo.environment[Self.baseURLEnvironmentKey].flatMap(URL.init(string:))
        self.baseURL = baseURL ?? environmentURL ?? Self.defaultBaseURL
        self.transport = transport
    }

    /// 查询模型状态。`modelId` 非空时后端会在空闲状态下把当前模型切换过去。
    public func modelStatus(cacheDir: String = "", modelId: String = "") async -> VoiceModelStatus {
        var components = URLComponents(url: baseURL.appendingPathComponent("model/status"), resolvingAgainstBaseURL: false)!
        var items: [URLQueryItem] = []
        if !cacheDir.isEmpty { items.append(URLQueryItem(name: "cache_dir", value: cacheDir)) }
        if !modelId.isEmpty { items.append(URLQueryItem(name: "model_id", value: modelId)) }
        components.queryItems = items.isEmpty ? nil : items
        guard let url = components.url else { return .unavailable }
        return await decodeStatus(URLRequest(url: url, timeoutInterval: 5))
    }

    /// 下载并加载模型；`load == false` 只下载、不切换当前模型。
    public func startDownload(cacheDir: String = "", modelId: String = "", load: Bool = true) async -> VoiceModelStatus {
        var body: [String: Any] = [:]
        if !cacheDir.isEmpty { body["cache_dir"] = cacheDir }
        if !modelId.isEmpty { body["model_id"] = modelId }
        if !load { body["load"] = false }

        var request = URLRequest(url: baseURL.appendingPathComponent("model/download"), timeoutInterval: 10)
        request.httpMethod = "POST"
        if !body.isEmpty {
            request.setValue("application/json", forHTTPHeaderField: "content-type")
            request.httpBody = try? JSONSerialization.data(withJSONObject: body)
        }
        return await decodeStatus(request)
    }

    /// 保存大模型设置后让后端重新读取配置。
    public func reloadConfig() async -> ConfigReloadResult {
        var request = URLRequest(url: baseURL.appendingPathComponent("config/reload"), timeoutInterval: 10)
        request.httpMethod = "POST"
        do {
            let (data, statusCode) = try await transport.send(request)
            let payload = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
            let detail = payload?["detail"] as? String
            if (200..<300).contains(statusCode) {
                return ConfigReloadResult(success: true, detail: detail ?? "")
            }
            return ConfigReloadResult(success: false, detail: detail ?? "HTTP \(statusCode)")
        } catch {
            return ConfigReloadResult(success: false, detail: error.localizedDescription)
        }
    }

    private func decodeStatus(_ request: URLRequest) async -> VoiceModelStatus {
        do {
            let (data, statusCode) = try await transport.send(request)
            guard (200..<300).contains(statusCode) else {
                let payload = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
                var status = VoiceModelStatus.unavailable
                if let detail = payload?["detail"] as? String { status.detail = detail }
                return status
            }
            return VoiceModelStatus(json: try? JSONSerialization.jsonObject(with: data))
        } catch {
            return .unavailable
        }
    }
}

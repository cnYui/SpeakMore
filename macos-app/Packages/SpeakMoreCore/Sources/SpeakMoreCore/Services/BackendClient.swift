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

/// `POST /model/delete` 的结果。成功时带更新后的模型列表；失败时 `detail` 是后端给的原因（下载中 / 文件被占用等）。
public struct ModelDeleteResult: Equatable, Sendable {
    public var ok: Bool
    public var status: VoiceModelStatus?
    public var detail: String
    public var freedBytes: Int
    /// 别处还有一份（显式目录 / Hugging Face 缓存）：应用不会删，只告诉用户位置。
    public var externalLocations: [String]

    public init(ok: Bool, status: VoiceModelStatus? = nil, detail: String = "", freedBytes: Int = 0, externalLocations: [String] = []) {
        self.ok = ok
        self.status = status
        self.detail = detail
        self.freedBytes = freedBytes
        self.externalLocations = externalLocations
    }
}

/// 本地 FastAPI 语音后端（默认 `http://127.0.0.1:8000`）的 HTTP 客户端，接口和 Electron 版主进程用的一致。
public struct BackendClient: Sendable {
    public static let baseURLEnvironmentKey = "SPEAKMORE_BACKEND_URL"
    public static let defaultBaseURL = URL(string: "http://127.0.0.1:8000")!

    public let baseURL: URL
    let transport: HTTPTransport

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

    /// 删除一个已下载的模型。`modelId` 必须明确给出（不会回退成“当前模型”，避免误删正在用的）。
    public func deleteModel(cacheDir: String = "", modelId: String) async -> ModelDeleteResult {
        guard !modelId.isEmpty else { return ModelDeleteResult(ok: false, detail: "缺少 model_id") }
        var body: [String: Any] = ["model_id": modelId]
        if !cacheDir.isEmpty { body["cache_dir"] = cacheDir }

        var request = URLRequest(url: baseURL.appendingPathComponent("model/delete"), timeoutInterval: 30)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "content-type")
        request.httpBody = try? JSONSerialization.data(withJSONObject: body)
        do {
            let (data, statusCode) = try await transport.send(request)
            let payload = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
            guard (200..<300).contains(statusCode), let payload else {
                // 409（下载 / 加载中）、500（文件被占用等）：后端的 detail 就是给用户看的原因。
                return ModelDeleteResult(ok: false, detail: (payload?["detail"] as? String) ?? "HTTP \(statusCode)")
            }
            let result = payload["delete"] as? [String: Any]
            return ModelDeleteResult(
                ok: true,
                status: VoiceModelStatus(json: payload),
                freedBytes: VoiceModelStatus.int(result?["freed_bytes"]),
                externalLocations: (result?["external_locations"] as? [Any])?.compactMap { $0 as? String } ?? []
            )
        } catch {
            return ModelDeleteResult(ok: false, detail: VoiceModelStatus.unavailable.detail)
        }
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

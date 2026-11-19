import Foundation

/// 基于 `URLSessionWebSocketTask` 的语音后端连接。
/// 连不上（连接被拒、握手前断开）抛 `backend_unavailable`，超时抛 `websocket_timeout`，和 `voiceSocket.ts` 一致。
public final class URLSessionVoiceTransport: NSObject, VoiceTransport, URLSessionWebSocketDelegate, @unchecked Sendable {
    public static let connectTimeout: TimeInterval = 2.5

    private let url: URL
    private let lock = NSLock()
    private var session: URLSession?
    private var task: URLSessionWebSocketTask?
    private var opened = false
    private var closed = false
    private var openContinuation: CheckedContinuation<Void, Error>?
    private var messageHandler: (@Sendable (String) -> Void)?
    private var closeHandler: (@Sendable () -> Void)?

    public init(url: URL = VoiceEndpoint.webSocketURL(base: BackendClient().baseURL)) {
        self.url = url
        super.init()
    }

    public var isOpen: Bool {
        lock.lock(); defer { lock.unlock() }
        return opened && !closed
    }

    public var onMessage: (@Sendable (String) -> Void)? {
        get { lock.lock(); defer { lock.unlock() }; return messageHandler }
        set { lock.lock(); messageHandler = newValue; lock.unlock() }
    }

    public var onClose: (@Sendable () -> Void)? {
        get { lock.lock(); defer { lock.unlock() }; return closeHandler }
        set { lock.lock(); closeHandler = newValue; lock.unlock() }
    }

    public func connect(timeout: TimeInterval = URLSessionVoiceTransport.connectTimeout) async throws {
        let created = URLSession(configuration: .ephemeral, delegate: self, delegateQueue: nil)
        let socket = created.webSocketTask(with: url)
        install(session: created, task: socket)

        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
            storeContinuation(continuation)
            socket.resume()
            // 连接超时要尽快反馈给界面，不能让用户停在 connecting 状态。
            DispatchQueue.global().asyncAfter(deadline: .now() + timeout) { [weak self] in
                self?.finishOpen(.failure(VoiceError(.websocketTimeout)), closeSocket: true)
            }
        }
        receiveLoop(socket)
    }

    public func send(text: String) async throws {
        guard let socket = currentTask() else { throw VoiceError(.websocketClosed) }
        try await socket.send(.string(text))
    }

    public func send(binary: Data) async throws {
        guard let socket = currentTask() else { throw VoiceError(.websocketClosed) }
        try await socket.send(.data(binary))
    }

    public func close() {
        lock.lock()
        let socket = task
        let activeSession = session
        task = nil
        session = nil
        closed = true
        lock.unlock()
        socket?.cancel(with: .goingAway, reason: nil)
        activeSession?.invalidateAndCancel()
    }

    // MARK: - 内部

    // NSLock 不能直接在 async 函数里用，加解锁都放进同步的小函数。
    private func install(session created: URLSession, task socket: URLSessionWebSocketTask) {
        lock.lock(); defer { lock.unlock() }
        session = created
        task = socket
        opened = false
        closed = false
    }

    private func storeContinuation(_ continuation: CheckedContinuation<Void, Error>) {
        lock.lock(); defer { lock.unlock() }
        openContinuation = continuation
    }

    private func currentTask() -> URLSessionWebSocketTask? {
        lock.lock(); defer { lock.unlock() }
        return closed ? nil : task
    }

    private func finishOpen(_ result: Result<Void, Error>, closeSocket: Bool = false) {
        lock.lock()
        let continuation = openContinuation
        openContinuation = nil
        if case .success = result { opened = true }
        lock.unlock()
        guard let continuation else { return }
        if case .failure = result, closeSocket { close() }
        continuation.resume(with: result)
    }

    private func receiveLoop(_ socket: URLSessionWebSocketTask) {
        socket.receive { [weak self, weak socket] result in
            guard let self, let socket else { return }
            switch result {
            case .success(let message):
                switch message {
                case .string(let text): self.onMessage?(text)
                case .data(let data): self.onMessage?(String(decoding: data, as: UTF8.self))
                @unknown default: break
                }
                self.receiveLoop(socket)
            case .failure:
                self.handleClosed(socket)
            }
        }
    }

    private func handleClosed(_ socket: URLSessionWebSocketTask) {
        lock.lock()
        let wasCurrent = task === socket
        let wasOpen = opened && !closed
        closed = true
        let handler = closeHandler
        lock.unlock()
        if wasCurrent && wasOpen { handler?() }
    }

    public func urlSession(_ session: URLSession, webSocketTask: URLSessionWebSocketTask, didOpenWithProtocol protocol: String?) {
        finishOpen(.success(()))
    }

    public func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        // 握手前断开 = 后端没起来；握手后断开由 receive 循环报告。
        finishOpen(.failure(VoiceError(.backendUnavailable, detail: error?.localizedDescription)))
    }

    public func urlSession(_ session: URLSession, webSocketTask: URLSessionWebSocketTask, didCloseWith closeCode: URLSessionWebSocketTask.CloseCode, reason: Data?) {
        handleClosed(webSocketTask)
    }
}

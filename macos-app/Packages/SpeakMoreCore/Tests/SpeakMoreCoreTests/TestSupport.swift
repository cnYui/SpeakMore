import Foundation
@testable import SpeakMoreCore

enum Fixture {
    static func data(_ name: String) throws -> Data {
        let url = try XCTUnwrapURL(Bundle.module.resourceURL?.appendingPathComponent("Fixtures/\(name)"))
        return try Data(contentsOf: url)
    }

    static func json(_ name: String) throws -> Any {
        try JSONSerialization.jsonObject(with: data(name))
    }

    private static func XCTUnwrapURL(_ url: URL?) throws -> URL {
        guard let url else { throw FixtureError.missing }
        return url
    }

    enum FixtureError: Error { case missing }
}

/// 把 `Encodable` 转成 JSON 对象，便于和 JS 生成的期望值逐字段比较（数字 1500 和 1500.0 视为相等）。
func jsonObject<T: Encodable>(_ value: T) throws -> Any {
    try JSONSerialization.jsonObject(with: JSONEncoder().encode(value))
}

func temporaryDataStore() throws -> (LocalDataStore, URL) {
    let directory = FileManager.default.temporaryDirectory
        .appendingPathComponent("speakmore-tests-\(UUID().uuidString)", isDirectory: true)
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    return (LocalDataStore(directory: directory), directory)
}

struct RecordedRequest: Sendable {
    let url: URL
    let method: String
    let body: Data?
    let contentType: String?
}

/// 记录请求并按顺序返回预设响应的假传输层。
final class FakeTransport: HTTPTransport, @unchecked Sendable {
    private let lock = NSLock()
    private var responses: [Result<(Data, Int), Error>]
    private var recorded: [RecordedRequest] = []

    init(_ responses: [Result<(Data, Int), Error>]) {
        self.responses = responses
    }

    var requests: [RecordedRequest] {
        lock.lock()
        defer { lock.unlock() }
        return recorded
    }

    func send(_ request: URLRequest) async throws -> (data: Data, statusCode: Int) {
        lock.lock()
        recorded.append(RecordedRequest(
            url: request.url!,
            method: request.httpMethod ?? "GET",
            body: request.httpBody,
            contentType: request.value(forHTTPHeaderField: "content-type")
        ))
        let next = responses.isEmpty ? .failure(URLError(.cannotConnectToHost)) : responses.removeFirst()
        lock.unlock()
        let (data, status) = try next.get()
        return (data, status)
    }
}

import XCTest
@testable import SpeakMoreCore

final class BackendEnvironmentTests: XCTestCase {
    func testInjectsPortHostFfmpegAndModelSettings() {
        var settings = LocalSettings()
        settings.modelCacheDir = "  /Volumes/Models  "
        settings.asrDeviceMode = .mps
        settings.asrModelId = "sensevoice-small-int8"
        let env = BackendEnvironment.make(
            base: ["PATH": "/usr/bin", "FUNASR_DEVICE": "stale", "SPEAKMORE_ASR_MODEL_ID": "stale"],
            settings: settings, port: 8123, ffmpegDirectory: URL(fileURLWithPath: "/App/ffmpeg/bin")
        )
        XCTAssertEqual(env["PATH"], "/App/ffmpeg/bin:/usr/bin")
        XCTAssertEqual(env["HOST"], "127.0.0.1")
        XCTAssertEqual(env["PORT"], "8123")
        XCTAssertEqual(env["TYPELESS_MODEL_CACHE_DIR"], "/Volumes/Models")
        XCTAssertEqual(env["FUNASR_DEVICE"], "mps")
        XCTAssertEqual(env["SPEAKMORE_ASR_MODEL_ID"], "sensevoice-small-int8")
    }

    func testDefaultDeviceDoesNotInjectAndStaleValuesAreRemoved() {
        var settings = LocalSettings()
        settings.asrDeviceMode = .default
        let env = BackendEnvironment.make(base: ["FUNASR_DEVICE": "cuda:0", "PORT": "9000", "HOST": "0.0.0.0"], settings: settings, port: 8000, ffmpegDirectory: nil)
        XCTAssertNil(env["FUNASR_DEVICE"], "默认策略不注入设备，旧的环境变量也要清掉")
        XCTAssertNil(env["TYPELESS_MODEL_CACHE_DIR"])
        XCTAssertEqual(env["PORT"], "9000", "外面显式指定的端口优先")
        XCTAssertEqual(env["HOST"], "0.0.0.0")
        XCTAssertEqual(env["PATH"], "")
    }

    func testCpuAndCuda() {
        var settings = LocalSettings()
        settings.asrDeviceMode = .cpu
        XCTAssertEqual(BackendEnvironment.make(base: [:], settings: settings, port: 1, ffmpegDirectory: nil)["FUNASR_DEVICE"], "cpu")
        settings.asrDeviceMode = .cuda
        XCTAssertEqual(BackendEnvironment.make(base: [:], settings: settings, port: 1, ffmpegDirectory: nil)["FUNASR_DEVICE"], "cuda:0")
    }
}

final class BackendLocatorTests: XCTestCase {
    private func makeResources() throws -> URL {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("speakmore-locator-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: root.appendingPathComponent("backend"), withIntermediateDirectories: true)
        try FileManager.default.createDirectory(at: root.appendingPathComponent("ffmpeg/bin"), withIntermediateDirectories: true)
        return root
    }

    private func makeExecutable(_ url: URL) throws {
        try "#!/bin/sh\nexit 0\n".write(to: url, atomically: true, encoding: .utf8)
        try FileManager.default.setAttributes([.posixPermissions: 0o755], ofItemAtPath: url.path)
    }

    func testBundledBackendAndFfmpeg() throws {
        let resources = try makeResources()
        try makeExecutable(resources.appendingPathComponent("backend/speakmore-backend"))
        let launch = try XCTUnwrap(BackendLocator.bundled(resourceURL: resources))
        XCTAssertEqual(launch.executable.lastPathComponent, "speakmore-backend")
        XCTAssertEqual(launch.ffmpegDirectory?.lastPathComponent, "bin")
        XCTAssertEqual(launch.workingDirectory?.lastPathComponent, "backend")
    }

    func testBundledMissingOrNotExecutable() throws {
        let resources = try makeResources()
        XCTAssertNil(BackendLocator.bundled(resourceURL: resources))
        try "x".write(to: resources.appendingPathComponent("backend/speakmore-backend"), atomically: true, encoding: .utf8)
        XCTAssertNil(BackendLocator.bundled(resourceURL: resources), "没有执行权限不算")
        XCTAssertNil(BackendLocator.bundled(resourceURL: nil))
    }

    func testDevelopmentDirectoryWinsOverBundle() throws {
        let server = FileManager.default.temporaryDirectory.appendingPathComponent("speakmore-dev-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: server.appendingPathComponent(".venv/bin"), withIntermediateDirectories: true)
        try makeExecutable(server.appendingPathComponent(".venv/bin/python"))
        let resources = try makeResources()
        try makeExecutable(resources.appendingPathComponent("backend/speakmore-backend"))

        let launch = try XCTUnwrap(BackendLocator.locate(
            resourceURL: resources, environment: [BackendLocator.developmentDirectoryEnvironmentKey: server.path]
        ))
        XCTAssertEqual(launch.executable.lastPathComponent, "python")
        XCTAssertEqual(launch.arguments, ["main.py"])
        XCTAssertEqual(launch.workingDirectory?.path, server.path)

        XCTAssertEqual(BackendLocator.locate(resourceURL: resources, environment: [:])?.executable.lastPathComponent, "speakmore-backend")
    }
}

final class BackendPreloadTests: XCTestCase {
    private func status(_ json: String) -> Result<(Data, Int), Error> { .success((Data(json.utf8), 200)) }
    private let client = { (transport: FakeTransport) in BackendClient(baseURL: URL(string: "http://127.0.0.1:1")!, transport: transport) }

    func testCachedIdleModelGetsLoaded() async {
        let transport = FakeTransport([
            .failure(URLError(.cannotConnectToHost)),  // 后端还没起来
            status(#"{"status":"idle","cached":true,"ready":false}"#),
            status(#"{"status":"loading","cached":true,"ready":false}"#),  // POST /model/download 的响应
        ])
        let result = await BackendPreload.run(client: client(transport), cacheDir: "", modelId: "sensevoice-small-int8", timeout: 5, interval: 0, sleep: { _ in })
        XCTAssertEqual(result, .started)
        XCTAssertEqual(transport.requests.map(\.method), ["GET", "GET", "POST"])
        XCTAssertEqual(transport.requests.last?.url.path, "/model/download")
    }

    func testNothingToDoWhenReadyOrMissing() async {
        for json in [
            #"{"status":"ready","cached":true,"ready":true}"#,
            #"{"status":"loading","cached":true,"ready":false}"#,
            #"{"status":"idle","cached":false,"ready":false}"#,
        ] {
            let transport = FakeTransport([status(json)])
            let result = await BackendPreload.run(client: client(transport), cacheDir: "", modelId: "", timeout: 5, interval: 0, sleep: { _ in })
            XCTAssertEqual(result, .skipped, json)
            XCTAssertEqual(transport.requests.count, 1, "不该再发 POST：\(json)")
        }
    }

    func testProcessExitStopsWaiting() async {
        let transport = FakeTransport([.failure(URLError(.cannotConnectToHost))])
        let result = await BackendPreload.run(
            client: client(transport), cacheDir: "", modelId: "", exitDescription: { "code 1" }, timeout: 5, interval: 0, sleep: { _ in }
        )
        XCTAssertEqual(result, .processExited("code 1"))
    }

    func testTimeout() async {
        let transport = FakeTransport(Array(repeating: .failure(URLError(.cannotConnectToHost)), count: 50))
        let result = await BackendPreload.run(
            client: client(transport), cacheDir: "", modelId: "", timeout: 0.05, interval: 0.02,
            sleep: { try? await Task.sleep(nanoseconds: UInt64($0 * 1_000_000_000)) }
        )
        XCTAssertEqual(result, .timedOut)
    }
}

final class BackendProcessManagerTests: XCTestCase {
    private func manager(_ transport: FakeTransport, launch: BackendLaunch?) -> BackendProcessManager {
        BackendProcessManager(
            client: BackendClient(baseURL: URL(string: "http://127.0.0.1:1")!, transport: transport),
            locate: { launch }, settings: { LocalSettings() }
        )
    }

    func testExistingBackendIsReusedWithoutSpawning() async throws {
        let transport = FakeTransport([.success((Data("{}".utf8), 200))])
        let backend = manager(transport, launch: BackendLaunch(executable: URL(fileURLWithPath: "/bin/sleep"), arguments: ["30"]))
        try await backend.start()
        XCTAssertFalse(backend.isRunningOwnProcess)
        XCTAssertEqual(transport.requests.map(\.url.path), ["/health"])
    }

    func testSpawnsAndStopsOwnProcess() async throws {
        let transport = FakeTransport([.failure(URLError(.cannotConnectToHost))])
        let backend = manager(transport, launch: BackendLaunch(executable: URL(fileURLWithPath: "/bin/sleep"), arguments: ["30"]))
        try await backend.start()
        XCTAssertTrue(backend.isRunningOwnProcess)
        XCTAssertNil(backend.exitDescription)

        backend.stop()
        for _ in 0..<100 where backend.isRunningOwnProcess { try await Task.sleep(nanoseconds: 20_000_000) }
        XCTAssertFalse(backend.isRunningOwnProcess)
        for _ in 0..<100 where backend.exitDescription == nil { try await Task.sleep(nanoseconds: 20_000_000) }
        XCTAssertNotNil(backend.exitDescription, "进程退出后要记录退出信息，等 ready 时才能快速失败")
    }

    func testMissingBackendThrowsUnavailable() async {
        let transport = FakeTransport([.failure(URLError(.cannotConnectToHost))])
        do {
            try await manager(transport, launch: nil).start()
            XCTFail("应当抛出")
        } catch let error as VoiceError {
            XCTAssertEqual(error.code, .backendUnavailable)
            XCTAssertTrue(error.detail?.contains("找不到内置语音后端") == true)
        } catch {
            XCTFail("\(error)")
        }
    }
}

import XCTest
import AVFoundation
@testable import SpeakMoreCore

/// 端到端：真实的语音后端 + 真实的 WebSocket + 用 WAV 文件当麦克风，跑完整的一轮听写。
/// 没有设置环境变量时跳过；用 `macos-app/Tools/e2e-voice.sh` 一键起后端、假大模型并跑这个测试。
///
///   SPEAKMORE_E2E_BACKEND  后端地址，例如 http://127.0.0.1:8033
///   SPEAKMORE_E2E_WAV      一段中文语音（任意采样率 / 声道的 WAV / AIFF）
///   SPEAKMORE_E2E_LLM_URL  假大模型的 base_url，例如 http://127.0.0.1:8765/v1
@MainActor
final class VoiceEndToEndTests: XCTestCase {
    func testDictationAgainstRealBackendWithWavFile() async throws {
        let env = ProcessInfo.processInfo.environment
        guard let backend = env["SPEAKMORE_E2E_BACKEND"], let wav = env["SPEAKMORE_E2E_WAV"], let llmURL = env["SPEAKMORE_E2E_LLM_URL"] else {
            throw XCTSkip("未设置 SPEAKMORE_E2E_* 环境变量，跳过端到端测试")
        }
        let client = BackendClient(baseURL: try XCTUnwrap(URL(string: backend)))
        let wavURL = URL(fileURLWithPath: wav)
        let audioFile = try AVAudioFile(forReading: wavURL)
        let seconds = Double(audioFile.length) / audioFile.processingFormat.sampleRate
        XCTAssertGreaterThan(seconds, 1)

        var settings = LocalSettings()
        let provider = LlmProvider(id: "custom", label: "Fake", baseUrl: llmURL, defaultModel: "fake-model", allowBaseUrlEdit: true, authType: .bearer)
        settings.llm = LlmSettings(providerId: "custom", providers: [provider], apiKeys: ["custom": "sk-e2e"], models: ["custom": "fake-model"])

        var history: [HistoryItem] = []
        var delivered: [String] = []
        let controller = VoiceSessionController(dependencies: VoiceDependencies(
            settings: { settings },
            promptTerms: { [PromptDictionaryTerm(phrase: "Claude Code", aliases: ["cloud code"])] },
            ensureBackendReady: { try await BackendReadiness.ensureReady(client: client, timeout: 90) },
            makeTransport: { URLSessionVoiceTransport(url: VoiceEndpoint.webSocketURL(base: client.baseURL)) },
            makeAudioSource: { _ in WavFileAudioSource(url: wavURL, realtimeFactor: 4) },
            resolver: VoiceTaskResolver(readSelection: { SelectionSnapshot() }, readFocus: { nil }),
            deliver: { text, _, _ in delivered.append(text) },
            saveHistory: { history.append($0) }
        ))

        await controller.startRecording(intent: .dictate)
        XCTAssertEqual(controller.session.status, .recording, "错误：\(String(describing: controller.session.error))")

        // WAV 按 4 倍速“说完”，再多等一点让最后的分片发完。
        try await Task.sleep(nanoseconds: UInt64((seconds / 4 + 0.8) * 1_000_000_000))
        controller.stopRecording()

        let deadline = Date().addingTimeInterval(90)
        while ![VoiceStatus.completed, .error].contains(controller.session.status), Date() < deadline {
            try await Task.sleep(nanoseconds: 100_000_000)
        }

        let session = controller.session
        XCTAssertEqual(session.status, .completed, "错误：\(String(describing: session.error))")
        XCTAssertFalse(session.rawText.isEmpty, "后端没有返回识别原文")
        XCTAssertEqual(session.refinedText, "FAKE_REFINED", "润色结果应来自假大模型")
        XCTAssertGreaterThan(session.durationMs, 500)
        print("E2E rawText=\(session.rawText) durationMs=\(Int(session.durationMs))")

        XCTAssertEqual(delivered, ["FAKE_REFINED"])
        XCTAssertEqual(history.count, 1)
        XCTAssertEqual(history.first?.status, .completed)
        XCTAssertEqual(history.first?.rawText, session.rawText)
        controller.dispose()
    }

    func testSecondRoundOnSameBackendAndCancel() async throws {
        let env = ProcessInfo.processInfo.environment
        guard let backend = env["SPEAKMORE_E2E_BACKEND"], let wav = env["SPEAKMORE_E2E_WAV"], let llmURL = env["SPEAKMORE_E2E_LLM_URL"] else {
            throw XCTSkip("未设置 SPEAKMORE_E2E_* 环境变量，跳过端到端测试")
        }
        let client = BackendClient(baseURL: try XCTUnwrap(URL(string: backend)))
        let wavURL = URL(fileURLWithPath: wav)
        var settings = LocalSettings()
        let provider = LlmProvider(id: "custom", label: "Fake", baseUrl: llmURL, defaultModel: "fake-model", allowBaseUrlEdit: true, authType: .bearer)
        settings.llm = LlmSettings(providerId: "custom", providers: [provider], apiKeys: ["custom": "sk-e2e"], models: ["custom": "fake-model"])

        var history: [HistoryItem] = []
        let controller = VoiceSessionController(dependencies: VoiceDependencies(
            settings: { settings },
            promptTerms: { [] },
            ensureBackendReady: { try await BackendReadiness.ensureReady(client: client, timeout: 90) },
            makeTransport: { URLSessionVoiceTransport(url: VoiceEndpoint.webSocketURL(base: client.baseURL)) },
            makeAudioSource: { _ in WavFileAudioSource(url: wavURL, realtimeFactor: 4) },
            resolver: VoiceTaskResolver(readSelection: { SelectionSnapshot() }, readFocus: { nil }),
            deliver: { _, _, _ in },
            saveHistory: { history.append($0) }
        ))

        // 第一轮：录一会儿就取消，不能有结果、不进历史。
        await controller.startRecording(intent: .dictate)
        XCTAssertEqual(controller.session.status, .recording)
        try await Task.sleep(nanoseconds: 500_000_000)
        controller.cancelRecording()
        XCTAssertEqual(controller.session.status, .cancelled)

        // 第二轮：在同一个后端上正常完成，说明取消没有把后端或客户端状态弄脏。
        await controller.startRecording(intent: .translate)
        XCTAssertEqual(controller.session.status, .recording, "错误：\(String(describing: controller.session.error))")
        try await Task.sleep(nanoseconds: 1_500_000_000)
        controller.stopRecording()
        let deadline = Date().addingTimeInterval(90)
        while ![VoiceStatus.completed, .error].contains(controller.session.status), Date() < deadline {
            try await Task.sleep(nanoseconds: 100_000_000)
        }
        XCTAssertEqual(controller.session.status, .completed, "错误：\(String(describing: controller.session.error))")
        XCTAssertEqual(controller.session.mode, .translate)
        XCTAssertEqual(history.count, 1, "取消的那一轮不进历史")
        controller.dispose()
    }
}

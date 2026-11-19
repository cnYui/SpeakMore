import XCTest
@testable import SpeakMoreCore

/// 语音链路的纯规则，对照 Electron 版 TS / JS 实现生成的夹具（`voice` 段）。
final class VoiceParityTests: XCTestCase {
    private var voice: [String: Any]!

    override func setUpWithError() throws {
        let fixture = try XCTUnwrap(Fixture.json("parity.json") as? [String: Any])
        voice = try XCTUnwrap(fixture["voice"] as? [String: Any])
    }

    private func floats(_ value: Any?) throws -> [Float] {
        try XCTUnwrap(value as? [Double]).map { Float($0) }
    }

    private func assertClose(_ actual: [Float], _ expected: [Float], _ label: String, accuracy: Float = 1e-5, file: StaticString = #filePath, line: UInt = #line) {
        XCTAssertEqual(actual.count, expected.count, "\(label) 长度", file: file, line: line)
        for (index, pair) in zip(actual, expected).enumerated() {
            XCTAssertEqual(pair.0, pair.1, accuracy: accuracy, "\(label)[\(index)]", file: file, line: line)
        }
    }

    // MARK: - 错误文案 / 悬浮胶囊状态

    func testErrorMessagesMatchElectron() throws {
        let expected = try XCTUnwrap(voice["errorMessages"] as? [String: String])
        XCTAssertEqual(expected.count, VoiceErrorCode.allCases.count)
        for code in VoiceErrorCode.allCases {
            XCTAssertEqual(VoiceError(code).message, expected[code.rawValue], code.rawValue)
        }
    }

    func testFloatingBarStateMatchesElectron() throws {
        let cases = try XCTUnwrap(voice["floatingBar"] as? [[String: Any]])
        XCTAssertFalse(cases.isEmpty)
        for item in cases {
            let input = try XCTUnwrap(item["session"] as? [String: Any])
            var session = VoiceSession()
            session.status = try XCTUnwrap(VoiceStatus(rawValue: input["status"] as? String ?? ""))
            session.mode = try XCTUnwrap(VoiceMode(rawValue: input["mode"] as? String ?? ""))
            session.inputLevel = input["inputLevel"] as? Double ?? 0
            session.noticeText = input["noticeText"] as? String ?? ""
            if let error = input["error"] as? [String: Any], let code = VoiceErrorCode(rawValue: error["code"] as? String ?? "") {
                session.error = VoiceError(code)
            }

            let expected = try XCTUnwrap(item["expected"] as? [String: Any])
            let actual = VoiceSessionMath.floatingBarState(for: session)
            let label = "\(session.status) \(session.mode)"
            XCTAssertEqual(actual.visible, expected["visible"] as? Bool, label)
            XCTAssertEqual(actual.status.rawValue, expected["status"] as? String, label)
            XCTAssertEqual(actual.mode.rawValue, expected["mode"] as? String, label)
            XCTAssertEqual(actual.inputLevel, expected["inputLevel"] as? Double ?? 0, accuracy: 1e-9, label)
            XCTAssertEqual(actual.displayText, expected["displayText"] as? String, label)
            XCTAssertEqual(actual.errorMessage, expected["errorMessage"] as? String, label)
        }
    }

    // MARK: - WebSocket 消息路由

    func testMessageRoutingMatchesElectron() throws {
        let cases = try XCTUnwrap(voice["messages"] as? [[String: Any]])
        XCTAssertGreaterThan(cases.count, 30)
        for item in cases {
            let message = try XCTUnwrap(item["message"] as? String)
            let context = try XCTUnwrap(item["contextValue"] as? [String: Any])
            let ignored = Set(context["ignored"] as? [String] ?? [])
            let routed = VoiceServerMessage.route(message, context: VoiceMessageContext(
                currentAudioId: context["audioId"] as? String ?? "",
                currentRawText: context["rawText"] as? String ?? "",
                isIgnoredAudioId: { ignored.contains($0) },
                isCancelled: context["cancelled"] as? Bool ?? false,
                isTerminal: context["terminal"] as? Bool ?? false
            ))
            let expected = try XCTUnwrap(item["expected"] as? [String: Any])
            let label = "\(item["context"] ?? "") \(message)"
            switch expected["event"] as? String {
            case "rawText": XCTAssertEqual(routed, .rawText(expected["text"] as? String ?? ""), label)
            case "finalText": XCTAssertEqual(routed, .finalText(expected["text"] as? String ?? ""), label)
            case "interrupt": XCTAssertEqual(routed, .interrupt(expected["detail"] as? String ?? ""), label)
            case "ignored": XCTAssertEqual(routed, .ignored, label)
            case "failure":
                guard case .failure(let error) = routed else { return XCTFail("应为失败：\(label)，实际 \(routed)") }
                XCTAssertEqual(error.code.rawValue, expected["code"] as? String, label)
            default: XCTFail("未知期望 \(expected)")
            }
        }
    }

    // MARK: - 快捷键守卫

    func testShortcutGuardMatchesElectron() throws {
        let replays = try XCTUnwrap(voice["guardReplays"] as? [[String: Any]])
        XCTAssertGreaterThan(replays.count, 10)
        for replay in replays {
            let name = try XCTUnwrap(replay["name"] as? String)
            let steps = try XCTUnwrap(replay["steps"] as? [[Any]])
            let recorded = try XCTUnwrap(replay["recorded"] as? [[String: Any]])
            var guardState = ShortcutGuard()
            var voiceStatus = VoiceStatus.idle
            var timerPending = false

            for (index, step) in steps.enumerated() {
                var action = ShortcutAction.none
                let keyName = try XCTUnwrap(step[0] as? String)
                if keyName == "LONG_PRESS" {
                    // 只有定时器还在跑时它才会到点。
                    if timerPending {
                        _ = guardState.longPressFired()
                        timerPending = false
                    }
                } else {
                    if step.count > 2, let raw = step[2] as? String { voiceStatus = try XCTUnwrap(VoiceStatus(rawValue: raw)) }
                    let key = try XCTUnwrap(ShortcutKey(rawValue: keyName))
                    let output = guardState.handle(RawKeyEvent(key: key, isDown: step[1] as? Bool ?? false), voiceStatus: voiceStatus)
                    action = output.action
                    if output.startLongPressTimer { timerPending = true }
                    if output.cancelLongPressTimer { timerPending = false }
                }

                let expected = recorded[index]
                let label = "\(name) 第 \(index + 1) 步"
                let expectedAction = expected["action"] as? String
                switch action {
                case .none: XCTAssertEqual("none", expectedAction, label)
                case .toggleRecording(let intent): XCTAssertEqual("toggle:\(intent.rawValue)", expectedAction, label)
                }
                XCTAssertEqual(guardState.isBlocked, expected["blocked"] as? Bool, "\(label) blocked")
                XCTAssertEqual(guardState.hintVisible, expected["hint"] as? Bool, "\(label) hint")
                XCTAssertEqual(guardState.isRightAltDown, expected["down"] as? Bool, "\(label) down")
                XCTAssertEqual(guardState.activeIntent?.rawValue, expected["intent"] as? String, "\(label) intent")
            }
        }
    }

    // MARK: - 音频整理

    func testConditioningMatchesElectron() throws {
        let cases = try XCTUnwrap(voice["conditioning"] as? [String: [String: Any]])
        for (name, item) in cases {
            let actual = AudioConditioning.condition(try floats(item["input"]))
            assertClose(actual, try floats(item["expected"]), "condition \(name)")
        }
    }

    func testMonoMixMatchesElectron() throws {
        let cases = try XCTUnwrap(voice["mixing"] as? [String: [String: Any]])
        for (name, item) in cases {
            let channels = try XCTUnwrap(item["channels"] as? [[Double]]).map { $0.map { Float($0) } }
            assertClose(AudioConditioning.mixToMono(channels), try floats(item["expected"]), "mix \(name)")
        }
    }

    func testResamplingMatchesElectron() throws {
        let cases = try XCTUnwrap(voice["resampling"] as? [[String: Any]])
        for item in cases {
            let name = try XCTUnwrap(item["name"] as? String)
            let rate = try XCTUnwrap(item["rate"] as? Double)
            let actual = AudioConditioning.resample(try floats(item["input"]), from: rate, to: 16000)
            assertClose(actual, try floats(item["expected"]), "resample \(name)")
        }
    }

    func testPCM16EncodingMatchesElectron() throws {
        let item = try XCTUnwrap(voice["pcm16"] as? [String: Any])
        let data = AudioConditioning.encodePCM16(try floats(item["input"]))
        let actual = stride(from: 0, to: data.count, by: 2).map { offset in
            Int(Int16(littleEndian: data.subdata(in: offset..<offset + 2).withUnsafeBytes { $0.loadUnaligned(as: Int16.self) }))
        }
        XCTAssertEqual(actual, try XCTUnwrap(item["expected"] as? [Int]))
    }

    func testPCM16IsLittleEndianBytes() {
        let data = AudioConditioning.encodePCM16([0.5])
        XCTAssertEqual([UInt8](data), [0x00, 0x40])  // 16384 = 0x4000，低字节在前
    }

    // MARK: - start_audio

    func testStartAudioMessageMatchesElectron() throws {
        let cases = try XCTUnwrap(voice["startAudio"] as? [[String: Any]])
        XCTAssertEqual(cases.count, 6)
        for item in cases {
            let mode = try XCTUnwrap(VoiceMode(rawValue: item["mode"] as? String ?? ""))
            let llmJson = try XCTUnwrap(item["llm"] as? [String: String])
            let llm = LlmRequestConfig(
                providerId: llmJson["provider_id"] ?? "", baseUrl: llmJson["base_url"] ?? "",
                apiKey: llmJson["api_key"] ?? "", model: llmJson["model"] ?? "", authType: llmJson["auth_type"] ?? ""
            )
            let terms = try XCTUnwrap(item["terms"] as? [[String: Any]]).map {
                PromptDictionaryTerm(phrase: $0["phrase"] as? String ?? "", aliases: $0["aliases"] as? [String] ?? [])
            }
            let parameters = StartAudioParameters.make(
                mode: mode, selectedText: item["selectedText"] as? String ?? "", llm: llm,
                dictionaryTerms: terms,
                translationTargetLanguage: mode == .translate ? item["language"] as? String : nil
            )
            let text = try VoiceClientMessage.startAudio(audioId: "audio-1", mode: mode, parameters: parameters)
            let actual = try JSONSerialization.jsonObject(with: Data(text.utf8)) as? NSDictionary
            let expected = try XCTUnwrap(item["expected"] as? NSDictionary)
            XCTAssertEqual(actual, expected, "\(mode) \(item["selectedText"] ?? "")")
        }
    }

    func testEndAudioMessage() throws {
        let text = try VoiceClientMessage.endAudio(audioId: "abc")
        XCTAssertEqual(try JSONSerialization.jsonObject(with: Data(text.utf8)) as? NSDictionary, ["type": "end_audio", "audio_id": "abc"])
    }

    func testWebSocketURLCarriesLocalToken() {
        let url = VoiceEndpoint.webSocketURL(base: URL(string: "http://127.0.0.1:8031")!)
        XCTAssertEqual(url.absoluteString, "ws://127.0.0.1:8031/ws/rt_voice_flow?v=win_local&t=local-dev-token&m=0")
    }

    // MARK: - prompt 词典

    func testPromptDictionaryMatchesElectron() throws {
        let prompt = try XCTUnwrap(voice["prompt"] as? [String: Any])
        let nowString = try XCTUnwrap(prompt["now"] as? String)
        let now = try XCTUnwrap(ISO8601.date(from: nowString))
        let rawEntries = try JSONSerialization.data(withJSONObject: try XCTUnwrap(prompt["entries"]))
        let entries = try JSONDecoder().decode([DictionaryEntry].self, from: rawEntries)
        let cases = try XCTUnwrap(prompt["cases"] as? [[String: Any]])
        for item in cases {
            let limit = try XCTUnwrap(item["limit"] as? Int)
            let expected = try XCTUnwrap(item["expected"] as? [[String: Any]])
            let actual = PromptDictionary.terms(from: entries, limit: limit, now: now)
            XCTAssertEqual(actual.map(\.phrase), expected.map { $0["phrase"] as? String ?? "" }, "limit \(limit)")
            XCTAssertEqual(actual.map(\.aliases), expected.map { $0["aliases"] as? [String] ?? [] }, "limit \(limit) aliases")
        }
    }

    func testPromptLimitClamping() {
        XCTAssertEqual(PromptDictionary.clampLimit(3), 8)
        XCTAssertEqual(PromptDictionary.clampLimit(100), 40)
        XCTAssertEqual(PromptDictionary.clampLimit(Double.nan), 24)
        XCTAssertEqual(PromptDictionary.clampLimit(12.9), 12)
    }

    // MARK: - 其它小规则

    func testLevelMeterRisesFastAndFallsSlowly() {
        var meter = AudioLevelMeter()
        let up = meter.update(rms: 0.3)
        XCTAssertEqual(up, 0.4032, accuracy: 0.0002)  // (0.3×3.2=0.96) × 0.42
        let down = meter.update(rms: 0)
        XCTAssertEqual(down, up * (1 - 0.18), accuracy: 0.0002)
        XCTAssertLessThanOrEqual(meter.update(rms: 5), 1)
    }

    func testTextLengthCountsUTF16LikeJavaScript() {
        XCTAssertEqual(VoiceSessionMath.countTextLength("  你好  "), 2)
        XCTAssertEqual(VoiceSessionMath.countTextLength("😀"), 2)  // JS 的 String.length 也是 2
        XCTAssertEqual(VoiceSessionMath.countTextLength(" \n "), 0)
    }
}

import Foundation
@preconcurrency import AVFoundation
import CoreAudio

// 两种音频源：
//   · `MicrophoneAudioSource`：AVAudioEngine 采集麦克风，需要系统的“麦克风”权限；
//   · `WavFileAudioSource`：把一个 WAV 文件按实时节奏“播”出来当麦克风用，端到端测试和远程验证用（不需要任何系统权限）。

public final class MicrophoneAudioSource: AudioSource, @unchecked Sendable {
    private let deviceUID: String
    private let engine = AVAudioEngine()
    private var tapInstalled = false

    /// `deviceUID`：设置页里选的设备 id（AVCaptureDevice.uniqueID），"default" = 系统默认输入。
    public init(deviceUID: String = "default") {
        self.deviceUID = deviceUID
    }

    public func prepare() async throws {
        switch AVCaptureDevice.authorizationStatus(for: .audio) {
        case .authorized:
            break
        case .notDetermined:
            let granted = await AVCaptureDevice.requestAccess(for: .audio)
            if !granted { throw VoiceError(.microphonePermissionDenied) }
        default:
            throw VoiceError(.microphonePermissionDenied)
        }
        applySelectedDevice()
        let format = engine.inputNode.outputFormat(forBus: 0)
        if format.sampleRate <= 0 || format.channelCount == 0 {
            throw VoiceError(.microphoneUnavailable, detail: "输入设备没有可用的音频格式")
        }
    }

    public func begin(onChunk: @escaping @Sendable (AudioChunk) -> Void) throws {
        let input = engine.inputNode
        let format = input.outputFormat(forBus: 0)
        // 保留全部声道：部分耳机的人声会落在非第 0 声道，下游按声道能量混音。
        input.installTap(onBus: 0, bufferSize: 4096, format: format) { buffer, _ in
            guard let data = buffer.floatChannelData else { return }
            let frames = Int(buffer.frameLength)
            let channels = (0..<Int(buffer.format.channelCount)).map { channel in
                Array(UnsafeBufferPointer(start: data[channel], count: frames))
            }
            onChunk(AudioChunk(channels: channels, sampleRate: buffer.format.sampleRate))
        }
        tapInstalled = true
        engine.prepare()
        do {
            try engine.start()
        } catch {
            input.removeTap(onBus: 0)
            tapInstalled = false
            throw VoiceError(.recordingStartFailed, detail: error.localizedDescription)
        }
    }

    public func stop() {
        if tapInstalled {
            engine.inputNode.removeTap(onBus: 0)
            tapInstalled = false
        }
        if engine.isRunning { engine.stop() }
    }

    /// 把引擎的输入设备切到用户选的那个；找不到（比如耳机拔了）就保持系统默认。
    private func applySelectedDevice() {
        guard deviceUID != "default", let deviceID = Self.audioDeviceID(forUID: deviceUID),
              let unit = engine.inputNode.audioUnit else { return }
        var id = deviceID
        AudioUnitSetProperty(
            unit, kAudioOutputUnitProperty_CurrentDevice, kAudioUnitScope_Global, 0,
            &id, UInt32(MemoryLayout<AudioDeviceID>.size)
        )
    }

    static func audioDeviceID(forUID uid: String) -> AudioDeviceID? {
        var deviceID = AudioDeviceID(0)
        var cfUID = uid as CFString
        var address = AudioObjectPropertyAddress(
            mSelector: kAudioHardwarePropertyTranslateUIDToDevice,
            mScope: kAudioObjectPropertyScopeGlobal,
            mElement: kAudioObjectPropertyElementMain
        )
        var size = UInt32(MemoryLayout<AudioDeviceID>.size)
        let status = withUnsafeMutablePointer(to: &cfUID) { uidPointer in
            AudioObjectGetPropertyData(
                AudioObjectID(kAudioObjectSystemObject), &address,
                UInt32(MemoryLayout<CFString>.size), uidPointer, &size, &deviceID
            )
        }
        return status == noErr && deviceID != 0 ? deviceID : nil
    }
}

/// 读一个 WAV（任意采样率 / 声道数，PCM 或浮点），按实时节奏分片送出，像在对着麦克风说话。
public final class WavFileAudioSource: AudioSource, @unchecked Sendable {
    private let url: URL
    private let chunkFrames: Int
    private let realtimeFactor: Double
    private let lock = NSLock()
    private var worker: Task<Void, Never>?
    private var samples: [[Float]] = []
    private var sampleRate: Double = 16000

    /// `realtimeFactor`：1 = 实时；大于 1 加速（测试里用 8 倍）。
    public init(url: URL, chunkFrames: Int = 4096, realtimeFactor: Double = 1) {
        self.url = url
        self.chunkFrames = chunkFrames
        self.realtimeFactor = max(0.01, realtimeFactor)
    }

    public func prepare() async throws {
        do {
            let file = try AVAudioFile(forReading: url)
            let format = file.processingFormat
            guard let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: AVAudioFrameCount(file.length)) else {
                throw VoiceError(.microphoneUnavailable, detail: "无法读取 \(url.lastPathComponent)")
            }
            try file.read(into: buffer)
            guard let data = buffer.floatChannelData else { throw VoiceError(.microphoneUnavailable) }
            let frames = Int(buffer.frameLength)
            samples = (0..<Int(format.channelCount)).map { Array(UnsafeBufferPointer(start: data[$0], count: frames)) }
            sampleRate = format.sampleRate
        } catch let error as VoiceError {
            throw error
        } catch {
            throw VoiceError(.microphoneUnavailable, detail: error.localizedDescription)
        }
    }

    public func begin(onChunk: @escaping @Sendable (AudioChunk) -> Void) throws {
        let channels = samples
        let rate = sampleRate
        let frameCount = channels.first?.count ?? 0
        let step = chunkFrames
        let pause = UInt64(Double(step) / rate / realtimeFactor * 1_000_000_000)
        let task = Task.detached {
            var offset = 0
            while offset < frameCount && !Task.isCancelled {
                let end = min(frameCount, offset + step)
                onChunk(AudioChunk(channels: channels.map { Array($0[offset..<end]) }, sampleRate: rate))
                offset = end
                try? await Task.sleep(nanoseconds: pause)
            }
        }
        lock.lock(); worker = task; lock.unlock()
    }

    public func stop() {
        lock.lock(); let task = worker; worker = nil; lock.unlock()
        task?.cancel()
    }
}

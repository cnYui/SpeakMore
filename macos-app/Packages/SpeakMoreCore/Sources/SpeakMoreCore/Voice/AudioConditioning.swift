import Foundation

/// 送进后端前的音频整理：多声道取有声声道平均、去直流、把偏小的人声拉到 RMS 0.08、线性重采样到 16 kHz、编码 PCM16。
/// 算法和数值与 `audioCapture.ts` 一致，这样两个版本喂给 ASR 的音频是同一种东西。
public enum AudioConditioning {
    public static let targetSampleRate = 16000
    static let activeChannelRatio: Float = 0.15
    static let minGainRMS: Float = 0.003
    static let targetSpeechRMS: Float = 0.08
    static let maxSpeechGain: Float = 8
    static let maxGainPeak: Float = 0.95

    public static func rms(_ samples: [Float]) -> Float {
        guard !samples.isEmpty else { return 0 }
        var sum: Float = 0
        for sample in samples { sum += sample * sample }
        return (sum / Float(samples.count)).squareRoot()
    }

    static func peak(_ samples: [Float]) -> Float {
        samples.reduce(0) { max($0, abs($1)) }
    }

    /// 多声道只取“有声”的声道（RMS ≥ 最大声道的 15%）求平均，避免耳机只有一个声道有人声时被另一路静音稀释。
    public static func mixToMono(_ channels: [[Float]]) -> [Float] {
        guard let first = channels.first else { return [] }
        if channels.count == 1 { return first }
        let rmsValues = channels.map(rms)
        let maxRms = rmsValues.max() ?? 0
        let active = maxRms > 0
            ? channels.enumerated().filter { rmsValues[$0.offset] >= maxRms * activeChannelRatio }.map(\.element)
            : channels
        var output = [Float](repeating: 0, count: first.count)
        for channel in active {
            for index in 0..<min(first.count, channel.count) { output[index] += channel[index] }
        }
        let divisor = Float(max(1, active.count))
        for index in output.indices { output[index] /= divisor }
        return output
    }

    public static func removeDCOffset(_ samples: [Float]) -> [Float] {
        guard !samples.isEmpty else { return samples }
        let offset = samples.reduce(0, +) / Float(samples.count)
        if abs(offset) < 0.000001 { return samples }
        return samples.map { $0 - offset }
    }

    /// 去直流 + 对偏小的语音做增益（最多 8 倍，峰值不超过 0.95）；太安静（接近底噪）或已经够响的不动。
    public static func condition(_ samples: [Float]) -> [Float] {
        let normalized = removeDCOffset(samples)
        let level = rms(normalized)
        if level < minGainRMS { return normalized }
        let peakValue = peak(normalized)
        if peakValue <= 0 || level >= targetSpeechRMS { return normalized }
        let gain = min(maxSpeechGain, targetSpeechRMS / level, maxGainPeak / peakValue)
        if gain <= 1.01 { return normalized }
        return normalized.map { $0 * gain }
    }

    /// 线性插值重采样。蓝牙耳机麦克风可能只有 8 kHz，也要升到 16 kHz。
    public static func resample(_ input: [Float], from sourceRate: Double, to outputRate: Double) -> [Float] {
        guard !input.isEmpty, sourceRate.isFinite, outputRate.isFinite, sourceRate > 0, outputRate > 0 else { return input }
        if sourceRate == outputRate { return input }
        let ratio = sourceRate / outputRate
        let outputLength = max(1, Int((Double(input.count) / ratio).rounded()))
        var output = [Float](repeating: 0, count: outputLength)
        for index in 0..<outputLength {
            let sourceIndex = Double(index) * ratio
            let left = Int(sourceIndex.rounded(.down))
            let right = min(input.count - 1, left + 1)
            let weight = Float(sourceIndex - Double(left))
            let leftValue = left < input.count ? input[left] : 0
            let rightValue = right >= 0 && right < input.count ? input[right] : leftValue
            output[index] = leftValue + (rightValue - leftValue) * weight
        }
        return output
    }

    /// PCM16 小端字节；先裁剪到 [-1, 1] 避免溢出。
    public static func encodePCM16(_ samples: [Float]) -> Data {
        var data = Data(capacity: samples.count * 2)
        for sample in samples {
            let clipped = max(-1, min(1, sample))
            let value = Int16(max(-32768, min(32767, (clipped * 32768).rounded())))
            withUnsafeBytes(of: value.littleEndian) { data.append(contentsOf: $0) }
        }
        return data
    }

    /// 整条链路：多声道 → 单声道 → 整理 → 重采样 → PCM16。
    public static func pcm16Chunk(channels: [[Float]], sampleRate: Double) -> Data {
        let mono = condition(mixToMono(channels))
        let resampled = resample(mono, from: sampleRate, to: Double(targetSampleRate))
        return encodePCM16(resampled)
    }
}

/// 悬浮胶囊用的输入音量：RMS × 3.2 限幅到 1，再做“上升快、下降慢”的平滑，和 `audioLevelMonitor.ts` 一致。
public struct AudioLevelMeter: Sendable {
    public private(set) var level: Double = 0

    public init() {}

    @discardableResult
    public mutating func update(rms: Float) -> Double {
        let normalized = min(1, Double(rms) * 3.2)
        let smoothing = normalized > level ? 0.42 : 0.18
        level += (normalized - level) * smoothing
        level = (level * 10_000).rounded() / 10_000
        return level
    }

    public mutating func reset() { level = 0 }
}

import SwiftUI
import SpeakMoreCore

/// 悬浮胶囊里的粒子球：斐波那契球面上的点绕竖轴旋转，录音时半径随输入音量起伏，
/// 转写时转得更快，完成 / 取消 / 出错各有自己的颜色（和 Electron 版 `floating-bar.html` 的色调一致）。
enum SphereTone: Equatable {
    case idle, recording, processing, completed, cancelled, error

    init(status: VoiceStatus) {
        switch status {
        case .recording: self = .recording
        case .stopping, .transcribing: self = .processing
        case .completed: self = .completed
        case .cancelled: self = .cancelled
        case .error: self = .error
        case .idle, .connecting: self = .idle
        }
    }

    /// 粒子颜色（RGB 0–1）。
    var color: (r: Double, g: Double, b: Double) {
        switch self {
        case .idle: (0.78, 0.82, 0.88)
        case .recording: (0.49, 0.83, 0.99)
        case .processing, .completed: (0.29, 0.87, 0.50)
        case .cancelled, .error: (0.97, 0.44, 0.44)
        }
    }

    var spinSpeed: Double {
        switch self {
        case .idle: 0.35
        case .recording: 0.8
        case .processing: 1.9
        case .completed: 0.9
        case .cancelled, .error: 0.25
        }
    }

    var baseAlpha: Double { self == .idle ? 0.55 : 0.95 }
}

struct ParticleSphereView: View {
    let tone: SphereTone
    let level: Double

    private static let particles: [SIMD3<Double>] = {
        let count = 280
        let golden = Double.pi * (3 - 5.0.squareRoot())
        return (0..<count).map { index in
            let y = 1 - 2 * (Double(index) + 0.5) / Double(count)
            let radius = (1 - y * y).squareRoot()
            let theta = golden * Double(index)
            return SIMD3(cos(theta) * radius, y, sin(theta) * radius)
        }
    }()

    var body: some View {
        TimelineView(.animation) { timeline in
            Canvas { context, size in
                let time = timeline.date.timeIntervalSinceReferenceDate
                draw(context: &context, size: size, time: time)
            }
        }
        .accessibilityHidden(true)
    }

    private func draw(context: inout GraphicsContext, size: CGSize, time: Double) {
        let center = CGPoint(x: size.width / 2, y: size.height / 2)
        let base = min(size.width, size.height) * 0.36
        let breathing = 1 + 0.03 * sin(time * 1.6)
        let radius = base * breathing * (1 + 0.32 * max(0, min(1, level)))
        let angle = time * tone.spinSpeed
        let tilt = 0.35
        let (sinA, cosA) = (sin(angle), cos(angle))
        let (sinT, cosT) = (sin(tilt), cos(tilt))
        let color = tone.color

        for (index, point) in Self.particles.enumerated() {
            // 先绕 Y 轴转，再整体前倾一点，球看起来更立体。
            let x1 = point.x * cosA + point.z * sinA
            let z1 = -point.x * sinA + point.z * cosA
            let y2 = point.y * cosT - z1 * sinT
            let z2 = point.y * sinT + z1 * cosT
            // 录音时每个粒子按自己的相位微微抖动，随音量加大。
            let wobble = 1 + 0.07 * level * sin(time * 9 + Double(index) * 0.7)
            let depth = (z2 + 1) / 2
            let x = center.x + x1 * radius * wobble
            let y = center.y + y2 * radius * wobble
            let diameter = 1.1 + 1.9 * depth
            let alpha = tone.baseAlpha * (0.25 + 0.75 * depth)
            let rect = CGRect(x: x - diameter / 2, y: y - diameter / 2, width: diameter, height: diameter)
            context.fill(Path(ellipseIn: rect), with: .color(Color(red: color.r, green: color.g, blue: color.b).opacity(alpha)))
        }
    }
}

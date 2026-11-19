// swift-tools-version: 6.0
import PackageDescription

// SpeakMore 原生 macOS 版的非 UI 逻辑：本地数据读写、与现有 Electron 版兼容的 JSON 格式、后端 HTTP 客户端。
// 不依赖 AppKit / SwiftUI，所以可以直接 `swift test` 在命令行验证，不需要图形会话。
let package = Package(
    name: "SpeakMoreCore",
    platforms: [.macOS(.v15)],
    products: [
        .library(name: "SpeakMoreCore", targets: ["SpeakMoreCore"]),
    ],
    targets: [
        .target(
            name: "SpeakMoreCore",
            resources: [.process("Resources")]
        ),
        .testTarget(
            name: "SpeakMoreCoreTests",
            dependencies: ["SpeakMoreCore"],
            resources: [.copy("Fixtures")]
        ),
    ],
    swiftLanguageModes: [.v5]
)

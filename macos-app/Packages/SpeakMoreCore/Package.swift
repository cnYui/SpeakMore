// swift-tools-version: 6.0
import PackageDescription

// SpeakMore 原生 macOS 版的非 UI 逻辑，分两层：
//   · SpeakMoreCore：本地数据读写、和 Electron 版兼容的 JSON 格式、后端 HTTP / WebSocket 客户端、语音会话状态机、快捷键守卫。
//     不依赖 AppKit / SwiftUI，所以可以直接 `swift test` 在命令行验证，不需要图形会话。
//   · SpeakMorePlatform：必须碰系统的部分——全局键盘监听（CGEventTap）、辅助功能（AX）读焦点和选区、剪贴板、模拟 Cmd+V、权限状态。
//     依赖 AppKit / ApplicationServices，但没有界面；需要系统权限的调用会在没有权限时优雅失败，所以也能在命令行测试。
let package = Package(
    name: "SpeakMoreCore",
    platforms: [.macOS(.v15)],
    products: [
        .library(name: "SpeakMoreCore", targets: ["SpeakMoreCore"]),
        .library(name: "SpeakMorePlatform", targets: ["SpeakMorePlatform"]),
    ],
    targets: [
        .target(
            name: "SpeakMoreCore",
            resources: [.process("Resources")]
        ),
        .target(
            name: "SpeakMorePlatform",
            dependencies: ["SpeakMoreCore"]
        ),
        .testTarget(
            name: "SpeakMoreCoreTests",
            dependencies: ["SpeakMoreCore"],
            resources: [.copy("Fixtures")]
        ),
        .testTarget(
            name: "SpeakMorePlatformTests",
            dependencies: ["SpeakMorePlatform", "SpeakMoreCore"]
        ),
    ],
    swiftLanguageModes: [.v5]
)

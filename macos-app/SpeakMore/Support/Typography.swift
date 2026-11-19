import SwiftUI

/// 字号规范（全项目统一，和 Windows 版 `electron-app/renderer/src/uiTokens.ts` 的 `typo` 一致）。
///
/// 只有 5 个字号，视图里不要再用 `.title2` / `.callout` / `.caption` 这类系统语义字号，也不要写死数字，直接用下面的字体：
///
///   title    24 / semibold  页面标题（每页只有一个；原生版的页面标题由工具栏标题承担，这里留给需要时用）
///   stat     20 / semibold  大数字（统计值）
///   heading  16 / semibold  卡片 / 区块标题
///   body     14 / regular   正文、表单行、列表内容、按钮、输入框、菜单、导航（强调用 bodyMedium / bodyStrong）
///   caption  12 / regular   说明、提示、日期、状态标签、键帽（徽章、键帽用 captionMedium）
///
/// 窗口根视图统一设置 `.font(AppFont.body)`，所以没写字体的 `Text` 就是 body。
/// 图标尺寸不属于字号：行内小图标 16，导航 / 操作图标 18。
enum AppFont {
    static let title = Font.system(size: 24, weight: .semibold)
    static let stat = Font.system(size: 20, weight: .semibold)
    static let heading = Font.system(size: 16, weight: .semibold)
    static let body = Font.system(size: 14)
    static let bodyMedium = Font.system(size: 14, weight: .medium)
    static let bodyStrong = Font.system(size: 14, weight: .semibold)
    static let caption = Font.system(size: 12)
    static let captionMedium = Font.system(size: 12, weight: .medium)

    /// 和 Windows 版共用的数值，供测试 / 文档核对。
    static let scale: [(name: String, size: CGFloat)] = [
        ("title", 24), ("stat", 20), ("heading", 16), ("body", 14), ("caption", 12),
    ]
}

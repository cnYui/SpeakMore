import Foundation
import Observation
import SpeakMoreCore

/// 界面文案。语言来自设置里的 `preferredLanguage`（可以和系统语言不同），
/// 文案放在 `Localizable.xcstrings`（由 `Tools/generate-localizable.mjs` 从 Electron 版的 i18n.tsx 生成），
/// Xcode 会把它编译成每种语言各一个 `.lproj`，这里按设置选用对应的那个。
@MainActor
@Observable
final class Localizer {
    private let settings: SettingsStore
    private var bundles: [String: Bundle] = [:]

    init(settings: SettingsStore) {
        self.settings = settings
    }

    var language: InterfaceLanguage { settings.settings.preferredLanguage }

    var locale: Locale { Locale(identifier: language.localeIdentifier) }

    func t(_ key: String) -> String {
        bundle(for: language).localizedString(forKey: key, value: key, table: "Localizable")
    }

    func format(_ key: String, _ arguments: CVarArg...) -> String {
        String(format: t(key), locale: locale, arguments: arguments)
    }

    private func bundle(for language: InterfaceLanguage) -> Bundle {
        let identifier = language.localeIdentifier
        if let cached = bundles[identifier] { return cached }
        let resolved = Bundle.main.path(forResource: identifier, ofType: "lproj").flatMap(Bundle.init(path:)) ?? .main
        bundles[identifier] = resolved
        return resolved
    }
}

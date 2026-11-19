import SwiftUI

/// 主窗口：左侧边栏 + 右侧详情，标准的 macOS `NavigationSplitView`。
struct ContentView: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        @Bindable var model = model

        NavigationSplitView {
            List(selection: $model.selection) {
                Section(model.t("app.name")) {
                    ForEach(AppPage.allCases) { page in
                        Label(model.t(page.titleKey), systemImage: page.symbol)
                            .tag(page)
                    }
                }
            }
            .navigationSplitViewColumnWidth(min: 180, ideal: 200, max: 260)
        } detail: {
            let page = model.selection ?? .home
            detail(for: page)
                .navigationTitle(model.t(page.titleKey))
                .navigationSubtitle(model.t("app.name"))
        }
        // 半透明窗口：桌面和后面的内容透过材质露出来，侧边栏 / 工具栏的玻璃才有东西可折射。
        .containerBackground(.ultraThinMaterial, for: .window)
        // 默认字号 = 规范里的 body（14）；没写字体的 Text 都走这里，见 Support/Typography.swift。
        .font(AppFont.body)
        .toolbar {
            // 工具栏按钮是系统的玻璃样式；点一下就能不用快捷键直接开始一轮语音输入。
            ToolbarItem(placement: .primaryAction) {
                Menu {
                    Button(model.t("toolbar.dictate"), systemImage: "mic") { model.coordinator?.toggle(mode: .dictate) }
                    Button(model.t("toolbar.ask"), systemImage: "questionmark.bubble") { model.coordinator?.toggle(mode: .ask) }
                    Button(model.t("toolbar.translate"), systemImage: "translate") { model.coordinator?.toggle(mode: .translate) }
                } label: {
                    Label(model.t("toolbar.voiceInput"), systemImage: "mic.fill")
                }
            }
        }
        .task { await model.monitorLocalChanges() }
        .task { await ScreenshotTour.runIfRequested(model: model) }
    }

    @ViewBuilder
    private func detail(for page: AppPage) -> some View {
        switch page {
        case .setup: SetupView()
        case .home: DashboardView()
        case .history: HistoryView()
        case .dictionary: DictionaryView()
        case .settings: SettingsView()
        }
    }
}

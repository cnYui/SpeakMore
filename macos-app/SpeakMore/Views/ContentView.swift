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

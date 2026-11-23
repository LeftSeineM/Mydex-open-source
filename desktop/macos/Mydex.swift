import SwiftUI
import AppKit
import ServiceManagement

// One local child owns the connection server. No HTTP admin port, model keys,
// or third-party login is introduced by the native UI.
@MainActor final class Connector: ObservableObject {
    @Published var status: [String: Any] = [:]
    @Published var notice = "正在检查本机连接…"
    @Published var busy = false
    @Published var relayImage: NSImage?
    @Published var relayConfirmation = ""
    @Published var autostart = SMAppService.mainApp.status == .enabled
    private var process: Process?
    private var input: FileHandle?
    private var buffer = Data()
    private var sequence = 0
    private var pending: [Int: CheckedContinuation<[String: Any], Error>] = [:]
    private var timers: [Int: Task<Void, Never>] = [:]
    private var poll: Task<Void, Never>?
    var connected: Bool { status["connected"] as? Bool ?? false }
    var configured: Bool { status["configured"] as? Bool ?? false }
    var tools: [[String: Any]] { status["tools"] as? [[String: Any]] ?? [] }
    var version: String { Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "开发版" }

    func launch() {
        guard process == nil, let root = Bundle.main.resourceURL?.appendingPathComponent("engine") else { return }
        let child = Process(), stdinPipe = Pipe(), stdoutPipe = Pipe()
        child.executableURL = root.appendingPathComponent("runtime/node")
        child.arguments = [root.appendingPathComponent("desktop/macos/bridge.mjs").path]
        child.currentDirectoryURL = root
        var env = ProcessInfo.processInfo.environment
        env["PATH"] = "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:" + (env["PATH"] ?? "")
        let arguments = ProcessInfo.processInfo.arguments
        if let index = arguments.firstIndex(of: "--mydex-update-job"), index + 1 < arguments.count { env["MYDEX_UPDATE_JOB"] = arguments[index + 1] }
        child.environment = env
        child.standardInput = stdinPipe; child.standardOutput = stdoutPipe
        child.standardError = FileHandle.nullDevice
        stdoutPipe.fileHandleForReading.readabilityHandler = { [weak self] handle in
            let bytes = handle.availableData
            guard !bytes.isEmpty else { handle.readabilityHandler = nil; return }
            Task { @MainActor in self?.receive(bytes) }
        }
        child.terminationHandler = { [weak self] _ in
            Task { @MainActor in
                guard let self else { return }
                self.process = nil; self.input = nil; self.status["connected"] = false
                self.notice = "连接服务已退出，点击重新检查可重启。"
                self.failAll("连接服务已退出；请检查操作是否已经完成")
            }
        }
        do { try child.run(); process = child; input = stdinPipe.fileHandleForWriting }
        catch { notice = "无法启动连接服务：\(error.localizedDescription)"; return }
        poll?.cancel()
        poll = Task { [weak self] in
            guard let self else { return }
            await self.refresh()
            if self.configured { await self.perform("start") }
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: 8_000_000_000)
                if Task.isCancelled { break }
                if !self.busy { await self.refresh() }
            }
        }
    }
    private func receive(_ bytes: Data) {
        buffer.append(bytes)
        if buffer.count > 16 * 1024 * 1024 { buffer.removeAll(); failAll("本机响应过大"); return }
        while let newline = buffer.firstIndex(of: 10) {
            let line = buffer[..<newline]; buffer.removeSubrange(...newline)
            guard let obj = try? JSONSerialization.jsonObject(with: line) as? [String: Any],
                  let id = obj["id"] as? Int, let continuation = pending.removeValue(forKey: id) else { continue }
            timers.removeValue(forKey: id)?.cancel()
            if let error = obj["error"] as? String { continuation.resume(throwing: failure(error)) }
            else { continuation.resume(returning: obj["result"] as? [String: Any] ?? [:]) }
        }
    }
    private func failure(_ text: String) -> NSError { NSError(domain: "Mydex", code: 1, userInfo: [NSLocalizedDescriptionKey: text]) }
    private func failAll(_ text: String) {
        let waiting = pending; pending.removeAll()
        for timer in timers.values { timer.cancel() }; timers.removeAll()
        for continuation in waiting.values { continuation.resume(throwing: failure(text)) }
    }
    func request(_ action: String, _ args: [String: Any] = [:]) async throws -> [String: Any] {
        guard let input, process?.isRunning == true else { throw failure("连接服务未启动") }
        sequence += 1; let id = sequence
        var bytes = try JSONSerialization.data(withJSONObject: ["id": id, "action": action, "args": args]); bytes.append(10)
        return try await withCheckedThrowingContinuation { continuation in
            pending[id] = continuation
            timers[id] = Task { [weak self] in
                try? await Task.sleep(nanoseconds: action == "installUpdate" ? 360_000_000_000 : 30_000_000_000)
                guard !Task.isCancelled, let self, let waiting = self.pending.removeValue(forKey: id) else { return }
                self.timers.removeValue(forKey: id)
                waiting.resume(throwing: self.failure("响应超时，请先检查当前状态；操作不会自动重复"))
            }
            do { try input.write(contentsOf: bytes) }
            catch { pending.removeValue(forKey: id)?.resume(throwing: error); timers.removeValue(forKey: id)?.cancel() }
        }
    }
    func refresh(force: Bool = false) async {
        do { status = try await request("status", ["force": force]); notice = (status["error"] as? String).flatMap { $0.isEmpty ? nil : $0 } ?? (connected ? "连接服务运行中 · 手机可使用配对地址连接" : "连接服务未启动") }
        catch { notice = error.localizedDescription }
    }
    func perform(_ action: String, _ args: [String: Any] = [:]) async {
        guard !busy else { return }; busy = true; defer { busy = false }
        do { _ = try await request(action, args); await refresh(force: true) }
        catch { notice = error.localizedDescription }
    }
    func updateAndRestart() async {
        guard !busy else { return }; busy = true; defer { busy = false }
        do {
            var phase = (status["update"] as? [String: Any])?["phase"] as? String ?? ""
            if phase == "available" {
                notice = "正在下载并校验更新，完成后将安装并重新打开 Mydex。"
                _ = try await request("downloadUpdate")
                let deadline = Date().addingTimeInterval(240)
                while Date() < deadline {
                    status = try await request("status")
                    let update = status["update"] as? [String: Any] ?? [:]
                    phase = update["phase"] as? String ?? ""
                    notice = update["message"] as? String ?? notice
                    if phase == "ready" { break }
                    if phase == "error" { throw failure(notice) }
                    try await Task.sleep(nanoseconds: 700_000_000)
                }
            }
            guard phase == "ready" else { throw failure("更新包尚未准备完成，请稍后重试") }
            notice = "正在准备安装；如需要管理员授权，请在系统弹窗中确认。"
            let result = try await request("installUpdate")
            guard result["helperReady"] as? Bool == true else { throw failure("安装助手尚未就绪，当前程序保留") }
            _ = try? await request("stop")
            NSApp.terminate(nil)
        } catch { notice = error.localizedDescription }
    }
    func pairWeb() async {
        do {
            let result = try await request("relayPairing")
            if let encoded = result["image"] as? String, let data = Data(base64Encoded: encoded) {
                relayImage = NSImage(data: data)
                relayConfirmation = result["name"] as? String ?? ""
                notice = "在手机 Mydex 网页中登录并打开扫码配对，核对确认码。二维码五分钟有效。"
            }
        } catch { notice = error.localizedDescription }
    }
    func copyPairing() async {
        do {
            let result = try await request("tunnelPairing")
            guard let bundle = result["bundle"] as? String else { return }
            NSPasteboard.general.clearContents(); NSPasteboard.general.setString(bundle, forType: .string)
            notice = "配对信息已复制，请只粘贴到自己的手机。"
        } catch { notice = error.localizedDescription }
    }
    func setAutostart(_ enabled: Bool) {
        do {
            if enabled { try SMAppService.mainApp.register() } else { try SMAppService.mainApp.unregister() }
            autostart = SMAppService.mainApp.status == .enabled
            notice = SMAppService.mainApp.status == .requiresApproval ? "请在系统设置的登录项中允许 Mydex。" : "登录启动设置已保存"
        } catch { notice = error.localizedDescription }
    }
    func shutdown() { poll?.cancel(); try? input?.close(); input = nil; process?.terminate(); failAll("Mydex 已退出") }
}

@MainActor final class AppDelegate: NSObject, NSApplicationDelegate {
    static weak var connector: Connector?
    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { false }
    func applicationWillTerminate(_ notification: Notification) { Self.connector?.shutdown() }
}

@main struct MydexApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) var delegate
    @StateObject private var connector = Connector()
    var body: some Scene {
        WindowGroup("Mydex", id: "main") {
            MainView().environmentObject(connector).onAppear {
                AppDelegate.connector = connector; connector.launch()
            }
        }.defaultSize(width: 980, height: 680)
        MenuBarExtra("Mydex", systemImage: "terminal") {
            TrayView().environmentObject(connector)
        }
    }
}
struct TrayView: View {
    @EnvironmentObject var connector: Connector
    @Environment(\.openWindow) var openWindow
    var body: some View {
        Text(connector.connected ? "Mydex · 已连接" : "Mydex · 未连接")
        Button("打开 Mydex") { openWindow(id: "main"); NSApp.activate(ignoringOtherApps: true) }
        Button("复制手机配对信息") { Task { await connector.copyPairing() } }.disabled(!connector.configured)
        Divider()
        Button("启动连接") { Task { await connector.perform("start") } }.disabled(!connector.configured)
        Button("停止连接") { Task { await connector.perform("stop") } }
        Divider()
        Button("退出 Mydex") { NSApp.terminate(nil) }
    }
}

enum Page: String, CaseIterable, Identifiable {
    case overview = "连接概览", tools = "工具接入", pair = "配对手机", settings = "设置"
    var id: Self { self }
    var symbol: String { switch self { case .overview: return "network"; case .tools: return "terminal"; case .pair: return "iphone"; case .settings: return "gearshape" } }
}
struct MainView: View {
    @EnvironmentObject var connector: Connector
    @State private var page: Page? = .overview
    @State private var configuring = false
    var body: some View {
        NavigationSplitView {
            VStack(alignment: .leading, spacing: 24) {
                HStack(spacing: 12) {
                    Image(nsImage: NSApplication.shared.applicationIconImage).resizable().frame(width: 44, height: 44)
                    VStack(alignment: .leading) { Text("Mydex").font(.title2.bold()); Text("电脑连接中心").font(.caption).foregroundStyle(.secondary) }
                }.padding(.horizontal, 16).padding(.top, 24)
                List(Page.allCases, selection: $page) { item in Label(item.rawValue, systemImage: item.symbol).tag(item) }.listStyle(.sidebar)
                Text("macOS \(connector.version)\n数据留在你的电脑").font(.caption).foregroundStyle(.secondary).lineSpacing(6).padding(20)
            }.navigationSplitViewColumnWidth(min: 210, ideal: 220, max: 260)
        } detail: {
            VStack(alignment: .leading, spacing: 0) {
                ScrollView {
                    VStack(alignment: .leading, spacing: 24) {
                        Text((page ?? .overview).rawValue).font(.system(size: 30, weight: .bold))
                        switch page ?? .overview {
                        case .overview: overview
                        case .tools: tools
                        case .pair: pairing
                        case .settings: settings
                        }
                    }.padding(32).frame(maxWidth: .infinity, alignment: .leading)
                }
                Divider()
                HStack { Circle().fill(connector.connected ? Color.green : Color.orange).frame(width: 7, height: 7); Text(connector.notice).font(.caption).foregroundStyle(.secondary); Spacer(); if connector.busy { ProgressView().controlSize(.small) } }.padding(16)
            }.background(Color(nsColor: .windowBackgroundColor))
        }.frame(minWidth: 840, minHeight: 580)
        .sheet(isPresented: $configuring) { SetupView().environmentObject(connector) }
    }
    var overview: some View {
        VStack(alignment: .leading, spacing: 24) {
            Text("让手机连接这台 Mac，随时查看项目与对话。").foregroundStyle(.secondary)
            GroupBox {
                HStack(spacing: 16) {
                    Image(systemName: "desktopcomputer").font(.system(size: 38)).foregroundStyle(Color.accentColor)
                    VStack(alignment: .leading, spacing: 8) {
                        Text(Host.current().localizedName ?? "这台 Mac").font(.title3.bold())
                        Text(connector.connected ? "连接服务正在运行" : "等待连接").foregroundStyle(.secondary)
                        Text(connector.status["address"] as? String ?? "尚未配置手机访问地址").font(.caption).textSelection(.enabled)
                    }; Spacer()
                }.padding(18).frame(maxWidth: .infinity)
            }
            HStack {
                if !connector.configured { Button("设置这台电脑") { configuring = true }.buttonStyle(.borderedProminent) }
                else {
                    Button(connector.connected ? "停止连接" : "启动连接") { Task { await connector.perform(connector.connected ? "stop" : "start") } }.buttonStyle(.borderedProminent)
                    Button("配对手机") { page = .pair }
                }
                Button("重新检查") { connector.launch(); Task { await connector.refresh(force: true) } }
            }.disabled(connector.busy)
            Text("每台电脑独立配对。其他电脑关闭时，不影响这台 Mac 的连接。跨网络使用还需要手机能够访问配对地址。").font(.callout).foregroundStyle(.secondary)
        }
    }
    var tools: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("安装与运行状态仅用于发现工具；是否能继续原对话，以实际连接结果为准。").foregroundStyle(.secondary)
            if connector.tools.isEmpty { Text("暂未发现工具。请先打开桌面 coding 工具，再重新检查。").padding(24) }
            ForEach(connector.tools, id: \.toolIdentity) { tool in
                GroupBox {
                    VStack(alignment: .leading, spacing: 10) {
                        HStack { Text(tool["name"] as? String ?? "工具").font(.headline); Spacer(); Text(tool["running"] as? Bool == true ? "运行中" : "未运行").font(.caption).foregroundStyle(.secondary) }
                        Text(tool["note"] as? String ?? "等待检查").font(.callout).foregroundStyle(.secondary)
                        if let capabilities = tool["capabilities"] as? [String: Any] {
                            HStack(spacing: 16) {
                                Label(capabilities["history"] as? Bool == true ? "可读历史" : "历史未接通", systemImage: "clock")
                                Label(capabilities["send"] as? Bool == true ? "可续聊原会话" : "续聊未接通", systemImage: "text.bubble")
                                Label(capabilities["create"] as? Bool == true ? "可新建" : "新建未接通", systemImage: "plus.bubble")
                            }.font(.caption).foregroundStyle(.secondary)
                        }

                    }.padding(12).frame(maxWidth: .infinity, alignment: .leading)
                }
            }
            Button("重新检查") { Task { await connector.refresh(force: true) } }
            Text("DeepSeek 连接由 Mydex 自动发现和维护，不需要单独安装 Python 脚本。原工具仍须正常运行并已配置账号；各工具能力以实际结果为准。Windows 兼容补丁不会在 Mac 上安装。").font(.caption).foregroundStyle(.secondary)
        }
    }
    var pairing: some View {
        VStack(alignment: .leading, spacing: 24) {
            Text("苹果 / 纯血鸿蒙使用网页中继；安卓使用免账号应用配对。").foregroundStyle(.secondary)
            Button("网页中继配对 / 刷新二维码") { Task { await connector.pairWeb() } }.buttonStyle(.borderedProminent).disabled(!connector.configured)
            if let image = connector.relayImage {
                Image(nsImage: image).resizable().interpolation(.none).frame(width: 280, height: 280)
                Text(connector.relayConfirmation).font(.title2.monospacedDigit())
                Text("手机打开 Mydex 网页 → 登录 → 扫码配对 → 核对确认码。五分钟内完成绑定。").font(.caption).foregroundStyle(.secondary)
            }
            Text((connector.status["relayOnline"] as? Bool == true) ? "网页中继已连接" : "未连接网页中继").foregroundStyle(.secondary)
            GroupBox {
                VStack(alignment: .leading, spacing: 18) {
                    Label("在电脑复制全部配对信息", systemImage: "1.circle")
                    Label("打开 Mydex 手机端，添加电脑", systemImage: "2.circle")
                    Label("粘贴全部信息，保存并连接", systemImage: "3.circle")
                    Button("复制全部配对信息") { Task { await connector.copyPairing() } }.buttonStyle(.borderedProminent).disabled(!connector.configured)
                }.padding(20).frame(maxWidth: .infinity, alignment: .leading)
            }
            Text("配对信息包含访问令牌，只交给自己的设备。此页面不显示令牌，方便安全截图。").font(.caption).foregroundStyle(.secondary)
        }
    }
    var settings: some View {
        VStack(alignment: .leading, spacing: 24) {
            Toggle("登录 Mac 后自动启动 Mydex", isOn: Binding(get: { connector.autostart }, set: { connector.setAutostart($0) }))
            Text("关闭窗口后留在菜单栏；选择“退出 Mydex”会停止本应用启动的连接服务。").foregroundStyle(.secondary)
            Button("打开本机数据目录") {
                if let value = connector.status["dataRoot"] as? String { NSWorkspace.shared.open(URL(fileURLWithPath: value)) }
            }
            Divider()
            Text("Mydex \(connector.version)").font(.headline)
            Button("检查 Mac 更新") { Task { await connector.perform("checkUpdate") } }
            Text((connector.status["update"] as? [String: Any])?["message"] as? String ?? "启动后会自动检查 Mac 新版本").foregroundStyle(.secondary)
            if let update = connector.status["update"] as? [String: Any] {
                if update["phase"] as? String == "available" { Button("更新并重启") { Task { await connector.updateAndRestart() } }.disabled(connector.busy) }
                if update["phase"] as? String == "ready" { Button("安装并重启") { Task { await connector.updateAndRestart() } }.disabled(connector.busy) }
                Text(update["notes"] as? String ?? "").font(.caption).foregroundStyle(.secondary)
                if let resultMessage = update["lastInstallMessage"] as? String, !resultMessage.isEmpty { Text("上次更新：" + resultMessage).font(.caption).foregroundStyle(.secondary) }
            }
            Text("更新包按芯片架构校验签名和哈希，自动安装并重启 Mydex，保留原账号和连接配置。手机连接会短暂中断，请先完成发送和审批；需要管理员权限时由系统询问。").font(.caption).foregroundStyle(.secondary)
            Link("Mac 安装与更新教程", destination: URL(string: "https://app.leftseinem.dpdns.org/macos.html")!)
            Button("授权 Codex 桌面新建会话") { Task { await connector.perform("authorizeCodexDesktop") } }
            Text("手机可自动打开 Codex 原会话。手机新建需首次授权辅助功能，并保持 Mac 已解锁、Codex 已登录。功能为预览，尚未真机联调。")
                .font(.caption).foregroundStyle(.secondary)
            Text("联系开发者 · 348897402@qq.com").textSelection(.enabled)
            Text("模型与账号设置沿用各个电脑工具，Mydex 不内置模型。").foregroundStyle(.secondary)
        }
    }
}
extension Dictionary where Key == String, Value == Any {
    var toolIdentity: String { self["id"] as? String ?? "unknown" }
}

struct SetupView: View {
    @EnvironmentObject var connector: Connector
    @Environment(\.dismiss) var dismiss
    @State private var name = ""
    @State private var address = ""
    @State private var codex = ""
    @State private var thread = ""
    @State private var error = ""
    @State private var saving = false
    var body: some View {
        VStack(alignment: .leading, spacing: 20) {
            Text("设置这台 Mac").font(.title2.bold())
            Text("填写手机可访问的地址。局域网地址仅适用于同一网络；外网需要可达地址或自己的私有网络。").foregroundStyle(.secondary)
            TextField("电脑名称", text: $name)
            TextField("HTTPS 地址，例如 https://192.168.1.20:18443", text: $address)
            DisclosureGroup("Codex 连接设置（自动检测）") {
                TextField("Codex 可执行文件", text: $codex)
                TextField("已有会话 ID", text: $thread)
            }
            if !error.isEmpty { Text(error).foregroundStyle(.red).font(.callout) }
            HStack { Spacer(); Button("取消") { dismiss() }; Button(saving ? "正在配置…" : "保存并启动") {
                saving = true
                Task {
                    do {
                        _ = try await connector.request("configureHub", ["name": name, "address": address, "codex": codex, "thread": thread])
                        _ = try await connector.request("start"); await connector.refresh(); dismiss()
                    } catch { self.error = error.localizedDescription }
                    saving = false
                }
            }.buttonStyle(.borderedProminent).disabled(saving || address.isEmpty) }
        }.padding(28).frame(width: 550).textFieldStyle(.roundedBorder)
        .task {
            do { let values = try await connector.request("defaults"); name = values["name"] as? String ?? "我的 Mac"; address = values["address"] as? String ?? ""; codex = values["codex"] as? String ?? ""; thread = values["thread"] as? String ?? "" }
            catch { self.error = error.localizedDescription }
        }
    }
}

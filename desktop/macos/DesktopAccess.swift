import Foundation
import AppKit
import ApplicationServices

// No arbitrary AppleScript, keystrokes, clipboard writes or remote commands.
// Only submit a uniquely identified composer containing the exact requested text.
func reply(_ value: [String: Any]) {
    if let data = try? JSONSerialization.data(withJSONObject: value) {
        FileHandle.standardOutput.write(data)
    }
}
func attribute(_ element: AXUIElement, _ name: String) -> CFTypeRef? {
    var value: CFTypeRef?
    return AXUIElementCopyAttributeValue(element, name as CFString, &value) == .success ? value : nil
}
func text(_ element: AXUIElement, _ name: String) -> String {
    attribute(element, name) as? String ?? ""
}
func descendants(_ root: AXUIElement) -> [AXUIElement] {
    var pending = [root], result: [AXUIElement] = []
    while let element = pending.popLast(), result.count < 4000 {
        result.append(element)
        pending.append(contentsOf: attribute(element, kAXChildrenAttribute) as? [AXUIElement] ?? [])
    }
    return result
}
let sendLabels: Set<String> = ["Send", "Send message", "Send prompt", "发送", "发送消息", "发送提示"]
func isSend(_ element: AXUIElement) -> Bool {
    guard text(element, kAXRoleAttribute) == kAXButtonRole,
          (attribute(element, kAXEnabledAttribute) as? Bool) == true else { return false }
    return [kAXTitleAttribute, kAXDescriptionAttribute, kAXHelpAttribute].contains {
        sendLabels.contains(text(element, $0).trimmingCharacters(in: .whitespacesAndNewlines))
    }
}
do {
    let raw = FileHandle.standardInput.readDataToEndOfFile()
    guard raw.count <= 200000,
          let request = try JSONSerialization.jsonObject(with: raw) as? [String: Any] else {
        throw NSError(domain: "Mydex", code: 1, userInfo: [NSLocalizedDescriptionKey: "无效的桌面操作"])
    }
    let action = request["action"] as? String
    if action == "status" { reply(["trusted": AXIsProcessTrusted()]) }
    else if action == "authorize" {
        let options = [kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: true] as CFDictionary
        reply(["trusted": AXIsProcessTrustedWithOptions(options)])
    } else if action == "create" {
        guard AXIsProcessTrusted() else { throw NSError(domain: "Mydex", code: 2, userInfo: [NSLocalizedDescriptionKey: "请先在 Mac 的 Mydex 设置中授权桌面辅助功能"])}
        guard let appPath = request["appPath"] as? String,
              let bundle = Bundle(path: appPath), let identifier = bundle.bundleIdentifier,
              ["ChatGPT.app", "Codex.app"].contains(URL(fileURLWithPath: appPath).lastPathComponent),
              let value = request["text"] as? String, !value.isEmpty,
              let urlString = request["url"] as? String, let url = URL(string: urlString),
              url.scheme == "codex", url.host == "threads", url.path == "/new",
              let parts = URLComponents(url: url, resolvingAgainstBaseURL: false),
              parts.queryItems?.first(where: {$0.name == "prompt"})?.value == value,
              parts.queryItems?.first(where: {$0.name == "mode"})?.value == "codex" else {
            throw NSError(domain: "Mydex", code: 3, userInfo: [NSLocalizedDescriptionKey: "无效的新建会话请求"])
        }
        let configuration = NSWorkspace.OpenConfiguration()
        configuration.activates = true
        var opened = false, openError: Error?
        NSWorkspace.shared.open([url], withApplicationAt: URL(fileURLWithPath: appPath), configuration: configuration) { _, error in opened = true; openError = error }
        let deadline = Date().addingTimeInterval(12)
        var pressed = false
        while Date() < deadline && !pressed {
            RunLoop.current.run(until: Date().addingTimeInterval(0.2))
            if let error = openError { throw error }
            guard opened,
                  let app = NSRunningApplication.runningApplications(withBundleIdentifier: identifier).first,
                  app.bundleURL?.standardizedFileURL == URL(fileURLWithPath: appPath).standardizedFileURL,
                  app.isActive else { continue }
            let root = AXUIElementCreateApplication(app.processIdentifier)
            AXUIElementSetMessagingTimeout(root, 1)
            let windows = attribute(root, kAXWindowsAttribute) as? [AXUIElement] ?? []
            var candidates: [(AXUIElement, AXUIElement)] = []
            for window in windows {
                let elements = descendants(window)
                let composers = elements.filter {
                    [kAXTextAreaRole, kAXTextFieldRole].contains(text($0, kAXRoleAttribute)) &&
                    text($0, kAXValueAttribute).trimmingCharacters(in: .newlines) == value
                }
                let buttons = elements.filter(isSend)
                if composers.count == 1 && buttons.count == 1 { candidates.append((composers[0], buttons[0])) }
            }
            if candidates.count == 1 {
                let (composer, button) = candidates[0]
                guard app.isActive, text(composer, kAXValueAttribute).trimmingCharacters(in: .newlines) == value, isSend(button) else { continue }
                // One press only. Even a failed AX acknowledgement can be ambiguous.
                let result = AXUIElementPerformAction(button, kAXPressAction as CFString)
                guard result == .success else { throw NSError(domain: "Mydex", code: 4, userInfo: [NSLocalizedDescriptionKey: "桌面发送结果尚未确认，请检查会话，不要重复提交"]) }
                pressed = true
            }
        }
        if pressed { reply(["pressed": true]) }
        else { reply(["error": "未找到唯一匹配的 Codex 输入框和发送按钮；未点击发送，请检查桌面版本或解锁 Mac"]) }
    } else { reply(["error": "不支持的桌面操作"]) }
} catch { reply(["error": error.localizedDescription]) }

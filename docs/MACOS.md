# Mydex for macOS · 0.5.0 preview 1

原生 SwiftUI 电脑连接器，面向 macOS 13 及以上，分别提供 Apple Silicon 和 Intel 构建。手机端本轮不变。

## 当前范围

- 连接概览、工具发现、一次复制手机配对信息、设置四个页面。
- 菜单栏常驻、关闭窗口保留服务、退出停止自身服务、登录启动设置。
- 使用已有 Node 网关，内置运行时，用户无需安装 Node。
- 私人配置位于 `~/Library/Application Support/Mydex`，不写入应用包。
- 新配置仅包含当前电脑；不要求电脑之间互联。
- 保留 Windows 传输；macOS 新增当前用户 Unix socket 检测和不读取完整参数的进程检测。

**预览边界：Mac 实机和各工具的原会话续聊尚未验证。发现进程不代表可控制会话。Windows Claude 补丁不自动安装到 Mac。**

## 构建

在 Mac 上安装 Xcode 命令行工具和 Node/npm，运行：

```sh
bash tools/macos/build.sh
```

脚本下载官方 Node 25.6.0 并校验官方 SHA-256，编译原生界面，生成 `dist/Mydex-0.5.0-preview.1-macOS-arm64.dmg` 或 `x86_64.dmg`。构建包仅含程序和依赖，不含个人配置。GitHub Actions 的 `macOS preview build` 支持手动执行双架构编译。

当前默认使用 ad-hoc 本地签名，**未进行 Developer ID 签名和苹果公证**，不代表可无提示分发给普通用户。生产分发需另完成证书、hardened runtime、Node 权限验证及公证，不能用全局关闭 Gatekeeper 代替。

## 安装与配对

1. 将 Mydex.app 放到 Applications，打开应用。
2. 设置这台电脑：确认名称和手机可访问的 HTTPS 地址。
3. 点击保存并启动；按系统提示允许需要的本地网络访问。
4. 配对手机 → 复制全部配对信息；在 Mydex Android 添加电脑中粘贴。
5. 跨网络需自行提供可达地址/私有网络，应用不自动开放路由器端口。

手机 iOS 尚未开发，本轮不提供 IPA。原有 Android 可继续使用。

## 真机验收清单

- 首次启动、菜单栏、窗口关闭/重新打开、退出无遗留服务。
- 系统登录项允许后自动启动，配置重启后保持。
- Android 配对、HTTPS / WebSocket 接通与断线恢复。
- Mac 原有 Codex 会话列表、正在生成的输出、原会话续聊。
- 各其他工具分别验证，不把独立 CLI 会话当作原桌面续聊。
- 保存四页真实截图，宣传截图不得包含令牌、私人会话。

连接协议因桌面版本可能不同；支持显式环境变量 `MYDEX_CODEX_TOOLS_SOCKET` 与 `MYDEX_CODEX_IPC_SOCKET`，仅接收当前用户拥有的 Unix socket，最终路径需真机核验。

## 2026-10-29 构建验证记录

源码提交：`8c14c7e`。Apple Silicon 包通过 macOS 构建、签名结构校验、20 项 Node 测试，以及打包后服务的配置、配对、TLS 鉴权、独立电脑拓扑和启停退出检查。

构建记录：https://github.com/LeftSeineM/Mydex-mobile/actions/runs/40905376544

这些检查不代表已经通过用户 Mac 的 GUI、登录启动或原桌面会话联调。用户当前 Mac 关机，待提供可用机器后继续。真实页面截图也留待该阶段保存。

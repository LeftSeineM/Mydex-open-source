# Mac 原桌面对话兼容补丁

版本：1.0 · 2026-10-31

来源：[graceeeeeeeee124 提交的 Issue #1](https://github.com/LeftSeineM/Mydex-mobile/issues/1)，以及评论中的 `mydex-macos-codex-fix.zip`。
附件 SHA-256：`a037d91d55aff79650a8d0a3291847a0cb03fe840e52a148d2464f3e1b79c86d`。

采纳内容：发现 `CODEX_HOME/ipc/ipc.sock` 和当前 app-tools/browser-use socket 子目录；保持显式路径优先、所有者检查和 Windows 命名管道兼容。工具接口拒绝连接时及时报告错误；工具接口在发送前不可用时，通过原桌面 owner 的 follower 协议继续已打开的原会话。等待首次快照，分别使用 start-turn v2 / steer-turn v1。工具能力标记区分续聊与新建。不关闭或绕过 Codex 签名身份验证。

适配当前源码：保留新版更新状态与配对去重逻辑；为旧配置补全缺失的 macOS CLI 路径，写前保留备份，不覆盖用户已有路径或令牌；补充断线等待清理、未知/待审批状态拒绝发送、待应用模型设置确认，以及结果不明确时不得跨通道重发的测试。

验证范围：本机 Windows 回归共 47 项，44 通过，3 项 Unix 专用测试跳过。Mac 构建与平台测试另以 GitHub Actions 结果记录。提交者报告一台 Apple Silicon Mac 上手机续聊成功，这不是维护者的真机复测；跨 Codex 版本兼容仍需实际验证。

边界：follower 模式要求电脑已打开对应会话，不支持手机新建原桌面对话。历史分页等仍依赖原工具接口的功能不因本补丁自动恢复。源码采纳不等同已发布新版 DMG；正式发布时仍需同步官网、下载和更新入口。

## 维护者平台验证结果

[GitHub Actions 41214996326](https://github.com/LeftSeineM/Mydex-mobile-source/actions/runs/41214996326) 对提交 `12a7226` 完成验证：Apple Silicon（macos-15）和 Intel（macos-15-intel）均 47 项测试通过、0 失败、0 跳过；APP/DMG 构建、签名完整性检查以及包内引擎配置、配对、TLS 鉴权、单电脑拓扑和启动/停止检查均通过。这些检查未运行真实 Codex 桌面会话，不替代真机续聊复测。现有公开 DMG 尚未替换。

# Mydex Agent for Windows — 0.1.7 preview

独立后台 + 标准 MCP + 安装 Skill。复用现有 Mydex 连接核心，关闭 Coding 工具不停止后台。现有桌面 EXE 可保留。包含无窗口启动器和 Node 运行时，不需要用户另外安装 Coding 应用或 Node。

## 安装

将整个包解压到本机目录，让 Agent 阅读 `desktop/headless/skill/SKILL.md`。指定安装目录，例如 D:/Software/MydexAgent，然后通过隐藏的进程执行：

`powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File <包目录>/desktop/headless/manage.ps1 -Action install -Package <包目录> -Root D:/Software/MydexAgent`

安装后，`mydex-mcp.json` 提供通用标准输入输出 MCP 配置。把这一条合并到当前工具的 MCP 设置（各宿主配置格式可能不同）。不要用 PowerShell -Mcp 作为 MCP 传输入口；使用无窗口 Mydex-AgentHost.exe --mcp。

也可直接使用安装目录的 `Mydex-AgentHost.exe status` 等 CLI 命令，Agent 需要以隐藏进程调用。安装产生当前用户登录自启任务，不需要关闭系统安全功能，不创建桌面快捷方式。

已有 EXE 正在占用相同连接端口时不能直接接管。可以先用独立端口配置和验证；切换同一配置前，应停止原所有者并备份。安装不会擅自覆盖 EXE 配置。手机已有连接保持原入口，新后台需要按实际选择重新扫码。

## 使用

通过 MCP 调用 mydex_status、mydex_defaults、mydex_configure，随后 mydex_pair（android/web）。配对在本机页面显示；不要把二维码内容或永久令牌贴给 AI。二维码过期需重新生成。工具检测到不等于原会话已可发送。

后台复用原有 Android/网页版、原会话、项目、侧聊、子智能体、审批、用量等接口；各工具能力仍取决于现有适配器。没有把不支持的工具声称为已适配。

接入优先级：官方接口 → 已有可打通接口／扩展与配置。默认一键安装不修改原应用文件，不制造魔改工具；不支持的能力如实标记。只有用户单独同意具体修改后，才允许带备份与还原方案的原文件补丁（allowOriginalAppPatch），不把一般安装授权当成补丁授权。现有桥保持不动。

对已经安装的 Claude、DeepSeek Harness、ZCode、Gemini，可按能力检查使用 mydex_install_bridge / mydex_restore_bridge。原应用运行中可能需要先正常退出。Agent 模式拒绝通过另装商店兼容副本解决接入；不下载替代应用。未知版本由安装 Skill 引导诊断、原应用可回滚补丁和验证，公开贡献须去掉私人数据及原厂程序。

## 更新和卸载

mydex_update 接收已解压的签名 Agent 包目录，返回操作编号；用 mydex_operation 查询完成结果。程序先校验签名与每个文件，分目录更新；启动失败恢复原版本，配置和配对身份保留。当前预览使用显式包更新，尚未发布公共自动发现更新源，勿使用 EXE 的更新包。

mydex_uninstall 会关闭本 MCP 会话，随后移除后台、自启项和程序文件。读取返回的本地 receipt 确认实际结果。配置和兼容桥备份保留；如需还原原应用，请卸载前逐个调用还原工具。卸载后在相同目录重装，可复用保留的配置。再从使用过的宿主配置中移除 Mydex MCP 那一项。

## 验证边界

已完成隔离安装、独立后台、标准 MCP 请求、退出 Agent 后服务保持在线、真实二维码解析和一次性凭证交换、设备/工具/项目/会话接口、更新保持配置、坏包启动失败回滚、MCP 卸载保留配置等检查。手机摄像头实际扫码和全部第三方工具真机功能尚未逐项重新测试。不包含下载新 Coding 工具、另建替代会话或绕过原应用权限的能力。

包内 agent-package.json 是 Mydex 自己的更新签名清单，不等同于微软 Authenticode 代码签名。本预览不替换既有 EXE 发布版本。

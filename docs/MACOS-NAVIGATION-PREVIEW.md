# Mac 手机会话操作预览

版本：0.5.1-preview.1 · 2026-10-31

新增：选择会话时用桌面 deep link 自动载入，并等待同一会话 ID 的 owner 快照；手机新建通过 Codex 桌面新建页预填指令，辅助功能仅在唯一输入框内容完全匹配且发送按钮唯一时点击一次。随后通过只读会话索引和首条用户消息确认新会话 ID，再连接桌面 owner。不会调用 CLI thread/start、thread/resume 或 turn/start 来冒充原桌面操作。

首次需在 Mydex 设置中点击“授权 Codex 桌面新建会话”，允许系统辅助功能。运行期间 Mac 需已解锁、Codex 已登录；操作会切换 Codex 前台页面。新建沿用电脑当前模型，暂不支持手机新建模型覆盖。指令上限 12000 字符。无法确认输入框、按钮或新会话身份时明确报错；发送结果未知时不自动重发。

实现依据：本机 Codex 26.1027.3384 的 deep-link 路由解析支持 `codex://threads/<uuid>` 和 `codex://threads/new?mode=codex&prompt=...&path=...`；这是兼容性线索，不代表其他 Mac 版本已验证。界面辅助功能标签若不同会拒绝发送，不使用盲按 Enter。

测试分层：Node 单元测试检查路由编码、原 ID 载入、单次发送、只读 CLI 关联和未知结果不重发；macOS CI 编译双架构并测试打包后引擎及辅助程序权限查询。用户明确要求本轮不做真实 Mac 联调，因此不能声称已验证真实桌面收发。

公开下载保留两个选择：

- Mac 补丁版：需先在电脑打开对应对话。
- Mac 测试版：尝试自动载入和手机新建；首次需授权，未真机验证。

回退只替换应用包，保留 `~/Library/Application Support/Mydex` 数据。代码与配置仍分开，截图不包含真实私人会话。

## 发布验证

源码 `0a9b332`，构建 [41216415760](https://github.com/LeftSeineM/Mydex-mobile-source/actions/runs/41216415760)。Apple Silicon 与 Intel 各 56 项测试全部通过；DMG 构建、包内引擎启停与辅助功能状态查询通过。新建/续聊未作真实 Codex GUI 联调。

[公开测试版](https://github.com/LeftSeineM/Mydex-mobile/releases/tag/macos-v0.5.1-preview.1)；[补丁版与测试版下载页](https://app.leftseinem.dpdns.org/macos.html)。应用内更新入口指向同一页面。

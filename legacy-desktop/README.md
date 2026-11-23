# Mydex 1.3.0 — 多 API 与托盘

1.3.0 增加首页 API 切换、独立加密密钥和模型配置、API 设置管理及原生系统托盘。关闭窗口隐藏到托盘，右键可打开设置、安装/配置目录或完全退出。成品在 D:\Software\Mydex\win-unpacked。使用与兼容性边界见 release/1.3.0-多API与托盘.md。仅支持 Responses 编程接口，尚未接入其他协议内核。默认桌面配置迁移到 D:\Software\MyHarnessData\desktop，原配置保留备份；本次未在小主机部署。

1.2.1 打磨回复文段：使用语义段落、标题、嵌套/有序列表与引用；源文本普通折行自然合并，空行分段，行尾双空格或反斜杠保留强制换行。用户消息仍保留原始换行。代码缩进与空行保持原样，长代码只在块内横向滚动。流式和最终回复使用相同排版，向上阅读时不强制滚到底部。原始 Markdown 仍用于复制、导出；`renderer/markdown.js` 是安全的基础子集渲染器，不声称完整 CommonMark/GFM（表格、链接等扩展暂未接入）。

1.2.0 修复输入框模型/思考强度的字号和间距；同一窗口支持多个对话同时运行与切换，每个对话保留独立草稿、目录引用、流式回复、审批和工作目录。关闭标签不停止后台任务，侧栏可重新打开。草稿与打开标签目前仅在本次应用运行中保留，已发送历史由引擎持久化。

权限现在按对话独立保存。输入框盾牌菜单可选请求批准、只读、完全访问；完全访问需要主进程原生确认。设置页只修改新对话默认值。支持命令/文件/网络审批、额外权限的本轮或本会话授权；失效、重复及类型不匹配的审批会被拒绝。自动审查尚未接入，不等同于关闭审批。

Windows 受限任务发送前检查内置引擎的沙箱就绪状态；未就绪时请到“设置 → 权限与审批 → 设置 Windows 代理沙箱”。该流程先确认，再调用官方 elevated 设置，可能需要管理员授权并调整系统用户、访问规则和防火墙；本次开发测试没有运行这一系统配置步骤，也没有证明本机操作系统隔离已经配置完成。不会自动降级到完全访问。

1.1.2 增加文件夹引用：输入框“＋ → 引用文件夹…”或项目文件树的目录右键“引用文件夹到任务”。引用以可移除标签显示，发送只附加路径，代理通过工具按需读取；失败保留引用，成功后写入对话历史。最多 20 个当前项目内的目录；外部目录需先添加为项目。不会递归打包上传文件，不会改变审批或写入权限。详见 `release/1.1.2-文件夹引用验收.md`。

1.1.1 修复版位于 `release/1.1.1`，补齐任务/项目/文件/标签右键、原生编辑菜单、真实 API 模型列表和分类设置页，统一外观及键盘交互。详见 `release/1.1.1-修复记录.md`。沿用现有安全保存的 API 配置与历史，无需重复填写密钥。

当前桌面版只连接用户配置的 API。网页 AI、内嵌登录页、DOM 注入、自动点击、豆包/其他网站适配器、网页 IPC 和网页引擎选择均已移除，不是隐藏开关。

1.0.0 及更早的 EXE 保留在 release；1.0.0 源码快照为 release/My-Harness-1.0.0-source-backup.zip。旧资料 README-1.0.0.md 不代表新版功能。

## 运行

- 免安装：release/1.2.1/My-Harness-Portable-1.2.1-x64.exe。
- 安装：release/1.2.1/My-Harness-Setup-1.2.1-x64.exe，默认位置 D:\Software\MyHarness。
- 设置中填写 Base URL（通常以 /v1 结尾）、API Key、模型 ID、上下文容量。保存后启动本地代理核心。
- API 必须兼容 Responses、SSE 流式响应，以及代理所需的 function/custom 工具调用。仅支持 Chat Completions 的端点不能直接使用。
- “引擎就绪”“API 已配置”只表示本地引擎/配置状态，不表示真实服务验证成功。首次发送时验证真实服务。API 不免费，费用由服务商决定。
- 添加项目，然后在输入框输入任务。Enter 发送，Shift+Enter 换行；中文输入法确认不会发送。
- Ctrl+N 新对话，Ctrl+K 搜索任务，Ctrl+, 打开设置。
- 拖动侧栏、聊天栏右边界调整宽度；分栏宽度及折叠状态保存在本机。
- 右侧支持文件标签、多标签切换和关闭、二进制占位、复制路径、系统应用打开、差异/计划/活动。
- 打开文件不会执行它。点击“打开”还会出现系统确认。超过 2 MB 的文件只展示占位。
- 任务支持恢复、重命名、分叉、归档和 Markdown 导出。跨项目恢复保留任务原有工作目录。
- 命令面板不是交互式 PTY；每条命令以当前用户权限执行，必须确认，不能把它当作代理沙箱。

## 内核与范围

桌面运行环境为 Electron 43.4.1（Chromium + Node.js）；编程代理使用官方公开的 app-server 0.156.1 原始发行包，通过 JSONL stdio 通信，未替换成自编的聊天循环。法律声明在 THIRD-PARTY-NOTICES.md。

官方文档说明开源 harness 负责代理循环、工具、状态、审批和流式事件；模型访问及托管服务是独立的：
https://developers.openai.com/blog/codex-as-a-platform
https://learn.chatgpt.com/docs/app-server

**这不是功能、外观、体验 100% 相同的官方桌面复制品。** 已按照用户截图重做布局与主要本地操作，但没有确认截图客户端的完整源码、私有构建或全部隐藏交互。不存在“开源核心相同，所以整套桌面软件已相同”的结论。

已实现：截图式菜单栏、项目分组侧栏、窄聊天栏、大标签工作区、圆角输入框、回复与代码复制、变更摘要、实时流式文本、执行审批、计划与日志、本地任务历史、API 安全存储。

仍不同或没有实现：自动审查/Guardian、永久命令前缀规则编辑器、权限增量的逐路径勾选、官方语音/实时音频、云任务、账号订阅、远程设备、插件商店、托管连接器、独立多窗口、完整编辑器/交互式终端、文件撤销快照、富媒体生成/预览、全部 Markdown 扩展、所有原版快捷键和拖拽行为。当前只显示最近 100 条可访问任务。不会放置不工作的语音按钮或伪造云端服务。

## 文件与可配置位置

- src/main.ts：桌面窗口、原生菜单、可信 IPC、文件边界检查。
- src/preload.ts：只暴露 API 代理/文件/设置/命令接口。
- src/mydexAppServer.ts：官方核心启动、API provider、模型工具能力、审批、线程协议。
- src/settingsStore.ts：默认参数、旧配置白名单迁移、系统加密密钥。
- src/permissions.ts：对话独立权限与审批请求校验；thread-permissions.json 位于应用配置目录，不保存 API Key。
- src/workspaceTools.ts：Git、导出、手动命令（明确审批）。
- renderer/index.html：界面结构。
- renderer/styles.css：主题、字体、间距；--sidebar-width / --chat-width 控制默认布局。
- renderer/icons.js：本地 SVG 图标。
- renderer/app.js：任务/标签/设置/审批/流式消息逻辑。
- renderer/menus.js：共用右键菜单、边界定位、键盘与焦点处理。
- renderer/markdown.js：基础 Markdown 分块与安全文本节点渲染；段落样式位于 styles.css 的 Reply typography 区域。
- src/apiModels.ts：主进程模型发现、鉴权、响应大小限制和错误脱敏。
- src/folderReferences.ts：目录引用校验、项目边界与仅路径提示构造。
- scripts/installer.nsh：Windows 默认安装位置。
- package.json：版本、依赖、打包资源白名单。

密钥通过 Electron safeStorage 加密保存，不放在 settings.json 或渲染器状态中。配置通常位于系统应用数据目录；Windows 的独立代理历史默认 D:\Software\MyHarnessData\engine。不会读取官方客户端的登录凭据。

测试支持环境变量 MY_HARNESS_DATA_DIR（配置目录）、MY_HARNESS_ENGINE_HOME（隔离代理历史）、MY_HARNESS_ENGINE_DIR（开发时核心路径）、MY_HARNESS_SCREENSHOT（隐藏启动截图并退出）。

## 开发与打包

使用已有 Node.js。新增工具/依赖默认安装到 D:\Software，保持本工作区 node_modules 现有依赖映射，不向 C 盘安装软件。

开发时准备官方 @openai/codex 0.156.1-win32-x64 包到 D:\Software\MyHarness-build\engine，保持 bin/codex.exe、codex-path、codex-resources、LICENSE/NOTICE 的原始结构。

~~~powershell
node node_modules/typescript/bin/tsc -p .
node --check renderer/app.js
node node_modules/electron/cli.js scripts/qa-ui.cjs
node node_modules/electron/cli.js scripts/qa-engine.cjs
node node_modules/electron/cli.js scripts/qa-host.cjs
node node_modules/electron/cli.js scripts/qa-multi-conversation.cjs
node scripts/qa-permissions.cjs
node node_modules/electron/cli.js scripts/qa-typography.cjs
node node_modules/electron/cli.js .
~~~

调试启动可在最后一条后添加 --dev，显示开发者工具。

~~~powershell
$env:ELECTRON_CACHE='D:\Software\MyHarness-build\electron-cache'
$env:ELECTRON_BUILDER_CACHE='D:\Software\MyHarness-build\builder-cache'
node node_modules/electron-builder/out/cli/cli.js --win nsis portable --x64 --config.electronDist=node_modules/electron/dist --config.directories.output=release/1.2.1
node scripts/qa-package.cjs "release/1.2.1/win-unpacked/My Harness.exe"
node scripts/qa-package.cjs release/1.2.1/My-Harness-Portable-1.2.1-x64.exe
~~~

打包采用显式 JS 白名单，旧网页编译产物即使意外出现，也不能进入安装包。验收记录见 release/1.1.0-验收记录.md。没有代码签名证书，Windows 可能显示未知发布者；请自行核验文件哈希。

## 验证说明

UI 测试使用模拟任务/API；核心测试使用真实 app-server + 本机模拟 Responses 服务，验证真实命令/补丁执行、401 错误、历史和加密存储。此类测试不会证明任意第三方 API 兼容；没有用户真实 API Key 时，不能声称真实模型端到端通过。

2026-09-25 补充真实验证：本机 Sub2API 中转站 http://127.0.0.1:18080/v1 已配置到实际桌面应用，使用现有密钥（系统加密保存）和模型 ID gpt-5.6-sol。真实代理核心收到 9 次文本增量，最终回复“MYDEX_RELAY_OK，连接成功。”；已在打包应用中恢复“中转站连接验证”任务并确认回复可见。记录见 qa-artifacts/relay-live-verification.json。这次只验证真实文本收发和历史恢复，没有执行真实模型文件修改/命令，也不证明其他模型或第三方端点全部兼容。使用时需保持 Docker 和中转站运行；本机已保存密钥，无需重复填写。测试项目为 connection-check，使用自己的代码请先添加对应项目。

同目录的历史版本和独立旧 VS Code 插件未被升级为本桌面版；需要回滚时使用旧成品，不要混用新旧网页配置。

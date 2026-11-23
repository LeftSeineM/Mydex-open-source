# 手机侧聊与子 Agent 接入进度

2026-11-02，开发中，未发布。

已实现子 Agent 事件及传输字段、折叠卡片、对应记录打开入口、关联会话返回导航，以及 controls 内的已保存桌面侧聊列表。问题选择卡片补充 agentMessage.questions 通道，按桌面原生 questionItemId 形式回答并移除已回答请求。本机此前已应用选择题单独修复，其余仍为开发源码。

新建侧聊路径使用 thread/fork 的 attachToSource，保留继承配置且不发送自动提示。模拟接口测试通过，但真实源会话 01a18311-6007-79c3-b6a6-61c3451a4a63 被 Codex 桌面持有时，app-server 返回 active writer，实际未创建任何侧聊。桌面已公开的 fork_thread 工具没有 attachToSource 参数；不得用普通 fork 冒充原生侧聊，也不得重放不明确的创建请求。真实侧聊新建和发送闭环尚未验证。

只有记录读取可回退 thread/read；回退明确标记只读，不能借读取记录启动另一执行进程。子 Agent 控制仍需进一步适配。

15 项相关 Node 测试、Flutter 静态检查及子 Agent 卡片测试通过。尚无此次功能的手机真机截图与新版 APK；未更新发布入口。

## 2026-11-02 第二轮实现（尚未发布）

- Windows 新增原会话深链载入：只接受 UUID，合并同一会话的并发请求，确认原始会话 ID；失败后 60 秒内不重复拉起桌面。读取失败继续只读，不创建 CLI writer。
- 手机增加停止按钮；由原桌面 owner 执行，并校验手机看到的运行轮次，防止停止已经切换的另一轮。未确认停止结果时报告错误，不显示成功。
- 子 Agent 卡片补齐原生 started/interacted/interrupted/completed 事件、模型和思考强度。
- 已有侧聊列表与“手机新建”能力分开显示，当前新建不可用时不提供必定失败的按钮。
- 本机只读验证：原始会话 ID 一致，成功读取 12 个 turn 实体、237 条映射消息，状态 Running；这次未向真实会话发送测试消息，也未中断真实任务。
- 新增手机/折叠屏组件测试，覆盖点击子 Agent 进入同设备原始 ID、返回主会话、停止请求只带子会话与对应 turn ID。截图使用模拟内容，存于 test/goldens/related-*.png，不是真机收发证据。

仍未完成：运行中桌面主会话的新建原生侧聊（active writer）、真实子 Agent 的发送/停止闭环、APK 与桌面新版发布。因此不能对外声称完整支持或提示手机已有新版本。

本轮最终检查：25 项相关 Node 测试、23 项 Flutter 组件/交互测试通过，Flutter analyze 无问题。开发版 0.2.17-dev.1（build 20）release APK 编译成功，仅保存在本地验证目录，未安装/公开发布；它不等于以上未完成项已验证。截图及构建副本保存在 D:/Software/MydexMaintenance/related-chats-qa-20261102。Windows 冷会话自动打开路径已有模拟测试，本次实际探测仅覆盖已载入会话。原始实时数组的渲染排序改为副本排序，避免改变后续增量补丁的下标。

## 2026-11-02 第三轮：真实停止协议校验

核对当前桌面原生协议后，停止调用从 version 1 改为 version 4（携带 expectedTurnId）。仅 ok=true 不能认定停止成功，还须 interruptedTurnId 与请求轮次相同。真实桌面使用一个确定不存在的轮次 ID 做保护测试：请求被当前协议接受，interruptedTurnId=null，主会话仍 active；该测试没有停止主会话，也不等于真实子 Agent 的中断闭环已经验证。协议不兼容时显示明确中文提示，不重试写入。

对同一主会话另试了从已确认 rolloutPath 原生 attachToSource fork，仍返回 active writer，未创建侧聊。现有工具没有可操作的本应用窗口，Computer Use 同时不允许自动操作被识别为 ChatGPT 的桌面 UI，因此未尝试热键或点击绕过。已请用户按 Ctrl+Alt+S 创建一条空侧聊，供下一步验证真实关联和原会话接入；等待用户操作，本轮仍未发布。

## 2026-11-02 第四轮：已有临时侧聊实测与版本打包

用户已创建空侧聊。它在 native snapshot 中明确标记 sideConversation=true、ephemeral=true、forkedFromId 为当前主会话，但不存在于持久化 attached_thread_parent_id 索引。补充 LiveSideChats：只在有限的本机 Codex 日志尾部提取候选 UUID，再通过独立的短时 NativeFollower 核验确切 ID、原生侧聊标记及父会话；不向手机输出日志，不把日志文本作为父子关系证据，不取得执行权。探测结果缓存 15 秒；记录关闭后不能保证恢复。

已向用户创建的一条空闲空侧聊发送一次仅要求文字回复的测试，在相同原生会话 ID 收到“侧聊连接正常”，期间没有执行操作步骤。打包后的 Windows gateway 再次读出两条临时侧聊，并包含实测目标；手机新建仍禁用。子 Agent 的独立收发与完整停止仍未真机逐项验证。

Android 0.2.17（20）及 Windows 0.4.20 构建通过；Android 新旧包证书 SHA-256 一致。23 项 Flutter 测试、静态检查、30 项侧聊/原生/传输/交互测试通过，另有网关、中继及更新签名回归。Windows --qa 工具表得到 8 行、正常退出，截图保存在 build/desktop-v0420/qa。网页版同步构建并使用同源引擎资源，构建标识 ff3e9347242c。公开功能边界见下载仓库 docs/RELATED-CHATS.md。两台已安装 Mydex 程序不由本次发布自动覆盖；只更新手机更新源，供用户自行安装新版。

本次版本已公开发布，GitHub 下载文档提交 0ec2965，私有实现提交 06c7afd。公网两包完整下载校验、GitHub 资产 digest、Windows 官网与 GitHub 签名清单、0.4.19 更新器检查、两台机器带鉴权的 Android 清单与 APK 获取均通过；首页与登录页 390/1280 宽度零脚本错误。GitHub raw 首次读取连接重置，随后读取通过。完整记录位于 D:/Software/MydexMaintenance/release-0217/public-verification.json；未宣称手机新建原生侧聊或独立子 Agent 控制已完成。

## 顶部侧聊文字入口（Android / Web 0.2.18）

按用户要求，在会话标题旁加入小号蓝色“侧边聊天”文字，无边框、无底色。点开即显示独立侧聊列表，支持刷新和同父会话切换；原模型面板入口保留。列表自身请求 controls，不读取模型列表或覆盖会话的模型/权限控制状态；切换电脑或会话后忽略旧响应。23 项 Flutter 相关测试及静态检查通过，包含小屏、字号缩放、直接打开列表及从子会话保持同一父会话的导航。手机、列表和折叠屏模拟截图在 test/goldens 与 D:/Software/MydexMaintenance/release-0218。

Android 0.2.18（21）、网页版构建 80ab693c8edc 已同步官网、GitHub 和两台电脑的手机更新源。APK 签名与旧版一致；完整公网下载 SHA-256 为 9d240eecf1fb58778f5be31a5e973145610d18363ef9ad6f545f2d2504253ac3，GitHub 资产 digest 一致。390/1280 官网与登录页验证通过。保留另一任务已发布的 Windows 0.4.22 首页、安装包和签名清单，并将相同已验证签名清单同步到实际使用的 legacy 入口；没有安装/更新 Windows 程序。核验时发现本机现有 Mydex 0.4.20 的服务处于停止状态，通过其“启动连接”恢复后，两机带鉴权的 Android 更新接口均完整返回新版 APK。用户已要求另一任务等待，已通知，不自动恢复该任务。

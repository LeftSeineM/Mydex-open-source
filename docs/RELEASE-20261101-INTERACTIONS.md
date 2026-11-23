# 权限与底部交互发布记录

版本：Android 0.2.12（15） / Windows 0.4.13 / Mac 0.5.1-preview.2。

新增真实桌面权限状态显示和手动切换，需桌面明确确认后才视为成功，作用于后续消息。待审批、选择题和填空题独立固定在输入框上方，不随历史滚动。

验证：网关 Windows 57 通过、3 Unix 跳过；Mac 双架构构建及测试通过（Actions 41217189191）。Flutter 原相关 32 项通过，补充状态刷新与截图检查 4 项通过；相关 lib 与新测试静态分析无问题。新版 Web 本地浏览器检查字号记忆、独立设备设置及删除绑定通过，无脚本错误。

两台 Windows 已安装 0.4.13，配置与证书哈希保持不变。实际更新接口均返回 0.2.12（15），完整 APK 哈希一致，WebSocket 正常。Windows 原会话只读核验显示完全访问及不主动请求审批；没有改动用户真实会话权限。APK 保持既有签名。Mac 按用户要求未做真实电脑联调，也未声称手机真机测试。

构建源码：Mac e1e0fe5；Android/Web 含 15ef474 的状态刷新修正（其余为测试与构建配置）。Windows 与 e1e0fe5 网关代码一致。

发布证据与安装备份：D:/Software/MydexMaintenance/release-interactions；两台电脑 pre-desktop-0413。演示截图：test/goldens/permissions-bottom.png、permissions-selector.png、questions-bottom.png，已公开到使用手册。

公网最终核验完成：Android、Windows、Mac 两包均完整下载并匹配发布哈希；官网 390/1280 两种宽度、双 Mac 入口、新 Web 主文件哈希、Windows 签名清单及 GitHub 备用清单均通过。公开包签名/大小与 GitHub API 资产 digest 一致。来源脚本需使用 node --use-env-proxy 以遵循本机网络代理。

用户随后反馈 Android 连接笔记本失败：本机 Wi-Fi IP 从保存的 183.172.30.32 变为 183.172.29.123，小主机 TCP 18443 实测旧地址失败、新地址成功。固定 Tailscale IP 100.111.164.21 未变化；已告知手机修正旧地址或通过应用版扫码切换跨网络连接。尚未获得手机端恢复反馈，不能声称手机真机已恢复。

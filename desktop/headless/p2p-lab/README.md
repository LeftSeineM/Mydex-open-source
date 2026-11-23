# Mydex Superagent P2P 私测 · Windows x64

这是私测包，包含现有 Superagent Agent 和独立的点对点探测器。完整解压后双击 `Mydex-P2P-Test.exe` 即可探测，现用 Agent 无需停止或覆盖。电脑的探测页面只在本机打开。

1. 将 `desktop/headless/p2p-lab/test.html` 发给自己的手机，用支持打开本地 HTML 的浏览器打开。也可以先在电脑上用 Edge 打开这个文件，模拟手机端。
2. 同 Wi-Fi 时留空 STUN。跨网时填写自己可用的 `stun:主机名:端口`，再把电脑生成的邀请复制到手机。
3. 手机生成应答并发回电脑，在电脑点击「接收应答」。手机显示通道已建立后，点击「测试直连延迟」。如没有建立连接，记录网络类型和错误，避免公开分享含临时地址的邀请或应答。
4. 点击电脑上的「结束测试」。邀请在五分钟后失效，探测进程最多运行十五分钟。

探测只交换测试消息，默认不调用第三方 STUN，也没有 TURN 或中继回退。它能验证 WebRTC 是否直连及往返延迟。现有 Mydex App、网页版、聊天和审批仍使用原来的连接路径。双端都是内网时，跨网连接取决于网络对 UDP 和 NAT 穿透的支持。

如果另需安装包内 Agent，可用现有 Mydex Agent 的签名包升级入口，或请本机 Agent 以隐藏进程运行 `desktop/headless/manage.ps1 -Action install -Package <解压目录> -Root <自选安装目录>`。探测器直接从解压目录运行。请只在有权使用的设备之间测试。

# 手机网关协议 v0.2.0

2026-10-29。HTTP 与 WebSocket 握手统一带 `Authorization: Bearer <phone-token>`。公网采用 HTTPS / WSS。以下为本项目适配层协议，不是 OpenClaw 原生协议。

| 接口 | 请求与响应 |
| --- | --- |
| GET /api/devices | `{devices:[{id,name,online,desktopOnline,lastSeen}]}` |
| GET /api/projects | `{projects:[{id,name,path,deviceId}]}` |
| GET /api/tasks | `{tasks:[Task],devices:[Device]}` |
| GET /api/tasks/{id}?cursor=… | Task，包括历史与 nextCursor / hasMore |
| POST /api/tasks | `{deviceId,projectId?,toolId?,model?,effort?,instruction}` → Task |
| GET /api/tools | `{tools:[{id,name,deviceId,installed,capabilities,note}]}` |
| GET /api/devices/{id}/models | `{models:[{id,name,efforts,defaultEffort,fast}]}`，从目标电脑读取 |
| GET /api/tasks/{id}/controls | `{model,effort,fast,goal,queue,capabilities}` |
| POST /api/tasks/{id}/settings | `{model,effort,fast}`，用于后续发言 |
| POST /api/tasks/{id}/queue | `{action:"add",instruction}` 或 `{action:"remove",queueId}` |
| POST /api/tasks/{id}/goal | `{status:"active"或"paused"或"complete",objective?,tokenBudget?}` |
| POST /api/tasks/{id}/messages | `{instruction}` → `{accepted:true}` |
| POST /api/tasks/{id}/approve | `{approvalId,decision:"accept"或"decline"}` |
| GET /api/images/{deviceId}/{key} | 经认证的图片二进制 |
| WSS /ws | 设备、任务与当前会话更新 |

每个 POST 另带 `Idempotency-Key`（16–100 位字母数字或连字符）。相同标识、相同请求返回保存结果，不重复执行。发送超时不自动重发，应先查看原会话。初始需求没有定义追加接口，因此补充 `/messages`。

全局 ID 为 `设备ID~desktop:原线程ID`，路径必须 URI 编码。状态：Pending、Running、AwaitingApproval、Completed、Failed。时间为 Unix 毫秒。

其他工具使用 `设备ID~cli:任务ID` 或 `设备ID~tool:历史标识`；Task 带 toolId、readOnly、source。客户端必须按 capabilities 判断能力，不能向只读历史发送指令。历史文件中的 Completed 表示快照，不能据此断言原终端当前闲置。消息可附 turnId 和 durationMs，供手机分组运行过程。控制目标返回 pending:true 时仅代表已发送请求，客户端轮询实际目标状态；不可当作已经落实。

```json
{
  "id":"mini~desktop:thread-id",
  "deviceId":"mini",
  "projectId":"project-id",
  "title":"检查项目",
  "status":"Running",
  "syncMode":"native-stream",
  "messages":[
    {"id":"u1","role":"user","type":"text","text":"检查项目"},
    {"id":"a1","role":"agent","type":"text","text":"正在检查…"},
    {"id":"s1","role":"agent","type":"step","title":"读取文件","text":"…"},
    {"id":"i1","role":"agent","type":"image","imagePath":"/api/images/mini/图片key"}
  ],
  "approvals":[],
  "hasMore":false,
  "nextCursor":null
}
```

手机通过 WS 发送 `{"type":"subscribe","taskId":"完整任务ID"}`。服务端推送 `{type:"devices",devices:[…]}`、`{type:"tasks",tasks:[…]}`、`{type:"task",task:{…}}`。增量文本在网关合并为当前快照，再推给手机；手机按消息 ID 替换，不重复追加。

待审批列表元素包含 id、title、description、details；后端审批时再次校验线程归属和有效性。网关约 15 秒 ping，失联关闭；手机指数退避重连，最大间隔 30 秒。历史分页使用后端 cursor。

`/agent?device=…` 只供电脑代理连接，使用独立令牌。笔记本主动连接小主机，不需固定 IP 或入站端口。图片仅从登记的本机文件读取，笔记本图片经加密连接返回小主机；不使用图床，单图限制 12 MB。

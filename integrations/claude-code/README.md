# Claude Code 插件：mydex-router

装上这个插件后，当前 Claude Code 会话就成了 Mydex Router。插件里有两样东西：
- Mydex Agent 的 MCP，提供 `mydex_*`、`mydex_router`、`mydex_worker_*` 这些工具。
- Router 工作规则，即 `skills/router/SKILL.md`。

## 前提

需要先装好**包含 Worker 引擎的 Mydex Agent**，也就是 superagent 私测版、`feat/sdk-workers` 之后的版本，以及 DeepSeek Harness 桌面版，并且 DSH 里要配好 GLM 模型。

Worker 的档位、单价和预算都在 Mydex Agent 数据目录的 `workers/tiers.json` 里。

## 安装（本地市场）

在 Claude Code 里运行：

```
/plugin marketplace add <本目录的绝对路径>
/plugin install mydex-router@mydex
```

启用时会让你填写 Mydex Agent 程序的路径，默认是 `D:/Software/MydexAgent/Mydex-AgentHost.exe`。

如果你已经在全局 MCP 配置里手动加过 `mydex`，安装插件后会出现两份同名工具。这时请删掉手动加的那一项，保留插件提供的。

## 权限分两档（用户 2026-11-25 确认）

- **Router 自己开的后台 Worker**：完全访问，不需要审批，但受预算、并发和超时限制。
- **用户原有的桌面会话**：仍然要经过 `mydex_router`，并由用户在手机上授权。

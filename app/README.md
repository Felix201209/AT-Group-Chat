# AT AI 合作群聊

## 5 分钟跑通

```bash
npm install
npm run setup
npm run dev
```

打开 `http://127.0.0.1:5173/`，先看 Platform 的 Setup Checklist，再到 Chat 发第一条真实任务。不要用 `file://.../index.html` 打开；AT 依赖本地 UI、API 和 Codex app-server 三个入口。

AT 是 Agent Team 的缩写。这个项目是本地 AI 合作平台：把 Codex app-server、Claude Code、Kimi Code CLI 和任意本地/远程模型 adapter 编排进一个 manager-controlled group chat，同时提供类似 GitHub 的 work items：`issue`、`proposal/PR`、`review`、`decision`、`artifact`。UI、HTTP API 和 MCP 三个入口共用同一套 runtime。状态持久化使用 `better-sqlite3` cached prepared statements + WAL，不再依赖外部 `sqlite3` CLI 子进程；JSONL 只是非阻塞审计镜像，SQLite 是事实源。

## 这到底解决什么

AT 不是“再造一个 Slack”，也不是“再造一个 Jira”。它解决的是：你已经能和单个 AI 对话，但当任务需要规划、代码审查、UI/UX 审查、目标验收、审计记录时，单线程聊天很快会变乱。

AT 的定位是本地 AI 协作控制台：

- Chat 保存所有 agent 都能看到的共享上下文。
- Manager 决定下一位 agent 是否活动，避免自由讨论和无限循环。
- Work 把聊天里的结论沉淀成 `issue`、`proposal/PR`、`review`、`decision`、`artifact`。
- Sessions 为每个项目、每个岗位保留独立多轮记忆。
- Events / Export 给团队、安全审查和复盘留下证据。

第一次使用只需要三步：

1. `npm run dev`
2. 打开 `http://127.0.0.1:5173/`
3. 在 Chat 里输入一个真实任务，例如“审查当前项目是否适合交给三个 agent 协作，并给出下一步”

如果你只想直接和一个 AI 对话，不需要追踪审查链路，AT 不是必需品；如果你想把多个 AI 的工作变成可恢复、可审计、可交接的本地协作流，AT 才有意义。

## 运行

```bash
npm install
npm run setup
npm run dev
```

打开：

```text
http://127.0.0.1:5173/
```

不要用 `file://.../index.html` 打开。这个项目依赖 Vite dev server 和本地 API runtime。

如果前后端分端口或分机器运行，前端用下面两个变量指向 API：

```bash
VITE_AT_TEAM_API_BASE_URL=http://127.0.0.1:5174
VITE_AT_TEAM_API_TOKEN=your-local-token
```

`npm run dev` 会同时启动三件事：

- Web UI: `http://127.0.0.1:5173/`
- Team API: `http://127.0.0.1:5174`
- Codex App Server: `ws://127.0.0.1:5176`

也可以单独启动 Codex App Server：

```bash
npm run dev:codex-server
```

## 自动化配置向导

AT 自带一个终端里的 npm setup wizard。它不是文档页，而是会在命令行里显示 CLI 检查结果，并用编号菜单带你选择 Demo、Real local、Secure local 或 Custom 配置，然后生成 `.env`。

交互式配置：

```bash
npm run setup
```

第一次只想看 demo：

```bash
npm run setup:mock
npm run dev
```

准备接真实 Codex / Claude / Kimi：

```bash
npm run setup:real
npm run health
npm run dev
```

非交互机器友好模式：

```bash
node scripts/setup.mjs --mock --yes --token auto --json
```

如果将来发布到 npm，全局安装后同一个向导可以这样运行：

```bash
at-group-chat setup
# or
at-setup
```

当前包已经带 `bin` 入口，也可以先本地模拟 npm 包安装：

```bash
npm pack --dry-run
npm install -g .
at-group-chat setup
```

## 两种交互方式

1. AT 群聊入口：人在 UI 里发消息，消息进入 `AT AI 合作群聊`，runtime 创建 manager-controlled run 并点名 `codex-manager` 先回复。
2. Work Board：像 GitHub issue/PR 一样创建 `issue`、`proposal`、`review`、`decision`、`artifact`，再交给 manager 转成可执行调度。
3. 外部 agent 调 API：Qwen、Codex、Claude、Kimi 等任意被授权 agent 可以调用 HTTP/MCP，当 manager 来发群聊消息、创建 run、点名岗位、读取 transcript 或操作 work items。

## Agent Roles

- `codex-manager`: Team Manager，负责拆任务、调度、开放权限、汇总，默认通过 `codex app-server` 执行。
- `claude-deep-review`: Claude Code + `deepseek-v4-pro`，负责代码底层审查。
- `kimi-ux-review`: Kimi Code CLI，负责用户交互和 UI/UX 审查。
- `codex-goal-review`: 独立 Codex app-server thread，检查目标和计划是否满足。

`codex-manager` 和 `codex-goal-review` 必须是两个独立 session。

## 调度规则

- 所有 agent 都能看到共享 team transcript。
- 只有 manager 能决定谁下一步活动。
- 禁止自由讨论。
- 禁止自动递归调度和无限循环。
- 每次只点名一个岗位，除非用户明确要求扩大范围。
- 群聊 UI 展示持久化 room messages；事件时间线展示 handoff、approval、stream、artifact 审计记录。

## API

HTTP API:

```text
GET  /api/status
GET  /api/platform
GET  /api/platform/export
GET  /api/adapters
GET  /api/agents?includeDisabled=true
GET  /api/chat
GET  /api/work-items
GET  /api/work-items/:id/activity
POST /api/chat/messages
POST /api/work-items
POST /api/work-items/:id
POST /api/work-items/:id/dispatch
POST /api/team/config
POST /api/projects
POST /api/agents
DELETE /api/agents/:roleId
GET  /api/projects/:id/team
POST /api/runs
POST /api/runs/:id/dispatch
GET  /api/runs/:id/events
POST /api/agents/:roleId/message
POST /api/agents/:roleId/permissions
POST /api/agents/:roleId/config
GET  /api/agents/:roleId/memory
```

平台接口：

- `/api/platform`: readiness gates、adapter registry、runtime counters、Codex app-server 状态。
- `/api/platform/export`: 可移植本地状态快照，包含 project、agents、sessions、runs、events、adapters。Platform 页有 `Export portable state` 下载入口；HTTP 响应会带 `content-disposition: attachment; filename="at-platform-export.json"`。
- `/api/adapters`: 当前支持的 adapter registry。
- `/api/chat`: AT 群聊 room、participants、持久化 messages、recentEvents。
- `/api/work-items`: 当前项目的协作对象板，包括 `issue`、`proposal`、`review`、`decision`、`artifact`。
- `/api/work-items/:id/activity`: work item activity thread，返回相关 run、messages、events、child review/decision/artifact。
- `/api/work-items` `POST`: 创建协作对象；可传 `dispatchToManager: true`，创建后立即进入 manager-controlled run。
- `/api/work-items/:id` `POST`: 更新协作对象状态、owner、优先级、linked run 等。
- `/api/work-items/:id/dispatch` `POST`: 把指定 work item 交给 manager，并把 run 重新 linked 回 item。
- `/api/chat/messages`: 推荐主入口。发消息到 AT 群聊，runtime 会创建 manager-controlled run，并让 `codex-manager` 先处理。
- `/api/team/config`: Settings 里的 Team Defaults 批量配置入口，只更新传入的字段，可统一模型、thinking level、默认权限、adapter、命令和模板。

`/api/agents/:roleId/config` 和 Settings 页是统一 customize 面板，可改显示名、职责、模型名、thinking level、默认权限、adapter、命令和命令模板。模型名会原样传给对应 adapter；adapter 优先于内置岗位的 CLI 类型，所以内置 Codex/Kimi/Claude 岗位也可以被重新接到 `generic-cli`。Codex 岗位走 app-server，不走 `codex exec`。

`GET /api/runs/:id/events` 是 SSE 流，会输出 `run.created`、`agent.queued`、`agent.started`、`agent.permission.requested`、`agent.approval.requested`、`agent.completed`、`agent.failed` 等事件。Codex app-server 的权限/approval 请求会进入同一条 runtime event log，UI 群聊、HTTP SSE 和 MCP 状态读取看到的是同一份事实。

本地 API 默认只面向 localhost 工具链；如果同网段或外部 agent 也会访问，建议启用 token：

```bash
AT_TEAM_API_TOKEN=your-local-token npm run dev
```

启用后 HTTP 请求需要带 `x-at-token: your-local-token`、`Authorization: Bearer your-local-token`，或 SSE query token。可选安全/稳定参数：

安全心智模型：

- `readonly`: 只读审查，适合默认专家 review。
- `write-proposed`: 允许提出补丁/方案，但不应该直接危险写入。
- `workspace-write`: 允许在当前 workspace 写文件，适合你明确授权的实现任务。
- `danger`: 只给你完全信任的本地 agent，且应当逐次确认。

公司/团队环境建议至少设置 `AT_TEAM_API_TOKEN`，并保持 `AT_TEAM_CORS_ORIGIN` 为明确来源。SQLite 默认明文保存本地 transcript；如果项目内容敏感，把 `.at/` 或数据目录纳入你的本机磁盘加密和备份策略。

- `AT_TEAM_CORS_ORIGIN`: 默认 `http://127.0.0.1:5173`，不要再使用全开放 CORS。
- `AT_TEAM_MAX_BODY_BYTES`: 默认 `1048576`，限制请求体大小。
- `AT_TEAM_MAX_TEXT_FIELD_LENGTH`: 默认 `32000`，限制单个文本字段长度。
- `AT_TEAM_RATE_LIMIT_WINDOW_MS`: 默认 `60000`。
- `AT_TEAM_RATE_LIMIT_MAX`: 默认 `600`。
- `AT_TEAM_AGENT_MODE`: 只在 runtime 层显式选择 `mock` 或 `real`；adapter 自身默认 `real`，避免误把真实任务静默变成假执行。

通用本机 CLI 接入：

- adapter: `generic-cli`
- `commandTemplate`: 任意 shell 命令模板
- runtime 会提供环境变量：
  - `AT_AGENT_PROMPT_FILE`: 完整岗位 prompt 文件
  - `AT_AGENT_PROMPT`: 完整岗位 prompt 文本
  - `AT_AGENT_SESSION_ID`
  - `AT_AGENT_PROJECT_PATH`
  - `AT_AGENT_MODEL`
  - `AT_AGENT_THINKING_LEVEL`
  - `AT_AGENT_PERMISSION_PROFILE`
  - `AT_AGENT_ROLE_ID`
  - `AT_AGENT_NAME`

例子：

```bash
curl -s -X POST http://127.0.0.1:5174/api/agents/kimi-ux-review/config \
  -H 'content-type: application/json' \
  -d '{
    "model": "my-local-model",
    "thinkingLevel": "high",
    "adapter": "generic-cli",
    "command": "zsh",
    "commandTemplate": "my-agent --model \"$AT_AGENT_MODEL\" --session \"$AT_AGENT_SESSION_ID\" < \"$AT_AGENT_PROMPT_FILE\""
  }'
```

MCP:

```bash
npm run mcp
```

Tools:

- `team_chat_message`
- `team_get_room`
- `team_get_work_items`
- `team_create_work_item`
- `team_update_work_item`
- `team_get_work_item_activity`
- `team_dispatch_work_item`
- `team_create_task`
- `team_dispatch_agent`
- `team_get_status`
- `team_export_platform`
- `team_get_memory`
- `team_set_permission`
- `team_configure_agent`
- `team_configure_defaults`
- `team_disable_agent`

`team_configure_agent` 支持 `name`、`responsibility`、`model`、`thinkingLevel`、`defaultPermission`、`adapter`、`command`、`commandTemplate`。`thinkingLevel` 可用值是 `default`、`minimal`、`low`、`medium`、`high`、`xhigh`。
`team_configure_defaults` 用于批量应用 team defaults，可传 `roleIds` 限定目标；不传则作用于所有启用 agent。

`team_create_work_item` 和 HTTP `/api/work-items` 用来把协作从“聊天消息”升级成可追踪对象。建议：

- 需求/bug/待办用 `issue`
- 可审查方案或代码改动用 `proposal`
- agent 的审查结论用 `review`
- manager 或用户确认的取舍用 `decision`
- 产物、链接、报告、补丁索引用 `artifact`

## Skill

AT manager skill 已安装到：

```text
/Users/felix/.codex/skills/at-agent-team-manager/SKILL.md
```

项目内副本：

```text
docs/agent-manager-skill.md
```

外部 agent 如果不能读取 Codex skills，可以直接读取或粘贴项目内副本。

Date/time check skill 也已安装到：

```text
/Users/felix/.codex/skills/date-time-check/SKILL.md
```

当任务涉及“现在几点”“今天/明天/昨天”“某个截止时间前能否完成”时，先用这个 skill 调本机 `date`，把相对时间转成明确日期和时区。skill 也明确要求：如果用户说不要在某个截止时间前完成，agent 不能 sleep 假装运行到截止点，只能继续做有用的验证/打磨，或等真实时间过线后再跑最终审计。

## 验证

```bash
npm run health
npm run typecheck
npm test
npm run build
npm run preflight
npm run test:ui
npm run test:browser
npm run audit
npm run smoke:manager
npm run verify
```

`npm test` 覆盖 runtime、MCP、HTTP SSE、动态 agent、平台 health/export、权限事件可见性、session 分离、adapter 覆盖，以及 work items 的 issue/proposal/review/linked run。`npm run preflight` 是硬 gate，会自检 CLI、Codex app-server、核心岗位和 session 分离。`npm run health` 会检查 CLI、测试、构建、session 分离、API、completion audit 和生产页面。`npm run test:ui` 是稳定的 Node UI smoke，不依赖本机 Chrome 状态；`npm run test:browser` 会先构建，再用 Chromium 检查真实 Platform/Chat/API/Work/Team/移动窄屏页面，并启动隔离临时数据库验证 Settings 里的新增 agent、Team Defaults、保存配置和 Team lane 展示。

`npm run audit` 会把目标要求映射到具体文件、skill、runtime API、群聊 room 和测试覆盖。最终完成前可运行 `npm run audit:complete`，它会额外要求当前时间已经过 `2026-05-13 07:30:00 CST (+0800)`。

`npm run smoke:manager` 会通过 `/api/chat/messages` 发一条只读 smoke，并等待 `codex-manager` 经 `codex app-server` 返回固定短句。它会真实写入一条 run/message，用于最终上线前链路复测。

可选环境变量：`AT_TEAM_API`、`AT_MANAGER_SMOKE_EXPECTED`、`AT_MANAGER_SMOKE_TIMEOUT_MS`。

`npm run verify` 会串起 `health`、`test:browser` 和 `audit`，适合日常完整复核。`npm run verify:complete` 会先跑 time-gated `audit:complete`，通过后再跑 `health`、`test:browser`、真实 manager smoke 和最终 `audit:complete`，只适合最终完成时使用。

审计项说明见：

```text
docs/completion-audit.md
```

## 运行模式

真实 CLI 模式：

```bash
npm run dev
```

Mock 模式，适合演示和测试，不会真的调用 agent CLI：

```bash
npm run dev:mock
```

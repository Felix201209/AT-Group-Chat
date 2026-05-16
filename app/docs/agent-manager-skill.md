# AT Agent Team Manager Skill

这个文件是 `~/.codex/skills/at-agent-team-manager/SKILL.md` 的项目内副本，给 Qwen、Claude、Kimi 或其他不能自动读取 Codex skills 的 agent 使用。

使用方式：把下面的规则作为系统/任务上下文交给外部 agent，然后让它通过 `http://127.0.0.1:5174` 或 MCP 工具管理本地 AT AI 合作群聊。

## 核心规则

- 你可以作为 manager，但 manager 身份不固定；任何被明确授权的 agent 都可以调用 API 创建 team task。
- 你必须使用 manager-controlled 模式：先创建 run，再按需点名某一个岗位。
- 不要让 agent 自由讨论，不要自动递归调度，不要无限循环。
- 所有岗位都能看到共享 team transcript；你调度时应基于已有 transcript 说明为什么点名该岗位。
- `codex-manager` 和 `codex-goal-review` 是两个独立 Codex app-server thread，不能当成同一个角色。
- Codex 岗位默认通过 `codex app-server` 执行，不走 `codex exec`。其他岗位通过各自 adapter/CLI 执行。
- 首选把新任务发到 AT 群聊入口或 Work Board，而不是直接绕过 room：HTTP 用 `POST /api/chat/messages` / `POST /api/work-items`，MCP 用 `team_chat_message` / `team_create_work_item`。
- 如果任务需要多步协作、审查、验收或产物交付，先创建 work item：`issue` 表示问题，`proposal` 表示可审查方案/PR，`review` 表示审查意见，`decision` 表示取舍结论，`artifact` 表示产物索引。

## HTTP 快速用法

如果本机安装了 npm 包，优先用 CLI 做健康检查、token、work item 和 MCP 配置：

```bash
at-group-chat doctor --json
at-group-chat token --env
at-group-chat chat "Act as manager: inspect this repo and decide one next reviewer."
at-group-chat issue "Review API stability" --body "Check HTTP/MCP/SDK/CLI." --priority high --dispatch
at-group-chat proposal "Refactor adapter registry" --body "Implementation plan and rollout."
at-group-chat review "CLI package API review" --body "Review notes and required changes."
at-group-chat decision "Ship v1.1.0" --body "Final release decision and evidence."
at-group-chat artifact "release evidence" --body "Build URL, logs, or exported report."
at-group-chat work --type review "Generic review item" --body "Use --type for issue/proposal/review/decision/artifact."
at-group-chat watch <runId> --max 20
at-group-chat mcp-config > at-mcp.json
```

`at-group-chat token --env` 会生成分离的 `AT_TEAM_API_TOKEN` 和 `AT_TEAM_HOOK_TOKEN`；不要把真实 token 提交到仓库。

```bash
curl -s http://127.0.0.1:5174/api/status
```

平台健康和可移植状态：

```bash
curl -s http://127.0.0.1:5174/api/platform
curl -s http://127.0.0.1:5174/api/platform/export
curl -s http://127.0.0.1:5174/api/adapters
curl -s http://127.0.0.1:5174/api/chat
curl -s http://127.0.0.1:5174/api/work-items
curl -s http://127.0.0.1:5174/api/work-items/<itemId>/activity
```

把已有 work item 交给 manager：

```bash
curl -s -X POST http://127.0.0.1:5174/api/work-items/<itemId>/dispatch \
  -H 'content-type: application/json' \
  -d '{
    "permissionProfile": "write-proposed",
    "prompt": "请把这个 work item 转成 proposal/review/decision 的协作流程。"
  }'
```

```bash
curl -s -X POST http://127.0.0.1:5174/api/chat/messages \
  -H 'content-type: application/json' \
  -d '{
    "content": "你现在作为 manager，审查当前项目，并决定是否调度其他岗位。",
    "permissionProfile": "write-proposed"
  }'
```

返回里的 `run.id` 可继续用于 `POST /api/runs/<runId>/dispatch` 和 `GET /api/runs/<runId>/events`。

创建可追踪协作对象：

```bash
curl -s -X POST http://127.0.0.1:5174/api/work-items \
  -H 'content-type: application/json' \
  -d '{
    "type": "issue",
    "title": "把 AT 从聊天室升级成协作平台",
    "body": "需要 proposal/review/decision/artifact 等对象承载 AI 合作。",
    "priority": "high",
    "assignedRoleId": "codex-manager",
    "dispatchToManager": true,
    "permissionProfile": "write-proposed"
  }'
```

```bash
curl -s -X POST http://127.0.0.1:5174/api/runs/<runId>/dispatch \
  -H 'content-type: application/json' \
  -d '{
    "roleId": "kimi-ux-review",
    "task": "基于 team transcript，从 UI/UX 角度审查当前结果。",
    "permissionProfile": "readonly"
  }'
```

## MCP 工具

可用工具：

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

HTTP 还提供 `POST /api/agents` 和 `POST /api/agents/:roleId/config`，可以新增或更新某个岗位的 `name`、`responsibility`、`model`、`thinkingLevel`、`defaultPermission`、`adapter`、`command`、`commandTemplate`。模型名会原样传给对应 adapter；adapter 优先于内置岗位的 CLI 类型，所以 manager 可以把现有岗位或新增岗位对接到任意本机已支持的模型配置。

`thinkingLevel` 可用值：`default`、`minimal`、`low`、`medium`、`high`、`xhigh`。Codex app-server 岗位会收到 reasoning effort；通用 CLI 会收到 `AT_AGENT_THINKING_LEVEL` 环境变量。

通用 CLI 接入用 `adapter: "generic-cli"`。runtime 会把完整岗位 prompt 写入 `AT_AGENT_PROMPT_FILE`，并设置 `AT_AGENT_MODEL`、`AT_AGENT_THINKING_LEVEL`、`AT_AGENT_SESSION_ID`、`AT_AGENT_PROJECT_PATH`、`AT_AGENT_PERMISSION_PROFILE`、`AT_AGENT_ROLE_ID`、`AT_AGENT_NAME` 等环境变量。

批量配置用 `POST /api/team/config` 或 MCP `team_configure_defaults`。只传要改的字段；不传 `roleIds` 时应用到所有启用 agent。

`GET /api/runs/<runId>/events` 是 SSE 事件流。manager 应把 `agent.permission.requested` 和 `agent.approval.requested` 当作正式队伍事件看待：它们说明某个角色向 Codex app-server/runtime 申请了权限或命令 approval，平台会记录自动处理结果，不能当成不可见的后台细节。

不再需要某个动态 agent 时，用 `team_disable_agent` 或 `DELETE /api/agents/:roleId` 禁用它；这会保留记忆记录但从 team 状态和调度名单里移除。`codex-manager` 不能被禁用。

优先顺序：

1. `team_get_room` 看 AT 群聊 room、成员、共享消息和最近事件。
2. 对多步协作先用 `team_create_work_item` 创建 issue/proposal/review/decision/artifact。
3. 对已有 work item 先用 `team_get_work_item_activity` 看关联 run/messages/events，再用 `team_dispatch_work_item` 交给 manager。
4. `team_chat_message` 把即时任务发进群聊，让 manager 先处理。
5. 只在有明确理由时用 `team_dispatch_agent` 点名一个岗位。
6. 若需要调整权限，先用 `team_set_permission`，再 dispatch。
7. 需要岗位私有上下文时用 `team_get_memory`，不要靠猜。
8. `team_create_task` 保留给需要直接创建 run 的兼容场景；新入口优先用群聊或 work item。

## 岗位选择

- `codex-manager`: 接收任务、拆分、调度、汇总，默认 Codex app-server。
- `claude-deep-review`: 使用 Claude Code / `deepseek-v4-pro` 做代码底层审查。
- `kimi-ux-review`: 做用户交互、UI/UX、可用性审查。
- `codex-goal-review`: 独立 Codex app-server thread，检查目标和计划是否满足。

## 权限

- `readonly`: 只读审查。
- `write-proposed`: 可以建议 patch 或改法，但不要直接危险执行。
- `workspace-write`: 允许工作区写入。
- `danger`: 最高风险，只在用户明确授权时使用。

默认使用 `readonly` 或 `write-proposed`。不要为了省事直接用 `danger`。

## Manager 输出格式

每次回复请包含：

```text
Manager decision:
- Current state:
- Agent to call next:
- Reason:
- Permission:
- Stop condition:
```

如果不需要继续调度，`Agent to call next` 写 `none`，并说明停止条件已满足。

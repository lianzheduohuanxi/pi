# Pi Agent 定时任务系统 - 构建指导

> **本文件是 AI Agent 创建定时任务时必须遵循的指导规范。**
> 任何创建、修改定时任务的操作，都必须先阅读本文件并确保符合所有要求。

---

## 1. 系统架构

定时任务系统由 **3 个核心组件** 组成，缺一不可：

```
┌─────────────────────────────────────────────────────────┐
│                  scheduler.mjs (调度器)                  │
│  常驻后台进程，每 60s 检查一次 tasks.json 中的 cron 表达式 │
│  到时间 → 调用: node run-task.mjs <taskId>               │
└──────────────────────┬──────────────────────────────────┘
                       │ 触发
                       ▼
┌─────────────────────────────────────────────────────────┐
│                run-task.mjs (执行器)                     │
│  读取任务配置 → 模板替换 → 执行 prompt 或 script         │
│  → 保存 Obsidian → 记录历史 → 弹出通知                   │
└──────────────────────┬──────────────────────────────────┘
                       │ 读取
                       ▼
┌─────────────────────────────────────────────────────────┐
│                tasks.json (任务配置)                     │
│  所有定时任务的声明式配置，包含 cron、执行模式、输出选项等 │
└─────────────────────────────────────────────────────────┘
```

### 文件清单

| 文件 | 路径 | 作用 | 必须存在 |
|------|------|------|----------|
| scheduler.mjs | `~/.pi/agent/scheduler/scheduler.mjs` | 调度器守护进程 | ✅ |
| run-task.mjs | `~/.pi/agent/scheduler/run-task.mjs` | 任务执行器 | ✅ |
| tasks.json | `~/.pi/agent/scheduler/tasks.json` | 任务配置 | ✅ |
| state.json | `~/.pi/agent/scheduler/state.json` | 运行状态（自动生成） | 自动 |
| history.json | `~/.pi/agent/scheduler/history.json` | 执行历史（自动生成） | 自动 |
| .lock | `~/.pi/agent/scheduler/.lock` | 并发锁（自动生成） | 自动 |

---

## 2. 创建定时任务的完整流程

**⚠️ 创建定时任务时，必须按以下步骤逐一完成，不可跳过任何一步。**

### 步骤 1：确认调度器正在运行

```bash
# 检查 scheduler.mjs 是否在运行
# Windows:
tasklist /FI "WINDOWTITLE eq pi-scheduler"
# 或用 pm2:
pm2 list

# 如果没有运行，启动它：
pm2 start ~/.pi/agent/scheduler/scheduler.mjs --name pi-scheduler
pm2 save
```

**如果调度器没有运行，定时任务永远不会被触发！这是最常见的故障原因。**

### 步骤 2：编写任务配置并写入 tasks.json

在 `tasks.json` 数组中添加新任务对象。根据执行模式选择对应的字段组合。

### 步骤 3：验证任务配置

```bash
# 手动执行一次，确认任务能正常运行
node ~/.pi/agent/scheduler/run-task.mjs <taskId>
```

### 步骤 4：确认调度器能识别新任务

```bash
# 查看调度器日志，确认它读取了新任务
pm2 logs pi-scheduler
```

---

## 3. 任务配置规范

### 3.1 必填字段

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | string | 唯一标识，格式: `task_<random>_<random>` |
| `name` | string | 人类可读的任务名称 |
| `cron` | string | 5 字段 cron 表达式（分 时 日 月 周） |
| `enabled` | boolean | 是否启用 |

### 3.2 执行模式（三选一，必填其一）

任务支持三种执行模式，**必须且只能选择一种**：

#### 模式 A：Prompt 模式 — 让 Pi CLI 执行 prompt

```json
{
  "id": "task_xxx_yyy",
  "name": "每日新闻摘要",
  "cron": "0 9 * * *",
  "prompt": "请总结今天 {{today}} 的科技新闻要点",
  "enabled": true
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `prompt` | string | **必填**。传给 `pi.cmd -p` 的提示词 |

⚠️ **注意**：Windows cmd.exe 命令行长度限制约 8191 字符。如果 prompt 超过 4000 字符，系统会自动将 prompt 写入临时文件，然后让 Pi CLI 读取文件执行。但建议长 prompt 优先使用模式 C（promptFile）。

#### 模式 B：Script 模式 — 执行 Python/Shell 脚本

```json
{
  "id": "task_xxx_yyy",
  "name": "每日操作回顾分析",
  "cron": "35 14 * * *",
  "script": "C:\\Users\\xxx\\.pi\\agent\\scheduler\\daily-review.py",
  "scriptArgs": ["{{yesterday}}"],
  "enabled": true
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `script` | string | **必填**。脚本文件的绝对路径 |
| `scriptArgs` | string[] | 可选。传给脚本的参数列表 |
| `scriptInterpreter` | string | 可选。解释器路径，默认 `python` |

#### 模式 C：PromptFile 模式 — 从文件读取 prompt（推荐用于长指令）

```json
{
  "id": "task_xxx_yyy",
  "name": "每日操作回顾分析",
  "cron": "35 14 * * *",
  "promptFile": "C:\\Users\\xxx\\.pi\\agent\\scheduler\\prompts\\daily-review.txt",
  "enabled": true
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `promptFile` | string | **必填**。prompt 文件的绝对路径，支持 `~` 开头 |

**为什么需要 promptFile？** 当 prompt 内容较长（如包含详细步骤、API 调用说明、输出格式要求等），直接通过命令行传递会被 Windows cmd.exe 截断。promptFile 模式将详细指令写入文件，让 Pi CLI 读取文件内容执行，彻底避免截断问题。

**promptFile 文件内容示例** (`daily-review.txt`)：
```
你是一个操作回顾分析助手。请分析 {{yesterday}} 的操作记录，完成以下任务：
1. 读取 ~/.pi/agent/logs/{{yesterday}}.log 文件
2. 按类别汇总操作（工作、学习、生活）
3. 生成 Markdown 格式的回顾报告
4. 不要调用任何外部 API
```

### 3.3 可选字段

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `outputToObsidian` | boolean | `false` | 是否将输出写入 Obsidian 笔记 |
| `obsidianOutputFormat` | string | `"daily"` | Obsidian 输出格式: daily/weekly/custom/daily-visual/weekly-visual |
| `obsidianCategory` | string | `"work"` | Obsidian 笔记中的分类标题 |
| `obsidianOutputPath` | string | - | custom 模式下的输出路径模板 |
| `obsidianWeeklyFolder` | string | - | weekly 模式下的文件夹路径 |
| `notifyOnComplete` | boolean | `true` | 完成后是否弹出系统通知 |

### 3.4 模板变量

以下占位符可在 `prompt`、`scriptArgs` 中使用，执行时自动替换：

| 变量 | 替换为 | 示例 |
|------|--------|------|
| `{{today}}` | 当天日期 | `2026-05-29` |
| `{{yesterday}}` | 昨天日期 | `2026-05-28` |
| `{{date}}` | 当天日期（同 today） | `2026-05-29` |

---

## 4. 模式选择建议

### 推荐优先级

1. **Script 模式（首选）** — 可靠性最高，适合数据收集、API 调用、文件操作等确定性任务
2. **PromptFile 模式（次选）** — 需要 LLM 判断时使用，但 prompt 必须具体明确
3. **Prompt 模式（不推荐）** — 短文本可用，但容易因指令模糊导致 AI 自由发挥

### 自动化约束

所有 prompt/promptFile 模式的任务会自动添加前缀：

```
[自动化任务] 严格按以下指令执行。禁止提问、禁止等待用户输入、禁止请求确认。
如果信息不足，使用合理的默认值继续。输出要求的内容即可。
```

这确保无人值守时 AI 不会反问用户。

### 敏感配置

脚本中的 API key、密码等敏感信息**禁止硬编码**，必须从环境变量读取：

```python
# 正确
API_KEY = os.environ.get('MINIMAX_API_KEY')
if not API_KEY:
    print("Error: MINIMAX_API_KEY not set", file=sys.stderr)
    sys.exit(1)

# 错误 — 不要这样做
API_KEY = os.environ.get('MINIMAX_API_KEY', 'sk-xxx...')
```

---

## 5. 常见错误与检查清单

### ❌ 错误 1：没有启动调度器

**现象**：任务配置正确，但到时间不执行。
**原因**：scheduler.mjs 没有在后台运行。
**修复**：启动调度器守护进程（见步骤 1），或使用 Windows Task Scheduler 原生触发（`scheduler_create` 工具会自动同步到 schtasks）。

### ❌ 错误 2：同时缺少 prompt、promptFile 和 script

**现象**：手动执行 run-task.mjs 报错 `Task must have either 'prompt', 'promptFile', or 'script' field`。
**原因**：任务配置中没有 `prompt`、`promptFile` 或 `script` 中的任何一个。
**修复**：添加其中一个字段。

### ❌ 错误 3：长 prompt 被命令行截断

**现象**：AI 收到的 prompt 不完整，无法理解任务要求，输出与预期不符。
**原因**：Windows cmd.exe 命令行长度限制约 8191 字符，长 prompt 被截断。
**修复**：使用 `promptFile` 字段将详细指令写入文件，或系统会自动处理（超过 4000 字符自动写入临时文件）。

### ❌ 错误 4：script 模式用了 prompt 的字段名

**现象**：任务本意是执行脚本，但配置了 `prompt` 字段，导致 Pi CLI 尝试把脚本路径当 prompt 执行。
**原因**：混淆了两种执行模式。
**修复**：使用 `script` + `scriptArgs` 字段。

### ❌ 错误 5：script 路径不是绝对路径

**现象**：执行报错找不到脚本文件。
**原因**：run-task.mjs 的工作目录可能不是脚本所在目录。
**修复**：始终使用绝对路径，如 `C:\\Users\\xxx\\.pi\\agent\\scheduler\\daily-review.py`。

### ❌ 错误 6：cron 表达式格式错误

**现象**：调度器无法匹配时间，任务永远不触发。
**原因**：cron 表达式不是标准 5 字段格式。
**修复**：使用 `分 时 日 月 周` 格式，如 `0 9 * * *`（每天 9:00）。

### ❌ 错误 7：AI 在定时任务中反问用户

**现象**：prompt/promptFile 模式的任务执行后输出的是问题列表而非结果。
**原因**：prompt 指令不够具体，AI 进入了对话模式。
**修复**：系统已自动添加"禁止提问"前缀。确保 prompt 内容具体明确、步骤清晰。

### ❌ 错误 8：脚本硬编码敏感信息

**现象**：API key、密码等泄露到日志、session 记录或 git 中。
**原因**：脚本中 fallback 值包含明文密钥。
**修复**：所有敏感信息从环境变量读取，缺失时直接报错退出。

---

## 5. 创建任务前的自检清单

在写入 tasks.json 之前，逐项确认：

- [ ] 调度器 scheduler.mjs 正在后台运行（或已通过 schtasks/crontab 注册）
- [ ] 任务有唯一 id
- [ ] 任务有正确的 cron 表达式（5 字段）
- [ ] 任务有 `prompt`、`promptFile` 或 `script` 字段（三选一）
- [ ] 优先使用 script 模式（可靠性最高）；需要 LLM 时使用 promptFile 模式
- [ ] 如果是 script 模式，路径是绝对路径
- [ ] 如果是 script 模式，脚本文件确实存在
- [ ] 脚本中无硬编码敏感信息（API key 等必须从环境变量读取）
- [ ] 模板变量 `{{today}}`/`{{yesterday}}` 使用正确
- [ ] 已手动执行 `node run-task.mjs <taskId>` 验证通过

---

## 6. 部署调度器

### 方式 A：pm2（推荐）

```bash
npm install -g pm2
pm2 start ~/.pi/agent/scheduler/scheduler.mjs --name pi-scheduler
pm2 save
pm2 startup    # 设置开机自启
```

### 方式 B：Windows 任务计划程序

```powershell
schtasks /create /tn "PiAgentScheduler" /tr "node %USERPROFILE%\.pi\agent\scheduler\scheduler.mjs" /sc onstart /ru "%USERNAME%"
```

### 方式 C：手动启动（调试用）

```bash
node ~/.pi/agent/scheduler/scheduler.mjs
```

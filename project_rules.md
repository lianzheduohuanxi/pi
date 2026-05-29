# Pi Agent 定时任务系统 - 项目规则

> 本规则是 AI Agent 创建、修改定时任务时必须遵循的硬性约束。
> 违反任何一条都会导致定时任务无法正常执行。

---

## 核心架构约束

定时任务系统由 3 个组件组成，缺一不可：

1. **scheduler.mjs** — 调度器守护进程，常驻后台，每 60s 检查一次任务
2. **run-task.mjs** — 任务执行器，被调度器调用后执行单个任务
3. **tasks.json** — 任务配置声明

所有文件位于 `~/.pi/agent/scheduler/` 目录下。

---

## 创建定时任务时的强制流程

### 第 1 步：检查基础设施

创建任何定时任务之前，必须先确认：

- [ ] `~/.pi/agent/scheduler/scheduler.mjs` 文件存在
- [ ] `~/.pi/agent/scheduler/run-task.mjs` 文件存在
- [ ] 调度器守护进程正在运行（检查 pm2 或 tasklist）

如果文件不存在，必须先创建它们。如果调度器未运行，必须先启动它。

### 第 2 步：编写任务配置

写入 `~/.pi/agent/scheduler/tasks.json`，必须遵循以下规范：

#### 必填字段

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | string | 唯一标识，格式 `task_<random>_<random>` |
| `name` | string | 任务名称 |
| `cron` | string | 标准 5 字段 cron：`分 时 日 月 周` |
| `enabled` | boolean | 是否启用 |

#### 执行模式（必须且只能选一种）

**Prompt 模式** — 让 Pi CLI 执行提示词：
```json
{
  "prompt": "你的提示词，支持 {{today}} {{yesterday}} {{date}} 模板变量"
}
```

**PromptFile 模式** — 从文件读取提示词（推荐用于长指令）：
```json
{
  "promptFile": "提示词文件的绝对路径，支持 ~ 开头"
}
```

**Script 模式** — 执行 Python/Shell 脚本：
```json
{
  "script": "脚本的绝对路径（必须绝对路径）",
  "scriptArgs": ["参数1", "参数2"],
  "scriptInterpreter": "python"
}
```

⚠️ **禁止**：同时缺少 `prompt`、`promptFile` 和 `script`，这会导致执行崩溃。
⚠️ **禁止**：script 模式使用相对路径，这会导致找不到脚本文件。
⚠️ **禁止**：长 prompt 直接用 prompt 字段（超过几百字），会被 Windows cmd.exe 截断，必须用 promptFile。

### 第 3 步：验证

创建任务后，必须手动执行一次验证：
```bash
node ~/.pi/agent/scheduler/run-task.mjs <taskId>
```

### 第 4 步：确认调度器识别

检查调度器日志，确认新任务被加载：
```bash
pm2 logs pi-scheduler
```

---

## 修改定时任务时的约束

- 修改 `tasks.json` 后无需重启调度器（调度器每 60s 自动重新读取）
- 修改 `scheduler.mjs` 或 `run-task.mjs` 后需要重启调度器：`pm2 restart pi-scheduler`
- 禁用任务只需设置 `"enabled": false`，不要删除任务记录

---

## 常见错误速查

| 错误现象 | 原因 | 修复 |
|----------|------|------|
| 任务到时间不执行 | 调度器未运行 | `pm2 start scheduler.mjs` |
| 执行报 TypeError: Cannot read properties of undefined | 缺少 prompt/promptFile/script 字段 | 添加对应字段 |
| AI 收到不完整的 prompt | prompt 太长被 cmd.exe 截断 | 改用 promptFile 字段 |
| 找不到脚本文件 | script 用了相对路径 | 改为绝对路径 |
| 同一分钟重复执行 | state.json 损坏 | 删除 state.json 让调度器重建 |
| 任务超时 | 执行超过 300s | 检查脚本是否有死循环 |

---

## 详细文档

完整规范见：`~/.pi/agent/scheduler/SCHEDULER-GUIDE.md`

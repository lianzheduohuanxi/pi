# 全局上下文

## 个人信息
- 语言偏好: 中文
- 笔记系统: Obsidian
- 操作系统: Windows

## Obsidian 笔记库
- **配置文件**: `~/.pi/agent/obsidian-config.json`
- **路径读取方式**: Agent 通过 `obsidian_show_config` 工具读取配置文件中的 vaultPath，**不依赖文档中的硬编码路径**
- **配置工具**: 使用 `/obsidian-setup` 命令或 `obsidian_config` 工具设置笔记库路径
- 每日笔记格式: YYYY-MM-DD.md，存放在 `Daily Notes` 文件夹
- 分类: 饮食(diet)、运动(exercise)、学习(learning)、工作(work)
- ⚠️ **重要**: 所有 Obsidian 操作必须使用 `obsidian_read`、`obsidian_write`、`obsidian_search`、`obsidian_list`、`obsidian_record` 等专用工具，这些工具会自动从配置文件读取正确的 vaultPath，**禁止使用通用的 `edit`、`read` 等工具直接操作笔记库文件**

## 定时任务
- 任务定义存储在 ~/.pi/agent/scheduler/tasks.json
- Windows: 使用 Windows Task Scheduler (schtasks) 执行定时任务
- Linux/macOS: 使用系统 crontab 执行定时任务
- 运行脚本在 ~/.pi/agent/scheduler/run-task.mjs
- Windows 批处理包装在 ~/.pi/agent/scheduler/run-task.bat
- 可通过 PI_BIN 环境变量指定 pi 命令路径
- Windows 上支持的 cron 模式:
  - `*/5 * * * *` 每 N 分钟
  - `0 */2 * * *` 每 N 小时
  - `0 9 * * *` 每天 9:00
  - `0 9 * * 1-5` 工作日 9:00
  - `0 9 * * 1` 每周一 9:00
  - `0 9 1 * *` 每月 1 号 9:00
- Windows 上创建任务可能需要管理员权限

## 常用命令
- `/obsidian-setup` - 配置 Obsidian 笔记库路径
- `/tasks` - 管理定时任务

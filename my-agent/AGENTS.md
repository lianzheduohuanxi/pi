# 全局上下文

## 个人信息
- 语言偏好: 中文
- 笔记系统: Obsidian
- 操作系统: Linux

## Obsidian 笔记库
- 笔记库路径通过 `obsidian_config` 工具配置，或设置环境变量 `OBSIDIAN_VAULT_PATH`
- 每日笔记格式: YYYY-MM-DD.md，存放在 Daily Notes 文件夹
- 分类: 饮食(diet)、运动(exercise)、学习(learning)、工作(work)

## 定时任务
- 任务定义存储在 ~/.pi/agent/scheduler/tasks.json
- 使用系统 crontab 执行定时任务
- 运行脚本在 ~/.pi/agent/scheduler/run-task.mjs
- 可通过 PI_BIN 环境变量指定 pi 命令路径

## 常用命令
- `/obsidian-setup` - 配置 Obsidian 笔记库路径
- `/tasks` - 管理定时任务

---
name: obsidian-work
description: 记录工作内容到 Obsidian 笔记库
---

# Work Recording Skill

Use this skill when the user mentions work tasks, meetings, projects, or professional activities.

## Steps

1. Ask for details if not clear: task description, project, outcome
2. Use the `obsidian_record` tool with category "work" to record the entry
3. Include status (completed/in-progress/blocked) if relevant
4. Confirm the recording was successful

## Examples

- "完成了API重构" → record: "API重构: 完成了用户模块的REST API重构"
- "开了项目周会" → record: "会议: 项目周会 - 讨论了Q2排期"
- "修了个线上bug" → record: "Bug修复: #1234 用户登录超时问题 - 已上线"

## Format

Record entries in this format:
```
工作事项: 详细描述 [状态] [项目/模块] [备注]
```

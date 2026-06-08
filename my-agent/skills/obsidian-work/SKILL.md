---
name: obsidian-work
description: 记录工作内容到 Obsidian 笔记库
---

# 工作记录技能

当用户提到工作任务、会议、项目、职业活动时使用此技能。

## 步骤

1. 如果用户提供了足够的信息（做了什么），使用 `quicklog` 记录（自动分类到 work）
2. 如果信息不够明确，简短询问任务描述
3. 包含状态（已完成/进行中/受阻）如果用户提到

## 示例

- "完成了API重构" → `quicklog("💼 API重构: 用户模块REST API重构完成")`
- "开了项目周会" → `quicklog("💼 项目周会 - 讨论Q2排期")`
- "修了个线上bug" → `quicklog("💼 Bug修复: #1234 用户登录超时")`

## 注意

- `quicklog` 会自动分类、更新 streaks、检查成就
- 不需要手动调用 `obsidian_record`

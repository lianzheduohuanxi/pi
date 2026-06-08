---
name: obsidian-health
description: 记录健康信息到 Obsidian 笔记库
---

# 健康记录技能

当用户提到健康、身体、睡眠、休息、药物、症状等词汇时使用此技能。

## 步骤

1. 如果用户提供了足够的健康相关信息，使用 `quicklog` 记录（自动分类到 health）
2. 如果信息不够明确，简短询问用户需要记录什么健康信息
3. 如果用户提供了详细数据，一并记录

## 示例

- "昨晚睡了 8 小时" → `quicklog("💤 睡眠 8 小时")`
- "头疼" → `quicklog("💊 头疼")`
- "吃了感冒药" → `quicklog("💊 感冒药")`

## 注意

- `quicklog` 会自动分类、更新 streaks、检查成就
- 不需要手动调用 `obsidian_record`

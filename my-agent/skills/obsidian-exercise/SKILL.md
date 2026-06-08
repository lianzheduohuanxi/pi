---
name: obsidian-exercise
description: 记录运动信息到 Obsidian 笔记库
---

# 运动记录技能

当用户提到运动、锻炼、跑步、健身、体力活动时使用此技能。

## 步骤

1. 如果用户提供了足够的信息（运动类型），使用 `quicklog` 记录（自动分类到 exercise）
2. 如果信息不够明确，简短询问运动类型和时长
3. 如果用户提供了数据（距离、次数、重量），一并记录

## 示例

- "跑了5公里" → `quicklog("🏃 跑步 5km")`
- "做了30分钟瑜伽" → `quicklog("💪 瑜伽 30分钟")`
- "举铁，深蹲80kg 5组" → `quicklog("💪 深蹲 80kg x 5组")`

## 注意

- `quicklog` 会自动分类、更新 streaks、检查成就
- 不需要手动调用 `obsidian_record`

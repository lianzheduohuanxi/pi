---
name: obsidian-exercise
description: 记录运动信息到 Obsidian 笔记库
---

# Exercise Recording Skill

Use this skill when the user mentions exercise, workout, running, gym, or physical activity.

## Steps

1. Ask for details if not clear: type of exercise, duration, intensity
2. Use the `obsidian_record` tool with category "exercise" to record the entry
3. If the user provides metrics (distance, reps, weight), include them
4. Confirm the recording was successful

## Examples

- "跑了5公里" → record: "跑步 5km"
- "做了30分钟瑜伽" → record: "瑜伽 30分钟"
- "举铁，深蹲80kg 5组" → record: "力量训练: 深蹲 80kg x 5组"

## Format

Record entries in this format:
```
运动类型: 详细描述 [时长] [强度] [备注]
```

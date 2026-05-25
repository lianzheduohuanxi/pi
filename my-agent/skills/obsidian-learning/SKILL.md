---
name: obsidian-learning
description: 记录学习内容到 Obsidian 笔记库
---

# Learning Recording Skill

Use this skill when the user mentions studying, learning, reading, courses, or knowledge acquisition.

## Steps

1. Ask for details if not clear: topic, duration, key takeaways
2. Use the `obsidian_record` tool with category "learning" to record the entry
3. Include key concepts or insights the user mentions
4. Confirm the recording was successful

## Examples

- "学了TypeScript泛型" → record: "TypeScript泛型: 学习了条件类型和映射类型"
- "读了《原子习惯》第3章" → record: "阅读: 《原子习惯》第3章 - 习惯叠加策略"
- "完成了LeetCode两道题" → record: "刷题: LeetCode #123 动态规划, #456 二分查找"

## Format

Record entries in this format:
```
学习主题: 关键内容摘要 [时长] [心得]
```

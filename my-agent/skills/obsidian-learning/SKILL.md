---
name: obsidian-learning
description: 记录学习内容到 Obsidian 笔记库
---

# 学习记录技能

当用户提到学习、读书、课程、知识获取时使用此技能。

## 步骤

1. 如果用户提供了足够的信息（学什么），使用 `quicklog` 记录（自动分类到 learning）
2. 如果信息不够明确，简短询问学习主题和关键内容
3. 记录用户提到的关键概念或心得

## 示例

- "学了TypeScript泛型" → `quicklog("📚 TypeScript泛型: 条件类型和映射类型")`
- "读了《原子习惯》第3章" → `quicklog("📚 阅读: 《原子习惯》第3章")`
- "完成了LeetCode两道题" → `quicklog("📚 LeetCode #123 动态规划, #456 二分查找")`

## 注意

- `quicklog` 会自动分类、更新 streaks、检查成就
- 不需要手动调用 `obsidian_record`

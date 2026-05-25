---
name: obsidian-diet
description: 记录饮食信息到 Obsidian 笔记库
---

# Diet Recording Skill

Use this skill when the user mentions food, meals, diet, or eating.

## Steps

1. Ask the user what they ate if not clear (breakfast/lunch/dinner/snack)
2. Use the `obsidian_record` tool with category "diet" to record the entry
3. If the user provides detailed info (calories, nutrition), include it in the content
4. Confirm the recording was successful

## Examples

- "我吃了早餐" → record: "早餐: [details]"
- "今天午饭吃了火锅" → record: "午餐: 火锅"
- "下午吃了个苹果" → record: "加餐: 苹果"

## Format

Record entries in this format:
```
餐次: 食物描述 [热量估算] [营养备注]
```

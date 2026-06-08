# 技术配置与工具手册

## 环境信息
- **语言**: 中文
- **笔记系统**: Obsidian
- **操作系统**: Windows

---

## 核心系统

### Obsidian 配置
- **配置文件**: `~/.pi/agent/obsidian-config.json`
- **读取配置**: 使用 `obsidian_show_config` 工具读取配置
- **设置配置**: 使用 `obsidian_config` 工具或 `/obsidian-setup` 命令
- **每日笔记**: YYYY-MM-DD.md，存在 `Daily Notes` 文件夹
- **分类**: diet, exercise, learning, work, mood, health, finance
- **重要**: 所有 Obsidian 操作必须使用 `obsidian_*` 专用工具，不要用通用文件工具

---

## 定时任务系统
- **任务存储**: `~/.pi/agent/scheduler/tasks.json`
- **Windows**: Task Scheduler (schtasks)
- **Linux/macOS**: crontab
- **运行脚本**: `~/.pi/agent/scheduler/run-task.mjs`
- **Windows 批处理**: `~/.pi/agent/scheduler/run-task.bat`
- **环境变量**: PI_BIN 指定 pi 命令路径

### 三种执行模式

| 模式 | 触发条件 | 执行方式 |
|------|---------|---------|
| **prompt** | `task.prompt` 存在 | `piBin -p "自动化前缀 + prompt"` |
| **promptFile** | `task.promptFile` 存在 | 读文件内容 → 同 prompt 模式 |
| **script** | `task.script` 存在 | `interpreter script [args]` |

- prompt/promptFile 模式通过 pi agent 执行，自动使用用户当前 LLM provider
- script 模式独立运行，不依赖 pi agent（适合纯数据处理脚本）
- **推荐**：需要 LLM 分析的任务用 promptFile 模式，数据提取用 script 模式

### PromptFile 模式模板变量

- `{{yesterday}}` — 昨天日期 YYYY-MM-DD
- `{{today}}` / `{{date}}` — 今天日期 YYYY-MM-DD

### 当前任务配置

- **每日项目复盘**: promptFile 模式，prompt 文件 `~/.pi/agent/scheduler/daily-review-prompt.md`
  - 数据提取: `extract-review-data.py`（SQLite + JSONL → JSON，无 API 调用）
  - LLM 分析: pi agent 自行完成（使用当前 provider）
  - 输出: Obsidian Daily Notes

---

## 扩展列表

### 1️⃣ 快速记录系统 ([quicklog.ts](file:///workspace/my-agent/extensions/quicklog.ts))
| 工具 | 用途 |
|------|------|
| `quicklog` | 一句话快速记录 |
| `quicklog_streaks` | 查看连续记录 |
| `quicklog_achievements` | 查看成就 |

**表情映射**:
- 😊😢😰😠 → mood
- 🏃💪 → exercise
- 📚 → learning
- 💼 → work
- 🍽️☕ → diet
- 💤💊 → health
- 💰 → finance

**关键词自动分类**:
- 吃、饭、咖啡 → diet
- 运动、跑步、健身 → exercise
- 学习、读书 → learning
- 工作 → work
- 开心、难过 → mood
- 睡、困 → health
- 买、花 → finance

---

### 2️⃣ 每日复盘引擎 ([dailyreview.ts](file:///workspace/my-agent/extensions/dailyreview.ts))
| 工具 | 用途 |
|------|------|
| `daily_review` | 每日复盘 |
| `weekly_keynote` | 每周回顾 |

---

### 3️⃣ 复利知识库 ([knowledge.ts](file:///workspace/my-agent/extensions/knowledge.ts))
| 工具 | 用途 |
|------|------|
| `knowledge_scan` | 扫描并索引笔记 |
| `knowledge_search` | 搜索知识 |
| `knowledge_related` | 相关笔记 |
| `knowledge_stats` | 知识统计 |

---

### 4️⃣ Obsidian 基础 ([obsidian.ts](file:///workspace/my-agent/extensions/obsidian.ts))
| 工具 | 用途 |
|------|------|
| `obsidian_record` | 记录条目 |
| `obsidian_read` | 读取笔记 |
| `obsidian_write` | 写入笔记 |
| `obsidian_search` | 搜索笔记 |
| `obsidian_list` | 列出内容 |
| `obsidian_config` | 配置路径 |
| `obsidian_show_config` | 查看配置 |

### 4️⃣+1 Obsidian 数据分析 ([obsidian-stats.ts](file:///workspace/my-agent/extensions/obsidian-stats.ts))
| 工具 | 用途 |
|------|------|
| `obsidian_summary` | 摘要 |
| `obsidian_statistics` | 统计 |
| `obsidian_visualize` | 可视化（图表、趋势） |
| `obsidian_analyze` | 分析建议 |
| `obsidian_report` | 周报/月报 |

**可视化优先规则**：
- 数据趋势分析 → 使用 `obsidian_visualize` 生成折线图/柱状图
- 多维度对比 → 使用 `obsidian_visualize` 生成对比图表
- 比例/占比分析 → 使用 `obsidian_visualize` 生成饼图
- 周期性报告 → 结合 `obsidian_visualize` + `obsidian_report`
- 分布分析 → 使用 `obsidian_visualize` 生成箱线图或直方图

**共享模块**: [obsidian-config.ts](file:///workspace/my-agent/lib/obsidian-config.ts) — 统一配置加载、类型定义、通用 helpers（位于 `my-agent/lib/`，不在 extensions/ 下，避免 pi 自动加载为扩展）

---

### 5️⃣ 定时任务 ([scheduler.ts](file:///workspace/my-agent/extensions/scheduler.ts))
| 工具 | 用途 |
|------|------|
| `scheduler_create` | 创建任务 |
| `scheduler_list` | 列出任务 |
| `scheduler_delete` | 删除任务 |
| `scheduler_run` | 立即运行 |
| `scheduler_toggle` | 启用/禁用 |
| `scheduler_update` | 更新配置 |
| `scheduler_history` | 历史记录 |

---

### 6️⃣ 智能提醒 ([reminder.ts](file:///workspace/my-agent/extensions/reminder.ts))
| 工具 | 用途 |
|------|------|
| `reminder_list` | 列出提醒 |
| `reminder_create` | 创建提醒 |
| `reminder_toggle` | 启用/禁用 |
| `reminder_delete` | 删除提醒 |
| `reminder_check` | 检查触发 |

---

## 命令列表

| 命令 | 用途 |
|------|------|
| `/obsidian-setup` | 设置 Obsidian |
| `/tasks` | 管理定时任务 |
| `/log` | 快速记录 |
| `/kb` | 知识库管理 |

---

## 目录结构

```
~/.pi/agent/
├── obsidian-config.json    # Obsidian 配置
├── scheduler/
│   ├── tasks.json         # 定时任务定义
│   ├── run-task.mjs       # 运行脚本（由 pi 启动时从模板生成）
│   ├── run-task.bat       # Windows 批处理入口
│   ├── daily-review-prompt.md  # 每日复盘 prompt 文件
│   ├── extract-review-data.py  # 数据提取脚本（SQLite + JSONL → JSON）
│   ├── prompts/           # 长 prompt 临时文件
│   ├── .lock              # 任务锁文件（防并发）
│   └── history.json       # 执行历史（最近 100 条）
├── quicklog/
│   ├── achievements.json  # 成就数据
│   ├── streaks.json       # 连续记录
│   └── total-count.json   # 累计记录总数
├── knowledge/
│   └── kb.json          # 知识库索引
└── reviews/              # 复盘历史
```

---

## 技能系统

### Obsidian 分类技能
- [obsidian-diet - 饮食记录]
- [obsidian-exercise - 运动记录]
- [obsidian-learning - 学习记录]
- [obsidian-work - 工作记录]
- [obsidian-mood - 心情记录]
- [obsidian-health - 健康记录]
- [obsidian-finance - 财务记录]

---

## Prompt 模板

- [daily-summary.md](file:///workspace/my-agent/prompts/daily-summary.md) - 每日总结提示词
- [weekly-review.md](file:///workspace/my-agent/prompts/weekly-review.md) - 每周回顾提示词

---

## 数据文件说明

- **quicklog 数据**: `~/.pi/agent/quicklog/`
- **achievements.json**: 成就解锁状态
- **streaks.json**: 分类连续记录天数
- **total-count.json**: 累计记录总数（用于 achievements）
- **knowledge/kb.json**: 知识库索引
- **reviews/**: 每日复盘历史

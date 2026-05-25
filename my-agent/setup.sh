#!/usr/bin/env bash
set -euo pipefail

PI_AGENT_DIR="$HOME/.pi/agent"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "========================================="
echo "  Pi 个人全能助手 - 安装脚本"
echo "========================================="
echo ""

mkdir -p "$PI_AGENT_DIR"/{extensions,skills,prompts,scheduler}

echo "[1/6] 安装扩展..."
for ext in "$SCRIPT_DIR"/extensions/*.ts; do
    name=$(basename "$ext")
    cp "$ext" "$PI_AGENT_DIR/extensions/$name"
    echo "  ✓ extensions/$name"
done

echo ""
echo "[2/6] 安装技能..."
for skill_dir in "$SCRIPT_DIR"/skills/*/; do
    name=$(basename "$skill_dir")
    mkdir -p "$PI_AGENT_DIR/skills/$name"
    cp "$skill_dir"SKILL.md "$PI_AGENT_DIR/skills/$name/SKILL.md"
    echo "  ✓ skills/$name"
done

echo ""
echo "[3/6] 安装提示词模板..."
for prompt in "$SCRIPT_DIR"/prompts/*.md; do
    name=$(basename "$prompt")
    cp "$prompt" "$PI_AGENT_DIR/prompts/$name"
    echo "  ✓ prompts/$name"
done

echo ""
echo "[4/6] 安装系统提示..."
if [ -f "$PI_AGENT_DIR/SYSTEM.md" ]; then
    echo "  ⚠ SYSTEM.md 已存在，备份为 SYSTEM.md.bak"
    mv "$PI_AGENT_DIR/SYSTEM.md" "$PI_AGENT_DIR/SYSTEM.md.bak"
fi
cp "$SCRIPT_DIR/SYSTEM.md" "$PI_AGENT_DIR/SYSTEM.md"
echo "  ✓ SYSTEM.md"

if [ -f "$PI_AGENT_DIR/AGENTS.md" ]; then
    echo "  ⚠ AGENTS.md 已存在，备份为 AGENTS.md.bak"
    mv "$PI_AGENT_DIR/AGENTS.md" "$PI_AGENT_DIR/AGENTS.md.bak"
fi
cp "$SCRIPT_DIR/AGENTS.md" "$PI_AGENT_DIR/AGENTS.md"
echo "  ✓ AGENTS.md"

echo ""
echo "[5/6] 配置 Obsidian..."
if [ ! -f "$PI_AGENT_DIR/obsidian-config.json" ]; then
    cp "$SCRIPT_DIR/obsidian-config.json" "$PI_AGENT_DIR/obsidian-config.json"
    echo "  ✓ obsidian-config.json (模板已安装)"
else
    echo "  ⚠ obsidian-config.json 已存在，跳过（如需更新请手动编辑）"
fi

echo ""
echo "[6/6] 配置定时任务目录..."
mkdir -p "$PI_AGENT_DIR/scheduler"
echo "  ✓ scheduler/ 目录已创建"

echo ""
echo "========================================="
echo "  安装完成！"
echo "========================================="
echo ""
echo "接下来你需要："
echo ""
echo "1. 配置 Obsidian 笔记库路径："
echo "   编辑 $PI_AGENT_DIR/obsidian-config.json"
echo "   将 vaultPath 改为你的 Obsidian vault 绝对路径"
echo "   或设置环境变量: export OBSIDIAN_VAULT_PATH=/path/to/your/vault"
echo ""
echo "2. 确保 pi 可以运行："
echo "   如果从源码运行: cd $(dirname "$SCRIPT_DIR") && ./pi-test.sh"
echo "   如果全局安装: pi"
echo "   定时任务需要设置: export PI_BIN=pi (或源码路径)"
echo ""
echo "3. 启动 pi 并测试："
echo "   pi"
echo "   然后输入: 帮我记录今天午餐吃了炒饭"
echo ""
echo "4. (可选) 设置定时任务："
echo "   在 pi 中输入: 帮我创建一个每天晚上9点的每日总结任务"
echo ""

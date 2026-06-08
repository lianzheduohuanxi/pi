import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "@earendil-works/pi-ai";
import {
	readFileSync,
	writeFileSync,
	existsSync,
	mkdirSync,
} from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { loadConfig } from "../lib/obsidian-config";

const REVIEW_DIR = join(homedir(), ".pi", "agent", "reviews");
const STREAKS_FILE = join(homedir(), ".pi", "agent", "quicklog", "streaks.json");

interface DailyData {
	date: string;
	categories: Record<string, { count: number; entries: string[] }>;
	rawContent: string;
}

interface Review {
	date: string;
	summary: string;
	highlights: string[];
	lowlights: string[];
	suggestions: string[];
	mood: string;
	productivity: number;
}

function parseDailyNote(date: string): DailyData | null {
	const config = loadConfig();
	const notePath = join(config.vaultPath, config.dailyNoteFolder || "Daily Notes", `${date}.md`);

	if (!existsSync(notePath)) {
		return null;
	}

	const content = readFileSync(notePath, 'utf-8');
	const categories: Record<string, { count: number; entries: string[] }> = {};

	for (const [key, cat] of Object.entries(config.categories || {})) {
		const sectionHeader = `## ${cat.emoji} ${cat.label}`;
		const sectionRegex = new RegExp(`${sectionHeader}[^#]*`, 's');
		const match = content.match(sectionRegex);

		if (match) {
			const entries = match[0].split('\n').filter(l => l.startsWith('-'));
			categories[key] = {
				count: entries.length,
				entries: entries.map(e => e.trim())
			};
		}
	}

	return {
		date,
		categories,
		rawContent: content
	};
}

function analyzeMood(data: DailyData): string {
	if (data.categories.mood) {
		const entries = data.categories.mood.entries;
		if (entries.some(e => e.includes('😊') || e.includes('🤩') || e.includes('😍') || e.includes('开心') || e.includes('幸福'))) {
			return '😃 心情很好';
		}
		if (entries.some(e => e.includes('😢') || e.includes('😰') || e.includes('😠') || e.includes('难过') || e.includes('焦虑') || e.includes('生气'))) {
			return '😔 心情有些低落';
		}
	}
	return '😐 心情平静';
}

function calculateProductivity(data: DailyData): number {
	let score = 0;
	const categories = ['work', 'learning', 'exercise', 'health'];

	categories.forEach(cat => {
		if (data.categories[cat]) {
			score += data.categories[cat].count * 10;
		}
	});

	return Math.min(score, 100);
}

function generateHighlights(data: DailyData): string[] {
	const highlights: string[] = [];

	if (data.categories.learning && data.categories.learning.count > 0) {
		highlights.push(`📚 学习了！有 ${data.categories.learning.count} 条记录`);
	}
	if (data.categories.exercise && data.categories.exercise.count > 0) {
		highlights.push(`🏃 运动了！有 ${data.categories.exercise.count} 条记录`);
	}
	if (data.categories.work && data.categories.work.count > 2) {
		highlights.push(`💼 工作很充实！${data.categories.work.count} 项任务`);
	}

	return highlights;
}

function generateLowlights(data: DailyData): string[] {
	const lowlights: string[] = [];

	if (!data.categories.learning) {
		lowlights.push('📚 今天没有学习，明天记得安排时间');
	}
	if (!data.categories.exercise) {
		lowlights.push('🏃 今天没有运动，抽点时间动一动');
	}
	if (!data.categories.mood) {
		lowlights.push('😊 没有记录心情，明天记得记录一下');
	}

	return lowlights;
}

function generateSuggestions(data: DailyData): string[] {
	const suggestions: string[] = [];

	if (!data.categories.learning) {
		suggestions.push('📚 明天安排30分钟学习时间，哪怕只看一页书');
	}
	if (!data.categories.exercise) {
		suggestions.push('🏃 明天抽15分钟散散步也好');
	}

	if (data.categories.learning && data.categories.exercise) {
		suggestions.push('🌟 今天表现不错！继续保持这个节奏');
	}

	if (suggestions.length === 0) {
		suggestions.push('🌈 今天很完美！继续保持');
	}

	return suggestions;
}

function generateSummary(data: DailyData): string {
	const totalEntries = Object.values(data.categories).reduce((sum, c) => sum + c.count, 0);
	const cats = Object.keys(data.categories).length;

	return `今日共记录 ${totalEntries} 条，覆盖 ${cats} 个分类。`;
}

function loadStreaks() {
	if (existsSync(STREAKS_FILE)) {
		try {
			return JSON.parse(readFileSync(STREAKS_FILE, 'utf-8'));
		} catch {}
	}
	return [];
}

function saveReview(review: Review): void {
	mkdirSync(REVIEW_DIR, { recursive: true });
	const filePath = join(REVIEW_DIR, `${review.date}.json`);
	writeFileSync(filePath, JSON.stringify(review, null, 2), 'utf-8');
}

export default function (pi: ExtensionAPI) {
	pi.registerTool({
		name: "daily_review",
		label: "每日复盘",
		description: "基于当天记录自动生成复盘和建议。",
		promptSnippet: "今天的复盘",
		parameters: Type.Object({
			date: Type.Optional(Type.String({ description: "要复盘的日期 (YYYY-MM-DD)，默认今天" })),
		}),
		async execute(_id, params) {
			const config = loadConfig();
			const date = params.date || new Date().toISOString().split('T')[0];
			const data = parseDailyNote(date);

			if (!data) {
				return {
					content: [{
						type: "text",
						text: `没有找到 ${date} 的记录，今天开始记录吧！💪`
					}],
					isError: true
				};
			}

			const streaks = loadStreaks();
			const review: Review = {
				date,
				summary: generateSummary(data),
				highlights: generateHighlights(data),
				lowlights: generateLowlights(data),
				suggestions: generateSuggestions(data),
				mood: analyzeMood(data),
				productivity: calculateProductivity(data)
			};

			saveReview(review);

			let output = `# 📅 ${date} 复盘\n\n`;

			output += `## 📊 概览\n\n`;
			output += `${review.summary}\n`;
			output += `${review.mood}\n`;

			// 生产力进度条
			const progressBar = '█'.repeat(Math.floor(review.productivity / 10)) +
				'░'.repeat(10 - Math.floor(review.productivity / 10));
			output += `生产力：${progressBar} ${review.productivity}%\n\n`;

			// 连续记录
			if (streaks.length > 0) {
				output += `## 🔥 连续记录\n\n`;
				streaks.slice(0, 5).forEach((s: any) => {
					const catCfg = config.categories?.[s.category];
					output += `${catCfg?.emoji || '📝'} ${catCfg?.label || s.category}: ${s.current}天\n`;
				});
				output += '\n';
			}

			// 亮点
			if (review.highlights.length > 0) {
				output += `## ✨ 做得好的地方\n\n`;
				review.highlights.forEach(h => output += `- ${h}\n`);
				output += '\n';
			}

			// 改进点
			if (review.lowlights.length > 0) {
				output += `## 💪 可以改进的地方\n\n`;
				review.lowlights.forEach(l => output += `- ${l}\n`);
				output += '\n';
			}

			// 建议
			output += `## 🎯 明天的建议\n\n`;
			review.suggestions.forEach(s => output += `- ${s}\n`);

			return {
				content: [{ type: "text", text: output }]
			};
		},
	});

	pi.registerTool({
		name: "weekly_keynote",
		label: "每周回顾",
		description: "生成一周的关键数据总结。",
		promptSnippet: "本周总结",
		parameters: Type.Object({}),
		async execute(_id, _params) {
			const config = loadConfig();
			const today = new Date();
			const days: DailyData[] = [];

			for (let i = 6; i >= 0; i--) {
				const date = new Date(today.getTime() - i * 24 * 60 * 60 * 1000);
				const data = parseDailyNote(date.toISOString().split('T')[0]);
				if (data) {
					days.push(data);
				}
			}

			if (days.length === 0) {
				return {
					content: [{
						type: "text",
						text: "本周没有记录，从今天开始吧！💪"
					}]
				};
			}

			const totalEntries = days.reduce((sum, d) =>
				sum + Object.values(d.categories).reduce((s, c) => s + c.count, 0), 0);
			const avgProductivity = days.length > 0 ?
				Math.round(days.reduce((sum, d) => sum + calculateProductivity(d), 0) / days.length) : 0;
			const bestDay = days.reduce((best, d) => {
				const score = calculateProductivity(d);
				return score > calculateProductivity(best) ? d : best;
			});

			let output = `# 📆 本周回顾\n\n`;

			output += `## 📊 总体数据\n\n`;
			output += `- 记录天数：${days.length}/7\n`;
			output += `- 总记录数：${totalEntries} 条\n`;
			output += `- 平均生产力：${avgProductivity}%\n`;
			output += `- 最好的一天：${bestDay.date}\n\n`;

			// 分类统计
			const catStats: Record<string, number> = {};
			days.forEach(d => {
				Object.entries(d.categories).forEach(([cat, data]) => {
					catStats[cat] = (catStats[cat] || 0) + data.count;
				});
			});

			output += `## 📈 分类统计\n\n`;
			for (const [cat, count] of Object.entries(catStats)) {
				const catConfig = config.categories?.[cat];
				const emoji = catConfig?.emoji || '📝';
				const name = catConfig?.label || cat;
				output += `${emoji} ${name}：${count} 条记录\n`;
			}

			output += `\n## 💪 下周目标\n\n`;
			output += `- 记录 7/7 天\n`;
			output += `- 学习天数增加到 ${Math.min(days.length + 1, 7)} 天\n`;
			output += `- 运动天数增加到 ${Math.min(days.length + 1, 7)} 天\n`;

			return {
				content: [{ type: "text", text: output }]
			};
		},
	});

	pi.registerCommand("review", {
		description: "每日复盘",
		async handler(args, ctx) {
			const date = args[0] || new Date().toISOString().split('T')[0];
			pi.sendUserMessage(`复盘 ${date}`);
		},
	});
}

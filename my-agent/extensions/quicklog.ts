import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "@earendil-works/pi-ai";
import {
	readFileSync,
	writeFileSync,
	existsSync,
	mkdirSync,
	appendFileSync,
} from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const CONFIG_PATH = join(homedir(), ".pi", "agent", "obsidian-config.json");
const QUICKLOG_DIR = join(homedir(), ".pi", "agent", "quicklog");
const ACHIEVEMENTS_FILE = join(QUICKLOG_DIR, "achievements.json");
const STREAKS_FILE = join(QUICKLOG_DIR, "streaks.json");

const EMOTION_MAP: Record<string, string> = {
	'😊': 'mood:开心',
	'😢': 'mood:难过',
	'😴': 'mood:疲惫',
	'🤩': 'mood:兴奋',
	'😐': 'mood:平静',
	'😰': 'mood:焦虑',
	'😠': 'mood:生气',
	'😍': 'mood:幸福',
	'💪': 'exercise:运动了',
	'🏃': 'exercise:跑步',
	'🧘': 'exercise:瑜伽',
	'🍽️': 'diet:吃饭',
	'☕': 'diet:咖啡',
	'🎮': 'break:娱乐',
	'📚': 'learning:学习',
	'💼': 'work:工作',
	'💤': 'health:睡觉',
	'💊': 'health:吃药',
	'💰': 'finance:收支',
	'🎯': 'goal:完成任务',
};

const KEYWORD_MAP: Record<string, { category: string; tag: string }> = {
	'吃了': { category: 'diet', tag: '饮食' },
	'吃饭': { category: 'diet', tag: '饮食' },
	'运动': { category: 'exercise', tag: '运动' },
	'跑步': { category: 'exercise', tag: '跑步' },
	'学习': { category: 'learning', tag: '学习' },
	'看书': { category: 'learning', tag: '阅读' },
	'工作': { category: 'work', tag: '工作' },
	'开心': { category: 'mood', tag: '心情好' },
	'难过': { category: 'mood', tag: '心情不好' },
	'累': { category: 'mood', tag: '疲惫' },
	'困': { category: 'health', tag: '困' },
	'睡': { category: 'health', tag: '睡眠' },
	'买了': { category: 'finance', tag: '消费' },
	'花了': { category: 'finance', tag: '支出' },
};

interface QuickLog {
	id: string;
	timestamp: string;
	content: string;
	category: string;
	tags: string[];
	emotion?: string;
}

interface Achievement {
	id: string;
	name: string;
	description: string;
	icon: string;
	unlockedAt?: string;
	condition: string;
}

interface Streak {
	category: string;
	current: number;
	longest: number;
	lastDate: string;
}

function loadConfig() {
	if (existsSync(CONFIG_PATH)) {
		try {
			return JSON.parse(readFileSync(CONFIG_PATH, "utf-8"));
		} catch {}
	}
	return {
		vaultPath: join(homedir(), "obsidian-vault"),
		dailyNoteFolder: "Daily Notes",
		categories: {}
	};
}

function getTodayNotePath(): string {
	const config = loadConfig();
	const today = new Date().toISOString().split('T')[0];
	return join(config.vaultPath, config.dailyNoteFolder || "Daily Notes", `${today}.md`);
}

function parseQuickLog(input: string): QuickLog {
	let category = 'general';
	let tags: string[] = [];
	let emotion: string | undefined;
	let content = input;

	// 检测表情
	for (const [emoji, mapping] of Object.entries(EMOTION_MAP)) {
		if (input.includes(emoji)) {
			const [cat, tag] = mapping.split(':');
			category = cat;
			tags.push(tag);
			emotion = emoji;
			content = content.replace(emoji, '').trim();
			break;
		}
	}

	// 检测关键词
	if (category === 'general') {
		for (const [keyword, mapping] of Object.entries(KEYWORD_MAP)) {
			if (input.includes(keyword)) {
				category = mapping.category;
				tags.push(mapping.tag);
				break;
			}
		}
	}

	return {
		id: `ql_${Date.now()}`,
		timestamp: new Date().toISOString(),
		content,
		category,
		tags,
		emotion,
	};
}

function saveToObsidian(log: QuickLog): string {
	const notePath = getTodayNotePath();
	const config = loadConfig();
	const catConfig = config.categories?.[log.category];
	const sectionHeader = catConfig ? `## ${catConfig.emoji} ${catConfig.label}` : `## ${log.category}`;

	const timeStr = new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
	const logLine = `- ${timeStr} ${log.emotion || ''} ${log.content} ${log.tags.map(t => `#${t}`).join(' ')}\n`;

	if (!existsSync(notePath)) {
		mkdirSync(join(notePath, '..'), { recursive: true });
		const header = `# ${new Date().toISOString().split('T')[0]}\n\n`;
		writeFileSync(notePath, header, 'utf-8');
	}

	let content = readFileSync(notePath, 'utf-8');

	// 检查是否有对应分类的章节
	if (!content.includes(sectionHeader)) {
		content += `\n${sectionHeader}\n\n`;
	}

	// 在对应章节添加记录
	const sectionRegex = new RegExp(`(${sectionHeader}[^#]*)(?:\\n## |$)`, 's');
	const match = content.match(sectionRegex);

	if (match) {
		const sectionContent = match[1];
		if (sectionContent.trim().endsWith('\n')) {
			content = content.replace(match[1], sectionContent + logLine);
		} else {
			content = content.replace(match[1], sectionContent + '\n' + logLine);
		}
	} else {
		content += logLine;
	}

	writeFileSync(notePath, content, 'utf-8');

	return `记录成功！${log.emotion || ''} ${content.slice(0, 50)}`;
}

function updateStreaks(category: string): void {
	mkdirSync(QUICKLOG_DIR, { recursive: true });
	let streaks: Streak[] = [];

	if (existsSync(STREAKS_FILE)) {
		streaks = JSON.parse(readFileSync(STREAKS_FILE, 'utf-8'));
	}

	const today = new Date().toISOString().split('T')[0];
	let streak = streaks.find(s => s.category === category);

	if (!streak) {
		streak = { category, current: 1, longest: 1, lastDate: today };
		streaks.push(streak);
	} else {
		const lastDate = new Date(streak.lastDate);
		const diffDays = Math.floor((new Date(today).getTime() - lastDate.getTime()) / (1000 * 60 * 60 * 24));

		if (diffDays === 1) {
			streak.current++;
			if (streak.current > streak.longest) {
				streak.longest = streak.current;
			}
		} else if (diffDays > 1) {
			streak.current = 1;
		}

		streak.lastDate = today;
	}

	writeFileSync(STREAKS_FILE, JSON.stringify(streaks, null, 2), 'utf-8');
}

function loadAchievements(): Achievement[] {
	mkdirSync(QUICKLOG_DIR, { recursive: true });

	if (!existsSync(ACHIEVEMENTS_FILE)) {
		const defaults = getDefaultAchievements();
		writeFileSync(ACHIEVEMENTS_FILE, JSON.stringify(defaults, null, 2), 'utf-8');
		return defaults;
	}

	return JSON.parse(readFileSync(ACHIEVEMENTS_FILE, 'utf-8'));
}

function saveAchievements(achievements: Achievement[]): void {
	writeFileSync(ACHIEVEMENTS_FILE, JSON.stringify(achievements, null, 2), 'utf-8');
}

function getDefaultAchievements(): Achievement[] {
	return [
		{ id: 'first_log', name: '初次记录', description: '开始记录的第一步！', icon: '🌟', condition: 'records_1' },
		{ id: 'streak_7', name: '一周达人', description: '连续记录7天', icon: '🔥', condition: 'streak_7' },
		{ id: 'streak_30', name: '月度冠军', description: '连续记录30天', icon: '👑', condition: 'streak_30' },
		{ id: 'multi_category', name: '全面发展', description: '记录超过5个分类', icon: '🌈', condition: 'categories_5' },
		{ id: 'records_100', name: '百条记录', description: '累计记录100条', icon: '💯', condition: 'records_100' },
	];
}

function checkAchievements(category: string): Achievement[] {
	const achievements = loadAchievements();
	const streaks = existsSync(STREAKS_FILE) ? JSON.parse(readFileSync(STREAKS_FILE, 'utf-8')) : [];
	const unlocked: Achievement[] = [];

	achievements.forEach(a => {
		if (a.unlockedAt) return;

		let unlock = false;

		if (a.condition === 'records_1') {
			unlock = true;
		} else if (a.condition.startsWith('streak_')) {
			const target = parseInt(a.condition.split('_')[1]);
			const streak = streaks.find((s: Streak) => s.category === category);
			if (streak && streak.current >= target) unlock = true;
		} else if (a.condition === 'categories_5') {
			if (streaks.length >= 5) unlock = true;
		}

		if (unlock) {
			a.unlockedAt = new Date().toISOString();
			unlocked.push(a);
		}
	});

	if (unlocked.length > 0) {
		saveAchievements(achievements);
	}

	return unlocked;
}

export default function (pi: ExtensionAPI) {
	pi.registerTool({
		name: "quicklog",
		label: "快速记录",
		description: "一句话/表情快速记录任何事情，自动分类到 Obsidian。",
		promptSnippet: "快速记录",
		parameters: Type.Object({
			content: Type.String({ description: "记录内容，支持表情/关键词自动分类" }),
		}),
		async execute(_id, params) {
			const log = parseQuickLog(params.content);
			const result = saveToObsidian(log);

			updateStreaks(log.category);
			const unlocked = checkAchievements(log.category);

			let response = `✅ ${result}`;

			if (unlocked.length > 0) {
				response += `\n\n🎊 解锁成就：${unlocked.map(a => `${a.icon} ${a.name}`).join('，')}`;
			}

			return {
				content: [{ type: "text", text: response }]
			};
		},
	});

	pi.registerTool({
		name: "quicklog_streaks",
		label: "查看连续记录",
		description: "查看各分类的连续记录天数。",
		promptSnippet: "查看我的连续记录",
		parameters: Type.Object({}),
		async execute(_id, _params) {
			if (!existsSync(STREAKS_FILE)) {
				return { content: [{ type: "text", text: "还没有任何记录数据，开始记录吧！💪" }] };
			}

			const streaks: Streak[] = JSON.parse(readFileSync(STREAKS_FILE, 'utf-8'));
			const config = loadConfig();

			const lines = streaks.map(s => {
				const catConfig = config.categories?.[s.category];
				const emoji = catConfig?.emoji || '📝';
				const name = catConfig?.label || s.category;
				return `${emoji} ${name}: ${s.current}天连续记录 (最长: ${s.longest}天)`;
			});

			return {
				content: [{ type: "text", text: `🔥 你的连续记录：\n\n${lines.join('\n')}` }]
			};
		},
	});

	pi.registerTool({
		name: "quicklog_achievements",
		label: "查看成就",
		description: "查看已解锁的成就和进度。",
		promptSnippet: "查看我的成就",
		parameters: Type.Object({}),
		async execute(_id, _params) {
			const achievements = loadAchievements();
			const unlocked = achievements.filter(a => a.unlockedAt);
			const locked = achievements.filter(a => !a.unlockedAt);

			let output = `🏆 你的成就 (${unlocked.length}/${achievements.length})\n\n`;
			output += '已解锁：\n';
			unlocked.forEach(a => {
				const date = new Date(a.unlockedAt!).toLocaleDateString('zh-CN');
				output += `  ${a.icon} ${a.name} - ${date}\n`;
			});

			if (locked.length > 0) {
				output += '\n待解锁：\n';
				locked.forEach(a => {
					output += `  ??? ${a.name}\n`;
				});
			}

			return {
				content: [{ type: "text", text: output }]
			};
		},
	});

	pi.registerCommand("log", {
		description: "快速记录",
		async handler(args, ctx) {
			if (args.length > 0) {
				pi.sendUserMessage(`快速记录：${args.join(' ')}`);
			} else {
				const content = await ctx.ui.input("快速记录什么？（支持表情和关键词）");
				if (content) {
					pi.sendUserMessage(`快速记录：${content}`);
				}
			}
		},
	});
}

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

const CONFIG_PATH = join(homedir(), ".pi", "agent", "obsidian-config.json");
const KNOWLEDGE_DIR = join(homedir(), ".pi", "agent", "knowledge");

interface Note {
	path: string;
	date: string;
	content: string;
	tags: string[];
	categories: string[];
	keywords: string[];
}

interface Relation {
	from: string;
	to: string;
	strength: number;
	type: string;
}

interface KnowledgeBase {
	notes: Note[];
	relations: Relation[];
	tags: Record<string, string[]>;
}

const KEYWORDS = [
	{ word: '学习', tags: ['learning', 'growth'] },
	{ word: '读书', tags: ['learning', 'reading'] },
	{ word: '编程', tags: ['work', 'coding'] },
	{ word: '项目', tags: ['work', 'project'] },
	{ word: '运动', tags: ['exercise', 'health'] },
	{ word: '跑步', tags: ['exercise', 'health'] },
	{ word: '健身', tags: ['exercise', 'health'] },
	{ word: '吃饭', tags: ['diet', 'health'] },
	{ word: '睡觉', tags: ['health', 'sleep'] },
	{ word: '开心', tags: ['mood', 'positive'] },
	{ word: '难过', tags: ['mood', 'negative'] },
	{ word: '会议', tags: ['work', 'meeting'] },
	{ word: '想法', tags: ['idea', 'thinking'] },
];

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

function loadKnowledgeBase(): KnowledgeBase {
	mkdirSync(KNOWLEDGE_DIR, { recursive: true });
	const kbPath = join(KNOWLEDGE_DIR, 'kb.json');

	if (existsSync(kbPath)) {
		try {
			return JSON.parse(readFileSync(kbPath, 'utf-8'));
		} catch {}
	}

	return {
		notes: [],
		relations: [],
		tags: {}
	};
}

function saveKnowledgeBase(kb: KnowledgeBase): void {
	const kbPath = join(KNOWLEDGE_DIR, 'kb.json');
	writeFileSync(kbPath, JSON.stringify(kb, null, 2), 'utf-8');
}

function extractKeywords(content: string): string[] {
	const keywords: string[] = [];

	KEYWORDS.forEach(k => {
		if (content.includes(k.word)) {
			keywords.push(...k.tags);
		}
	});

	const hashtagRegex = /#(\w+)/g;
	const matches = content.match(hashtagRegex);
	if (matches) {
		matches.forEach(m => keywords.push(m.slice(1)));
	}

	return [...new Set(keywords)];
}

function parseNote(path: string): Note | null {
	if (!existsSync(path)) {
		return null;
	}

	const content = readFileSync(path, 'utf-8');
	const filename = path.split(/[/\\]/).pop() || '';
	const dateMatch = filename.match(/(\d{4}-\d{2}-\d{2})/);

	const tags = extractKeywords(content);
	const categories: string[] = [];
	const config = loadConfig();

	for (const [key, cat] of Object.entries(config.categories || {})) {
		if (content.includes((cat as any).label)) {
			categories.push(key);
		}
	}

	return {
		path,
		date: dateMatch ? dateMatch[1] : '',
		content,
		tags,
		categories,
		keywords: extractKeywords(content)
	};
}

function buildRelations(kb: KnowledgeBase): void {
	kb.relations = [];

	for (let i = 0; i < kb.notes.length; i++) {
		for (let j = i + 1; j < kb.notes.length; j++) {
			const note1 = kb.notes[i];
			const note2 = kb.notes[j];

			const sharedTags = note1.tags.filter(t => note2.tags.includes(t));
			const sharedCats = note1.categories.filter(c => note2.categories.includes(c));

			const strength = sharedTags.length * 2 + sharedCats.length * 3;

			if (strength >= 2) {
				kb.relations.push({
					from: note1.path,
					to: note2.path,
					strength,
					type: sharedCats.length > 0 ? 'category' : 'tag'
				});
			}
		}
	}

	kb.relations.sort((a, b) => b.strength - a.strength);
}

function buildTagIndex(kb: KnowledgeBase): void {
	kb.tags = {};

	kb.notes.forEach(note => {
		note.tags.forEach(tag => {
			if (!kb.tags[tag]) kb.tags[tag] = [];
			kb.tags[tag].push(note.path);
		});
	});
}

function scanDailyNotes(): Note[] {
	const config = loadConfig();
	const notes: Note[] = [];
	const dailyFolder = join(config.vaultPath, config.dailyNoteFolder || "Daily Notes");

	if (!existsSync(dailyFolder)) {
		return notes;
	}

	const { readdirSync } = require('node:fs');
	const files = readdirSync(dailyFolder);

	files.forEach((file: string) => {
		if (file.endsWith('.md')) {
			const path = join(dailyFolder, file);
			const note = parseNote(path);
			if (note) {
				notes.push(note);
			}
		}
	});

	return notes.sort((a, b) => b.date.localeCompare(a.date));
}

export default function (pi: ExtensionAPI) {
	pi.registerTool({
		name: "knowledge_scan",
		label: "扫描笔记",
		description: "扫描并索引所有笔记，建立知识关联。",
		promptSnippet: "扫描笔记",
		parameters: Type.Object({}),
		async execute(_id, _params) {
			const notes = scanDailyNotes();

			if (notes.length === 0) {
				return {
					content: [{
						type: "text",
						text: "没有找到笔记，先开始记录吧！💪"
					}]
				};
			}

			const kb = loadKnowledgeBase();
			kb.notes = notes;
			buildRelations(kb);
			buildTagIndex(kb);
			saveKnowledgeBase(kb);

			return {
				content: [{
					type: "text",
					text: `✅ 扫描完成！\n- 索引了 ${notes.length} 个笔记\n- 建立了 ${kb.relations.length} 个关联\n- 发现了 ${Object.keys(kb.tags).length} 个标签`
				}]
			};
		},
	});

	pi.registerTool({
		name: "knowledge_search",
		label: "搜索知识",
		description: "搜索相关的笔记和内容。",
		promptSnippet: "搜索知识",
		parameters: Type.Object({
			query: Type.String({ description: "搜索关键词" }),
			tag: Type.Optional(Type.String({ description: "按标签搜索" })),
		}),
		async execute(_id, params) {
			const kb = loadKnowledgeBase();

			if (kb.notes.length === 0) {
				return {
					content: [{
						type: "text",
						text: "知识库是空的，先扫描笔记吧！"
					}]
				};
			}

			let results: Note[] = [];

			if (params.tag) {
				const tagNotes = kb.tags[params.tag] || [];
				results = kb.notes.filter(n => tagNotes.includes(n.path));
			} else if (params.query) {
				const query = params.query.toLowerCase();
				results = kb.notes.filter(n =>
					n.content.toLowerCase().includes(query) ||
					n.keywords.some(k => k.toLowerCase().includes(query))
				);
			}

			if (results.length === 0) {
				return {
					content: [{
						type: "text",
						text: "没有找到相关内容。"
					}]
				};
			}

			let output = `## 📚 搜索结果 (${results.length} 个)\n\n`;

			results.slice(0, 10).forEach(note => {
				const filename = note.path.split(/[/\\]/).pop();
				output += `### ${note.date}\n`;
				output += `📁 ${filename}\n`;
				if (note.tags.length > 0) {
					output += `🏷️ ${note.tags.slice(0, 5).map(t => `#${t}`).join(' ')}\n`;
				}
				output += `\n`;
			});

			return {
				content: [{ type: "text", text: output }]
			};
		},
	});

	pi.registerTool({
		name: "knowledge_related",
		label: "相关笔记",
		description: "查看与当前内容相关的笔记。",
		promptSnippet: "相关笔记",
		parameters: Type.Object({
			date: Type.Optional(Type.String({ description: "日期，默认今天" })),
		}),
		async execute(_id, params) {
			const kb = loadKnowledgeBase();
			const date = params.date || new Date().toISOString().split('T')[0];

			if (kb.relations.length === 0) {
				return {
					content: [{
						type: "text",
						text: "先扫描笔记建立关联吧！"
					}]
				};
			}

			const currentNote = kb.notes.find(n => n.date === date);
			if (!currentNote) {
				return {
					content: [{
						type: "text",
						text: `${date} 没有找到笔记。`
					}]
				};
			}

			const related = kb.relations.filter(r =>
				r.from === currentNote.path || r.to === currentNote.path
			).slice(0, 5);

			if (related.length === 0) {
				return {
					content: [{
						type: "text",
						text: "没有发现相关笔记。"
					}]
				};
			}

			let output = `## 🔗 ${date} 的相关笔记\n\n`;

			related.forEach(rel => {
				const otherPath = rel.from === currentNote.path ? rel.to : rel.from;
				const otherNote = kb.notes.find(n => n.path === otherPath);
				if (otherNote) {
					const relType = rel.type === 'category' ? '📂 同类' : '🏷️ 同标签';
					const strength = '⭐'.repeat(Math.min(rel.strength, 5));
					output += `${relType} ${strength} ${otherNote.date}\n`;
				}
			});

			return {
				content: [{ type: "text", text: output }]
			};
		},
	});

	pi.registerTool({
		name: "knowledge_stats",
		label: "知识统计",
		description: "查看知识库的统计信息。",
		promptSnippet: "知识统计",
		parameters: Type.Object({}),
		async execute(_id, _params) {
			const kb = loadKnowledgeBase();

			if (kb.notes.length === 0) {
				return {
					content: [{
						type: "text",
						text: "知识库是空的！"
					}]
				};
			}

			const tagCounts: Record<string, number> = {};
			kb.notes.forEach(n => {
				n.tags.forEach(t => {
					tagCounts[t] = (tagCounts[t] || 0) + 1;
				});
			});

			const topTags = Object.entries(tagCounts)
				.sort((a, b) => b[1] - a[1])
				.slice(0, 10);

			let output = `# 📚 知识库统计\n\n`;
			output += `- 笔记数：${kb.notes.length}\n`;
			output += `- 关联数：${kb.relations.length}\n`;
			output += `- 标签数：${Object.keys(kb.tags).length}\n\n`;

			output += `## 🏷️ 热门标签\n\n`;
			topTags.forEach(([tag, count]) => {
				const bar = '█'.repeat(Math.min(count, 20));
				output += `#${tag}: ${bar} ${count}\n`;
			});

			output += `\n## ⏱️ 时间线\n\n`;
			const firstNote = kb.notes[kb.notes.length - 1];
			const lastNote = kb.notes[0];
			if (firstNote && lastNote) {
				const days = Math.ceil(
					(new Date(lastNote.date).getTime() - new Date(firstNote.date).getTime()) /
					(24 * 60 * 60 * 1000)
				);
				output += `- 跨度：${days} 天\n`;
				output += `- 开始：${firstNote.date}\n`;
				output += `- 最新：${lastNote.date}\n`;
			}

			return {
				content: [{ type: "text", text: output }]
			};
		},
	});

	pi.registerCommand("kb", {
		description: "知识库管理",
		async handler(args, ctx) {
			if (args[0] === 'scan') {
				pi.sendUserMessage('扫描笔记');
			} else if (args[0] === 'stats') {
				pi.sendUserMessage('知识统计');
			} else if (args[0] === 'search' && args[1]) {
				pi.sendUserMessage(`搜索知识：${args[1]}`);
			} else {
				const choice = await ctx.ui.select('知识库', ['扫描笔记', '查看统计', '搜索知识']);
				if (choice === '扫描笔记') {
					pi.sendUserMessage('扫描笔记');
				} else if (choice === '查看统计') {
					pi.sendUserMessage('知识统计');
				} else if (choice === '搜索知识') {
					const query = await ctx.ui.input('搜索关键词：');
					if (query) pi.sendUserMessage(`搜索知识：${query}`);
				}
			}
		},
	});
}

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "@earendil-works/pi-ai";
import {
	readFileSync,
	writeFileSync,
	appendFileSync,
	existsSync,
	mkdirSync,
	readdirSync,
} from "node:fs";
import { join, resolve, sep } from "node:path";
import { homedir } from "node:os";
import { spawnSync } from "node:child_process";

const CONFIG_PATH = join(homedir(), ".pi", "agent", "obsidian-config.json");

interface ObsidianConfig {
	vaultPath: string;
	dailyNoteFolder: string;
	categories: Record<string, { label: string; emoji: string }>;
	template: string;
}

const DEFAULT_CONFIG: ObsidianConfig = {
	vaultPath: process.env.OBSIDIAN_VAULT_PATH || join(homedir(), "obsidian-vault"),
	dailyNoteFolder: "Daily Notes",
	categories: {
		diet: { label: "饮食", emoji: "🍽️" },
		exercise: { label: "运动", emoji: "🏃" },
		learning: { label: "学习", emoji: "📚" },
		work: { label: "工作", emoji: "💼" },
	},
	template: "",
};

function loadConfig(): ObsidianConfig {
	if (existsSync(CONFIG_PATH)) {
		try {
			const saved = JSON.parse(readFileSync(CONFIG_PATH, "utf-8"));
			return { ...DEFAULT_CONFIG, ...saved };
		} catch {
			return DEFAULT_CONFIG;
		}
	}
	return DEFAULT_CONFIG;
}

function getWeekNumber(date: Date): { year: number; week: number } {
	const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
	const dayNum = d.getUTCDay() || 7;
	d.setUTCDate(d.getUTCDate() + 4 - dayNum);
	const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
	const week = Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
	return { year: d.getUTCFullYear(), week };
}

function saveConfig(config: ObsidianConfig): void {
	mkdirSync(join(homedir(), ".pi", "agent"), { recursive: true });
	writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), "utf-8");
}

function getToday(): string {
	const now = new Date();
	const y = now.getFullYear();
	const m = String(now.getMonth() + 1).padStart(2, "0");
	const d = String(now.getDate()).padStart(2, "0");
	return `${y}-${m}-${d}`;
}

function getWeekday(): string {
	const days = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
	return days[new Date().getDay()];
}

function getDailyNotePath(config: ObsidianConfig, date?: string): string {
	const d = date || getToday();
	return join(config.vaultPath, config.dailyNoteFolder, `${d}.md`);
}

function generateDailyNoteTemplate(config: ObsidianConfig, date?: string): string {
	const d = date || getToday();
	const weekday = getWeekday();
	let template = `# ${d} ${weekday}\n\n`;
	for (const [, cat] of Object.entries(config.categories)) {
		template += `## ${cat.emoji} ${cat.label}\n\n`;
	}
	template += `## 📝 备注\n\n`;
	return template;
}

function ensureDailyNote(config: ObsidianConfig, date?: string): string {
	const notePath = getDailyNotePath(config, date);
	if (!existsSync(notePath)) {
		mkdirSync(join(config.vaultPath, config.dailyNoteFolder), { recursive: true });
		writeFileSync(notePath, generateDailyNoteTemplate(config, date), "utf-8");
	}
	return notePath;
}

function isPathInsideVault(filePath: string, vaultPath: string): boolean {
	const resolved = resolve(filePath);
	const resolvedVault = resolve(vaultPath);
	return resolved.startsWith(resolvedVault + sep) || resolved === resolvedVault;
}

function resolveCategory(category: string, config: ObsidianConfig): string {
	if (config.categories[category]) return category;

	const lower = category.toLowerCase();
	for (const key of Object.keys(config.categories)) {
		if (key.toLowerCase() === lower) return key;
	}

	for (const [key, val] of Object.entries(config.categories)) {
		if (val.label === category) return key;
	}

	return category;
}

function appendToSection(filePath: string, sectionLabel: string, content: string): boolean {
	if (!existsSync(filePath)) return false;

	const fileContent = readFileSync(filePath, "utf-8");
	const lines = fileContent.split("\n");

	let sectionIndex = -1;
	let nextSectionIndex = lines.length;

	for (let i = 0; i < lines.length; i++) {
		const trimmed = lines[i].trim();
		if (
			sectionIndex === -1 &&
			trimmed.startsWith("## ") &&
			trimmed.includes(sectionLabel)
		) {
			sectionIndex = i;
		} else if (sectionIndex !== -1 && lines[i].startsWith("## ")) {
			nextSectionIndex = i;
			break;
		}
	}

	if (sectionIndex === -1) return false;

	const timestamp = new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
	const entry = `- ${timestamp} ${content}\n`;

	lines.splice(nextSectionIndex, 0, entry);
	writeFileSync(filePath, lines.join("\n"), "utf-8");
	return true;
}

function checkVault(vaultPath: string): { content: { type: "text"; text: string }[]; isError: true } | null {
	if (!existsSync(vaultPath)) {
		return {
			content: [
				{
					type: "text",
					text: `Vault path does not exist: ${vaultPath}\nPlease configure it with /obsidian-setup or obsidian_config tool.\nConfig file: ${CONFIG_PATH}`,
				},
			],
			isError: true,
		};
	}
	return null;
}

function searchWithRg(vaultPath: string, query: string, maxResults: number): string[] | null {
	const extDir = join(__dirname, "..", "bin");
	const rgPath = join(extDir, "rg.exe");
	if (!existsSync(rgPath)) return null;

	try {
		const result = spawnSync(
			rgPath,
			[
				"--max-count", "3",
				"--max-filesize", "1M",
				"-l",
				"--sort-files",
				"-i",
				"--max-results", String(maxResults),
				query,
				vaultPath,
			],
			{
				timeout: 10000,
				encoding: "utf-8",
				shell: false,
				windowsHide: true,
			},
		);

		if (result.status !== 0 || !result.stdout) return null;

		const files = result.stdout.trim().split("\n").filter(Boolean);
		const output: string[] = [];

		for (const filePath of files) {
			if (output.length >= maxResults) break;
			const relPath = filePath.slice(vaultPath.length + 1);

			const previewResult = spawnSync(
				rgPath,
				["-i", "--max-count", "3", "--no-filename", query, filePath],
				{
					timeout: 5000,
					encoding: "utf-8",
					shell: false,
					windowsHide: true,
				},
			);

			const preview = (previewResult.stdout || "")
				.trim()
				.split("\n")
				.slice(0, 3)
				.map((l: string) => l.trim())
				.join(" | ");

			output.push(`${relPath}: ${preview}`);
		}

		return output;
	} catch {
		return null;
	}
}

function searchInVault(vaultPath: string, query: string, maxResults: number): string[] {
	const rgResult = searchWithRg(vaultPath, query, maxResults);
	if (rgResult) return rgResult;

	const results: string[] = [];
	const lowerQuery = query.toLowerCase();

	function walk(dir: string): void {
		if (results.length >= maxResults) return;
		let entries;
		try {
			entries = readdirSync(dir, { withFileTypes: true });
		} catch {
			return;
		}
		for (const entry of entries) {
			if (results.length >= maxResults) break;
			if (entry.name.startsWith(".")) continue;
			const fullPath = join(dir, entry.name);
			if (entry.isDirectory()) {
				walk(fullPath);
			} else if (entry.name.endsWith(".md")) {
				try {
					const content = readFileSync(fullPath, "utf-8").toLowerCase();
					if (content.includes(lowerQuery) || entry.name.toLowerCase().includes(lowerQuery)) {
						const relPath = fullPath.slice(vaultPath.length + 1);
						const preview = content
							.split("\n")
							.filter((line) => line.toLowerCase().includes(lowerQuery))
							.slice(0, 3)
							.map((line) => line.trim())
							.join(" | ");
						results.push(`${relPath}: ${preview}`);
					}
				} catch {
					// skip unreadable files
				}
			}
		}
	}

	walk(vaultPath);
	return results;
}

const DAILY_ALIASES = new Set(["daily", "today", "今日", "今天"]);

export default function (pi: ExtensionAPI) {
	const config = loadConfig();

	pi.registerTool({
		name: "obsidian_read",
		label: "Obsidian Read",
		description:
			"Read a note from the Obsidian vault. Provide a path relative to the vault root, or use 'daily'/'today' to read today's daily note.",
		promptSnippet: "read notes from the Obsidian vault",
		promptGuidelines: [
			"Use obsidian_read to look up information the user has previously recorded in their notes",
			"Use 'daily' or 'today' as the path to read today's daily note",
		],
		parameters: Type.Object({
			path: Type.String({
				description: "Note path relative to vault root, or 'daily'/'today' for today's daily note",
			}),
			date: Type.Optional(
				Type.String({ description: "Date for daily note in YYYY-MM-DD format (default: today)" }),
			),
		}),
		async execute(_id, params) {
			const vaultPath = config.vaultPath;
			const vaultCheck = checkVault(vaultPath);
			if (vaultCheck) return vaultCheck;

			let filePath: string;
			if (DAILY_ALIASES.has(params.path.toLowerCase())) {
				filePath = ensureDailyNote(config, params.date);
			} else {
				filePath = join(vaultPath, params.path);
			}

			if (!isPathInsideVault(filePath, vaultPath)) {
				return {
					content: [{ type: "text", text: `Access denied: path escapes vault boundary` }],
					isError: true,
				};
			}

			if (!existsSync(filePath)) {
				return {
					content: [{ type: "text", text: `Note not found: ${params.path}` }],
					isError: true,
				};
			}

			const content = readFileSync(filePath, "utf-8");
			const relPath = filePath.slice(vaultPath.length + 1);
			return {
				content: [{ type: "text", text: `# ${relPath}\n\n${content}` }],
			};
		},
	});

	pi.registerTool({
		name: "obsidian_write",
		label: "Obsidian Write",
		description: "Write or create a note in the Obsidian vault. Creates parent directories if needed.",
		promptSnippet: "write notes to the Obsidian vault",
		parameters: Type.Object({
			path: Type.String({ description: "Note path relative to vault root" }),
			content: Type.String({ description: "Note content in markdown" }),
			append: Type.Optional(
				Type.Boolean({ description: "Append to existing note instead of overwriting (default: false)" }),
			),
		}),
		async execute(_id, params) {
			const vaultPath = config.vaultPath;
			const vaultCheck = checkVault(vaultPath);
			if (vaultCheck) return vaultCheck;

			const filePath = join(vaultPath, params.path);

			if (!isPathInsideVault(filePath, vaultPath)) {
				return {
					content: [{ type: "text", text: `Access denied: path escapes vault boundary` }],
					isError: true,
				};
			}

			const dir = resolve(filePath, "..");
			mkdirSync(dir, { recursive: true });

			if (params.append && existsSync(filePath)) {
				appendFileSync(filePath, `\n\n${params.content}`, "utf-8");
			} else {
				writeFileSync(filePath, params.content, "utf-8");
			}

			return {
				content: [{ type: "text", text: `Note saved: ${params.path}` }],
			};
		},
	});

	pi.registerTool({
		name: "obsidian_search",
		label: "Obsidian Search",
		description: "Search notes in the Obsidian vault by keyword. Searches both filenames and content.",
		promptSnippet: "search notes in the Obsidian vault",
		promptGuidelines: [
			"Use obsidian_search when the user asks about information they may have recorded previously",
		],
		parameters: Type.Object({
			query: Type.String({ description: "Search keyword or phrase" }),
			max_results: Type.Optional(
				Type.Number({ description: "Maximum number of results (default: 10)", default: 10 }),
			),
		}),
		async execute(_id, params) {
			const vaultPath = config.vaultPath;
			const vaultCheck = checkVault(vaultPath);
			if (vaultCheck) return vaultCheck;

			const maxResults = params.max_results || 10;
			const results = searchInVault(vaultPath, params.query, maxResults);

			if (results.length === 0) {
				return {
					content: [{ type: "text", text: `No notes found matching: "${params.query}"` }],
				};
			}

			return {
				content: [
					{
						type: "text",
						text: `Found ${results.length} note(s) matching "${params.query}":\n\n${results.join("\n\n")}`,
					},
				],
			};
		},
	});

	pi.registerTool({
		name: "obsidian_list",
		label: "Obsidian List",
		description: "List notes in a folder of the Obsidian vault.",
		parameters: Type.Object({
			folder: Type.Optional(
				Type.String({ description: "Folder path relative to vault root (default: vault root)" }),
			),
		}),
		async execute(_id, params) {
			const vaultPath = config.vaultPath;
			const vaultCheck = checkVault(vaultPath);
			if (vaultCheck) return vaultCheck;

			const folderPath = params.folder ? join(vaultPath, params.folder) : vaultPath;

			if (!isPathInsideVault(folderPath, vaultPath)) {
				return {
					content: [{ type: "text", text: `Access denied: path escapes vault boundary` }],
					isError: true,
				};
			}

			if (!existsSync(folderPath)) {
				return {
					content: [{ type: "text", text: `Folder not found: ${params.folder || "/"}` }],
					isError: true,
				};
			}

			const entries = readdirSync(folderPath, { withFileTypes: true });
			const items = entries
				.filter((e) => !e.name.startsWith("."))
				.map((e) => (e.isDirectory() ? `📁 ${e.name}/` : `📄 ${e.name}`));

			if (items.length === 0) {
				return {
					content: [{ type: "text", text: `Folder is empty: ${params.folder || "/"}` }],
				};
			}

			return {
				content: [
					{
						type: "text",
						text: `Contents of ${params.folder || "/"}:\n\n${items.join("\n")}`,
					},
				],
			};
		},
	});

	pi.registerTool({
		name: "obsidian_record",
		label: "Obsidian Record",
		description:
			"Record an entry to a specific category in the daily note. Automatically creates the daily note if it doesn't exist. Supports category keys (diet, exercise, learning, work) or Chinese labels (饮食, 运动, 学习, 工作).",
		promptSnippet: "record entries to the daily note in Obsidian",
		promptGuidelines: [
			"Use obsidian_record when the user wants to log something to their daily note",
			"Common categories: diet/饮食, exercise/运动, learning/学习, work/工作",
			"Both English keys and Chinese labels are accepted",
			"The entry is automatically timestamped and added under the correct section",
		],
		parameters: Type.Object({
			category: Type.String({
				description:
					"Category: diet/饮食, exercise/运动, learning/学习, work/工作, or a custom category name",
			}),
			content: Type.String({ description: "The content to record" }),
			date: Type.Optional(
				Type.String({ description: "Date in YYYY-MM-DD format (default: today)" }),
			),
		}),
		async execute(_id, params) {
			const vaultPath = config.vaultPath;
			const vaultCheck = checkVault(vaultPath);
			if (vaultCheck) return vaultCheck;

			const resolvedCategory = resolveCategory(params.category, config);
			const notePath = ensureDailyNote(config, params.date);
			const catConfig = config.categories[resolvedCategory];
			const sectionLabel = catConfig ? catConfig.label : resolvedCategory;
			const sectionTitle = catConfig
				? `## ${catConfig.emoji} ${catConfig.label}`
				: `## ${resolvedCategory}`;

			if (!appendToSection(notePath, sectionLabel, params.content)) {
				const timestamp = new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
				const entry = `- ${timestamp} ${params.content}\n`;
				appendFileSync(notePath, `\n${sectionTitle}\n\n${entry}`, "utf-8");
			}

			const date = params.date || getToday();
			return {
				content: [
					{
						type: "text",
						text: `Recorded to ${sectionLabel} [${date}]: ${params.content}`,
					},
				],
			};
		},
	});

	pi.registerTool({
		name: "obsidian_config",
		label: "Obsidian Config",
		description:
			"Configure Obsidian vault settings. Use this to set the vault path, daily note folder, or add/remove categories.",
		parameters: Type.Object({
			vault_path: Type.Optional(Type.String({ description: "Absolute path to the Obsidian vault" })),
			daily_note_folder: Type.Optional(Type.String({ description: "Folder name for daily notes" })),
			add_category: Type.Optional(Type.Object({
				key: Type.String({ description: "Category key (e.g., 'health')" }),
				label: Type.String({ description: "Display label (e.g., '健康')" }),
				emoji: Type.String({ description: "Emoji icon (e.g., '💊')" }),
			}, { description: "Add a new category" })),
			remove_category: Type.Optional(Type.String({ description: "Category key to remove" })),
		}),
		async execute(_id, params) {
			if (params.vault_path) {
				const resolved = resolve(params.vault_path.replace(/^~/, homedir()));
				if (!existsSync(resolved)) {
					return {
						content: [{ type: "text", text: `Warning: path does not exist: ${resolved}. Config saved but vault is not accessible.` }],
						isError: true,
					};
				}
				config.vaultPath = resolved;
			}
			if (params.daily_note_folder) {
				config.dailyNoteFolder = params.daily_note_folder;
			}
			if (params.add_category) {
				const { key, label, emoji } = params.add_category;
				if (config.categories[key]) {
					return {
						content: [{ type: "text", text: `Category "${key}" already exists. Use a different key or remove it first.` }],
						isError: true,
					};
				}
				config.categories[key] = { label, emoji };
			}
			if (params.remove_category) {
				if (!config.categories[params.remove_category]) {
					return {
						content: [{ type: "text", text: `Category "${params.remove_category}" not found.` }],
						isError: true,
					};
				}
				delete config.categories[params.remove_category];
			}

			saveConfig(config);

			return {
				content: [
					{
						type: "text",
						text: `Obsidian config updated:\n- Vault: ${config.vaultPath}\n- Daily notes: ${config.dailyNoteFolder}\n- Categories: ${Object.entries(config.categories)
							.map(([k, v]) => `${v.emoji} ${v.label} (${k})`)
							.join(", ")}\n\nConfig saved to: ${CONFIG_PATH}`,
					},
				],
			};
		},
	});

	pi.registerTool({
		name: "obsidian_show_config",
		label: "Obsidian Show Config",
		description:
			"Display the current Obsidian vault configuration. Use this to check the vault path and other settings.",
		promptSnippet: "show Obsidian configuration",
		promptGuidelines: [
			"Use obsidian_show_config to verify the current vault path before performing any write operations",
			"This tool helps confirm that the correct vault is being used",
		],
		parameters: Type.Object({}),
		async execute(_id, _params) {
			const vaultExists = existsSync(config.vaultPath);
			return {
				content: [
					{
						type: "text",
						text: `Obsidian Vault Configuration\n\n` +
							`Vault Path: ${config.vaultPath} ${vaultExists ? "(exists)" : "(NOT FOUND)"}\n` +
							`Daily Notes Folder: ${config.dailyNoteFolder}\n` +
							`Categories: ${Object.entries(config.categories)
								.map(([k, v]) => `${v.emoji} ${v.label} (${k})`)
								.join(", ")}\n` +
							`\nConfig File: ${CONFIG_PATH}\n` +
							(!vaultExists ? `\nWarning: Vault path does not exist. Use /obsidian-setup to configure.` : ""),
					},
				],
			};
		},
	});

	pi.registerTool({
		name: "obsidian_summary",
		label: "Obsidian Summary",
		description: "Generate a summary of notes from a date range or category.",
		promptSnippet: "generate a summary of notes",
		parameters: Type.Object({
			category: Type.Optional(Type.String({ description: "Category to summarize (optional)" })),
			startDate: Type.Optional(Type.String({ description: "Start date (YYYY-MM-DD, default: 7 days ago)" })),
			endDate: Type.Optional(Type.String({ description: "End date (YYYY-MM-DD, default: today)" })),
		}),
		async execute(_id, params) {
			const vaultPath = config.vaultPath;
			const vaultCheck = checkVault(vaultPath);
			if (vaultCheck) return vaultCheck;

			const today = new Date();
			const start = params.startDate ? new Date(params.startDate) : new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);
			const end = params.endDate ? new Date(params.endDate) : today;

			const summaries: string[] = [];
			let current = new Date(start);

			while (current <= end) {
				const dateStr = current.toISOString().split('T')[0];
				const notePath = getDailyNotePath(config, dateStr);
				
				if (existsSync(notePath)) {
					const content = readFileSync(notePath, 'utf-8');
					
					if (params.category) {
						const catConfig = config.categories[params.category];
						const sectionLabel = catConfig ? catConfig.label : params.category;
						const sectionMatch = content.match(new RegExp(`##.*${sectionLabel}[^#]*`, 's'));
						if (sectionMatch) {
							summaries.push(`${dateStr} (${sectionLabel}):\n${sectionMatch[0].trim()}`);
						}
					} else {
						summaries.push(`${dateStr}:\n${content.trim().substring(0, 500)}...`);
					}
				}
				
				current.setDate(current.getDate() + 1);
			}

			if (summaries.length === 0) {
				return { content: [{ type: "text", text: "No notes found in the specified date range." }] };
			}

			return { content: [{ type: "text", text: `Summary of ${summaries.length} note(s):\n\n${summaries.join('\n\n---\n\n')}` }] };
		},
	});

	pi.registerTool({
		name: "obsidian_statistics",
		label: "Obsidian Statistics",
		description: "Get statistics about your notes, such as entry counts by category.",
		promptSnippet: "get statistics about notes",
		parameters: Type.Object({
			days: Type.Optional(Type.Number({ description: "Number of days to analyze (default: 30)" })),
		}),
		async execute(_id, params) {
			const vaultPath = config.vaultPath;
			const vaultCheck = checkVault(vaultPath);
			if (vaultCheck) return vaultCheck;

			const days = params.days || 30;
			const today = new Date();
			const stats: Record<string, number> = {};

			for (const cat of Object.keys(config.categories)) {
				stats[cat] = 0;
			}

			for (let i = 0; i < days; i++) {
				const date = new Date(today.getTime() - i * 24 * 60 * 60 * 1000);
				const dateStr = date.toISOString().split('T')[0];
				const notePath = getDailyNotePath(config, dateStr);
				
				if (existsSync(notePath)) {
					const content = readFileSync(notePath, 'utf-8');
					for (const [key, cat] of Object.entries(config.categories)) {
						const sectionMatch = content.match(new RegExp(`##.*${cat.label}`, 's'));
						if (sectionMatch) {
							const entries = sectionMatch[0].match(/^- \d{2}:\d{2}/gm);
							stats[key] += entries ? entries.length : 0;
						}
					}
				}
			}

			let statsText = `📊 Note Statistics (Last ${days} days):\n\n`;
			for (const [key, count] of Object.entries(stats)) {
				const cat = config.categories[key];
				if (cat) {
					statsText += `${cat.emoji} ${cat.label}: ${count} entries\n`;
				}
			}

			return { content: [{ type: "text", text: statsText }] };
		},
	});

	pi.registerTool({
		name: "obsidian_visualize",
		label: "Obsidian Data Visualization",
		description: "Generate ASCII visualizations of your tracking data over time.",
		promptSnippet: "generate chart visualizations of tracked data",
		parameters: Type.Object({
			category: Type.Optional(Type.String({ description: "Category to visualize (default: all)" })),
			days: Type.Optional(Type.Number({ description: "Number of days to visualize (default: 7)" })),
			type: Type.Optional(Type.String({ description: "Visualization type: bar, line, sparkline (default: bar)" })),
		}),
		async execute(_id, params) {
			const vaultPath = config.vaultPath;
			const vaultCheck = checkVault(vaultPath);
			if (vaultCheck) return vaultCheck;

			const days = params.days || 7;
			const vizType = params.type || 'bar';
			const today = new Date();
			const data: Record<string, number[]> = {};
			const labels: string[] = [];

			for (let i = days - 1; i >= 0; i--) {
				const date = new Date(today.getTime() - i * 24 * 60 * 60 * 1000);
				const dateStr = date.toISOString().split('T')[0];
				const dayLabel = `${date.getMonth() + 1}/${date.getDate()}`;
				labels.push(dayLabel);
				const notePath = getDailyNotePath(config, dateStr);
				
				if (existsSync(notePath)) {
					const content = readFileSync(notePath, 'utf-8');
					
					if (params.category) {
						const catConfig = config.categories[params.category];
						const sectionLabel = catConfig ? catConfig.label : params.category;
						const sectionMatch = content.match(new RegExp(`##.*${sectionLabel}[^#]*`, 's'));
						if (sectionMatch) {
							const entries = sectionMatch[0].match(/^- \d{2}:\d{2}/gm);
							if (!data[params.category]) data[params.category] = [];
							data[params.category].push(entries ? entries.length : 0);
						} else {
							if (!data[params.category]) data[params.category] = [];
							data[params.category].push(0);
						}
					} else {
						for (const [key, cat] of Object.entries(config.categories)) {
							if (!data[key]) data[key] = [];
							const sectionMatch = content.match(new RegExp(`##.*${cat.label}`, 's'));
							if (sectionMatch) {
								const entries = sectionMatch[0].match(/^- \d{2}:\d{2}/gm);
								data[key].push(entries ? entries.length : 0);
							} else {
								data[key].push(0);
							}
						}
					}
				} else {
					if (params.category) {
						if (!data[params.category]) data[params.category] = [];
						data[params.category].push(0);
					} else {
						for (const key of Object.keys(config.categories)) {
							if (!data[key]) data[key] = [];
							data[key].push(0);
						}
					}
				}
			}

			let output = `📈 Data Visualization (Last ${days} days)\n\n`;

			if (vizType === 'sparkline') {
				for (const [key, values] of Object.entries(data)) {
					const cat = config.categories[key];
					const emoji = cat?.emoji || '📊';
					const label = cat?.label || key;
					const maxVal = Math.max(...values);
					const sparkline = values.map(v => {
						if (maxVal === 0) return '▸';
						const bar = Math.round((v / maxVal) * 8);
						return '▁▂▃▄▅▆▇█'[bar];
					}).join('');
					output += `${emoji} ${label}: ${sparkline} (total: ${values.reduce((a, b) => a + b, 0)})\n`;
				}
			} else if (vizType === 'line') {
				for (const [key, values] of Object.entries(data)) {
					const cat = config.categories[key];
					const emoji = cat?.emoji || '📊';
					const label = cat?.label || key;
					const maxVal = Math.max(...values);
					const lines = Array.from({ length: 5 }, (_, i) => {
						const threshold = maxVal * (4 - i) / 4;
						return values.map(v => v >= threshold ? '●' : ' ').join(' ');
					});
					output += `${emoji} ${label}:\n`;
					lines.forEach((line, i) => {
						output += `  ${i === 0 ? maxVal : ''} ${line}\n`;
					});
					output += `    ${labels.join(' ')}\n`;
				}
			} else {
				const maxVal = Math.max(...Object.values(data).flat().filter(v => v > 0));
				const chartHeight = 8;
				
				for (const [key, values] of Object.entries(data)) {
					const cat = config.categories[key];
					const emoji = cat?.emoji || '📊';
					const label = cat?.label || key;
					const total = values.reduce((a, b) => a + b, 0);
					const avg = (total / days).toFixed(1);
					
					output += `${emoji} ${label} (Total: ${total}, Avg: ${avg}/day)\n`;
					output += `   ${labels.join('')}\n`;
					
					for (let h = chartHeight; h >= 0; h--) {
						const threshold = (maxVal * h / chartHeight).toFixed(1);
						const row = values.map(v => {
							const vRounded = v.toFixed(1);
							if (parseFloat(vRounded) >= parseFloat(threshold)) return '█';
							if (h === 0) return '─';
							return ' ';
						}).join('');
						const yLabel = h === 0 ? ' 0' : h === chartHeight ? `${maxVal}` : '  ';
						output += `${yLabel} ${row}\n`;
					}
					output += '\n';
				}
			}

			return { content: [{ type: "text", text: output }] };
		},
	});

	pi.registerTool({
		name: "obsidian_analyze",
		label: "Obsidian Smart Analysis",
		description: "Analyze your tracked data and provide personalized insights and suggestions.",
		promptSnippet: "analyze my data and give me suggestions",
		parameters: Type.Object({
			category: Type.Optional(Type.String({ description: "Category to analyze (default: all)" })),
			days: Type.Optional(Type.Number({ description: "Days to analyze (default: 30)" })),
		}),
		async execute(_id, params) {
			const vaultPath = config.vaultPath;
			const vaultCheck = checkVault(vaultPath);
			if (vaultCheck) return vaultCheck;

			const days = params.days || 30;
			const today = new Date();
			const analysis: Record<string, { entries: number; streak: number; lastDate: string; content: string[] }> = {};

			for (const key of Object.keys(config.categories)) {
				analysis[key] = { entries: 0, streak: 0, lastDate: '', content: [] };
			}

			let streakCount = 0;
			for (let i = 0; i < days; i++) {
				const date = new Date(today.getTime() - i * 24 * 60 * 60 * 1000);
				const dateStr = date.toISOString().split('T')[0];
				const notePath = getDailyNotePath(config, dateStr);
				let hasAnyEntry = false;
				
				if (existsSync(notePath)) {
					const content = readFileSync(notePath, 'utf-8');
					for (const [key, cat] of Object.entries(config.categories)) {
						if (params.category && params.category !== key) continue;
						const sectionMatch = content.match(new RegExp(`##.*${cat.label}[^#]*`, 's'));
						if (sectionMatch) {
							hasAnyEntry = true;
							analysis[key].entries++;
							analysis[key].lastDate = dateStr;
							const lines = sectionMatch[0].split('\n').filter(l => l.startsWith('- ')).slice(0, 2);
							analysis[key].content.push(...lines);
						}
					}
				}
				
				if (hasAnyEntry) {
					streakCount++;
				} else if (i > 0) {
					for (const key of Object.keys(analysis)) {
						if (analysis[key].streak === 0) analysis[key].streak = streakCount;
					}
					streakCount = 0;
				}
			}

			let output = `🔍 Smart Analysis (Last ${days} days)\n\n`;

			for (const [key, data] of Object.entries(analysis)) {
				if (params.category && params.category !== key) continue;
				const cat = config.categories[key];
				const emoji = cat?.emoji || '📊';
				const label = cat?.label || key;
				const avgPerWeek = (data.entries / days * 7).toFixed(1);
				
				output += `${emoji} ${label}:\n`;
				output += `   - Total entries: ${data.entries}\n`;
				output += `   - Average: ${avgPerWeek}/week\n`;
				output += `   - Last recorded: ${data.lastDate || 'N/A'}\n`;
				
				if (data.entries === 0) {
					output += `   💡 Suggestion: You haven't tracked ${label} in ${days} days. Try setting a daily reminder!\n`;
				} else if (data.entries < days * 0.3) {
					output += `   💡 Suggestion: Consider tracking ${label} more consistently.\n`;
				} else if (data.entries > days * 0.8) {
					output += `   ⭐ Great job! You've been consistently tracking ${label}!\n`;
				}
				
				if (data.content.length > 0) {
					output += `   Recent: ${data.content.slice(0, 2).join(' | ')}\n`;
				}
				output += '\n';
			}

			const totalEntries = Object.values(analysis).reduce((sum, d) => sum + d.entries, 0);
			const mostActive = Object.entries(analysis).sort((a, b) => b[1].entries - a[1].entries)[0];
			
			output += `📊 Overall:\n`;
			output += `   - Total tracked entries: ${totalEntries}\n`;
			output += `   - Most active category: ${mostActive[1]?.entries > 0 ? mostActive[1]?.lastDate ? (config.categories[mostActive[0]]?.emoji + ' ' + config.categories[mostActive[0]]?.label) : 'None' : 'None'}\n`;
			output += `   - Coverage: ${((totalEntries / (days * Object.keys(analysis).length)) * 100).toFixed(0)}%\n`;

			return { content: [{ type: "text", text: output }] };
		},
	});

	pi.registerTool({
		name: "obsidian_report",
		label: "Obsidian Report Generator",
		description: "Generate weekly or monthly reports with summaries and visualizations.",
		promptSnippet: "generate weekly or monthly report",
		parameters: Type.Object({
			period: Type.Optional(Type.String({ description: "Report period: weekly or monthly (default: weekly)" })),
			weeks: Type.Optional(Type.Number({ description: "Number of weeks to include (default: 1)" })),
		}),
		async execute(_id, params) {
			const vaultPath = config.vaultPath;
			const vaultCheck = checkVault(vaultPath);
			if (vaultCheck) return vaultCheck;

			const period = params.period || 'weekly';
			const weeks = params.weeks || 1;
			const days = period === 'monthly' ? 30 : 7 * weeks;
			const today = new Date();
			const stats: Record<string, number> = {};
			const summaries: Record<string, string[]> = {};

			for (const key of Object.keys(config.categories)) {
				stats[key] = 0;
				summaries[key] = [];
			}

			for (let i = 0; i < days; i++) {
				const date = new Date(today.getTime() - i * 24 * 60 * 60 * 1000);
				const dateStr = date.toISOString().split('T')[0];
				const notePath = getDailyNotePath(config, dateStr);
				
				if (existsSync(notePath)) {
					const content = readFileSync(notePath, 'utf-8');
					for (const [key, cat] of Object.entries(config.categories)) {
						const sectionMatch = content.match(new RegExp(`##.*${cat.label}[^#]*`, 's'));
						if (sectionMatch) {
							stats[key]++;
							const lines = sectionMatch[0].split('\n').filter(l => l.startsWith('- ')).slice(-3);
							summaries[key].push(...lines);
						}
					}
				}
			}

			const startDate = new Date(today.getTime() - (days - 1) * 24 * 60 * 60 * 1000);
			const endDate = today;
			const periodLabel = period === 'monthly' ? 'Monthly Report' : `Weekly Report (${weeks} week${weeks > 1 ? 's' : ''})`;

			let report = `# ${periodLabel}\n\n`;
			report += `📅 Period: ${startDate.toISOString().split('T')[0]} to ${endDate.toISOString().split('T')[0]}\n\n`;
			
			report += `## 📊 Summary\n\n`;
			for (const [key, count] of Object.entries(stats)) {
				const cat = config.categories[key];
				const emoji = cat?.emoji || '📊';
				const label = cat?.label || key;
				const pct = ((count / days) * 100).toFixed(0);
				const bar = '█'.repeat(Math.round(count / days * 10)) + '░'.repeat(10 - Math.round(count / days * 10));
				report += `${emoji} ${label}: ${bar} ${count}/${days} days (${pct}%)\n`;
			}

			report += `\n## 📝 Details\n\n`;
			for (const [key, items] of Object.entries(summaries)) {
				if (items.length === 0) continue;
				const cat = config.categories[key];
				const emoji = cat?.emoji || '📊';
				const label = cat?.label || key;
				report += `### ${emoji} ${label}\n`;
				report += items.slice(-5).map(item => `- ${item.substring(0, 100)}`).join('\n') + '\n\n';
			}

			report += `## 💡 Insights\n\n`;
			const mostActive = Object.entries(stats).sort((a, b) => b[1] - a[1])[0];
			const leastActive = Object.entries(stats).sort((a, b) => a[1] - b[1])[0];
			const avgDays = Object.values(stats).reduce((a, b) => a + b, 0) / Object.keys(stats).length;
			
			if (mostActive[1] > 0) {
				report += `- Most active: ${config.categories[mostActive[0]]?.emoji} ${config.categories[mostActive[0]]?.label} (${mostActive[1]} entries)\n`;
			}
			if (leastActive[1] < avgDays * 0.5) {
				report += `- Needs attention: ${config.categories[leastActive[0]]?.emoji} ${config.categories[leastActive[0]]?.label} (${leastActive[1]} entries)\n`;
			}
			report += `- Overall consistency: ${((Object.values(stats).reduce((a, b) => a + b, 0) / (days * Object.keys(stats).length)) * 100).toFixed(0)}%\n`;

			return { content: [{ type: "text", text: report }] };
		},
	});

	pi.registerCommand("obsidian-setup", {
		description: "Configure Obsidian vault path",
		async handler(_args, ctx) {
			const currentPath = config.vaultPath;
			const newPath = await ctx.ui.input(`Obsidian vault path [${currentPath}]:`);
			if (newPath) {
				const resolved = resolve(newPath.replace(/^~/, homedir()));
				if (!existsSync(resolved)) {
					ctx.ui.notify(`Warning: path does not exist: ${resolved}`, "warning");
				}
				config.vaultPath = resolved;
				saveConfig(config);
				ctx.ui.notify(`Vault path set to: ${config.vaultPath}`, "info");
			}
		},
	});
}

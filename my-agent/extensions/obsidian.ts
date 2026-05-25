import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "@earendil-works/pi-ai";
import {
	readFileSync,
	writeFileSync,
	appendFileSync,
	existsSync,
	mkdirSync,
	readdirSync,
	unlinkSync,
} from "node:fs";
import { join, resolve, basename } from "node:path";
import { homedir } from "node:os";

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

function appendToSection(filePath: string, sectionTitle: string, content: string): boolean {
	if (!existsSync(filePath)) return false;

	const fileContent = readFileSync(filePath, "utf-8");
	const lines = fileContent.split("\n");

	let sectionIndex = -1;
	let nextSectionIndex = lines.length;

	for (let i = 0; i < lines.length; i++) {
		if (lines[i].trim() === sectionTitle) {
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

function searchInVault(vaultPath: string, query: string, maxResults: number): string[] {
	const results: string[] = [];
	const lowerQuery = query.toLowerCase();

	function walk(dir: string): void {
		if (results.length >= maxResults) return;
		const entries = readdirSync(dir, { withFileTypes: true });
		for (const entry of entries) {
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
			if (results.length >= maxResults) break;
		}
	}

	try {
		walk(vaultPath);
	} catch {
		// vault path might not exist
	}
	return results;
}

export default function (pi: ExtensionAPI) {
	const config = loadConfig();

	pi.registerTool({
		name: "obsidian_read",
		label: "Obsidian Read",
		description:
			"Read a note from the Obsidian vault. Provide a path relative to the vault root, or use 'daily' to read today's daily note.",
		promptSnippet: "read notes from the Obsidian vault",
		promptGuidelines: [
			"Use obsidian_read to look up information the user has previously recorded in their notes",
			"Use 'daily' as the path to read today's daily note",
		],
		parameters: Type.Object({
			path: Type.String({
				description: "Note path relative to vault root, or 'daily' for today's daily note",
			}),
			date: Type.Optional(
				Type.String({ description: "Date for daily note in YYYY-MM-DD format (default: today)" }),
			),
		}),
		async execute(_id, params) {
			const vaultPath = config.vaultPath;
			if (!existsSync(vaultPath)) {
				return {
					content: [
						{
							type: "text",
							text: `Vault path does not exist: ${vaultPath}\nPlease configure it in ${CONFIG_PATH} or set OBSIDIAN_VAULT_PATH env var.`,
						},
					],
					isError: true,
				};
			}

			let filePath: string;
			if (params.path === "daily") {
				filePath = ensureDailyNote(config, params.date);
			} else {
				filePath = join(vaultPath, params.path);
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
			const filePath = join(vaultPath, params.path);
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
			if (!existsSync(vaultPath)) {
				return {
					content: [{ type: "text", text: `Vault path does not exist: ${vaultPath}` }],
					isError: true,
				};
			}

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
			const folderPath = params.folder ? join(vaultPath, params.folder) : vaultPath;

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
			"Record an entry to a specific category in the daily note. Automatically creates the daily note if it doesn't exist. Categories include: diet, exercise, learning, work, or custom.",
		promptSnippet: "record entries to the daily note in Obsidian",
		promptGuidelines: [
			"Use obsidian_record when the user wants to log something to their daily note",
			"Common categories: diet (饮食), exercise (运动), learning (学习), work (工作)",
			"The entry is automatically timestamped and added under the correct section",
		],
		parameters: Type.Object({
			category: Type.String({
				description:
					"Category key: diet, exercise, learning, work, or a custom category name",
			}),
			content: Type.String({ description: "The content to record" }),
			date: Type.Optional(
				Type.String({ description: "Date in YYYY-MM-DD format (default: today)" }),
			),
		}),
		async execute(_id, params) {
			const vaultPath = config.vaultPath;
			if (!existsSync(vaultPath)) {
				mkdirSync(vaultPath, { recursive: true });
			}

			const notePath = ensureDailyNote(config, params.date);
			const catConfig = config.categories[params.category];
			const sectionTitle = catConfig
				? `## ${catConfig.emoji} ${catConfig.label}`
				: `## ${params.category}`;

			if (!appendToSection(notePath, sectionTitle, params.content)) {
				const fileContent = readFileSync(notePath, "utf-8");
				const newSection = `\n${sectionTitle}\n\n`;
				const timestamp = new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
				const entry = `- ${timestamp} ${params.content}\n`;
				appendFileSync(notePath, newSection + entry, "utf-8");
			}

			const date = params.date || getToday();
			const catLabel = catConfig ? catConfig.label : params.category;
			return {
				content: [
					{
						type: "text",
						text: `Recorded to ${catLabel} [${date}]: ${params.content}`,
					},
				],
			};
		},
	});

	pi.registerTool({
		name: "obsidian_config",
		label: "Obsidian Config",
		description:
			"Configure Obsidian vault settings. Use this to set the vault path, daily note folder, or categories.",
		parameters: Type.Object({
			vault_path: Type.Optional(Type.String({ description: "Absolute path to the Obsidian vault" })),
			daily_note_folder: Type.Optional(Type.String({ description: "Folder name for daily notes" })),
		}),
		async execute(_id, params) {
			if (params.vault_path) {
				config.vaultPath = resolve(params.vault_path.replace(/^~/, homedir()));
			}
			if (params.daily_note_folder) {
				config.dailyNoteFolder = params.daily_note_folder;
			}

			saveConfig(config);

			return {
				content: [
					{
						type: "text",
						text: `Obsidian config updated:\n- Vault: ${config.vaultPath}\n- Daily notes: ${config.dailyNoteFolder}\n- Categories: ${Object.entries(config.categories)
							.map(([k, v]) => `${k}=${v.label}`)
							.join(", ")}\n\nConfig saved to: ${CONFIG_PATH}`,
					},
				],
			};
		},
	});

	pi.registerCommand("obsidian-setup", {
		description: "Configure Obsidian vault path",
		async handler(_args, ctx) {
			const currentPath = config.vaultPath;
			const newPath = await ctx.ui.input(`Obsidian vault path [${currentPath}]:`);
			if (newPath) {
				config.vaultPath = resolve(newPath.replace(/^~/, homedir()));
				saveConfig(config);
				ctx.ui.notify(`Vault path set to: ${config.vaultPath}`, "info");
			}
		},
	});
}

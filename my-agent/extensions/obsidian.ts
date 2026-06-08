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
import { join, resolve } from "node:path";
import { homedir } from "node:os";
import { spawnSync } from "node:child_process";
import {
	CONFIG_PATH,
	DAILY_ALIASES,
	loadConfig,
	saveConfig,
	getToday,
	getDailyNotePath,
	ensureDailyNote,
	isPathInsideVault,
	resolveCategory,
	checkVault,
} from "../lib/obsidian-config";

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

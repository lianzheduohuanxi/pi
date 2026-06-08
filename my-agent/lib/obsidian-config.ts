/**
 * Shared Obsidian configuration and helpers.
 * Single source of truth for vault config used by all extensions.
 */
import {
	readFileSync,
	writeFileSync,
	existsSync,
	mkdirSync,
} from "node:fs";
import { join, resolve, sep } from "node:path";
import { homedir } from "node:os";

export const CONFIG_PATH = join(homedir(), ".pi", "agent", "obsidian-config.json");

export interface CategoryConfig {
	label: string;
	emoji: string;
}

export interface ObsidianConfig {
	vaultPath: string;
	dailyNoteFolder: string;
	categories: Record<string, CategoryConfig>;
	template: string;
}

export const DEFAULT_CONFIG: ObsidianConfig = {
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

export function loadConfig(): ObsidianConfig {
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

export function saveConfig(config: ObsidianConfig): void {
	mkdirSync(join(homedir(), ".pi", "agent"), { recursive: true });
	writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), "utf-8");
}

// --- Shared helpers ---

export function getToday(): string {
	const now = new Date();
	const y = now.getFullYear();
	const m = String(now.getMonth() + 1).padStart(2, "0");
	const d = String(now.getDate()).padStart(2, "0");
	return `${y}-${m}-${d}`;
}

export function getWeekday(): string {
	const days = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
	return days[new Date().getDay()];
}

export function getWeekNumber(date: Date): { year: number; week: number } {
	const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
	const dayNum = d.getUTCDay() || 7;
	d.setUTCDate(d.getUTCDate() + 4 - dayNum);
	const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
	const week = Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
	return { year: d.getUTCFullYear(), week };
}

export function getDailyNotePath(config: ObsidianConfig, date?: string): string {
	const d = date || getToday();
	return join(config.vaultPath, config.dailyNoteFolder, `${d}.md`);
}

export function generateDailyNoteTemplate(config: ObsidianConfig, date?: string): string {
	const weekday = getWeekday();
	let template = `# ${date || getToday()} ${weekday}\n\n`;
	for (const [, cat] of Object.entries(config.categories)) {
		template += `## ${cat.emoji} ${cat.label}\n\n`;
	}
	template += `## 📝 备注\n\n`;
	return template;
}

export function ensureDailyNote(config: ObsidianConfig, date?: string): string {
	const notePath = getDailyNotePath(config, date);
	if (!existsSync(notePath)) {
		mkdirSync(join(config.vaultPath, config.dailyNoteFolder), { recursive: true });
		writeFileSync(notePath, generateDailyNoteTemplate(config, date), "utf-8");
	}
	return notePath;
}

export function isPathInsideVault(filePath: string, vaultPath: string): boolean {
	const resolved = resolve(filePath);
	const resolvedVault = resolve(vaultPath);
	return resolved.startsWith(resolvedVault + sep) || resolved === resolvedVault;
}

export function resolveCategory(category: string, config: ObsidianConfig): string {
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

export function checkVault(vaultPath: string): { content: { type: "text"; text: string }[]; isError: true } | null {
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

/** Extract entries count for a category from daily note content */
export function extractCategoryEntries(content: string, categoryLabel: string): string[] {
	const sectionMatch = content.match(new RegExp(`##.*${categoryLabel}[^#]*`, "s"));
	if (!sectionMatch) return [];
	return sectionMatch[0].split("\n").filter((l: string) => l.startsWith("-"));
}

/** Get the section header for a category */
export function getCategoryHeader(config: ObsidianConfig, category: string): string {
	const catConfig = config.categories[category];
	return catConfig ? `## ${catConfig.emoji} ${catConfig.label}` : `## ${category}`;
}

/** Get the display label for a category */
export function getCategoryLabel(config: ObsidianConfig, category: string): string {
	const catConfig = config.categories[category];
	return catConfig ? catConfig.label : category;
}

/** Get the emoji for a category */
export function getCategoryEmoji(config: ObsidianConfig, category: string): string {
	const catConfig = config.categories[category];
	return catConfig?.emoji || "📝";
}

const DAILY_ALIASES = new Set(["daily", "today", "今日", "今天"]);
export { DAILY_ALIASES };

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

const REMINDER_DIR = join(homedir(), ".pi", "agent", "reminders");
const REMINDERS_FILE = join(REMINDER_DIR, "reminders.json");
const CONFIG_PATH = join(homedir(), ".pi", "agent", "obsidian-config.json");

interface Reminder {
	id: string;
	type: 'routine' | 'suggestion' | 'alert' | 'insight';
	category?: string;
	message: string;
	conditions: {
		type: 'time' | 'category_low' | 'category_high' | 'pattern' | 'streak';
		value?: string;
		threshold?: number;
	};
	enabled: boolean;
	priority: 'high' | 'medium' | 'low';
	createdAt: string;
	lastTriggered?: string;
	triggerCount: number;
}

function loadConfig() {
	if (existsSync(CONFIG_PATH)) {
		try {
			return JSON.parse(readFileSync(CONFIG_PATH, "utf-8"));
		} catch {}
	}
	return {
		categories: {},
		scheduler: { enabled: true }
	};
}

function loadReminders(): Reminder[] {
	mkdirSync(REMINDER_DIR, { recursive: true });
	if (!existsSync(REMINDERS_FILE)) {
		const defaults = getDefaultReminders();
		saveReminders(defaults);
		return defaults;
	}
	try {
		return JSON.parse(readFileSync(REMINDERS_FILE, "utf-8"));
	} catch {
		return getDefaultReminders();
	}
}

function saveReminders(reminders: Reminder[]): void {
	mkdirSync(REMINDER_DIR, { recursive: true });
	writeFileSync(REMINDERS_FILE, JSON.stringify(reminders, null, 2), "utf-8");
}

function generateId(): string {
	return `reminder_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

function getDefaultReminders(): Reminder[] {
	return [
		{
			id: 'default_morning',
			type: 'routine',
			message: '🌅 早上好！新的一天开始了。今天有什么计划吗？记得吃早餐哦～',
			conditions: { type: 'time', value: '08:00' },
			enabled: true,
			priority: 'medium',
			createdAt: new Date().toISOString(),
			triggerCount: 0,
		},
		{
			id: 'default_exercise_reminder',
			type: 'suggestion',
			category: 'exercise',
			message: '🏃 今天还没运动呢，要不要出去走走或者做些简单的运动？',
			conditions: { type: 'category_low', value: 'exercise', threshold: 1 },
			enabled: true,
			priority: 'medium',
			createdAt: new Date().toISOString(),
			triggerCount: 0,
		},
		{
			id: 'default_diet_reminder',
			type: 'suggestion',
			category: 'diet',
			message: '🍽️ 记得记录今天的饮食哦！健康饮食是生活的重要组成部分。',
			conditions: { type: 'category_low', value: 'diet', threshold: 2 },
			enabled: true,
			priority: 'low',
			createdAt: new Date().toISOString(),
			triggerCount: 0,
		},
		{
			id: 'default_learning_reminder',
			type: 'suggestion',
			category: 'learning',
			message: '📚 今天学习了吗？每天进步一点点，长期坚持会有大收获！',
			conditions: { type: 'category_low', value: 'learning', threshold: 1 },
			enabled: true,
			priority: 'low',
			createdAt: new Date().toISOString(),
			triggerCount: 0,
		},
		{
			id: 'default_mood_check',
			type: 'insight',
			category: 'mood',
			message: '😊 今天心情怎么样？记录一下心情有助于了解自己的情绪变化。',
			conditions: { type: 'category_low', value: 'mood', threshold: 1 },
			enabled: true,
			priority: 'low',
			createdAt: new Date().toISOString(),
			triggerCount: 0,
		},
		{
			id: 'default_evening_review',
			type: 'routine',
			message: '🌙 晚上了，今天过得怎么样？要不要做个简单的每日总结？',
			conditions: { type: 'time', value: '21:00' },
			enabled: true,
			priority: 'medium',
			createdAt: new Date().toISOString(),
			triggerCount: 0,
		},
	];
}

function checkTimeCondition(timeStr: string): boolean {
	const now = new Date();
	const currentTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
	return currentTime === timeStr;
}

function getCategoryCount(category: string, days: number = 1): number {
	const config = loadConfig();
	const vaultPath = config.vaultPath || join(homedir(), "obsidian-vault");
	const dailyNoteFolder = config.dailyNoteFolder || "Daily Notes";
	let count = 0;

	for (let i = 0; i < days; i++) {
		const date = new Date(Date.now() - i * 24 * 60 * 60 * 1000);
		const dateStr = date.toISOString().split('T')[0];
		const notePath = join(vaultPath, dailyNoteFolder, `${dateStr}.md`);

		if (existsSync(notePath)) {
			const content = readFileSync(notePath, 'utf-8');
			const catConfig = config.categories?.[category];
			if (catConfig) {
				const sectionMatch = content.match(new RegExp(`##.*${catConfig.label}[^#]*`, 's'));
				if (sectionMatch) {
					const entries = sectionMatch[0].match(/^- \d{2}:\d{2}/gm);
					count += entries ? entries.length : 0;
				}
			}
		}
	}

	return count;
}

function checkCategoryCondition(type: 'category_low' | 'category_high', category: string, threshold: number): boolean {
	const count = getCategoryCount(category);
	if (type === 'category_low') {
		return count < threshold;
	}
	return count > threshold;
}

function shouldTriggerReminder(reminder: Reminder): boolean {
	if (!reminder.enabled) return false;

	const now = new Date();
	const lastTriggered = reminder.lastTriggered ? new Date(reminder.lastTriggered) : null;
	if (lastTriggered) {
		const hoursSinceLastTrigger = (now.getTime() - lastTriggered.getTime()) / (1000 * 60 * 60);
		if (hoursSinceLastTrigger < 1) return false;
	}

	switch (reminder.conditions.type) {
		case 'time':
			return checkTimeCondition(reminder.conditions.value || '');
		case 'category_low':
		case 'category_high':
			return checkCategoryCondition(
				reminder.conditions.type,
				reminder.conditions.value || '',
				reminder.conditions.threshold || 1
			);
		default:
			return false;
	}
}

function getActiveReminders(): Reminder[] {
	const reminders = loadReminders();
	return reminders.filter(r => shouldTriggerReminder(r))
		.sort((a, b) => {
			const priorityOrder = { high: 0, medium: 1, low: 2 };
			return priorityOrder[a.priority] - priorityOrder[b.priority];
		});
}

function markReminderTriggered(reminderId: string): void {
	const reminders = loadReminders();
	const reminder = reminders.find(r => r.id === reminderId);
	if (reminder) {
		reminder.lastTriggered = new Date().toISOString();
		reminder.triggerCount++;
		saveReminders(reminders);
	}
}

export default function (pi: ExtensionAPI) {
	pi.registerTool({
		name: "reminder_list",
		label: "List Reminders",
		description: "List all configured reminders with their status.",
		promptSnippet: "list my reminders",
		parameters: Type.Object({}),
		async execute(_id, _params) {
			const reminders = loadReminders();

			if (reminders.length === 0) {
				return { content: [{ type: "text", text: "No reminders configured." }] };
			}

			const lines = reminders.map(r => {
				const status = r.enabled ? "✅" : "⏸️";
				const typeIcon = r.type === 'routine' ? '🔔' : r.type === 'suggestion' ? '💡' : r.type === 'alert' ? '⚠️' : '🔍';
				const priorityIcon = r.priority === 'high' ? '🔴' : r.priority === 'medium' ? '🟡' : '🟢';
				let condition = '';
				switch (r.conditions.type) {
					case 'time':
						condition = `⏰ ${r.conditions.value}`;
						break;
					case 'category_low':
						condition = `📉 ${r.conditions.value} < ${r.conditions.threshold}`;
						break;
					case 'category_high':
						condition = `📈 ${r.conditions.value} > ${r.conditions.threshold}`;
						break;
				}
				return `${status} ${typeIcon} ${priorityIcon} ${r.message}\n   Condition: ${condition} | Triggered: ${r.triggerCount}x`;
			});

			return {
				content: [{
					type: "text",
					text: `Reminders (${reminders.length}):\n\n${lines.join('\n\n')}`
				}]
			};
		},
	});

	pi.registerTool({
		name: "reminder_create",
		label: "Create Reminder",
		description: "Create a new reminder with custom conditions.",
		promptSnippet: "create a new reminder",
		parameters: Type.Object({
			message: Type.String({ description: "Reminder message" }),
			type: Type.Optional(Type.String({ description: "Type: routine, suggestion, alert, insight", enum: ["routine", "suggestion", "alert", "insight"] })),
			category: Type.Optional(Type.String({ description: "Category to monitor (for category conditions)" })),
			condition_type: Type.Optional(Type.String({ description: "Condition type: time, category_low, category_high", enum: ["time", "category_low", "category_high"] })),
			condition_value: Type.Optional(Type.String({ description: "For time: HH:MM, For category: category name" })),
			condition_threshold: Type.Optional(Type.Number({ description: "For category conditions: threshold value" })),
			priority: Type.Optional(Type.String({ description: "Priority: high, medium, low", enum: ["high", "medium", "low"] })),
		}),
		async execute(_id, params) {
			const reminders = loadReminders();

			const reminder: Reminder = {
				id: generateId(),
				type: (params.type as any) || 'suggestion',
				message: params.message,
				category: params.category,
				conditions: {
					type: (params.condition_type as any) || 'time',
					value: params.condition_value || '09:00',
					threshold: params.condition_threshold,
				},
				enabled: true,
				priority: (params.priority as any) || 'medium',
				createdAt: new Date().toISOString(),
				triggerCount: 0,
			};

			reminders.push(reminder);
			saveReminders(reminders);

			return {
				content: [{
					type: "text",
					text: `Reminder created: "${params.message}" (ID: ${reminder.id})`
				}]
			};
		},
	});

	pi.registerTool({
		name: "reminder_toggle",
		label: "Toggle Reminder",
		description: "Enable or disable a reminder.",
		parameters: Type.Object({
			identifier: Type.String({ description: "Reminder ID or message keyword" }),
			enabled: Type.Boolean({ description: "true to enable, false to disable" }),
		}),
		async execute(_id, params) {
			const reminders = loadReminders();
			const reminder = reminders.find(r =>
				r.id === params.identifier ||
				r.message.includes(params.identifier)
			);

			if (!reminder) {
				return { content: [{ type: "text", text: "Reminder not found." }], isError: true };
			}

			reminder.enabled = params.enabled;
			saveReminders(reminders);

			return {
				content: [{
					type: "text",
					text: `Reminder "${reminder.message}" ${params.enabled ? 'enabled' : 'disabled'}.`
				}]
			};
		},
	});

	pi.registerTool({
		name: "reminder_delete",
		label: "Delete Reminder",
		description: "Delete a reminder.",
		parameters: Type.Object({
			identifier: Type.String({ description: "Reminder ID or message keyword" }),
		}),
		async execute(_id, params) {
			const reminders = loadReminders();
			const index = reminders.findIndex(r =>
				r.id === params.identifier ||
				r.message.includes(params.identifier)
			);

			if (index === -1) {
				return { content: [{ type: "text", text: "Reminder not found." }], isError: true };
			}

			const removed = reminders.splice(index, 1)[0];
			saveReminders(reminders);

			return {
				content: [{
					type: "text",
					text: `Deleted reminder: "${removed.message}"`
				}]
			};
		},
	});

	pi.registerTool({
		name: "reminder_check",
		label: "Check Active Reminders",
		description: "Check which reminders should trigger now based on conditions.",
		promptSnippet: "check if I should get any reminders",
		parameters: Type.Object({}),
		async execute(_id, _params) {
			const active = getActiveReminders();

			if (active.length === 0) {
				return {
					content: [{
						type: "text",
						text: "No reminders triggered right now. You're all caught up! 🎉"
					}]
				};
			}

			active.forEach(r => markReminderTriggered(r.id));

			const lines = active.map(r => {
				const typeIcon = r.type === 'routine' ? '🔔' : r.type === 'suggestion' ? '💡' : r.type === 'alert' ? '⚠️' : '🔍';
				return `${typeIcon} ${r.message}`;
			});

			return {
				content: [{
					type: "text",
					text: `Active Reminders:\n\n${lines.join('\n')}`
				}]
			};
		},
	});

	pi.registerTool({
		name: "reminder_reset",
		label: "Reset Reminders",
		description: "Reset all reminders to defaults.",
		promptSnippet: "reset reminders to default",
		parameters: Type.Object({
			confirm: Type.Boolean({ description: "Confirm reset (required)" }),
		}),
		async execute(_id, params) {
			if (!params.confirm) {
				return {
					content: [{
						type: "text",
						text: "Please confirm reset by setting confirm=true"
					}],
					isError: true
				};
			}

			const defaults = getDefaultReminders();
			saveReminders(defaults);

			return {
				content: [{
					type: "text",
					text: `Reset ${defaults.length} reminders to defaults.`
				}]
			};
		},
	});

	pi.registerCommand("reminders", {
		description: "Manage reminders",
		async handler(_args, ctx) {
			const reminders = loadReminders();
			const active = getActiveReminders();

			const options = [
				`View All (${reminders.length})`,
				`Active Now (${active.length})`,
				"Create New",
				"↩ Cancel"
			];

			const choice = await ctx.ui.select("Reminders", options);
			if (!choice || choice === "↩ Cancel") return;

			if (choice.includes("Active Now")) {
				const activeMsgs = active.map(r => `${r.type === 'suggestion' ? '💡' : '🔔'} ${r.message}`);
				if (activeMsgs.length > 0) {
					ctx.ui.notify(`Active reminders: ${activeMsgs.join(', ')}`, "info");
				} else {
					ctx.ui.notify("No active reminders right now!", "info");
				}
			} else if (choice.includes("View All")) {
				const allMsgs = reminders.map(r =>
					`${r.enabled ? '✅' : '⏸️'} ${r.message}`
				).join('\n');
				ctx.ui.notify(`All reminders:\n${allMsgs}`, "info");
			} else if (choice === "Create New") {
				pi.sendUserMessage("Create a new reminder");
			}
		},
	});
}

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "@earendil-works/pi-ai";
import {
	readFileSync,
	writeFileSync,
	existsSync,
	mkdirSync,
	unlinkSync,
	readdirSync,
	appendFileSync,
} from "node:fs";
import { join, resolve, dirname } from "node:path";
import { homedir } from "node:os";

const isWindows = process.platform === "win32";
const SCHEDULER_DIR = join(homedir(), ".pi", "agent", "scheduler");
const TASKS_FILE = join(SCHEDULER_DIR, "tasks.json");
const HISTORY_FILE = join(SCHEDULER_DIR, "history.json");
const RUNNER_SCRIPT = join(SCHEDULER_DIR, "run-task.mjs");
const RUNNER_BAT = join(SCHEDULER_DIR, "run-task.bat");
const LOCK_FILE = join(SCHEDULER_DIR, ".lock");

interface ScheduledTask {
	id: string;
	name: string;
	cron: string;
	prompt: string;
	outputToObsidian?: boolean;
	obsidianCategory?: string;
	obsidianOutputFormat?: "daily" | "weekly" | "custom" | "daily-visual" | "weekly-visual";
	obsidianOutputPath?: string;
	obsidianWeeklyFolder?: string;
	notifyOnComplete?: boolean;
	enabled: boolean;
	createdAt: string;
}

interface TaskHistory {
	taskId: string;
	taskName: string;
	timestamp: string;
	status: "success" | "failed";
	exitCode: number;
	output?: string;
	error?: string;
	durationMs: number;
}

// ============================================
// 共享工具函数 - 主文件和运行器脚本共用
// ============================================

function loadConfig() {
	const configPath = join(homedir(), ".pi", "agent", "obsidian-config.json");
	if (existsSync(configPath)) {
		try {
			return JSON.parse(readFileSync(configPath, "utf-8"));
		} catch {
			// ignore
		}
	}
	return {
		vaultPath: join(homedir(), "obsidian-vault"),
		dailyNoteFolder: "Daily Notes",
		weeklyNoteFolder: "40-Life/weekly",
		categories: {},
	};
}

function getWeekNumber(date: Date): { year: number; week: number } {
	const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
	const dayNum = d.getUTCDay() || 7;
	d.setUTCDate(d.getUTCDate() + 4 - dayNum);
	const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
	const week = Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
	return { year: d.getUTCFullYear(), week };
}

function acquireLock(): boolean {
	try {
		if (existsSync(LOCK_FILE)) {
			const lockTime = parseInt(readFileSync(LOCK_FILE, "utf-8"));
			if (Date.now() - lockTime < 300000) {
				return false;
			}
		}
		writeFileSync(LOCK_FILE, Date.now().toString(), "utf-8");
		return true;
	} catch {
		return false;
	}
}

function releaseLock(): void {
	try {
		if (existsSync(LOCK_FILE)) {
			unlinkSync(LOCK_FILE);
		}
	} catch {}
}

function saveToObsidian(
	output: string,
	task: ScheduledTask,
	now: Date,
): string | null {
	const config = loadConfig();
	const vaultPath = config.vaultPath || join(homedir(), "obsidian-vault");
	const dailyFolder = config.dailyNoteFolder || "Daily Notes";
	const date = now.toISOString().split("T")[0];

	let category = task.obsidianCategory || "work";
	const catConfig = config.categories?.[category];
	if (catConfig) category = catConfig.label;

	const outputFormat = task.obsidianOutputFormat || "daily";
	const customPath = task.obsidianOutputPath || "";
	const weeklyFolder = task.obsidianWeeklyFolder || config.weeklyNoteFolder || "40-Life/weekly";

	let outputPath: string | null = null;

	if (outputFormat === "daily" || outputFormat === "daily-visual") {
		outputPath = join(vaultPath, dailyFolder, `${date}.md`);
	} else if (outputFormat === "weekly" || outputFormat === "weekly-visual") {
		const { year, week } = getWeekNumber(now);
		const weekStr = week.toString().padStart(2, "0");
		const weeklyDir = join(vaultPath, weeklyFolder, year.toString());
		outputPath = join(weeklyDir, `${year}-W${weekStr}.md`);
	} else if (outputFormat === "custom" && customPath) {
		const actualPath = customPath
			.replace(/YYYY-MM-DD/g, date)
			.replace(/YYYY/g, date.slice(0, 4))
			.replace(/MM/g, date.slice(5, 7))
			.replace(/DD/g, date.slice(8, 10));
		outputPath = join(vaultPath, actualPath);
	}

	if (!outputPath) return null;

	const outputDir = dirname(outputPath);
	const sectionTitle = `## ${category}`;
	const entry = `- ${date}: ${output.slice(0, 2000)}\n`;

	if (existsSync(outputPath)) {
		const content = readFileSync(outputPath, "utf-8");
		const lines = content.split("\n");
		let sectionIdx = -1;
		let nextIdx = lines.length;
		for (let i = 0; i < lines.length; i++) {
			if (lines[i].trim() === sectionTitle) sectionIdx = i;
			else if (sectionIdx !== -1 && lines[i].startsWith("## ")) {
				nextIdx = i;
				break;
			}
		}
		if (sectionIdx !== -1) {
			lines.splice(nextIdx, 0, entry);
			writeFileSync(outputPath, lines.join("\n"), "utf-8");
		} else {
			appendFileSync(outputPath, `\n${sectionTitle}\n\n${entry}`, "utf-8");
		}
	} else {
		mkdirSync(outputDir, { recursive: true });
		writeFileSync(outputPath, `# ${date}\n\n${sectionTitle}\n\n${entry}`, "utf-8");
	}

	return outputPath;
}

function addToHistory(history: TaskHistory) {
	let histories: TaskHistory[] = [];
	if (existsSync(HISTORY_FILE)) {
		try {
			histories = JSON.parse(readFileSync(HISTORY_FILE, "utf-8"));
		} catch {
			// ignore
		}
	}
	histories.unshift(history);
	histories = histories.slice(0, 100);
	writeFileSync(HISTORY_FILE, JSON.stringify(histories, null, 2), "utf-8");
}

function loadTasks(): ScheduledTask[] {
	if (!existsSync(TASKS_FILE)) return [];
	try {
		return JSON.parse(readFileSync(TASKS_FILE, "utf-8"));
	} catch {
		return [];
	}
}

function saveTasks(tasks: ScheduledTask[]): void {
	mkdirSync(SCHEDULER_DIR, { recursive: true });
	writeFileSync(TASKS_FILE, JSON.stringify(tasks, null, 2), "utf-8");
}

function generateId(): string {
	return `task_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

function resolvePrompt(prompt: string): string {
	const now = new Date();
	const today = now.toISOString().split("T")[0];
	const yesterday = new Date(now.getTime() - 86400000).toISOString().split("T")[0];
	return prompt
		.replace(/{{today}}/gi, today)
		.replace(/{{yesterday}}/gi, yesterday)
		.replace(/{{date}}/gi, today);
}

function ensureRunnerScript(piBin: string): void {
	mkdirSync(SCHEDULER_DIR, { recursive: true });

	const script = `import { readFileSync, appendFileSync, existsSync, mkdirSync, writeFileSync, readdirSync, unlinkSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir, platform } from "node:os";
import { spawnSync } from "node:child_process";

const SCHEDULER_DIR = join(homedir(), ".pi", "agent", "scheduler");
const TASKS_FILE = join(SCHEDULER_DIR, "tasks.json");
const HISTORY_FILE = join(SCHEDULER_DIR, "history.json");
const LOCK_FILE = join(SCHEDULER_DIR, ".lock");
const taskId = process.argv[2];

if (!taskId) {
	console.error("Usage: node run-task.mjs <task-id>");
	process.exit(1);
}

let tasks;
try {
	tasks = JSON.parse(readFileSync(TASKS_FILE, "utf-8"));
} catch {
	console.error("Cannot read tasks file:", TASKS_FILE);
	process.exit(1);
}

const task = tasks.find((t) => t.id === taskId);
if (!task) {
	console.error("Task not found:", taskId);
	process.exit(1);
}

if (!task.enabled) {
	console.log("Task is disabled, skipping:", task.name);
	process.exit(0);
}

function loadConfig() {
	const configPath = join(homedir(), ".pi", "agent", "obsidian-config.json");
	if (existsSync(configPath)) {
		try {
			return JSON.parse(readFileSync(configPath, "utf-8"));
		} catch {
			// ignore
		}
	}
	return {
		vaultPath: join(homedir(), "obsidian-vault"),
		dailyNoteFolder: "Daily Notes",
		weeklyNoteFolder: "40-Life/weekly",
		categories: {},
	};
}

function getWeekNumber(date) {
	const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
	const dayNum = d.getUTCDay() || 7;
	d.setUTCDate(d.getUTCDate() + 4 - dayNum);
	const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
	const week = Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
	return { year: d.getUTCFullYear(), week };
}

function acquireLock() {
	try {
		if (existsSync(LOCK_FILE)) {
			const lockTime = parseInt(readFileSync(LOCK_FILE, "utf-8"));
			if (Date.now() - lockTime < 300000) {
				return false;
			}
		}
		writeFileSync(LOCK_FILE, Date.now().toString(), "utf-8");
		return true;
	} catch {
		return false;
	}
}

function releaseLock() {
	try {
		if (existsSync(LOCK_FILE)) {
			unlinkSync(LOCK_FILE);
		}
	} catch {}
}

function resolvePrompt(prompt) {
	const now = new Date();
	const today = now.toISOString().split("T")[0];
	const yesterday = new Date(now.getTime() - 86400000).toISOString().split("T")[0];
	return prompt
		.replace(/{{today}}/gi, today)
		.replace(/{{yesterday}}/gi, yesterday)
		.replace(/{{date}}/gi, today);
}

function saveToObsidian(output, task, now) {
	const config = loadConfig();
	const vaultPath = config.vaultPath || join(homedir(), "obsidian-vault");
	const dailyFolder = config.dailyNoteFolder || "Daily Notes";
	const date = now.toISOString().split("T")[0];

	let category = task.obsidianCategory || "work";
	const catConfig = config.categories?.[category];
	if (catConfig) category = catConfig.label;

	const outputFormat = task.obsidianOutputFormat || "daily";
	const customPath = task.obsidianOutputPath || "";
	const weeklyFolder = task.obsidianWeeklyFolder || config.weeklyNoteFolder || "40-Life/weekly";

	let outputPath = null;

	if (outputFormat === "daily" || outputFormat === "daily-visual") {
		outputPath = join(vaultPath, dailyFolder, \`\${date}.md\`);
	} else if (outputFormat === "weekly" || outputFormat === "weekly-visual") {
		const { year, week } = getWeekNumber(now);
		const weekStr = week.toString().padStart(2, "0");
		const weeklyDir = join(vaultPath, weeklyFolder, year.toString());
		outputPath = join(weeklyDir, \`\${year}-W\${weekStr}.md\`);
	} else if (outputFormat === "custom" && customPath) {
		const actualPath = customPath
			.replace(/YYYY-MM-DD/g, date)
			.replace(/YYYY/g, date.slice(0, 4))
			.replace(/MM/g, date.slice(5, 7))
			.replace(/DD/g, date.slice(8, 10));
		outputPath = join(vaultPath, actualPath);
	}

	if (!outputPath) return null;

	const outputDir = dirname(outputPath);
	const sectionTitle = \`## \${category}\`;
	const entry = \`- \${date}: \${output.slice(0, 2000)}\\n\`;

	if (existsSync(outputPath)) {
		const content = readFileSync(outputPath, "utf-8");
		const lines = content.split("\\n");
		let sectionIdx = -1;
		let nextIdx = lines.length;
		for (let i = 0; i < lines.length; i++) {
			if (lines[i].trim() === sectionTitle) sectionIdx = i;
			else if (sectionIdx !== -1 && lines[i].startsWith("## ")) {
				nextIdx = i;
				break;
			}
		}
		if (sectionIdx !== -1) {
			lines.splice(nextIdx, 0, entry);
			writeFileSync(outputPath, lines.join("\\n"), "utf-8");
		} else {
			appendFileSync(outputPath, \`\\n\${sectionTitle}\\n\\n\${entry}\`, "utf-8");
		}
	} else {
		mkdirSync(outputDir, { recursive: true });
		writeFileSync(outputPath, \`# \${date}\\n\\n\${sectionTitle}\\n\\n\${entry}\`, "utf-8");
	}

	return outputPath;
}

function addToHistory(history) {
	let histories = [];
	if (existsSync(HISTORY_FILE)) {
		try {
			histories = JSON.parse(readFileSync(HISTORY_FILE, "utf-8"));
		} catch {
			// ignore
		}
	}
	histories.unshift(history);
	histories = histories.slice(0, 100);
	writeFileSync(HISTORY_FILE, JSON.stringify(histories, null, 2), "utf-8");
}

function showNotification(title, message) {
	try {
		const isWindows = platform === "win32";
		if (isWindows) {
			const psCommand = \`[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType=WindowsRuntime];\` +
				\`$toastXml = New-Object Windows.Data.Xml.Dom.XmlDocument;\` +
				\`$toastXml.LoadXml(@'\` +
				\`<toast><visual><binding template="ToastGeneric"><text>\\\${title}</text><text>\\\${message}</text></binding></visual></toast>\` +
				\`'@);\` +
				\`$toast = New-Object Windows.UI.Notifications.ToastNotification($toastXml);\` +
				\`[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('Pi Agent').Show($toast);\`;
			spawnSync("powershell", ["-Command", psCommand], { shell: true });
		} else {
			spawnSync("notify-send", [title, message], { shell: true });
		}
		return true;
	} catch (err) {
		console.error("Failed to show notification:", err.message);
		return false;
	}
}

if (!acquireLock()) {
	console.warn("Another task is already running, skipping:", task.name);
	process.exit(0);
}

const startTime = Date.now();

try {
	const piBin = ${JSON.stringify(piBin)};
	const now = new Date();

	console.log(\`[\${now.toISOString()}] Running task: \${task.name}\`);

	let output = "";
	let exitCode = 0;
	let savedPath = null;

	try {
		const resolvedPrompt = resolvePrompt(task.prompt);
		const result = spawnSync(piBin, ["-p", resolvedPrompt], {
			timeout: 300000,
			maxBuffer: 10 * 1024 * 1024,
			encoding: "utf-8",
			shell: true,
		});

		if (result.error) {
			if (result.error.killed) {
				output = "(task timed out after 300s)";
				exitCode = -1;
			} else {
				output = "(execution error: " + result.error.message + ")";
				exitCode = 1;
			}
		} else {
			output = (result.stdout || "").trim() || (result.stderr || "").trim() || "(no output)";
			exitCode = result.status ?? 1;
		}

		console.log(output);

		if (task.outputToObsidian && output !== "(no output)") {
			savedPath = saveToObsidian(output, task, now);
			if (savedPath) {
				console.log("Output saved to Obsidian:", savedPath);
			}
		}
	} catch (err) {
		console.error("Task execution failed:", err.message);
		exitCode = 1;
	}

	const endTime = Date.now();
	addToHistory({
		taskId,
		taskName: task.name,
		timestamp: now.toISOString(),
		status: exitCode === 0 ? "success" : "failed",
		exitCode,
		output: output.slice(0, 1000),
		durationMs: endTime - startTime,
	});

	if (task.notifyOnComplete !== false) {
		const title = "Pi Agent - Task Completed";
		const message = exitCode === 0
			? \`\${task.name} completed successfully\${savedPath ? '\\nSaved to: ' + savedPath.split(/[/\\\\]/).pop() : ''}\`
			: \`\${task.name} failed (code: \${exitCode})\`;
		showNotification(title, message);
	}

	releaseLock();
	process.exit(exitCode);
} catch (err) {
	releaseLock();
	console.error("Fatal error:", err.message);
	process.exit(1);
}
`;

	const needsWrite = !existsSync(RUNNER_SCRIPT) || readFileSync(RUNNER_SCRIPT, "utf-8") !== script;

	if (needsWrite) {
		writeFileSync(RUNNER_SCRIPT, script, "utf-8");
	}

	if (isWindows) {
		const nodePath = process.execPath;
		const bat = `@echo off\n"${nodePath}" "${RUNNER_SCRIPT}" %1\n`;
		const batNeedsWrite = !existsSync(RUNNER_BAT) || readFileSync(RUNNER_BAT, "utf-8") !== bat;

		if (batNeedsWrite) {
			writeFileSync(RUNNER_BAT, bat, "utf-8");
		}
	}
}

const CRON_DAY_MAP: Record<string, string> = {
	"0": "SUN",
	"7": "SUN",
	"1": "MON",
	"2": "TUE",
	"3": "WED",
	"4": "THU",
	"5": "FRI",
	"6": "SAT",
};

function isNumeric(s: string): boolean {
	return /^\d+$/.test(s);
}

function expandDayRange(dayExpr: string): string | null {
	if (dayExpr.includes("-")) {
		const [start, end] = dayExpr.split("-").map(Number);
		if (Number.isNaN(start) || Number.isNaN(end)) return null;
		const days: string[] = [];
		for (let i = start; i <= end; i++) {
			const name = CRON_DAY_MAP[String(i)];
			if (!name) return null;
			days.push(name);
		}
		return days.join(",");
	}

	if (dayExpr.includes(",")) {
		const parts = dayExpr.split(",").map((p) => CRON_DAY_MAP[p.trim()]);
		if (parts.some((p) => !p)) return null;
		return parts.join(",");
	}

	const name = CRON_DAY_MAP[dayExpr];
	return name || null;
}

interface SchtasksConfig {
	schedule: string;
	modifier?: string;
	days?: string;
	dayOfMonth?: string;
	startTime: string;
}

function parseCronForWindows(cron: string): SchtasksConfig | { error: string } {
	const parts = cron.trim().split(/\s+/);
	if (parts.length !== 5) {
		return { error: `Invalid cron expression: "${cron}"` };
	}

	const [minute, hour, dayOfMonth, month, dayOfWeek] = parts;

	if (minute.startsWith("*/") && hour === "*" && dayOfMonth === "*" && month === "*" && dayOfWeek === "*") {
		const interval = minute.slice(2);
		return { schedule: "MINUTE", modifier: interval, startTime: "00:00" };
	}

	if (isNumeric(minute) && hour.startsWith("*/") && dayOfMonth === "*" && month === "*" && dayOfWeek === "*") {
		const interval = hour.slice(2);
		return { schedule: "HOURLY", modifier: interval, startTime: `${minute.padStart(2, "0")}:00` };
	}

	if (isNumeric(minute) && isNumeric(hour) && dayOfMonth === "*" && month === "*" && dayOfWeek === "*") {
		return { schedule: "DAILY", startTime: `${hour.padStart(2, "0")}:${minute.padStart(2, "0")}` };
	}

	if (isNumeric(minute) && isNumeric(hour) && dayOfMonth === "*" && month === "*" && dayOfWeek !== "*") {
		const days = expandDayRange(dayOfWeek);
		if (!days) {
			return { error: `Cannot convert day-of-week "${dayOfWeek}" to Windows schedule. Use 0-6 or ranges like 1-5.` };
		}
		return { schedule: "WEEKLY", days, startTime: `${hour.padStart(2, "0")}:${minute.padStart(2, "0")}` };
	}

	if (isNumeric(minute) && isNumeric(hour) && isNumeric(dayOfMonth) && month === "*" && dayOfWeek === "*") {
		return { schedule: "MONTHLY", dayOfMonth, startTime: `${hour.padStart(2, "0")}:${minute.padStart(2, "0")}` };
	}

	return {
		error: `Cannot convert cron "${cron}" to Windows Task Scheduler. Supported patterns:\n- "*/5 * * * *" (every N minutes)\n- "0 */2 * * *" (every N hours)\n- "0 9 * * *" (daily at 9:00)\n- "0 9 * * 1-5" (weekdays at 9:00)\n- "0 9 * * 1" (weekly on Monday at 9:00)\n- "0 9 1 * *" (monthly on 1st at 9:00)`,
	};
}

async function syncWindowsTasks(tasks: ScheduledTask[]): Promise<{ success: boolean; message: string }> {
	const { execFile } = await import("node:child_process");
	const { promisify } = await import("node:util");
	const execFileAsync = promisify(execFile);

	const enabledTasks = tasks.filter((t) => t.enabled);
	const enabledIds = new Set(enabledTasks.map((t) => `PiScheduler_${t.id}`));
	const nodePath = process.execPath;
	const batPath = RUNNER_BAT;

	let piTaskNames: string[] = [];
	try {
		const { stdout: queryOutput } = await execFileAsync("schtasks", ["/query", "/fo", "LIST", "/v"]).catch(() => ({
			stdout: "",
			stderr: "",
		}));

		const lines = queryOutput.split("\n");
		for (const line of lines) {
			if (line.includes("PiScheduler_")) {
				const match = line.match(/PiScheduler_\S+/);
				if (match) piTaskNames.push(match[0]);
			}
		}
	} catch {
		// ignore query errors
	}

	for (const taskName of piTaskNames) {
		if (!enabledIds.has(taskName)) {
			await execFileAsync("schtasks", ["/delete", "/tn", taskName, "/f"]).catch(() => {});
		}
	}

	const results: string[] = [];
	let failCount = 0;

	for (const task of enabledTasks) {
		const config = parseCronForWindows(task.cron);
		if ("error" in config) {
			results.push(`  ✗ "${task.name}": ${config.error}`);
			failCount++;
			continue;
		}

		const taskName = `PiScheduler_${task.id}`;
		const args = ["/create", "/tn", taskName, "/f"];

		if (batPath && existsSync(batPath)) {
			args.push("/tr", `${batPath} ${task.id}`);
		} else {
			args.push("/tr", `"${nodePath}" "${RUNNER_SCRIPT}" ${task.id}`);
		}

		args.push("/sc", config.schedule);

		if (config.modifier) {
			args.push("/mo", config.modifier);
		}
		if (config.days) {
			args.push("/d", config.days);
		}
		if (config.dayOfMonth) {
			args.push("/d", config.dayOfMonth);
		}

		args.push("/st", config.startTime);

		try {
			await execFileAsync("schtasks", args);
			results.push(`  ✓ "${task.name}" → ${config.schedule} at ${config.startTime}`);
		} catch (err: any) {
			results.push(`  ✗ "${task.name}": ${err.message}`);
			failCount++;
		}
	}

	if (failCount > 0) {
		return {
			success: false,
			message: `Windows Task Scheduler sync (${enabledTasks.length - failCount}/${enabledTasks.length} succeeded):\n${results.join("\n")}\n\nNote: schtasks may require administrator privileges. Try running as admin if tasks fail to create.`,
		};
	}

	return {
		success: true,
		message: `Synced ${enabledTasks.length} task(s) to Windows Task Scheduler:\n${results.join("\n")}`,
	};
}

async function syncCrontabTasks(tasks: ScheduledTask[]): Promise<{ success: boolean; message: string }> {
	const enabledTasks = tasks.filter((t) => t.enabled);
	const nodePath = process.execPath;
	const runnerPath = RUNNER_SCRIPT;

	const cronLines = enabledTasks.map((task) => {
		return `${task.cron} ${nodePath} ${runnerPath} ${task.id} # pi-scheduler:${task.name}`;
	});

	const { execFile } = await import("node:child_process");
	const { promisify } = await import("node:util");
	const execFileAsync = promisify(execFile);

	try {
		const { stdout: currentCrontab } = await execFileAsync("crontab", ["-l"]).catch(() => ({
			stdout: "",
			stderr: "",
		}));

		const existingLines = currentCrontab
			.split("\n")
			.filter((line: string) => !line.includes("# pi-scheduler:"));

		const newCrontab = [...existingLines, ...cronLines].filter(Boolean).join("\n") + "\n";

		const { tmpdir } = await import("node:os");
		const tempFile = join(tmpdir(), `pi-crontab-${Date.now()}`);
		writeFileSync(tempFile, newCrontab);

		try {
			await execFileAsync("crontab", [tempFile]);
		} finally {
			try { unlinkSync(tempFile); } catch {}
		}

		return {
			success: true,
			message: `Synced ${enabledTasks.length} task(s) to crontab`,
		};
	} catch (err: any) {
		return {
			success: false,
			message: `Failed to sync crontab: ${err.message}. You may need to install cron or grant permissions.`,
		};
	}
}

async function syncScheduledTasks(tasks: ScheduledTask[]): Promise<{ success: boolean; message: string }> {
	if (isWindows) {
		return syncWindowsTasks(tasks);
	}
	return syncCrontabTasks(tasks);
}

export default function (pi: ExtensionAPI) {
	const rawBin = process.env.PI_BIN || "pi";
	const piBin = isWindows && !rawBin.endsWith(".cmd") && !rawBin.endsWith(".exe") && !rawBin.includes("/") && !rawBin.includes("\\")
		? rawBin + ".cmd"
		: rawBin;
	ensureRunnerScript(piBin);

	pi.registerTool({
		name: "scheduler_create",
		label: "Create Scheduled Task",
		description: "Create a scheduled task that runs automatically at specified times.",
		promptSnippet: "create a scheduled task that runs automatically",
		promptGuidelines: [
			"Use scheduler_create when the user wants to set up recurring automated tasks",
			"Cron format: minute hour day-of-month month day-of-week",
			"obsidian_weekly_folder sets the folder for weekly notes (default: 40-Life/weekly)",
		],
		parameters: Type.Object({
			name: Type.String({ description: "Human-readable task name" }),
			cron: Type.String({ description: "Cron expression (5 fields)" }),
			prompt: Type.String({ description: "The prompt that pi will execute" }),
			output_to_obsidian: Type.Optional(Type.Boolean({ description: "Save output to Obsidian" })),
			obsidian_category: Type.Optional(Type.String({ description: "Obsidian category" })),
			obsidian_output_format: Type.Optional(Type.String({ description: "Output format", enum: ["daily", "weekly", "custom", "daily-visual", "weekly-visual"] })),
			obsidian_output_path: Type.Optional(Type.String({ description: "Custom output path" })),
			obsidian_weekly_folder: Type.Optional(Type.String({ description: "Weekly notes folder (default: 40-Life/weekly)" })),
			notify_on_complete: Type.Optional(Type.Boolean({ description: "Show notification" })),
		}),
		async execute(_id, params) {
			const tasks = loadTasks();

			const existing = tasks.find((t) => t.name === params.name);
			if (existing) {
				return { content: [{ type: "text", text: `Task "${params.name}" already exists.` }], isError: true };
			}

			const cronParts = params.cron.trim().split(/\s+/);
			if (cronParts.length !== 5) {
				return { content: [{ type: "text", text: `Invalid cron expression: "${params.cron}". Must have 5 fields.` }], isError: true };
			}

			if (isWindows) {
				const config = parseCronForWindows(params.cron);
				if ("error" in config) {
					return { content: [{ type: "text", text: `Cron not supported on Windows: ${config.error}` }], isError: true };
				}
			}

			const task: ScheduledTask = {
				id: generateId(),
				name: params.name,
				cron: params.cron,
				prompt: params.prompt,
				outputToObsidian: params.output_to_obsidian ?? false,
				obsidianCategory: params.obsidian_category || "work",
				obsidianOutputFormat: (params.obsidian_output_format as any) || "daily",
				obsidianOutputPath: params.obsidian_output_path,
				obsidianWeeklyFolder: params.obsidian_weekly_folder,
				notifyOnComplete: params.notify_on_complete ?? true,
				enabled: true,
				createdAt: new Date().toISOString(),
			};

			tasks.push(task);
			saveTasks(tasks);

			const syncResult = await syncScheduledTasks(tasks);

			return {
				content: [{
					type: "text",
					text: `Task created: "${task.name}" (ID: ${task.id})\nSchedule: ${task.cron}\n${syncResult.message}`,
				}],
			};
		},
	});

	pi.registerTool({
		name: "scheduler_list",
		label: "List Scheduled Tasks",
		description: "List all scheduled tasks.",
		promptSnippet: "list all scheduled tasks",
		parameters: Type.Object({}),
		async execute(_id, _params) {
			const tasks = loadTasks();

			if (tasks.length === 0) {
				return { content: [{ type: "text", text: "No scheduled tasks." }] };
			}

			const lines = tasks.map((task) => {
				const status = task.enabled ? "✅" : "⏸️";
				const obsidian = task.outputToObsidian ? ` → Obsidian(${task.obsidianCategory})` : "";
				const notify = task.notifyOnComplete !== false ? " 🔔" : "";
				return `${status} [${task.id}] ${task.name}${notify}\n   Schedule: ${task.cron}\n   Prompt: ${task.prompt.slice(0, 80)}${task.prompt.length > 80 ? "..." : ""}${obsidian}`;
			});

			return { content: [{ type: "text", text: `Scheduled Tasks (${tasks.length}):\n\n${lines.join("\n\n")}` }] };
		},
	});

	pi.registerTool({
		name: "scheduler_delete",
		label: "Delete Scheduled Task",
		description: "Delete a scheduled task.",
		parameters: Type.Object({ identifier: Type.String({ description: "Task name or ID" }) }),
		async execute(_id, params) {
			const tasks = loadTasks();
			const index = tasks.findIndex((t) => t.id === params.identifier || t.name === params.identifier);

			if (index === -1) {
				return { content: [{ type: "text", text: `Task not found.` }], isError: true };
			}

			const removed = tasks.splice(index, 1)[0];
			saveTasks(tasks);
			const syncResult = await syncScheduledTasks(tasks);

			return { content: [{ type: "text", text: `Deleted task: "${removed.name}"\n${syncResult.message}` }] };
		},
	});

	pi.registerTool({
		name: "scheduler_run",
		label: "Run Scheduled Task",
		description: "Run a scheduled task immediately.",
		promptSnippet: "run a scheduled task now",
		parameters: Type.Object({ identifier: Type.String({ description: "Task name or ID" }) }),
		async execute(_id, params, _signal, onUpdate) {
			const tasks = loadTasks();
			const task = tasks.find((t) => t.id === params.identifier || t.name === params.identifier);

			if (!task) {
				return { content: [{ type: "text", text: `Task not found.` }], isError: true };
			}

			if (!acquireLock()) {
				return { content: [{ type: "text", text: "Another task is already running." }], isError: true };
			}

			onUpdate?.({ content: [{ type: "text", text: `Running task: ${task.name}...` }] });

			const startTime = Date.now();

			try {
				const { spawnSync } = await import("node:child_process");
				const resolvedPrompt = resolvePrompt(task.prompt);
				const result = spawnSync(piBin, ["-p", resolvedPrompt], {
					timeout: 300000,
					maxBuffer: 10 * 1024 * 1024,
					encoding: "utf-8",
					shell: isWindows,
				});

				let output: string;
				let exitCode: number;

				if (result.error) {
					if (result.error.killed) {
						output = "(task timed out after 300s)";
						exitCode = -1;
					} else {
						output = `(execution error: ${result.error.message})`;
						exitCode = 1;
					}
				} else {
					output = (result.stdout || "").trim() || (result.stderr || "").trim() || "(no output)";
					exitCode = result.status ?? 1;
				}
				const now = new Date();
				const endTime = Date.now();

				let resultMessage = `Task "${task.name}" completed (exit code: ${exitCode}):\n\n${output.slice(0, 3000)}`;
				let savedPath: string | null = null;

				if (task.outputToObsidian && output !== "(no output)") {
					savedPath = saveToObsidian(output, task, now);
					if (savedPath) {
						resultMessage += `\n\nOutput saved to: ${savedPath}`;
					}
				}

				addToHistory({
					taskId: task.id,
					taskName: task.name,
					timestamp: now.toISOString(),
					status: exitCode === 0 ? "success" : "failed",
					exitCode,
					output: output.slice(0, 1000),
					durationMs: endTime - startTime,
				});

				releaseLock();
				return { content: [{ type: "text", text: resultMessage }], isError: exitCode !== 0 };
			} catch (err: any) {
				releaseLock();
				return { content: [{ type: "text", text: `Task failed: ${err.message}` }], isError: true };
			}
		},
	});

	pi.registerTool({
		name: "scheduler_toggle",
		label: "Toggle Scheduled Task",
		description: "Enable or disable a task.",
		parameters: Type.Object({
			identifier: Type.String({ description: "Task name or ID" }),
			enabled: Type.Boolean({ description: "true to enable, false to disable" }),
		}),
		async execute(_id, params) {
			const tasks = loadTasks();
			const task = tasks.find((t) => t.id === params.identifier || t.name === params.identifier);

			if (!task) {
				return { content: [{ type: "text", text: `Task not found.` }], isError: true };
			}

			task.enabled = params.enabled;
			saveTasks(tasks);
			const syncResult = await syncScheduledTasks(tasks);

			return { content: [{ type: "text", text: `Task "${task.name}" ${params.enabled ? "enabled" : "disabled"}.\n${syncResult.message}` }] };
		},
	});

	pi.registerTool({
		name: "scheduler_update",
		label: "Update Scheduled Task",
		description: "Update an existing task's fields.",
		parameters: Type.Object({
			identifier: Type.String({ description: "Task name or ID" }),
			name: Type.Optional(Type.String({ description: "New name" })),
			cron: Type.Optional(Type.String({ description: "New cron" })),
			prompt: Type.Optional(Type.String({ description: "New prompt" })),
			output_to_obsidian: Type.Optional(Type.Boolean()),
			obsidian_category: Type.Optional(Type.String()),
			obsidian_output_format: Type.Optional(Type.String({ enum: ["daily", "weekly", "custom", "daily-visual", "weekly-visual"] })),
			obsidian_output_path: Type.Optional(Type.String()),
			obsidian_weekly_folder: Type.Optional(Type.String()),
			notify_on_complete: Type.Optional(Type.Boolean()),
			enabled: Type.Optional(Type.Boolean()),
		}),
		async execute(_id, params) {
			const tasks = loadTasks();
			const task = tasks.find((t) => t.id === params.identifier || t.name === params.identifier);

			if (!task) {
				return { content: [{ type: "text", text: `Task not found.` }], isError: true };
			}

			if (params.name !== undefined) task.name = params.name;
			if (params.cron !== undefined) {
				const cronParts = params.cron.trim().split(/\s+/);
				if (cronParts.length !== 5) {
					return { content: [{ type: "text", text: `Invalid cron.` }], isError: true };
				}
				if (isWindows) {
					const config = parseCronForWindows(params.cron);
					if ("error" in config) {
						return { content: [{ type: "text", text: `Cron not supported.` }], isError: true };
					}
				}
				task.cron = params.cron;
			}
			if (params.prompt !== undefined) task.prompt = params.prompt;
			if (params.output_to_obsidian !== undefined) task.outputToObsidian = params.output_to_obsidian;
			if (params.obsidian_category !== undefined) task.obsidianCategory = params.obsidian_category;
			if (params.obsidian_output_format !== undefined) task.obsidianOutputFormat = params.obsidian_output_format as any;
			if (params.obsidian_output_path !== undefined) task.obsidianOutputPath = params.obsidian_output_path;
			if (params.obsidian_weekly_folder !== undefined) task.obsidianWeeklyFolder = params.obsidian_weekly_folder;
			if (params.notify_on_complete !== undefined) task.notifyOnComplete = params.notify_on_complete;
			if (params.enabled !== undefined) task.enabled = params.enabled;

			saveTasks(tasks);
			const syncResult = await syncScheduledTasks(tasks);

			return { content: [{ type: "text", text: `Task "${task.name}" updated.\n${syncResult.message}` }] };
		},
	});

	pi.registerTool({
		name: "scheduler_history",
		label: "Task Execution History",
		description: "View recent task execution history.",
		promptSnippet: "view task execution history",
		parameters: Type.Object({
			limit: Type.Optional(Type.Number({ description: "Number of records (default: 20)" })),
			task_id: Type.Optional(Type.String({ description: "Filter by task ID" })),
		}),
		async execute(_id, params) {
			if (!existsSync(HISTORY_FILE)) {
				return { content: [{ type: "text", text: "No execution history yet." }] };
			}

			let histories: TaskHistory[] = JSON.parse(readFileSync(HISTORY_FILE, "utf-8"));

			if (params.task_id) {
				histories = histories.filter((h) => h.taskId === params.task_id);
			}

			const limit = params.limit || 20;
			histories = histories.slice(0, limit);

			if (histories.length === 0) {
				return { content: [{ type: "text", text: "No matching history records." }] };
			}

			const lines = histories.map((h) => {
				const status = h.status === "success" ? "✅" : "❌";
				const time = new Date(h.timestamp).toLocaleString("zh-CN");
				const duration = `${h.durationMs}ms`;
				return `${status} ${h.taskName} @ ${time}\n   Duration: ${duration}, Exit: ${h.exitCode}${h.output ? `\n   Output: ${h.output.slice(0, 100)}${h.output.length > 100 ? "..." : ""}` : ""}`;
			});

			return { content: [{ type: "text", text: `Task Execution History (${histories.length}):\n\n${lines.join("\n\n")}` }] };
		},
	});

	pi.registerCommand("tasks", {
		description: "Manage scheduled tasks",
		async handler(args, ctx) {
			const tasks = loadTasks();
			if (tasks.length === 0) {
				ctx.ui.notify("No scheduled tasks.", "info");
				return;
			}

			const options = tasks.map((t) => `${t.enabled ? "✅" : "⏸️"} ${t.name} (${t.cron})`);
			options.push("View History");
			options.push("↩ Cancel");

			const choice = await ctx.ui.select("Scheduled Tasks", options);
			if (!choice || choice === "↩ Cancel") return;

			if (choice === "View History") {
				pi.sendUserMessage("Show task execution history");
				return;
			}

			const taskIndex = options.indexOf(choice);
			const task = tasks[taskIndex];

			const action = await ctx.ui.select(`Task: ${task.name}`, ["Run now", task.enabled ? "Disable" : "Enable", "Delete", "Cancel"]);

			if (action === "Run now") {
				pi.sendUserMessage(`Run scheduled task "${task.name}" now`);
			} else if (action === "Disable" || action === "Enable") {
				task.enabled = !task.enabled;
				saveTasks(tasks);
				await syncScheduledTasks(tasks);
				ctx.ui.notify(`Task "${task.name}" ${task.enabled ? "enabled" : "disabled"}`, "info");
			} else if (action === "Delete") {
				const confirm = await ctx.ui.confirm("Delete task?", `Are you sure you want to delete "${task.name}"?`);
				if (confirm) {
					tasks.splice(taskIndex, 1);
					saveTasks(tasks);
					await syncScheduledTasks(tasks);
					ctx.ui.notify(`Task "${task.name}" deleted`, "info");
				}
			}
		},
	});
}

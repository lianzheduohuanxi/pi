import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "@earendil-works/pi-ai";
import {
	readFileSync,
	writeFileSync,
	existsSync,
	mkdirSync,
	unlinkSync,
	readdirSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { homedir } from "node:os";

const isWindows = process.platform === "win32";
const SCHEDULER_DIR = join(homedir(), ".pi", "agent", "scheduler");
const TASKS_FILE = join(SCHEDULER_DIR, "tasks.json");
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
	obsidianOutputFormat?: "daily" | "weekly" | "custom";
	obsidianOutputPath?: string;
	notifyOnComplete?: boolean;
	enabled: boolean;
	createdAt: string;
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

function getWeekNumber(date: Date): { year: number; week: number } {
	const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
	const dayNum = d.getUTCDay() || 7;
	d.setUTCDate(d.getUTCDate() + 4 - dayNum);
	const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
	const week = Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
	return { year: d.getUTCFullYear(), week };
}

function ensureRunnerScript(piBin: string): void {
	mkdirSync(SCHEDULER_DIR, { recursive: true });

	const script = `import { readFileSync, appendFileSync, existsSync, mkdirSync, writeFileSync, readdirSync, unlinkSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir, platform } from "node:os";
import { spawnSync } from "node:child_process";

const tasksFile = join(homedir(), ".pi", "agent", "scheduler", "tasks.json");
const lockFile = join(homedir(), ".pi", "agent", "scheduler", ".lock");
const taskId = process.argv[2];

if (!taskId) {
  console.error("Usage: node run-task.mjs <task-id>");
  process.exit(1);
}

let tasks;
try {
  tasks = JSON.parse(readFileSync(tasksFile, "utf-8"));
} catch {
  console.error("Cannot read tasks file:", tasksFile);
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

function acquireLock() {
  try {
    if (existsSync(lockFile)) {
      const lockTime = parseInt(readFileSync(lockFile, "utf-8"));
      if (Date.now() - lockTime < 300000) {
        return false;
      }
    }
    writeFileSync(lockFile, Date.now().toString(), "utf-8");
    return true;
  } catch {
    return false;
  }
}

function releaseLock() {
  try {
    if (existsSync(lockFile)) {
      unlinkSync(lockFile);
    }
  } catch {}
}

function getWeekNumber(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  return { year: d.getUTCFullYear(), week };
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

try {
  const piBin = ${JSON.stringify(piBin)};
  const now = new Date();
  const date = now.toISOString().split("T")[0];
  const timestamp = now.toISOString();

  console.log(\`[\${timestamp}] Running task: \${task.name}\`);

  let output = "";
  let exitCode = 0;
  let savedPath = "";

  const tmpPromptFile = join(homedir(), ".pi", "agent", "scheduler", "_tmp_prompt_" + taskId + ".txt");
  try {
    writeFileSync(tmpPromptFile, task.prompt, "utf-8");
    const result = spawnSync(piBin, ["-p", "@" + tmpPromptFile], {
      timeout: 300000,
      maxBuffer: 10 * 1024 * 1024,
      encoding: "utf-8",
      shell: true,
    });

    output = (result.stdout || "").trim() || (result.stderr || "").trim() || "(no output)";
    exitCode = result.status || 0;

    console.log(output);

    if (task.outputToObsidian && output !== "(no output)") {
      const configPath = join(homedir(), ".pi", "agent", "obsidian-config.json");
      let vaultPath = join(homedir(), "obsidian-vault");
      let dailyFolder = "Daily Notes";
      let category = task.obsidianCategory || "work";
      let outputFormat = task.obsidianOutputFormat || "daily";
      let customPath = task.obsidianOutputPath || "";

      try {
        const config = JSON.parse(readFileSync(configPath, "utf-8"));
        vaultPath = config.vaultPath || vaultPath;
        dailyFolder = config.dailyNoteFolder || dailyFolder;
        const catConfig = config.categories?.[category];
        if (catConfig) category = catConfig.label;
      } catch {}

      let outputPath;

      if (outputFormat === "daily") {
        outputPath = join(vaultPath, dailyFolder, \`\${date}.md\`);
      } else if (outputFormat === "weekly") {
        const { year, week } = getWeekNumber(now);
        const weekStr = week.toString().padStart(2, "0");
        const weeklyFolder = join(vaultPath, "40-Life", "weekly", year.toString());
        outputPath = join(weeklyFolder, \`\${year}-W\${weekStr}.md\`);
      } else if (outputFormat === "custom" && customPath) {
        const actualPath = customPath.replace(/YYYY-MM-DD/g, date).replace(/YYYY/g, date.slice(0, 4)).replace(/MM/g, date.slice(5, 7)).replace(/DD/g, date.slice(8, 10));
        outputPath = join(vaultPath, actualPath);
      }

      if (outputPath) {
        savedPath = outputPath;
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
            else if (sectionIdx !== -1 && lines[i].startsWith("## ")) { nextIdx = i; break; }
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
        console.log("Output saved to Obsidian:", outputPath);
      }
    }
  } catch (err) {
    console.error("Task execution failed:", err.message);
    exitCode = 1;
  } finally {
    try { if (existsSync(tmpPromptFile)) unlinkSync(tmpPromptFile); } catch {}
  }

  if (task.notifyOnComplete !== false) {
    const title = "Pi Agent - Task Completed";
    const message = exitCode === 0 
      ? \`\\\${task.name} completed successfully\${savedPath ? '\\nSaved to: ' + savedPath.split('\\\\').pop() : ''}\`
      : \`\\\${task.name} failed (code: \\\${exitCode})\`;
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

	const needsWrite = !existsSync(RUNNER_SCRIPT) ||
		readFileSync(RUNNER_SCRIPT, "utf-8") !== script;

	if (needsWrite) {
		writeFileSync(RUNNER_SCRIPT, script, "utf-8");
	}

	if (isWindows) {
		const nodePath = process.execPath;
		const bat = `@echo off
"${nodePath}" "${RUNNER_SCRIPT}" %1
`;
		const batNeedsWrite = !existsSync(RUNNER_BAT) ||
			readFileSync(RUNNER_BAT, "utf-8") !== bat;

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
		return { schedule: "HOURLY", modifier: interval, startTime: `00:${minute.padStart(2, "0")}` };
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
		description:
			"Create a scheduled task that runs automatically at specified times. The task will execute a pi prompt and optionally save results to Obsidian.",
		promptSnippet: "create a scheduled task that runs automatically",
		promptGuidelines: [
			"Use scheduler_create when the user wants to set up recurring automated tasks",
			"Cron format: minute hour day-of-month month day-of-week (e.g., '0 9 * * *' = every day at 9:00)",
			"Common patterns: '0 9 * * *' daily 9am, '0 9 * * 1-5' weekdays 9am, '0 20 * * *' daily 8pm",
			"For weekly journals, set obsidian_output_format to 'weekly'",
		],
		parameters: Type.Object({
			name: Type.String({ description: "Human-readable task name" }),
			cron: Type.String({
				description:
					"Cron expression (5 fields: minute hour day-of-month month day-of-week). E.g., '0 9 * * *' for daily at 9:00",
			}),
			prompt: Type.String({
				description: "The prompt that pi will execute when the task runs",
			}),
			output_to_obsidian: Type.Optional(
				Type.Boolean({
					description: "Save task output to Obsidian note (default: false)",
				}),
			),
			obsidian_category: Type.Optional(
				Type.String({
					description: "Obsidian category for output (default: work)",
				}),
			),
			obsidian_output_format: Type.Optional(
				Type.String({
					description: "Output format: 'daily' (default), 'weekly', or 'custom'",
					enum: ["daily", "weekly", "custom"],
				}),
			),
			obsidian_output_path: Type.Optional(
				Type.String({
					description: "Custom output path (only when using 'custom' format)",
				}),
			),
			notify_on_complete: Type.Optional(
				Type.Boolean({
					description: "Show system notification when task completes (default: true)",
				}),
			),
		}),
		async execute(_id, params) {
			const tasks = loadTasks();

			const existing = tasks.find((t) => t.name === params.name);
			if (existing) {
				return {
					content: [
						{
							type: "text",
							text: `Task "${params.name}" already exists (ID: ${existing.id}). Use scheduler_delete first or choose a different name.`,
						},
					],
					isError: true,
				};
			}

			const cronParts = params.cron.trim().split(/\s+/);
			if (cronParts.length !== 5) {
				return {
					content: [
						{
							type: "text",
							text: `Invalid cron expression: "${params.cron}". Must have 5 fields: minute hour day-of-month month day-of-week\nExamples:\n- "0 9 * * *" = every day at 9:00\n- "30 8 * * 1-5" = weekdays at 8:30\n- "0 20 * * *" = every day at 20:00`,
						},
					],
					isError: true,
				};
			}

			if (isWindows) {
				const config = parseCronForWindows(params.cron);
				if ("error" in config) {
					return {
						content: [
							{
								type: "text",
								text: `This cron expression is not supported on Windows: ${config.error}`,
							},
						],
						isError: true,
					};
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
				notifyOnComplete: params.notify_on_complete ?? true,
				enabled: true,
				createdAt: new Date().toISOString(),
			};

			tasks.push(task);
			saveTasks(tasks);

			const syncResult = await syncScheduledTasks(tasks);

			const formatInfo = task.outputToObsidian ? 
				`\nOutput format: ${task.obsidianOutputFormat || "daily"}${task.obsidianOutputFormat === "custom" ? ` (${task.obsidianOutputPath})` : ""}` : "";

			return {
				content: [
					{
						type: "text",
						text: `Task created: "${task.name}" (ID: ${task.id})\nSchedule: ${task.cron}\nPrompt: ${task.prompt.slice(0, 100)}${task.prompt.length > 100 ? "..." : ""}\nOutput to Obsidian: ${task.outputToObsidian ? `Yes (${task.obsidianCategory})${formatInfo}` : "No"}\n\n${syncResult.message}`,
					},
				],
			};
		},
	});

	pi.registerTool({
		name: "scheduler_list",
		label: "List Scheduled Tasks",
		description: "List all scheduled tasks with their status and schedule.",
		promptSnippet: "list all scheduled tasks",
		parameters: Type.Object({}),
		async execute(_id, _params) {
			const tasks = loadTasks();

			if (tasks.length === 0) {
				return {
					content: [
						{
							type: "text",
							text: "No scheduled tasks. Use scheduler_create to add one.",
						},
					],
				};
			}

			const lines = tasks.map((task) => {
				const status = task.enabled ? "✅" : "⏸️";
				const obsidian = task.outputToObsidian 
					? ` → Obsidian(${task.obsidianCategory}, format: ${task.obsidianOutputFormat || "daily"})` 
					: "";
				const notify = task.notifyOnComplete !== false ? " 🔔" : "";
				return `${status} [${task.id}] ${task.name}${notify}\n   Schedule: ${task.cron}\n   Prompt: ${task.prompt.slice(0, 80)}${task.prompt.length > 80 ? "..." : ""}${obsidian}`;
			});

			return {
				content: [
					{
						type: "text",
						text: `Scheduled Tasks (${tasks.length}):\n\n${lines.join("\n\n")}`,
					},
				],
			};
		},
	});

	pi.registerTool({
		name: "scheduler_delete",
		label: "Delete Scheduled Task",
		description: "Delete a scheduled task by name or ID.",
		parameters: Type.Object({
			identifier: Type.String({ description: "Task name or ID to delete" }),
		}),
		async execute(_id, params) {
			const tasks = loadTasks();
			const index = tasks.findIndex(
				(t) => t.id === params.identifier || t.name === params.identifier,
			);

			if (index === -1) {
				return {
					content: [
						{
							type: "text",
							text: `Task not found: "${params.identifier}". Use scheduler_list to see all tasks.`,
						},
					],
					isError: true,
				};
			}

			const removed = tasks.splice(index, 1)[0];
			saveTasks(tasks);

			const syncResult = await syncScheduledTasks(tasks);

			return {
				content: [
					{
						type: "text",
						text: `Deleted task: "${removed.name}" (${removed.id})\n${syncResult.message}`,
					},
				],
			};
		},
	});

	pi.registerTool({
		name: "scheduler_run",
		label: "Run Scheduled Task",
		description: "Run a scheduled task immediately, regardless of its schedule.",
		promptSnippet: "run a scheduled task now",
		parameters: Type.Object({
			identifier: Type.String({ description: "Task name or ID to run" }),
		}),
		async execute(_id, params, _signal, onUpdate, ctx) {
			const tasks = loadTasks();
			const task = tasks.find(
				(t) => t.id === params.identifier || t.name === params.identifier,
			);

			if (!task) {
				return {
					content: [
						{
							type: "text",
							text: `Task not found: "${params.identifier}". Use scheduler_list to see all tasks.`,
						},
					],
					isError: true,
				};
			}

			if (!acquireLock()) {
				return {
					content: [
						{
							type: "text",
							text: "Another task is already running. Please try again later.",
						},
					],
					isError: true,
				};
			}

			onUpdate?.({ content: [{ type: "text", text: `Running task: ${task.name}...` }] });

			const tmpPromptFile = join(SCHEDULER_DIR, `_tmp_prompt_${task.id}.txt`);
			try {
				const { spawnSync } = await import("node:child_process");
				writeFileSync(tmpPromptFile, task.prompt, "utf-8");
				const result = spawnSync(piBin, ["-p", "@" + tmpPromptFile], {
					timeout: 300000,
					maxBuffer: 10 * 1024 * 1024,
					encoding: "utf-8",
					shell: isWindows,
				});

				const output = (result.stdout || "").trim() || (result.stderr || "").trim() || "(no output)";
				const exitCode = result.status || 0;

				let resultMessage = `Task "${task.name}" completed (exit code: ${exitCode}):\n\n${output.slice(0, 3000)}`;

				if (task.outputToObsidian && output !== "(no output)") {
					const now = new Date();
					const date = now.toISOString().split("T")[0];
					const configPath = join(homedir(), ".pi", "agent", "obsidian-config.json");
					let vaultPath = join(homedir(), "obsidian-vault");
					let dailyFolder = "Daily Notes";
					let category = task.obsidianCategory || "work";
					let outputFormat = task.obsidianOutputFormat || "daily";
					let customPath = task.obsidianOutputPath || "";

					try {
						const config = JSON.parse(readFileSync(configPath, "utf-8"));
						vaultPath = config.vaultPath || vaultPath;
						dailyFolder = config.dailyNoteFolder || dailyFolder;
						const catConfig = config.categories?.[category];
						if (catConfig) category = catConfig.label;
					} catch {}

					let outputPath;

					if (outputFormat === "daily") {
						outputPath = join(vaultPath, dailyFolder, `${date}.md`);
					} else if (outputFormat === "weekly") {
						const { year, week } = getWeekNumber(now);
						const weekStr = week.toString().padStart(2, "0");
						const weeklyFolder = join(vaultPath, "40-Life", "weekly", year.toString());
						outputPath = join(weeklyFolder, `${year}-W${weekStr}.md`);
					} else if (outputFormat === "custom" && customPath) {
						const actualPath = customPath.replace(/YYYY-MM-DD/g, date).replace(/YYYY/g, date.slice(0, 4)).replace(/MM/g, date.slice(5, 7)).replace(/DD/g, date.slice(8, 10));
						outputPath = join(vaultPath, actualPath);
					}

					if (outputPath) {
						const outputDir = join(outputPath, "..");
						const sectionTitle = `## ${category}`;
						const entry = `- ${date}: ${output.slice(0, 2000)}\n`;

						if (existsSync(outputPath)) {
							const content = readFileSync(outputPath, "utf-8");
							const lines = content.split("\n");
							let sectionIdx = -1;
							let nextIdx = lines.length;
							for (let i = 0; i < lines.length; i++) {
								if (lines[i].trim() === sectionTitle) sectionIdx = i;
								else if (sectionIdx !== -1 && lines[i].startsWith("## ")) { nextIdx = i; break; }
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
						resultMessage += `\n\nOutput saved to: ${outputPath}`;
					}
				}

				releaseLock();

				return {
					content: [
						{
							type: "text",
							text: resultMessage,
						},
					],
					isError: exitCode !== 0,
				};
			} catch (err: any) {
				releaseLock();
				return {
					content: [
						{
							type: "text",
							text: `Task "${task.name}" failed: ${err.message}`,
						},
					],
					isError: true,
				};
			} finally {
				try { if (existsSync(tmpPromptFile)) unlinkSync(tmpPromptFile); } catch {}
			}
		},
	});

	pi.registerTool({
		name: "scheduler_toggle",
		label: "Toggle Scheduled Task",
		description: "Enable or disable a scheduled task without deleting it.",
		parameters: Type.Object({
			identifier: Type.String({ description: "Task name or ID" }),
			enabled: Type.Boolean({ description: "true to enable, false to disable" }),
		}),
		async execute(_id, params) {
			const tasks = loadTasks();
			const task = tasks.find(
				(t) => t.id === params.identifier || t.name === params.identifier,
			);

			if (!task) {
				return {
					content: [
						{
							type: "text",
							text: `Task not found: "${params.identifier}".`,
						},
					],
					isError: true,
				};
			}

			task.enabled = params.enabled;
			saveTasks(tasks);

			const syncResult = await syncScheduledTasks(tasks);

			return {
				content: [
					{
						type: "text",
						text: `Task "${task.name}" ${params.enabled ? "enabled" : "disabled"}.\n${syncResult.message}`,
					},
				],
			};
		},
	});

	pi.registerTool({
		name: "scheduler_update",
		label: "Update Scheduled Task",
		description: "Update an existing scheduled task's fields. Only provided fields will be changed.",
		parameters: Type.Object({
			identifier: Type.String({ description: "Task name or ID to update" }),
			name: Type.Optional(Type.String({ description: "New task name" })),
			cron: Type.Optional(Type.String({ description: "New cron expression" })),
			prompt: Type.Optional(Type.String({ description: "New prompt" })),
			output_to_obsidian: Type.Optional(Type.Boolean({ description: "Save output to Obsidian" })),
			obsidian_category: Type.Optional(Type.String({ description: "Obsidian category" })),
			obsidian_output_format: Type.Optional(
				Type.String({
					description: "Output format: 'daily', 'weekly', or 'custom'",
					enum: ["daily", "weekly", "custom"],
				}),
			),
			obsidian_output_path: Type.Optional(Type.String({ description: "Custom output path" })),
			notify_on_complete: Type.Optional(Type.Boolean({ description: "Show notification on completion" })),
			enabled: Type.Optional(Type.Boolean({ description: "Enable or disable the task" })),
		}),
		async execute(_id, params) {
			const tasks = loadTasks();
			const task = tasks.find(
				(t) => t.id === params.identifier || t.name === params.identifier,
			);

			if (!task) {
				return {
					content: [{ type: "text", text: `Task not found: "${params.identifier}". Use scheduler_list to see all tasks.` }],
					isError: true,
				};
			}

			if (params.name !== undefined) task.name = params.name;
			if (params.cron !== undefined) {
				const cronParts = params.cron.trim().split(/\s+/);
				if (cronParts.length !== 5) {
					return {
						content: [{ type: "text", text: `Invalid cron expression: "${params.cron}". Must have 5 fields.` }],
						isError: true,
					};
				}
				if (isWindows) {
					const config = parseCronForWindows(params.cron);
					if ("error" in config) {
						return {
							content: [{ type: "text", text: `Cron not supported on Windows: ${config.error}` }],
							isError: true,
						};
					}
				}
				task.cron = params.cron;
			}
			if (params.prompt !== undefined) task.prompt = params.prompt;
			if (params.output_to_obsidian !== undefined) task.outputToObsidian = params.output_to_obsidian;
			if (params.obsidian_category !== undefined) task.obsidianCategory = params.obsidian_category;
			if (params.obsidian_output_format !== undefined) task.obsidianOutputFormat = params.obsidian_output_format as ScheduledTask["obsidianOutputFormat"];
			if (params.obsidian_output_path !== undefined) task.obsidianOutputPath = params.obsidian_output_path;
			if (params.notify_on_complete !== undefined) task.notifyOnComplete = params.notify_on_complete;
			if (params.enabled !== undefined) task.enabled = params.enabled;

			saveTasks(tasks);
			const syncResult = await syncScheduledTasks(tasks);

			return {
				content: [{
					type: "text",
					text: `Task "${task.name}" updated.\nSchedule: ${task.cron}\nPrompt: ${task.prompt.slice(0, 100)}${task.prompt.length > 100 ? "..." : ""}\n${syncResult.message}`,
				}],
			};
		},
	});

	pi.registerCommand("tasks", {
		description: "Manage scheduled tasks",
		async handler(args, ctx) {
			const tasks = loadTasks();
			if (tasks.length === 0) {
				ctx.ui.notify("No scheduled tasks. Use scheduler_create tool to add one.", "info");
				return;
			}

			const options = tasks.map(
				(t) => `${t.enabled ? "✅" : "⏸️"} ${t.name} (${t.cron})`,
			);
			options.push("↩ Cancel");

			const choice = await ctx.ui.select("Scheduled Tasks", options);
			if (!choice || choice === "↩ Cancel") return;

			const taskIndex = options.indexOf(choice);
			const task = tasks[taskIndex];

			const action = await ctx.ui.select(`Task: ${task.name}`, [
				"Run now",
				task.enabled ? "Disable" : "Enable",
				"Delete",
				"Cancel",
			]);

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

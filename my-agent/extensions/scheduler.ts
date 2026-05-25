import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "@earendil-works/pi-ai";
import {
	readFileSync,
	writeFileSync,
	existsSync,
	mkdirSync,
	unlinkSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { homedir } from "node:os";

const SCHEDULER_DIR = join(homedir(), ".pi", "agent", "scheduler");
const TASKS_FILE = join(SCHEDULER_DIR, "tasks.json");
const RUNNER_SCRIPT = join(SCHEDULER_DIR, "run-task.mjs");

interface ScheduledTask {
	id: string;
	name: string;
	cron: string;
	prompt: string;
	outputToObsidian?: boolean;
	obsidianCategory?: string;
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

function ensureRunnerScript(piBin: string): void {
	if (existsSync(RUNNER_SCRIPT)) return;
	mkdirSync(SCHEDULER_DIR, { recursive: true });

	const script = `#!/usr/bin/env node
import { readFileSync, appendFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { execSync } from "node:child_process";

const tasksFile = join(homedir(), ".pi", "agent", "scheduler", "tasks.json");
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

const piBin = ${JSON.stringify(piBin)};
const date = new Date().toISOString().split("T")[0];
const timestamp = new Date().toISOString();

console.log(\`[\${timestamp}] Running task: \${task.name}\`);

try {
  const output = execSync(
    \`\${piBin} -p \${JSON.stringify(task.prompt)} 2>&1\`,
    { timeout: 300000, maxBuffer: 10 * 1024 * 1024, shell: "/bin/bash" }
  ).toString().trim();

  console.log(output);

  if (task.outputToObsidian) {
    const configPath = join(homedir(), ".pi", "agent", "obsidian-config.json");
    let vaultPath = join(homedir(), "obsidian-vault");
    let dailyFolder = "Daily Notes";
    let category = task.obsidianCategory || "work";

    try {
      const config = JSON.parse(readFileSync(configPath, "utf-8"));
      vaultPath = config.vaultPath || vaultPath;
      dailyFolder = config.dailyNoteFolder || dailyFolder;
      const catConfig = config.categories?.[category];
      if (catConfig) category = catConfig.label;
    } catch {}

    const dailyPath = join(vaultPath, dailyFolder, \`\${date}.md\`);
    const sectionTitle = \`## \${category}\`;
    const entry = \`- \${output.slice(0, 500)}\\n\`;

    if (existsSync(dailyPath)) {
      const content = readFileSync(dailyPath, "utf-8");
      const lines = content.split("\\n");
      let sectionIdx = -1;
      let nextIdx = lines.length;
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].trim() === sectionTitle) sectionIdx = i;
        else if (sectionIdx !== -1 && lines[i].startsWith("## ")) { nextIdx = i; break; }
      }
      if (sectionIdx !== -1) {
        lines.splice(nextIdx, 0, entry);
        writeFileSync(dailyPath, lines.join("\\n"), "utf-8");
      } else {
        appendFileSync(dailyPath, \`\\n\${sectionTitle}\\n\\n\${entry}\`, "utf-8");
      }
    } else {
      mkdirSync(join(vaultPath, dailyFolder), { recursive: true });
      writeFileSync(dailyPath, \`# \${date}\\n\\n\${sectionTitle}\\n\\n\${entry}\`, "utf-8");
    }
    console.log("Output saved to Obsidian daily note");
  }
} catch (err) {
  console.error("Task execution failed:", err.message);
  process.exit(1);
}
`;

	writeFileSync(RUNNER_SCRIPT, script, "utf-8");
}

async function syncCrontab(tasks: ScheduledTask[]): Promise<{ success: boolean; message: string }> {
	const enabledTasks = tasks.filter((t) => t.enabled);
	const nodePath = process.execPath;
	const runnerPath = RUNNER_SCRIPT;

	const cronLines = enabledTasks.map((task) => {
		return `${task.cron} ${nodePath} ${runnerPath} ${task.id} # pi-scheduler:${task.name}`;
	});

	try {
		const { stdout } = await (globalThis as any).execResult?.();
	} catch {}

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

		const { writeFileSync: writeTemp } = await import("node:fs");
		const { tmpdir } = await import("node:os");
		const tempFile = join(tmpdir(), `pi-crontab-${Date.now()}`);
		writeTemp(tempFile, newCrontab);

		await execFileAsync("crontab", [tempFile]);
		unlinkSync(tempFile);

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

export default function (pi: ExtensionAPI) {
	const piBin = process.env.PI_BIN || "pi";
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
					description: "Save task output to Obsidian daily note (default: false)",
				}),
			),
			obsidian_category: Type.Optional(
				Type.String({
					description: "Obsidian category for output (default: work)",
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

			const task: ScheduledTask = {
				id: generateId(),
				name: params.name,
				cron: params.cron,
				prompt: params.prompt,
				outputToObsidian: params.output_to_obsidian ?? false,
				obsidianCategory: params.obsidian_category || "work",
				enabled: true,
				createdAt: new Date().toISOString(),
			};

			tasks.push(task);
			saveTasks(tasks);

			const syncResult = await syncCrontab(tasks);

			return {
				content: [
					{
						type: "text",
						text: `Task created: "${task.name}" (ID: ${task.id})\nSchedule: ${task.cron}\nPrompt: ${task.prompt.slice(0, 100)}${task.prompt.length > 100 ? "..." : ""}\nOutput to Obsidian: ${task.outputToObsidian ? `Yes (${task.obsidianCategory})` : "No"}\n\n${syncResult.message}`,
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
				const obsidian = task.outputToObsidian ? ` → Obsidian(${task.obsidianCategory})` : "";
				return `${status} [${task.id}] ${task.name}\n   Schedule: ${task.cron}\n   Prompt: ${task.prompt.slice(0, 80)}${task.prompt.length > 80 ? "..." : ""}${obsidian}`;
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

			const syncResult = await syncCrontab(tasks);

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

			onUpdate?.({ type: "text", text: `Running task: ${task.name}...` });

			try {
				const { stdout, stderr } = await pi.exec(piBin, [
					"-p",
					task.prompt,
				]);

				const output = stdout || stderr || "(no output)";
				return {
					content: [
						{
							type: "text",
							text: `Task "${task.name}" completed:\n\n${output.slice(0, 3000)}`,
						},
					],
				};
			} catch (err: any) {
				return {
					content: [
						{
							type: "text",
							text: `Task "${task.name}" failed: ${err.message}`,
						},
					],
					isError: true,
				};
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

			const syncResult = await syncCrontab(tasks);

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
				await syncCrontab(tasks);
				ctx.ui.notify(`Task "${task.name}" ${task.enabled ? "enabled" : "disabled"}`, "info");
			} else if (action === "Delete") {
				const confirm = await ctx.ui.confirm("Delete task?", `Are you sure you want to delete "${task.name}"?`);
				if (confirm) {
					tasks.splice(taskIndex, 1);
					saveTasks(tasks);
					await syncCrontab(tasks);
					ctx.ui.notify(`Task "${task.name}" deleted`, "info");
				}
			}
		},
	});
}

import { readFileSync, appendFileSync, existsSync, mkdirSync, writeFileSync, unlinkSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir, platform } from "node:os";
import { spawnSync } from "node:child_process";

const SCHEDULER_DIR = join(homedir(), ".pi", "agent", "scheduler");
const TASKS_FILE = join(SCHEDULER_DIR, "tasks.json");
const HISTORY_FILE = join(SCHEDULER_DIR, "history.json");
const LOCK_FILE = join(SCHEDULER_DIR, ".lock");
const PROMPTS_DIR = join(SCHEDULER_DIR, "prompts");
const PROMPT_FILE_THRESHOLD = {{PROMPT_FILE_THRESHOLD}};
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

if (!task.prompt && !task.promptFile && !task.script) {
	console.error("Task must have either 'prompt', 'promptFile', or 'script' field:", task.name);
	process.exit(1);
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

function resolveTemplate(str) {
	if (!str) return str;
	const now = new Date();
	const today = now.toISOString().split("T")[0];
	const yesterday = new Date(now.getTime() - 86400000).toISOString().split("T")[0];
	return str
		.replace(/{{today}}/gi, today)
		.replace(/{{yesterday}}/gi, yesterday)
		.replace(/{{date}}/gi, today);
}

function loadPromptFromFile(filePath) {
	const resolvedPath = filePath.startsWith("~")
		? join(homedir(), filePath.slice(1))
		: filePath;
	if (!existsSync(resolvedPath)) {
		throw new Error(`Prompt file not found: ${resolvedPath}`);
	}
	return readFileSync(resolvedPath, "utf-8");
}

function writePromptToTempFile(prompt) {
	if (!existsSync(PROMPTS_DIR)) {
		mkdirSync(PROMPTS_DIR, { recursive: true });
	}
	const tempPath = join(PROMPTS_DIR, `${taskId}-${Date.now()}.txt`);
	writeFileSync(tempPath, prompt, "utf-8");
	return tempPath;
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
	const entry = `- ${date}: ${output.slice(0, 50000)}\n`;

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
			const psCommand = `[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType=WindowsRuntime];` +
				`$toastXml = New-Object Windows.Data.Xml.Dom.XmlDocument;` +
				`$toastXml.LoadXml(@'` +
				`<toast><visual><binding template="ToastGeneric"><text>\\\\${title}</text><text>\\\\${message}</text></binding></visual></toast>` +
				`'@);` +
				`$toast = New-Object Windows.UI.Notifications.ToastNotification($toastXml);` +
				`[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('Pi Agent').Show($toast);`;
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
	const piBin = {{PI_BIN}};
	const now = new Date();
	const mode = task.script ? "script" : (task.promptFile ? "promptFile" : "prompt");

	console.log(`[${now.toISOString()}] Running task: ${task.name} (mode: ${mode})`);

	let output = "";
	let exitCode = 0;
	let savedPath = null;

	try {
		let result;
		
		if (task.script) {
			const resolvedArgs = (task.scriptArgs || []).map((a) => resolveTemplate(a));
			const interpreter = task.scriptInterpreter || "python";
			result = spawnSync(interpreter, [task.script, ...resolvedArgs], {
				timeout: 300000,
				maxBuffer: 10 * 1024 * 1024,
				encoding: "utf-8",
				shell: true,
			});
		} else {
			let promptText;
			if (task.promptFile) {
				promptText = loadPromptFromFile(task.promptFile);
			} else {
				promptText = task.prompt;
			}

			const resolvedPrompt = resolveTemplate(promptText);

			const automationPrefix = "[自动化任务] 严格按以下指令执行。禁止提问、禁止等待用户输入、禁止请求确认。如果信息不足，使用合理的默认值继续。输出要求的内容即可。\n\n---\n\n";

			// Use shell:false for absolute paths (avoids space-in-path issues on Windows),
			// shell:true for bare commands like "pi.cmd" that need PATH lookup.
			const useShell = !piBin.includes("/") && !piBin.includes("\\");

			if (resolvedPrompt.length + automationPrefix.length > PROMPT_FILE_THRESHOLD) {
				const fullPrompt = automationPrefix + resolvedPrompt;
				const tempFile = writePromptToTempFile(fullPrompt);
				console.log(`Prompt too long (${fullPrompt.length} chars), written to file: ${tempFile}`);
				const wrapperPrompt = `请读取文件 ${tempFile} 的内容，并严格按照其中的指令执行。不要做任何额外操作。`;
				result = spawnSync(piBin, ["-p", wrapperPrompt], {
					timeout: 300000,
					maxBuffer: 10 * 1024 * 1024,
					encoding: "utf-8",
					shell: useShell,
				});
			} else {
				result = spawnSync(piBin, ["-p", automationPrefix + resolvedPrompt], {
					timeout: 300000,
					maxBuffer: 10 * 1024 * 1024,
					encoding: "utf-8",
					shell: useShell,
				});
			}
		}

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
		taskMode: mode,
		timestamp: now.toISOString(),
		status: exitCode === 0 ? "success" : "failed",
		exitCode,
		output: output.slice(0, 1000),
		durationMs: endTime - startTime,
	});

	if (task.notifyOnComplete !== false) {
		const title = "Pi Agent - Task Completed";
		const message = exitCode === 0
			? `${task.name} completed successfully${savedPath ? '\\nSaved to: ' + savedPath.split(/[/\\\\]/).pop() : ''}`
			: `${task.name} failed (code: ${exitCode})`;
		showNotification(title, message);
	}

	releaseLock();
	process.exit(exitCode);
} catch (err) {
	releaseLock();
	console.error("Fatal error:", err.message);
	process.exit(1);
}

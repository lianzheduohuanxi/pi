import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { execSync } from "node:child_process";

const SCHEDULER_DIR = join(homedir(), ".pi", "agent", "scheduler");
const TASKS_FILE = join(SCHEDULER_DIR, "tasks.json");
const STATE_FILE = join(SCHEDULER_DIR, "state.json");
const RUN_TASK_SCRIPT = join(SCHEDULER_DIR, "run-task.mjs");
const CHECK_INTERVAL = 60_000;

function loadState() {
	if (existsSync(STATE_FILE)) {
		try {
			return JSON.parse(readFileSync(STATE_FILE, "utf-8"));
		} catch {}
	}
	return { lastRuns: {} };
}

function saveState(state) {
	writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), "utf-8");
}

function shouldRun(cronExpr, now, lastRun) {
	const [minute, hour, dom, month, dow] = cronExpr.split(/\s+/);
	const match = (pattern, value) => {
		if (pattern === "*") return true;
		if (pattern.includes(",")) return pattern.split(",").some((p) => parseInt(p) === value);
		if (pattern.includes("-")) {
			const [lo, hi] = pattern.split("-").map(Number);
			return value >= lo && value <= hi;
		}
		return parseInt(pattern) === value;
	};

	if (!match(minute, now.getMinutes())) return false;
	if (!match(hour, now.getHours())) return false;
	if (!match(dom, now.getDate())) return false;
	if (!match(month, now.getMonth() + 1)) return false;
	if (!match(dow, now.getDay())) return false;

	const nowMinute = new Date(
		now.getFullYear(),
		now.getMonth(),
		now.getDate(),
		now.getHours(),
		now.getMinutes()
	).getTime();
	const lastMinute = lastRun ? new Date(lastRun).getTime() : 0;
	return nowMinute > lastMinute;
}

function checkAndRun() {
	let tasks;
	try {
		tasks = JSON.parse(readFileSync(TASKS_FILE, "utf-8"));
	} catch {
		console.error("Cannot read tasks file:", TASKS_FILE);
		return;
	}

	const state = loadState();
	const now = new Date();

	for (const task of tasks) {
		if (!task.enabled || !task.cron) continue;
		const lastRun = state.lastRuns[task.id];
		if (shouldRun(task.cron, now, lastRun)) {
			console.log(`[${now.toISOString()}] Triggering task: ${task.name} (${task.id})`);
			state.lastRuns[task.id] = now.toISOString();
			saveState(state);
			try {
				execSync(`node "${RUN_TASK_SCRIPT}" ${task.id}`, {
					timeout: 310_000,
					stdio: "inherit",
					shell: true,
					windowsHide: true,
				});
			} catch (err) {
				console.error(`Task ${task.id} failed:`, err.message);
			}
		}
	}
}

console.log(`[Pi Agent Scheduler] Started, checking every ${CHECK_INTERVAL / 1000}s`);
console.log(`[Pi Agent Scheduler] Tasks file: ${TASKS_FILE}`);
console.log(`[Pi Agent Scheduler] State file: ${STATE_FILE}`);
checkAndRun();
setInterval(checkAndRun, CHECK_INTERVAL);

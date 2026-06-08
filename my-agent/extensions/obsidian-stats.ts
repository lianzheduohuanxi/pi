import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "@earendil-works/pi-ai";
import { readFileSync, existsSync } from "node:fs";
import {
	loadConfig,
	getDailyNotePath,
	checkVault,
} from "../lib/obsidian-config";
import type { ObsidianConfig } from "../lib/obsidian-config";

export default function (pi: ExtensionAPI) {
	const config = loadConfig();

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

			// Per-category independent streak tracking (fixes shared streakCount bug)
			const catStreaks: Record<string, number> = {};
			const catBroken: Record<string, boolean> = {};
			for (const key of Object.keys(config.categories)) {
				catStreaks[key] = 0;
				catBroken[key] = false;
			}

			for (let i = 0; i < days; i++) {
				const date = new Date(today.getTime() - i * 24 * 60 * 60 * 1000);
				const dateStr = date.toISOString().split('T')[0];
				const notePath = getDailyNotePath(config, dateStr);

				if (!existsSync(notePath)) {
					// No note for this day: all categories break their streak
					for (const key of Object.keys(config.categories)) {
						if (params.category && params.category !== key) continue;
						if (catBroken[key]) continue;
						catBroken[key] = true;
						analysis[key].streak = catStreaks[key];
					}
					continue;
				}

				const content = readFileSync(notePath, 'utf-8');

				for (const [key, cat] of Object.entries(config.categories)) {
					if (params.category && params.category !== key) continue;
					if (catBroken[key]) continue;
					const sectionMatch = content.match(new RegExp(`##.*${cat.label}[^#]*`, 's'));
					if (sectionMatch) {
						catStreaks[key]++;
						analysis[key].entries++;
						analysis[key].lastDate = dateStr;
						const lines = sectionMatch[0].split('\n').filter((l: string) => l.startsWith('- ')).slice(0, 2);
						analysis[key].content.push(...lines);
					} else {
						catBroken[key] = true;
						analysis[key].streak = catStreaks[key];
					}
				}
			}

			// After loop, set streak for categories that never broke
			for (const key of Object.keys(analysis)) {
				if (analysis[key].streak === 0 && catStreaks[key] > 0) {
					analysis[key].streak = catStreaks[key];
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
}

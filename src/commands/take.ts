import {
	existsSync,
	mkdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";
import chalk from "chalk";
import { ApiError, patch } from "../api.js";
import {
	PROJECT_DIR_PATH,
	formatTaskId,
	getCredentials,
	getProjectConfig,
} from "../config.js";
import { findTask, getDb, getTaskComments } from "../db.js";

// --- Agent config file markers ---

const BEGIN_MARKER = "<!-- BEGIN SPEQTRA TASK -->";
const END_MARKER = "<!-- END SPEQTRA TASK -->";

// --- Agent config paths ---

const AGENT_CONFIGS = {
	claude: "CLAUDE.md",
	codex: "AGENTS.md",
	cursor: ".cursor/rules/speqtra-task.mdc",
	copilot: ".github/copilot-instructions.md",
} as const;

// --- Build the active task markdown ---

function buildTaskMarkdown(
	task: ReturnType<typeof findTask> & {},
	displayId: string,
	projectName: string,
): string {
	const lines: string[] = [];

	lines.push(`# Active Task: ${displayId} — ${task.summary ?? "Untitled"}`);
	lines.push("");

	const meta: string[] = [];
	meta.push("**Status:** in_progress");
	if (task.priority) meta.push(`**Priority:** ${task.priority}`);
	if (task.due_date) meta.push(`**Due:** ${task.due_date}`);
	if (task.assignee_name) meta.push(`**Assignee:** ${task.assignee_name}`);
	lines.push(meta.join(" | "));
	lines.push("");

	if (task.description) {
		lines.push("## Spec");
		lines.push("");
		lines.push(task.description);
		lines.push("");
	}

	if (task.context) {
		lines.push("## Planning Context");
		lines.push("");
		lines.push(task.context);
		lines.push("");
	}

	const comments = getTaskComments(task.id);
	if (comments.length > 0) {
		lines.push("## Discussion");
		lines.push("");
		for (const c of comments) {
			const author = c.author_name ?? "unknown";
			lines.push(`**${author}:** ${c.body}`);
			lines.push("");
		}
	}

	if (task.labels) {
		const labels = JSON.parse(task.labels) as string[];
		if (labels.length > 0) {
			lines.push(`**Labels:** ${labels.join(", ")}`);
			lines.push("");
		}
	}

	lines.push("---");
	lines.push(
		`*Project: ${projectName} | Source: ${task.source} | Created by: ${task.created_by_name ?? "unknown"}*`,
	);
	lines.push("");
	lines.push("When done, run `speqtra drop` to mark complete and clean up.");

	return lines.join("\n");
}

// --- Build the agent instruction block ---

function buildAgentBlock(displayId: string, summary: string): string {
	return [
		BEGIN_MARKER,
		`## Active Task: ${displayId} — ${summary}`,
		"",
		"Read `.speqtra/active-task.md` for the full spec before starting work.",
		"",
		"When the task is complete, run `speqtra drop` to mark it done and clean up.",
		`To add progress notes: \`speqtra comment ${displayId} "your update here"\``,
		END_MARKER,
	].join("\n");
}

// --- Inject/replace managed section in a file ---

function injectSection(filePath: string, block: string): void {
	const dir = filePath.includes("/")
		? filePath.slice(0, filePath.lastIndexOf("/"))
		: null;
	if (dir && !existsSync(dir)) {
		mkdirSync(dir, { recursive: true });
	}

	if (!existsSync(filePath)) {
		writeFileSync(filePath, `${block}\n`);
		return;
	}

	const content = readFileSync(filePath, "utf-8");
	const beginIdx = content.indexOf(BEGIN_MARKER);
	const endIdx = content.indexOf(END_MARKER);

	if (beginIdx !== -1 && endIdx !== -1) {
		const before = content.slice(0, beginIdx);
		const after = content.slice(endIdx + END_MARKER.length);
		writeFileSync(filePath, `${before}${block}${after}`);
	} else {
		const separator = content.endsWith("\n") ? "\n" : "\n\n";
		writeFileSync(filePath, `${content}${separator}${block}\n`);
	}
}

// --- Remove managed section from a file ---

function removeSection(filePath: string): void {
	if (!existsSync(filePath)) return;

	const content = readFileSync(filePath, "utf-8");
	const beginIdx = content.indexOf(BEGIN_MARKER);
	const endIdx = content.indexOf(END_MARKER);

	if (beginIdx === -1 || endIdx === -1) return;

	const before = content.slice(0, beginIdx);
	const after = content.slice(endIdx + END_MARKER.length);
	const cleaned = (before + after).replace(/\n{3,}/g, "\n\n").trim();

	if (cleaned) {
		writeFileSync(filePath, `${cleaned}\n`);
	} else {
		rmSync(filePath);
	}
}

// --- Detect which agents are present ---

function detectAgents(): (keyof typeof AGENT_CONFIGS)[] {
	const agents: (keyof typeof AGENT_CONFIGS)[] = [];

	agents.push("claude");

	if (existsSync(".cursor") || existsSync(".cursorrules")) {
		agents.push("cursor");
	}
	if (existsSync("AGENTS.md") || existsSync(".codex")) {
		agents.push("codex");
	}
	if (existsSync(".github")) {
		agents.push("copilot");
	}

	return agents;
}

// --- Auto-sync take/drop to server ---

async function syncTaskToServer(
	taskId: string,
	status: string,
	assigneeId: string | null,
	cloudVersion: number,
): Promise<boolean> {
	try {
		await patch(`/api/v1/tasks/${taskId}`, {
			status,
			assigneeId: assigneeId ?? undefined,
			cloudVersion,
		});
		return true;
	} catch {
		return false;
	}
}

// --- Main: take ---

export async function take(
	taskIdOrNumber: string,
	options: { json?: boolean },
) {
	const config = getProjectConfig();
	if (!config) {
		console.error(chalk.red("No project linked. Run `speqtra init` first."));
		process.exit(1);
	}

	const creds = getCredentials();
	if (!creds) {
		console.error(chalk.red("No credentials. Run `speqtra login` first."));
		process.exit(1);
	}

	const task = findTask(taskIdOrNumber);
	if (!task) {
		console.error(
			chalk.red(
				`Task '${taskIdOrNumber}' not found. Run \`speqtra sync\` first.`,
			),
		);
		process.exit(1);
	}

	const displayId = formatTaskId(config.taskPrefix, task.number);

	// Update local DB
	const db = getDb();
	db.prepare(
		"UPDATE tasks SET assignee_id = ?, assignee_name = ?, status = 'in_progress', is_dirty = 1, updated_at = datetime('now') WHERE id = ?",
	).run(creds.userId, creds.userName, task.id);

	// Auto-sync to server (take is a coordination event)
	let synced = false;
	if (!task.is_new) {
		synced = await syncTaskToServer(
			task.id,
			"in_progress",
			creds.userId,
			task.cloud_version,
		);
		if (synced) {
			db.prepare(
				"UPDATE tasks SET is_dirty = 0, synced_at = datetime('now') WHERE id = ?",
			).run(task.id);
		}
	}

	// Refresh task data after update
	const updated = findTask(task.id);
	if (!updated) {
		console.error(chalk.red("Failed to refresh task after update."));
		process.exit(1);
	}

	// Write active task spec
	if (!existsSync(PROJECT_DIR_PATH)) {
		mkdirSync(PROJECT_DIR_PATH, { recursive: true });
	}
	const specPath = join(PROJECT_DIR_PATH, "active-task.md");
	writeFileSync(
		specPath,
		buildTaskMarkdown(updated, displayId, config.projectName),
	);

	// Inject into detected agent configs
	const agents = detectAgents();
	const block = buildAgentBlock(displayId, task.summary ?? "Untitled");

	for (const agent of agents) {
		injectSection(AGENT_CONFIGS[agent], block);
	}

	if (options.json) {
		console.log(
			JSON.stringify({
				id: displayId,
				status: "in_progress",
				assignee: creds.userName,
				specFile: specPath,
				agents,
				synced,
			}),
		);
	} else {
		console.log(
			chalk.green(`✓ Took ${displayId}: ${task.summary ?? "Untitled"}`),
		);
		console.log(chalk.dim(`  Spec written to ${specPath}`));
		console.log(
			chalk.dim(
				`  Injected into: ${agents.map((a) => AGENT_CONFIGS[a]).join(", ")}`,
			),
		);
		if (synced) {
			console.log(chalk.dim("  Synced to server."));
		} else if (!task.is_new) {
			console.log(
				chalk.yellow("  Could not sync to server. Run `speqtra sync` later."),
			);
		}
		console.log();
		console.log(
			chalk.dim("  Your coding agent will see this task automatically."),
		);
		console.log(chalk.dim("  When done, run `speqtra drop` to clean up."));
	}
}

// --- Main: drop ---

export async function drop(
	taskIdOrNumber: string | undefined,
	options: { json?: boolean; keep?: boolean },
) {
	const config = getProjectConfig();
	if (!config) {
		console.error(chalk.red("No project linked. Run `speqtra init` first."));
		process.exit(1);
	}

	const specPath = join(PROJECT_DIR_PATH, "active-task.md");

	// If no task ID given, try to detect from active task file
	let taskId = taskIdOrNumber;
	if (!taskId) {
		if (!existsSync(specPath)) {
			console.error(chalk.red("No active task. Nothing to drop."));
			process.exit(1);
		}
		const content = readFileSync(specPath, "utf-8");
		const match = content.match(/^# Active Task: (\S+)/);
		if (match) {
			taskId = match[1];
		}
	}

	// Mark as done (unless --keep flag) and auto-sync
	let synced = false;
	if (taskId && !options.keep) {
		const task = findTask(taskId);
		if (task && task.status !== "done") {
			const db = getDb();
			db.prepare(
				"UPDATE tasks SET status = 'done', is_dirty = 1, updated_at = datetime('now') WHERE id = ?",
			).run(task.id);

			// Auto-sync to server (drop is a coordination event)
			if (!task.is_new) {
				synced = await syncTaskToServer(
					task.id,
					"done",
					null,
					task.cloud_version,
				);
				if (synced) {
					db.prepare(
						"UPDATE tasks SET is_dirty = 0, synced_at = datetime('now') WHERE id = ?",
					).run(task.id);
				}
			}
		}
	}

	// Remove spec file
	if (existsSync(specPath)) {
		rmSync(specPath);
	}

	// Remove injected sections from all agent configs
	for (const configPath of Object.values(AGENT_CONFIGS)) {
		removeSection(configPath);
	}

	const displayId = taskId
		? formatTaskId(config.taskPrefix, findTask(taskId)?.number ?? null)
		: "active task";

	if (options.json) {
		console.log(
			JSON.stringify({
				id: displayId,
				status: options.keep ? "kept" : "done",
				cleaned: true,
				synced,
			}),
		);
	} else {
		if (options.keep) {
			console.log(chalk.green(`✓ Dropped ${displayId} (status kept)`));
		} else {
			console.log(chalk.green(`✓ Closed ${displayId}`));
		}
		console.log(chalk.dim("  Cleaned up agent configs."));
		if (synced) {
			console.log(chalk.dim("  Synced to server."));
		} else {
			console.log(chalk.dim("  Run `speqtra sync` to sync."));
		}
	}
}

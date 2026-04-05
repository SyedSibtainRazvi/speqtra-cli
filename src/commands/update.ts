import chalk from "chalk";
import { formatTaskId, getProjectConfig } from "../config.js";
import { findTask, getDb, resolveAssignee } from "../db.js";

export async function update(
	taskIdOrNumber: string,
	options: {
		json?: boolean;
		summary?: string;
		description?: string;
		desc?: string;
		priority?: string;
		prio?: string;
		labels?: string;
		label?: string;
		assignee?: string;
		assign?: string;
		due?: string;
		dueDate?: string;
		status?: string;
	},
) {
	const config = getProjectConfig();
	if (!config) {
		console.error(chalk.red("No project linked. Run `speqtra init` first."));
		process.exit(1);
	}

	const task = findTask(taskIdOrNumber);
	if (!task) {
		console.error(
			chalk.red(
				`Task '${taskIdOrNumber}' not found. Run \`speqtra sync\` to sync.`,
			),
		);
		process.exit(1);
	}

	const db = getDb();
	const sets: string[] = [];
	const params: unknown[] = [];
	const changes: string[] = [];

	if (options.summary !== undefined) {
		sets.push("summary = ?");
		params.push(options.summary);
		changes.push(`summary → ${options.summary}`);
	}

	const desc = options.description ?? options.desc;
	if (desc !== undefined) {
		sets.push("description = ?");
		params.push(desc);
		changes.push("description updated");
	}

	const prio = options.priority ?? options.prio;
	if (prio !== undefined) {
		sets.push("priority = ?");
		params.push(prio || null);
		changes.push(`priority → ${prio || "none"}`);
	}

	const labelsRaw = options.labels ?? options.label;
	if (labelsRaw !== undefined) {
		const labels = labelsRaw
			? JSON.stringify(labelsRaw.split(",").map((l) => l.trim()))
			: "[]";
		sets.push("labels = ?");
		params.push(labels);
		changes.push(`labels → ${labelsRaw || "none"}`);
	}

	const assigneeName = options.assignee ?? options.assign;
	if (assigneeName !== undefined) {
		if (assigneeName) {
			const match = resolveAssignee(assigneeName);
			if (match) {
				sets.push("assignee_id = ?", "assignee_name = ?");
				params.push(match.id, match.name);
				changes.push(`assignee → ${match.name}`);
			} else {
				sets.push("assignee_name = ?");
				params.push(assigneeName);
				changes.push(`assignee → ${assigneeName} (unresolved)`);
			}
		} else {
			sets.push("assignee_id = ?", "assignee_name = ?");
			params.push(null, null);
			changes.push("assignee → none");
		}
	}

	const dueDate = options.due ?? options.dueDate;
	if (dueDate !== undefined) {
		sets.push("due_date = ?");
		params.push(dueDate || null);
		changes.push(`due → ${dueDate || "none"}`);
	}

	if (options.status !== undefined) {
		sets.push("status = ?");
		params.push(options.status);
		changes.push(`status → ${options.status}`);
	}

	if (sets.length === 0) {
		console.error(
			chalk.red(
				"No changes specified. Use --summary, -d, -p, -a, --due, -s, or -l.",
			),
		);
		process.exit(1);
	}

	sets.push("is_dirty = 1");
	sets.push("updated_at = datetime('now')");
	params.push(task.id);

	db.prepare(`UPDATE tasks SET ${sets.join(", ")} WHERE id = ?`).run(...params);

	const displayId = formatTaskId(config.taskPrefix, task.number);

	if (options.json) {
		console.log(JSON.stringify({ id: displayId, changes, synced: false }));
	} else {
		console.log(
			chalk.green(`✓ Updated: ${displayId} — ${task.summary ?? task.id}`),
		);
		for (const c of changes) {
			console.log(chalk.dim(`  ${c}`));
		}
		console.log(chalk.dim("  Run `speqtra sync` to sync."));
	}
}

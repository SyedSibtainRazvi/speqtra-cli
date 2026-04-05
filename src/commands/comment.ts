import { randomUUID } from "node:crypto";
import chalk from "chalk";
import { formatTaskId, getCredentials, getProjectConfig } from "../config.js";
import { findTask, insertLocalComment } from "../db.js";

export async function comment(
	taskIdOrNumber: string,
	text: string,
	options: { json?: boolean },
) {
	const config = getProjectConfig();
	if (!config) {
		console.error(chalk.red("No project linked. Run `speqtra init` first."));
		process.exit(1);
	}

	const creds = getCredentials();
	const task = findTask(taskIdOrNumber);
	if (!task) {
		console.error(
			chalk.red(
				`Task '${taskIdOrNumber}' not found. Run \`speqtra sync\` to sync.`,
			),
		);
		process.exit(1);
	}

	if (!text?.trim()) {
		console.error(chalk.red("Comment text is required."));
		process.exit(1);
	}

	const id = `local_${randomUUID().slice(0, 8)}`;
	const displayId = formatTaskId(config.taskPrefix, task.number);

	insertLocalComment({
		id,
		task_id: task.id,
		body: text.trim(),
		author_id: creds?.userId ?? null,
		author_name: creds?.userName ?? null,
	});

	if (options.json) {
		console.log(
			JSON.stringify({
				taskId: displayId,
				body: text.trim(),
				author: creds?.userName ?? null,
				synced: false,
			}),
		);
	} else {
		console.log(chalk.green(`✓ Comment added to ${displayId}`));
		console.log(chalk.dim("  Run `speqtra sync` to sync."));
	}
}

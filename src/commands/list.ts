import chalk from "chalk";
import { formatTaskId, getProjectConfig } from "../config.js";
import { getDb } from "../db.js";

interface TaskRow {
	id: string;
	number: number | null;
	summary: string | null;
	status: string;
	priority: string | null;
	assignee_name: string | null;
	due_date: string | null;
	source: string;
}

const statusColor: Record<string, (s: string) => string> = {
	open: chalk.blue,
	in_progress: chalk.yellow,
	review: chalk.magenta,
	blocked: chalk.red,
	done: chalk.green,
};

export async function list(options: {
	json?: boolean;
	all?: boolean;
	status?: string;
}) {
	const config = getProjectConfig();
	if (!config) {
		console.error(chalk.red("No project linked. Run `speqtra init` first."));
		process.exit(1);
	}

	const db = getDb();
	const conditions: string[] = [];
	const params: string[] = [];

	if (options.status) {
		const statuses = options.status.split(",");
		conditions.push(`status IN (${statuses.map(() => "?").join(",")})`);
		params.push(...statuses);
	}

	if (!options.all) {
		const creds = await import("../config.js").then((m) => m.getCredentials());
		if (creds?.userId) {
			conditions.push("assignee_id = ?");
			params.push(creds.userId);
		}
	}

	const where =
		conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
	const query = `SELECT id, number, summary, status, priority, assignee_name, due_date, source FROM tasks ${where} ORDER BY
    CASE status WHEN 'in_progress' THEN 1 WHEN 'open' THEN 2 WHEN 'review' THEN 3 WHEN 'blocked' THEN 4 WHEN 'done' THEN 5 END,
    CASE priority WHEN 'high' THEN 1 WHEN 'medium' THEN 2 WHEN 'low' THEN 3 ELSE 4 END`;

	const tasks = db.prepare(query).all(...params) as TaskRow[];

	if (options.json) {
		console.log(
			JSON.stringify(
				tasks.map((t) => ({
					id: formatTaskId(config.taskPrefix, t.number),
					summary: t.summary,
					status: t.status,
					priority: t.priority,
					assignee: t.assignee_name,
					due: t.due_date,
					source: t.source,
				})),
			),
		);
		return;
	}

	if (tasks.length === 0) {
		console.log(chalk.dim("No tasks found. Run `speqtra sync` to sync."));
		return;
	}

	const idW = 12;
	const summaryW = 34;
	const statusW = 14;
	const prioW = 8;
	const assignW = 12;
	const dueW = 12;

	console.log(
		chalk.bold(
			`${"ID".padEnd(idW)}${"Summary".padEnd(summaryW)}${"Status".padEnd(statusW)}${"Priority".padEnd(prioW)}${"Assignee".padEnd(assignW)}${"Due".padEnd(dueW)}`,
		),
	);
	console.log(
		chalk.dim("─".repeat(idW + summaryW + statusW + prioW + assignW + dueW)),
	);

	for (const t of tasks) {
		const id = truncPad(formatTaskId(config.taskPrefix, t.number), idW);
		const summary = truncPad(t.summary ?? "Untitled", summaryW);
		const colorFn = statusColor[t.status] ?? chalk.dim;
		const status = colorFn(truncPad(t.status, statusW));
		const prioColor =
			t.priority === "high"
				? chalk.red
				: t.priority === "medium"
					? chalk.yellow
					: chalk.dim;
		const priority = prioColor(truncPad(t.priority ?? "—", prioW));
		const assignee = truncPad(t.assignee_name ?? "—", assignW);
		const due = truncPad(t.due_date ? t.due_date.slice(0, 10) : "—", dueW);

		console.log(
			`${chalk.cyan(id)}${summary}${status}${priority}${assignee}${due}`,
		);
	}

	console.log(
		chalk.dim(`\n${tasks.length} task${tasks.length !== 1 ? "s" : ""}`),
	);
}

function truncPad(s: string, w: number): string {
	return (s.length > w - 2 ? `${s.slice(0, w - 2)}…` : s).padEnd(w);
}

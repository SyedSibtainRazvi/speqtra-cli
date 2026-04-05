import { randomUUID } from "node:crypto";
import chalk from "chalk";
import {
  formatTaskId,
  getCredentials,
  getProjectConfig,
  nextLocalNumber,
} from "../config.js";
import { insertLocalTask, resolveAssignee } from "../db.js";

export async function create(
  summary: string,
  options: {
    json?: boolean;
    description?: string;
    desc?: string;
    priority?: string;
    prio?: string;
    labels?: string;
    label?: string;
    status?: string;
    assignee?: string;
    assign?: string;
    due?: string;
    dueDate?: string;
  },
) {
  const config = getProjectConfig();
  if (!config) {
    console.error(chalk.red("No project linked. Run `speqtra init` first."));
    process.exit(1);
  }

  if (!summary?.trim()) {
    console.error(
      chalk.red('Summary is required. Usage: speqtra create "Fix auth bug"'),
    );
    process.exit(1);
  }

  const creds = getCredentials();
  const description = options.description ?? options.desc ?? "";
  const priority = options.priority ?? options.prio ?? null;
  const labelsRaw = options.labels ?? options.label;
  const labels = labelsRaw
    ? JSON.stringify(labelsRaw.split(",").map((l) => l.trim()))
    : null;
  const assigneeName = options.assignee ?? options.assign ?? null;
  const dueDate = options.due ?? options.dueDate ?? null;

  let assigneeId: string | null = null;
  let resolvedName: string | null = assigneeName;

  if (assigneeName) {
    const match = resolveAssignee(assigneeName);
    if (match) {
      assigneeId = match.id;
      resolvedName = match.name;
    } else {
      console.error(
        chalk.yellow(
          `⚠ No member found for '${assigneeName}'. Run \`speqtra sync\` to refresh members.`,
        ),
      );
    }
  }

  const id = `local_${randomUUID().slice(0, 8)}`;
  const number = nextLocalNumber();
  const displayId = formatTaskId(config.taskPrefix, number);

  insertLocalTask({
    id,
    number,
    summary: summary.trim(),
    description,
    status: options.status ?? "open",
    priority,
    labels,
    assignee_id: assigneeId,
    assignee_name: resolvedName,
    created_by_id: creds?.userId ?? null,
    created_by_name: creds?.userName ?? null,
    due_date: dueDate,
    project_id: config.projectId,
  });

  if (options.json) {
    console.log(
      JSON.stringify({
        id: displayId,
        summary: summary.trim(),
        status: options.status ?? "open",
        priority,
        assignee: resolvedName,
        due: dueDate,
        synced: false,
      }),
    );
  } else {
    console.log(chalk.green(`✓ Created: ${displayId} — ${summary.trim()}`));
    if (priority) console.log(chalk.dim(`  Priority: ${priority}`));
    if (resolvedName) console.log(chalk.dim(`  Assignee: ${resolvedName}`));
    if (dueDate) console.log(chalk.dim(`  Due: ${dueDate}`));
    console.log(chalk.dim("  Run `speqtra sync` to sync."));
  }
}

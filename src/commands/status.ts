import chalk from "chalk";
import { formatTaskId, getCredentials, getProjectConfig } from "../config.js";
import { findTask, getDb } from "../db.js";

function setStatus(
  taskIdOrNumber: string,
  newStatus: string,
  statusLabel: string,
  options: { json?: boolean },
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

  const displayId = formatTaskId(config.taskPrefix, task.number);

  if (task.status === newStatus) {
    if (!options.json) {
      console.log(chalk.dim(`${displayId} is already ${statusLabel}.`));
    }
    return;
  }

  const db = getDb();
  db.prepare(
    "UPDATE tasks SET status = ?, is_dirty = 1, updated_at = datetime('now') WHERE id = ?",
  ).run(newStatus, task.id);

  if (options.json) {
    console.log(
      JSON.stringify({ id: displayId, status: newStatus, synced: false }),
    );
  } else {
    console.log(chalk.green(`✓ ${displayId} → ${statusLabel}`));
    console.log(chalk.dim("  Run `speqtra sync` to sync."));
  }
}

export async function start(taskId: string, options: { json?: boolean }) {
  setStatus(taskId, "in_progress", "In Progress", options);
}

export async function close(taskId: string, options: { json?: boolean }) {
  setStatus(taskId, "done", "Done", options);
}

export async function claim(taskId: string, options: { json?: boolean }) {
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

  const task = findTask(taskId);
  if (!task) {
    console.error(
      chalk.red(`Task '${taskId}' not found. Run \`speqtra sync\` to sync.`),
    );
    process.exit(1);
  }

  const displayId = formatTaskId(config.taskPrefix, task.number);
  const db = getDb();

  db.prepare(
    "UPDATE tasks SET assignee_id = ?, assignee_name = ?, status = 'in_progress', is_dirty = 1, updated_at = datetime('now') WHERE id = ?",
  ).run(creds.userId, creds.userName, task.id);

  if (options.json) {
    console.log(
      JSON.stringify({
        id: displayId,
        assignee: creds.userName,
        status: "in_progress",
        synced: false,
      }),
    );
  } else {
    console.log(
      chalk.green(`✓ ${displayId} → Claimed by ${creds.userName}, In Progress`),
    );
    console.log(chalk.dim("  Run `speqtra sync` to sync."));
  }
}

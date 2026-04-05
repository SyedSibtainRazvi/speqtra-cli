import chalk from "chalk";
import { formatTaskId, getProjectConfig } from "../config.js";
import { findTask, getDb } from "../db.js";

export async function deleteTask(
  taskIdOrNumber: string,
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

  const db = getDb();
  const displayId = formatTaskId(config.taskPrefix, task.number);

  if (task.is_new) {
    db.prepare("DELETE FROM tasks WHERE id = ?").run(task.id);
  } else {
    db.prepare(
      "UPDATE tasks SET status = 'deleted', is_dirty = 1, updated_at = datetime('now') WHERE id = ?",
    ).run(task.id);
  }

  if (options.json) {
    console.log(
      JSON.stringify({ id: displayId, deleted: true, synced: !!task.is_new }),
    );
  } else {
    console.log(
      chalk.green(`✓ Deleted: ${displayId} — ${task.summary ?? task.id}`),
    );
    if (!task.is_new) {
      console.log(chalk.dim("  Run `speqtra sync` to sync."));
    }
  }
}

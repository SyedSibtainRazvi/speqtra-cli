import chalk from "chalk";
import { formatTaskId, getProjectConfig } from "../config.js";
import { findTask, getTaskActivities, getTaskComments } from "../db.js";

export async function show(
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

  const comments = getTaskComments(task.id);
  const activities = getTaskActivities(task.id);
  const displayId = formatTaskId(config.taskPrefix, task.number);

  if (options.json) {
    console.log(
      JSON.stringify({
        id: displayId,
        internalId: task.id,
        summary: task.summary,
        description: task.description,
        status: task.status,
        priority: task.priority,
        labels: task.labels ? JSON.parse(task.labels) : [],
        assignee: task.assignee_name,
        createdBy: task.created_by_name,
        source: task.source,
        dueDate: task.due_date,
        createdAt: task.created_at,
        updatedAt: task.updated_at,
        syncedAt: task.synced_at,
        cloudVersion: task.cloud_version,
        dirty: !!task.is_dirty,
        local: !!task.is_new,
        comments: comments.map((c) => ({
          body: c.body,
          author: c.author_name,
          createdAt: c.created_at,
        })),
        activities: activities.map((a) => ({
          action: a.action,
          field: a.field,
          oldValue: a.old_value,
          newValue: a.new_value,
          user: a.user_name,
          createdAt: a.created_at,
        })),
      }),
    );
    return;
  }

  const statusColors: Record<string, (s: string) => string> = {
    open: chalk.blue,
    in_progress: chalk.yellow,
    review: chalk.magenta,
    blocked: chalk.red,
    done: chalk.green,
  };
  const colorFn = statusColors[task.status] ?? chalk.white;

  console.log();
  console.log(
    `${chalk.bold(task.summary ?? "Untitled")}  ${chalk.dim(displayId)}`,
  );
  console.log();

  console.log(`  ${chalk.dim("Status:")}     ${colorFn(task.status)}`);
  console.log(`  ${chalk.dim("Priority:")}   ${task.priority ?? "—"}`);
  console.log(`  ${chalk.dim("Assignee:")}   ${task.assignee_name ?? "—"}`);
  console.log(`  ${chalk.dim("Due:")}        ${task.due_date ?? "—"}`);
  console.log(`  ${chalk.dim("Source:")}     ${task.source}`);
  console.log(`  ${chalk.dim("Created by:")} ${task.created_by_name ?? "—"}`);

  if (task.labels) {
    const labels = JSON.parse(task.labels) as string[];
    if (labels.length > 0) {
      console.log(`  ${chalk.dim("Labels:")}     ${labels.join(", ")}`);
    }
  }

  console.log(`  ${chalk.dim("Created:")}    ${task.created_at}`);
  console.log(`  ${chalk.dim("Updated:")}    ${task.updated_at}`);

  if (task.synced_at) {
    console.log(
      `  ${chalk.dim("Synced:")}     ${task.synced_at} (v${task.cloud_version})`,
    );
  } else {
    console.log(`  ${chalk.dim("Synced:")}     ${chalk.yellow("not synced")}`);
  }

  if (task.description) {
    console.log();
    console.log(chalk.dim("─".repeat(60)));
    console.log(task.description);
  }

  if (comments.length > 0) {
    console.log();
    console.log(chalk.bold(`Comments (${comments.length})`));
    console.log(chalk.dim("─".repeat(60)));
    for (const c of comments) {
      const author = c.author_name ?? "unknown";
      const time = c.created_at.slice(0, 16).replace("T", " ");
      console.log(`  ${chalk.cyan(author)} ${chalk.dim(time)}`);
      console.log(`  ${c.body}`);
      console.log();
    }
  }

  if (activities.length > 0) {
    console.log();
    console.log(chalk.bold(`Activity (${activities.length})`));
    console.log(chalk.dim("─".repeat(60)));
    for (const a of activities) {
      const user = a.user_name ?? "system";
      const time = a.created_at.slice(0, 16).replace("T", " ");
      let desc = a.action;
      if (a.field) {
        desc = `${a.field}: ${a.old_value ?? "—"} → ${a.new_value ?? "—"}`;
      }
      console.log(`  ${chalk.dim(time)} ${chalk.cyan(user)} ${desc}`);
    }
  }

  console.log();
}

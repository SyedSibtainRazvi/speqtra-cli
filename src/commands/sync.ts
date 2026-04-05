import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import chalk from "chalk";
import { ApiError, get, patch, post } from "../api.js";
import { getProjectConfig, PROJECT_DIR_PATH } from "../config.js";
import {
  getAllTasks,
  getDirtyTasks,
  getNewComments,
  getNewTasks,
  getSyncState,
  markClean,
  markCommentSynced,
  markSynced,
  setSyncState,
  upsertActivity,
  upsertComment,
  upsertMembers,
  upsertTask,
} from "../db.js";

interface TaskFromServer {
  id: string;
  number: number | null;
  summary: string | null;
  description: string;
  status: string;
  priority: string | null;
  labels: string[];
  assignee: { id: string; name: string } | null;
  createdBy: { id: string; name: string } | null;
  source: string;
  context: string | null;
  dueDate: string | null;
  cloudVersion: number;
  createdAt: string;
  updatedAt: string;
}

interface TasksResponse {
  tasks: TaskFromServer[];
  serverTime: string;
}

interface TaskDetailResponse {
  task: TaskFromServer;
  comments: {
    id: string;
    body: string;
    author: { id: string; name: string } | null;
    createdAt: string;
  }[];
  activities: {
    id: string;
    action: string;
    field: string | null;
    oldValue: string | null;
    newValue: string | null;
    user: { id: string; name: string } | null;
    createdAt: string;
  }[];
}

interface PatchResponse {
  task: { id: string; status: string; cloudVersion: number };
}

interface CreateResponse {
  task: {
    id: string;
    number: number;
    summary: string;
    status: string;
    cloudVersion: number;
    createdAt: string;
  };
}

interface CommentResponse {
  comment: {
    id: string;
    body: string;
    author: { id: string; name: string };
    createdAt: string;
  };
}

export async function sync(options: { json?: boolean; all?: boolean }) {
  const config = getProjectConfig();
  if (!config) {
    console.error(chalk.red("No project linked. Run `speqtra init` first."));
    process.exit(1);
  }

  // --- Pull tasks ---
  // Track separate timestamps for filtered vs all syncs so switching
  // from assignee=me to --all does a full pull on first use
  const syncKey = options.all ? "last_pull_all_at" : "last_pull_at";
  const lastPull = getSyncState(syncKey);
  let pullPath = `/api/v1/projects/${config.projectId}/tasks`;
  const params: string[] = [];

  if (lastPull) {
    params.push(`since=${encodeURIComponent(lastPull)}`);
  }
  if (!options.all) {
    params.push("assignee=me");
  }
  if (params.length > 0) {
    pullPath += `?${params.join("&")}`;
  }

  const { tasks: serverTasks, serverTime } = await get<TasksResponse>(pullPath);

  let pulled = 0;
  for (const t of serverTasks) {
    upsertTask({
      id: t.id,
      number: t.number,
      summary: t.summary,
      description: t.description,
      status: t.status,
      priority: t.priority,
      labels: t.labels ? JSON.stringify(t.labels) : null,
      assignee_id: t.assignee?.id ?? null,
      assignee_name: t.assignee?.name ?? null,
      created_by_id: t.createdBy?.id ?? null,
      created_by_name: t.createdBy?.name ?? null,
      source: t.source,
      context: t.context,
      due_date: t.dueDate,
      cloud_version: t.cloudVersion,
      project_id: config.projectId,
      created_at: t.createdAt,
      updated_at: t.updatedAt,
    });

    // Pull comments + activities for each task
    try {
      const detail = await get<TaskDetailResponse>(`/api/v1/tasks/${t.id}`);
      for (const c of detail.comments) {
        upsertComment({
          id: c.id,
          task_id: t.id,
          body: c.body,
          author_id: c.author?.id ?? null,
          author_name: c.author?.name ?? null,
          created_at: c.createdAt,
        });
      }
      for (const a of detail.activities) {
        upsertActivity({
          id: a.id,
          task_id: t.id,
          action: a.action,
          field: a.field,
          old_value: a.oldValue,
          new_value: a.newValue,
          user_id: a.user?.id ?? null,
          user_name: a.user?.name ?? null,
          created_at: a.createdAt,
        });
      }
    } catch {
      // Non-fatal — task data already synced
    }

    pulled++;
  }

  // --- Refresh comments/activities for existing tasks not in delta ---
  const allLocal = getAllTasks();
  const pulledIds = new Set(serverTasks.map((t) => t.id));
  for (const local of allLocal) {
    if (pulledIds.has(local.id) || local.is_new) continue;
    try {
      const detail = await get<TaskDetailResponse>(`/api/v1/tasks/${local.id}`);
      for (const c of detail.comments) {
        upsertComment({
          id: c.id,
          task_id: local.id,
          body: c.body,
          author_id: c.author?.id ?? null,
          author_name: c.author?.name ?? null,
          created_at: c.createdAt,
        });
      }
      for (const a of detail.activities) {
        upsertActivity({
          id: a.id,
          task_id: local.id,
          action: a.action,
          field: a.field,
          old_value: a.oldValue,
          new_value: a.newValue,
          user_id: a.user?.id ?? null,
          user_name: a.user?.name ?? null,
          created_at: a.createdAt,
        });
      }
    } catch {
      // Non-fatal
    }
  }

  setSyncState(syncKey, serverTime);

  // --- Pull members ---
  try {
    const { members } = await get<{ members: { id: string; name: string }[] }>(
      `/api/v1/projects/${config.projectId}/members`,
    );
    upsertMembers(members);
  } catch {
    // Non-fatal
  }

  // --- Push new tasks ---
  const newTasks = getNewTasks();
  const dirtyTasks = getDirtyTasks();

  let created = 0;
  let pushed = 0;
  let conflicts = 0;

  for (const task of newTasks) {
    try {
      const res = await post<CreateResponse>(
        `/api/v1/projects/${config.projectId}/tasks`,
        {
          summary: task.summary,
          description: task.description,
          priority: task.priority,
          labels: task.labels ? JSON.parse(task.labels) : [],
          status: task.status,
          assigneeId: task.assignee_id ?? undefined,
          dueDate: task.due_date,
          source: task.source,
        },
      );
      markSynced(task.id, res.task.id, res.task.cloudVersion, res.task.number);
      created++;
    } catch (err) {
      if (!options.json) {
        const msg = err instanceof Error ? err.message : "Unknown error";
        console.error(
          chalk.red(`  ✗ Failed: ${task.summary ?? task.id} — ${msg}`),
        );
      }
    }
  }

  // --- Push dirty tasks ---
  for (const task of dirtyTasks) {
    try {
      const res = await patch<PatchResponse>(`/api/v1/tasks/${task.id}`, {
        summary: task.summary,
        description: task.description,
        status: task.status,
        priority: task.priority,
        labels: task.labels ? JSON.parse(task.labels) : [],
        assigneeId: task.assignee_id ?? undefined,
        dueDate: task.due_date,
        cloudVersion: task.cloud_version,
      });
      markClean(task.id, res.task.cloudVersion);
      pushed++;
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        conflicts++;
        if (!options.json) {
          console.log(
            chalk.yellow(
              `  ⚠ Conflict: '${task.summary ?? task.id}' — run sync again after resolving.`,
            ),
          );
        }
      } else {
        throw err;
      }
    }
  }

  // --- Push new comments ---
  const newComments = getNewComments();
  let commentsPushed = 0;

  for (const c of newComments) {
    try {
      const res = await post<CommentResponse>(
        `/api/v1/tasks/${c.task_id}/comments`,
        { body: c.body },
      );
      markCommentSynced(c.id, res.comment.id);
      commentsPushed++;
    } catch {
      // Non-fatal
    }
  }

  // --- Push repo context if indexed ---
  let contextPushed = false;
  const contextPath = join(PROJECT_DIR_PATH, "repo-context.json");
  if (existsSync(contextPath)) {
    try {
      const repoContext = JSON.parse(readFileSync(contextPath, "utf-8"));
      await patch(`/api/v1/projects/${config.projectId}`, { repoContext });
      contextPushed = true;
    } catch {
      // Non-fatal
    }
  }

  if (options.json) {
    console.log(
      JSON.stringify({
        pulled,
        created,
        pushed,
        conflicts,
        commentsPushed,
        contextPushed,
      }),
    );
  } else {
    const parts: string[] = [];
    if (pulled > 0) parts.push(`${pulled} pulled`);
    if (created > 0) parts.push(`${created} created`);
    if (pushed > 0) parts.push(`${pushed} pushed`);
    if (commentsPushed > 0) parts.push(`${commentsPushed} comments`);
    if (contextPushed) parts.push("context");
    if (conflicts > 0) parts.push(chalk.yellow(`${conflicts} conflicts`));

    if (parts.length === 0) {
      console.log(chalk.dim("Already up to date."));
    } else {
      console.log(chalk.green(`✓ Synced: ${parts.join(", ")}`));
    }
  }
}

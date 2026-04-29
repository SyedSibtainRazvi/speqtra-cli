import { existsSync } from "node:fs";
import Database from "better-sqlite3";
import { DB_PATH } from "./config.js";

function assertNativeSqlite(): void {
	if (typeof Database !== "function") {
		throw new Error(
			[
				"better-sqlite3 native binding is missing or stubbed.",
				"This usually means your workspace has a pnpm/npm override forcing better-sqlite3 to an empty package.",
				"",
				"Fix options:",
				"  1. Install @speqtra/cli globally instead of into your workspace:",
				"       npm i -g @speqtra/cli",
				"  2. Or scope the override in your root package.json so it only applies to your app:",
				'       "pnpm": { "overrides": { "<your-app-name>>better-sqlite3": "npm:empty-npm-package@1.0.0" } }',
				"",
				"After fixing, run `pnpm install` and retry.",
			].join("\n"),
		);
	}
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS tasks (
  id              TEXT PRIMARY KEY,
  number          INTEGER,
  summary         TEXT,
  description     TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'open',
  priority        TEXT,
  labels          TEXT,
  assignee_id     TEXT,
  assignee_name   TEXT,
  created_by_id   TEXT,
  created_by_name TEXT,
  source          TEXT NOT NULL DEFAULT 'manual',
  context         TEXT,
  due_date        TEXT,
  cloud_version   INTEGER NOT NULL DEFAULT 0,
  is_dirty        INTEGER NOT NULL DEFAULT 0,
  is_new          INTEGER NOT NULL DEFAULT 0,
  project_id      TEXT NOT NULL,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL,
  synced_at       TEXT
);

CREATE TABLE IF NOT EXISTS comments (
  id          TEXT PRIMARY KEY,
  task_id     TEXT NOT NULL,
  body        TEXT NOT NULL,
  author_id   TEXT,
  author_name TEXT,
  source      TEXT NOT NULL DEFAULT 'cli',
  is_new      INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS activities (
  id          TEXT PRIMARY KEY,
  task_id     TEXT NOT NULL,
  action      TEXT NOT NULL,
  field       TEXT,
  old_value   TEXT,
  new_value   TEXT,
  user_id     TEXT,
  user_name   TEXT,
  created_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS members (
  id   TEXT PRIMARY KEY,
  name TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sync_state (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_assignee ON tasks(assignee_id);
CREATE INDEX IF NOT EXISTS idx_tasks_number ON tasks(number);
CREATE INDEX IF NOT EXISTS idx_comments_task ON comments(task_id);
CREATE INDEX IF NOT EXISTS idx_activities_task ON activities(task_id);
`;

let _db: Database.Database | null = null;

export function getDb(): Database.Database {
	if (_db) return _db;
	assertNativeSqlite();
	if (!existsSync(DB_PATH)) {
		throw new Error("No local database. Run `speqtra init` first.");
	}
	_db = new Database(DB_PATH);
	_db.pragma("journal_mode = WAL");
	migrateDb(_db);
	return _db;
}

function migrateDb(db: Database.Database): void {
	const cols = db.pragma("table_info(tasks)") as { name: string }[];
	const colNames = new Set(cols.map((c) => c.name));
	if (!colNames.has("number")) {
		db.exec("ALTER TABLE tasks ADD COLUMN number INTEGER");
	}

	db.exec(`
    CREATE TABLE IF NOT EXISTS comments (
      id TEXT PRIMARY KEY, task_id TEXT NOT NULL, body TEXT NOT NULL,
      author_id TEXT, author_name TEXT, source TEXT NOT NULL DEFAULT 'cli',
      is_new INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS activities (
      id TEXT PRIMARY KEY, task_id TEXT NOT NULL, action TEXT NOT NULL,
      field TEXT, old_value TEXT, new_value TEXT,
      user_id TEXT, user_name TEXT, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS members (
      id TEXT PRIMARY KEY, name TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_tasks_number ON tasks(number);
    CREATE INDEX IF NOT EXISTS idx_comments_task ON comments(task_id);
    CREATE INDEX IF NOT EXISTS idx_activities_task ON activities(task_id);
  `);
}

export function initDb(): Database.Database {
	assertNativeSqlite();
	_db = new Database(DB_PATH);
	_db.pragma("journal_mode = WAL");
	_db.exec(SCHEMA);
	return _db;
}

// --- Sync state ---

export function getSyncState(key: string): string | null {
	const db = getDb();
	const row = db
		.prepare("SELECT value FROM sync_state WHERE key = ?")
		.get(key) as { value: string } | undefined;
	return row?.value ?? null;
}

export function setSyncState(key: string, value: string): void {
	const db = getDb();
	db.prepare(
		"INSERT OR REPLACE INTO sync_state (key, value) VALUES (?, ?)",
	).run(key, value);
}

// --- Task types ---

export interface LocalTask {
	id: string;
	number: number | null;
	summary: string | null;
	description: string;
	status: string;
	priority: string | null;
	labels: string | null;
	assignee_id: string | null;
	assignee_name: string | null;
	created_by_id: string | null;
	created_by_name: string | null;
	source: string;
	context: string | null;
	due_date: string | null;
	cloud_version: number;
	is_dirty: number;
	is_new: number;
	project_id: string;
	created_at: string;
	updated_at: string;
	synced_at: string | null;
}

export interface LocalComment {
	id: string;
	task_id: string;
	body: string;
	author_id: string | null;
	author_name: string | null;
	source: string;
	is_new: number;
	created_at: string;
}

export interface LocalActivity {
	id: string;
	task_id: string;
	action: string;
	field: string | null;
	old_value: string | null;
	new_value: string | null;
	user_id: string | null;
	user_name: string | null;
	created_at: string;
}

// --- Task CRUD ---

// FIX: Protect ALL dirty fields during upsert, not just status.
// When a row is dirty (local edits pending push), server data should not
// overwrite local changes. Previously only status was protected.
export function upsertTask(
	task: Omit<LocalTask, "is_dirty" | "is_new" | "synced_at">,
): void {
	const db = getDb();
	db.prepare(`
    INSERT INTO tasks (id, number, summary, description, status, priority, labels,
      assignee_id, assignee_name, created_by_id, created_by_name,
      source, context, due_date, cloud_version, is_dirty, project_id,
      created_at, updated_at, synced_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, datetime('now'))
    ON CONFLICT(id) DO UPDATE SET
      number = excluded.number,
      summary = CASE WHEN tasks.is_dirty = 1 THEN tasks.summary ELSE excluded.summary END,
      description = CASE WHEN tasks.is_dirty = 1 THEN tasks.description ELSE excluded.description END,
      status = CASE WHEN tasks.is_dirty = 1 THEN tasks.status ELSE excluded.status END,
      priority = CASE WHEN tasks.is_dirty = 1 THEN tasks.priority ELSE excluded.priority END,
      labels = CASE WHEN tasks.is_dirty = 1 THEN tasks.labels ELSE excluded.labels END,
      assignee_id = CASE WHEN tasks.is_dirty = 1 THEN tasks.assignee_id ELSE excluded.assignee_id END,
      assignee_name = CASE WHEN tasks.is_dirty = 1 THEN tasks.assignee_name ELSE excluded.assignee_name END,
      created_by_id = excluded.created_by_id,
      created_by_name = excluded.created_by_name,
      source = excluded.source,
      context = excluded.context,
      due_date = CASE WHEN tasks.is_dirty = 1 THEN tasks.due_date ELSE excluded.due_date END,
      cloud_version = excluded.cloud_version,
      project_id = excluded.project_id,
      created_at = excluded.created_at,
      updated_at = excluded.updated_at,
      synced_at = datetime('now')
  `).run(
		task.id,
		task.number,
		task.summary,
		task.description,
		task.status,
		task.priority,
		task.labels,
		task.assignee_id,
		task.assignee_name,
		task.created_by_id,
		task.created_by_name,
		task.source,
		task.context,
		task.due_date,
		task.cloud_version,
		task.project_id,
		task.created_at,
		task.updated_at,
	);
}

export function insertLocalTask(task: {
	id: string;
	number: number;
	summary: string;
	description: string;
	status: string;
	priority: string | null;
	labels: string | null;
	assignee_id: string | null;
	assignee_name: string | null;
	created_by_id: string | null;
	created_by_name: string | null;
	due_date: string | null;
	project_id: string;
}): void {
	const db = getDb();
	const now = new Date().toISOString();
	db.prepare(`
    INSERT INTO tasks (id, number, summary, description, status, priority, labels,
      assignee_id, assignee_name, created_by_id, created_by_name,
      source, context, due_date, cloud_version, is_dirty, is_new, project_id,
      created_at, updated_at, synced_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
      'cli', NULL, ?, 0, 0, 1, ?,
      ?, ?, NULL)
  `).run(
		task.id,
		task.number,
		task.summary,
		task.description,
		task.status,
		task.priority,
		task.labels,
		task.assignee_id,
		task.assignee_name,
		task.created_by_id,
		task.created_by_name,
		task.due_date,
		task.project_id,
		now,
		now,
	);
}

export function getNewTasks(): LocalTask[] {
	const db = getDb();
	return db
		.prepare("SELECT * FROM tasks WHERE is_new = 1")
		.all() as LocalTask[];
}

// FIX: Also rewrite comments.task_id and activities.task_id when a local
// task gets its server ID. Without this, comments on locally-created tasks
// reference stale local IDs and silently fail to upload.
export function markSynced(
	taskId: string,
	serverId: string,
	cloudVersion: number,
	serverNumber: number,
): void {
	const db = getDb();
	const tx = db.transaction(() => {
		db.prepare(
			"UPDATE tasks SET is_new = 0, is_dirty = 0, id = ?, number = ?, cloud_version = ?, synced_at = datetime('now') WHERE id = ?",
		).run(serverId, serverNumber, cloudVersion, taskId);
		db.prepare("UPDATE comments SET task_id = ? WHERE task_id = ?").run(
			serverId,
			taskId,
		);
		db.prepare("UPDATE activities SET task_id = ? WHERE task_id = ?").run(
			serverId,
			taskId,
		);
	});
	tx();
}

export function getDirtyTasks(): LocalTask[] {
	const db = getDb();
	return db
		.prepare("SELECT * FROM tasks WHERE is_dirty = 1")
		.all() as LocalTask[];
}

export function markClean(taskId: string, newCloudVersion: number): void {
	const db = getDb();
	db.prepare(
		"UPDATE tasks SET is_dirty = 0, cloud_version = ?, synced_at = datetime('now') WHERE id = ?",
	).run(newCloudVersion, taskId);
}

export function getAllTasks(): LocalTask[] {
	const db = getDb();
	return db
		.prepare("SELECT * FROM tasks ORDER BY created_at DESC")
		.all() as LocalTask[];
}

export function findTask(taskIdOrNumber: string): LocalTask | null {
	const db = getDb();

	const exact = db
		.prepare("SELECT * FROM tasks WHERE id = ?")
		.get(taskIdOrNumber) as LocalTask | undefined;
	if (exact) return exact;

	const numMatch = taskIdOrNumber.match(/(?:^|-)(\d+)$/);
	if (numMatch) {
		const num = Number.parseInt(numMatch[1], 10);
		const byNumber = db
			.prepare("SELECT * FROM tasks WHERE number = ?")
			.get(num) as LocalTask | undefined;
		if (byNumber) return byNumber;
	}

	const prefix = db
		.prepare("SELECT * FROM tasks WHERE id LIKE ? LIMIT 2")
		.all(`${taskIdOrNumber}%`) as LocalTask[];
	if (prefix.length === 1) return prefix[0];

	return null;
}

// --- Comments ---

export function insertLocalComment(comment: {
	id: string;
	task_id: string;
	body: string;
	author_id: string | null;
	author_name: string | null;
}): void {
	const db = getDb();
	db.prepare(`
    INSERT INTO comments (id, task_id, body, author_id, author_name, source, is_new, created_at)
    VALUES (?, ?, ?, ?, ?, 'cli', 1, datetime('now'))
  `).run(
		comment.id,
		comment.task_id,
		comment.body,
		comment.author_id,
		comment.author_name,
	);
}

export function upsertComment(comment: {
	id: string;
	task_id: string;
	body: string;
	author_id: string | null;
	author_name: string | null;
	created_at: string;
}): void {
	const db = getDb();
	db.prepare(`
    INSERT OR IGNORE INTO comments (id, task_id, body, author_id, author_name, source, is_new, created_at)
    VALUES (?, ?, ?, ?, ?, 'server', 0, ?)
  `).run(
		comment.id,
		comment.task_id,
		comment.body,
		comment.author_id,
		comment.author_name,
		comment.created_at,
	);
}

export function getNewComments(): LocalComment[] {
	const db = getDb();
	return db
		.prepare("SELECT * FROM comments WHERE is_new = 1")
		.all() as LocalComment[];
}

export function markCommentSynced(localId: string, serverId: string): void {
	const db = getDb();
	db.prepare("UPDATE comments SET is_new = 0, id = ? WHERE id = ?").run(
		serverId,
		localId,
	);
}

export function getTaskComments(taskId: string): LocalComment[] {
	const db = getDb();
	return db
		.prepare("SELECT * FROM comments WHERE task_id = ? ORDER BY created_at ASC")
		.all(taskId) as LocalComment[];
}

// --- Activities ---

export function upsertActivity(activity: {
	id: string;
	task_id: string;
	action: string;
	field: string | null;
	old_value: string | null;
	new_value: string | null;
	user_id: string | null;
	user_name: string | null;
	created_at: string;
}): void {
	const db = getDb();
	db.prepare(`
    INSERT OR IGNORE INTO activities (id, task_id, action, field, old_value, new_value, user_id, user_name, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
		activity.id,
		activity.task_id,
		activity.action,
		activity.field,
		activity.old_value,
		activity.new_value,
		activity.user_id,
		activity.user_name,
		activity.created_at,
	);
}

export function getTaskActivities(taskId: string): LocalActivity[] {
	const db = getDb();
	return db
		.prepare(
			"SELECT * FROM activities WHERE task_id = ? ORDER BY created_at DESC LIMIT 20",
		)
		.all(taskId) as LocalActivity[];
}

// --- Members ---

export function upsertMembers(members: { id: string; name: string }[]): void {
	const db = getDb();
	const stmt = db.prepare(
		"INSERT OR REPLACE INTO members (id, name) VALUES (?, ?)",
	);
	const tx = db.transaction(() => {
		for (const m of members) {
			stmt.run(m.id, m.name);
		}
	});
	tx();
}

export function resolveAssignee(
	namePrefix: string,
): { id: string; name: string } | null {
	const db = getDb();
	const exact = db
		.prepare("SELECT id, name FROM members WHERE LOWER(name) = LOWER(?)")
		.get(namePrefix) as { id: string; name: string } | undefined;
	if (exact) return exact;

	const matches = db
		.prepare(
			"SELECT id, name FROM members WHERE LOWER(name) LIKE LOWER(?) LIMIT 2",
		)
		.all(`%${namePrefix}%`) as { id: string; name: string }[];
	if (matches.length === 1) return matches[0];
	return null;
}

// --- Cleanup ---

export function closeDb(): void {
	_db?.close();
	_db = null;
}

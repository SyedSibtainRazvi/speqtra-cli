import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
	closeDb,
	findTask,
	getAllTasks,
	getDb,
	getDirtyTasks,
	getNewComments,
	getNewTasks,
	getSyncState,
	getTaskActivities,
	getTaskComments,
	initDb,
	insertLocalComment,
	insertLocalTask,
	markClean,
	markCommentSynced,
	markSynced,
	resolveAssignee,
	setSyncState,
	upsertActivity,
	upsertComment,
	upsertMembers,
	upsertTask,
} from "../src/db.js";

const originalCwd = process.cwd();
const tmpRoot = mkdtempSync(join(tmpdir(), "speqtra-db-"));

beforeAll(() => {
	process.chdir(tmpRoot);
	mkdirSync(".speqtra", { recursive: true });
	initDb();
});

afterAll(() => {
	closeDb();
	process.chdir(originalCwd);
	rmSync(tmpRoot, { recursive: true, force: true });
});

beforeEach(() => {
	const db = getDb();
	db.exec(
		"DELETE FROM tasks; DELETE FROM comments; DELETE FROM activities; DELETE FROM members; DELETE FROM sync_state;",
	);
});

const baseTask = (overrides: Partial<Parameters<typeof insertLocalTask>[0]> = {}) => ({
	id: "local-1",
	number: -1,
	summary: "Test task",
	description: "A test task body",
	status: "open",
	priority: null,
	labels: null,
	assignee_id: null,
	assignee_name: null,
	created_by_id: null,
	created_by_name: null,
	due_date: null,
	project_id: "proj-1",
	...overrides,
});

describe("task CRUD", () => {
	it("insertLocalTask adds a row that getAllTasks returns", () => {
		insertLocalTask(baseTask());
		const all = getAllTasks();
		expect(all).toHaveLength(1);
		expect(all[0].id).toBe("local-1");
		expect(all[0].summary).toBe("Test task");
		expect(all[0].is_new).toBe(1);
	});

	it("getNewTasks returns only rows where is_new=1", () => {
		insertLocalTask(baseTask({ id: "local-a", number: -1 }));
		insertLocalTask(baseTask({ id: "local-b", number: -2 }));
		const db = getDb();
		db.prepare("UPDATE tasks SET is_new = 0 WHERE id = ?").run("local-b");
		const newOnes = getNewTasks();
		expect(newOnes.map((t) => t.id)).toEqual(["local-a"]);
	});

	it("upsertTask inserts a server task with is_new=0", () => {
		upsertTask({
			id: "server-1",
			number: 42,
			summary: "From server",
			description: "desc",
			status: "open",
			priority: "high",
			labels: null,
			assignee_id: null,
			assignee_name: null,
			created_by_id: null,
			created_by_name: null,
			source: "server",
			context: null,
			due_date: null,
			cloud_version: 1,
			project_id: "proj-1",
			created_at: "2026-01-01T00:00:00Z",
			updated_at: "2026-01-01T00:00:00Z",
		});
		const all = getAllTasks();
		expect(all).toHaveLength(1);
		expect(all[0].id).toBe("server-1");
		expect(all[0].number).toBe(42);
	});

	it("upsertTask preserves dirty fields on update", () => {
		insertLocalTask(baseTask({ id: "t1", number: 5, summary: "local edit" }));
		const db = getDb();
		db.prepare(
			"UPDATE tasks SET is_dirty = 1, is_new = 0, status = 'in_progress', summary = 'my local change' WHERE id = ?",
		).run("t1");

		upsertTask({
			id: "t1",
			number: 5,
			summary: "server version",
			description: "server desc",
			status: "done",
			priority: "low",
			labels: null,
			assignee_id: "u1",
			assignee_name: "Alice",
			created_by_id: null,
			created_by_name: null,
			source: "server",
			context: null,
			due_date: null,
			cloud_version: 2,
			project_id: "proj-1",
			created_at: "2026-01-01T00:00:00Z",
			updated_at: "2026-01-02T00:00:00Z",
		});

		const t = findTask("t1");
		expect(t?.status).toBe("in_progress");
		expect(t?.summary).toBe("my local change");
		expect(t?.cloud_version).toBe(2);
	});
});

describe("findTask", () => {
	beforeEach(() => {
		insertLocalTask(baseTask({ id: "abcdef1234", number: 101 }));
		insertLocalTask(baseTask({ id: "xyz987", number: 202 }));
	});

	it("finds by exact id", () => {
		expect(findTask("abcdef1234")?.id).toBe("abcdef1234");
	});

	it("finds by trailing number", () => {
		expect(findTask("PROJ-101")?.number).toBe(101);
		expect(findTask("202")?.number).toBe(202);
	});

	it("finds by unique id prefix", () => {
		expect(findTask("abcd")?.id).toBe("abcdef1234");
	});

	it("returns null when prefix is ambiguous", () => {
		insertLocalTask(baseTask({ id: "abcdef9999", number: 303 }));
		expect(findTask("abcdef")).toBeNull();
	});

	it("returns null when nothing matches", () => {
		expect(findTask("nope")).toBeNull();
	});
});

describe("markSynced", () => {
	it("assigns server id and rewrites comment/activity task_id", () => {
		insertLocalTask(baseTask({ id: "local-x", number: -5 }));
		insertLocalComment({
			id: "c1",
			task_id: "local-x",
			body: "hi",
			author_id: null,
			author_name: null,
		});
		upsertActivity({
			id: "a1",
			task_id: "local-x",
			action: "created",
			field: null,
			old_value: null,
			new_value: null,
			user_id: null,
			user_name: null,
			created_at: "2026-01-01T00:00:00Z",
		});

		markSynced("local-x", "server-x", 1, 99);

		expect(findTask("server-x")?.number).toBe(99);
		expect(findTask("local-x")).toBeNull();
		expect(getTaskComments("server-x")).toHaveLength(1);
		expect(getTaskActivities("server-x")).toHaveLength(1);
	});
});

describe("dirty tracking", () => {
	it("getDirtyTasks returns only is_dirty=1 rows", () => {
		insertLocalTask(baseTask({ id: "t1", number: -1 }));
		insertLocalTask(baseTask({ id: "t2", number: -2 }));
		const db = getDb();
		db.prepare("UPDATE tasks SET is_dirty = 1 WHERE id = ?").run("t1");
		const dirty = getDirtyTasks();
		expect(dirty.map((t) => t.id)).toEqual(["t1"]);
	});

	it("markClean clears is_dirty and bumps cloud_version", () => {
		insertLocalTask(baseTask({ id: "t1", number: -1 }));
		const db = getDb();
		db.prepare("UPDATE tasks SET is_dirty = 1 WHERE id = ?").run("t1");
		markClean("t1", 7);
		const t = findTask("t1");
		expect(t?.is_dirty).toBe(0);
		expect(t?.cloud_version).toBe(7);
	});
});

describe("comments", () => {
	beforeEach(() => {
		insertLocalTask(baseTask({ id: "t1", number: -1 }));
	});

	it("insertLocalComment + getNewComments roundtrip", () => {
		insertLocalComment({
			id: "c1",
			task_id: "t1",
			body: "first comment",
			author_id: "u1",
			author_name: "Alice",
		});
		const news = getNewComments();
		expect(news).toHaveLength(1);
		expect(news[0].body).toBe("first comment");
		expect(news[0].is_new).toBe(1);
	});

	it("markCommentSynced clears is_new and updates id", () => {
		insertLocalComment({
			id: "local-c",
			task_id: "t1",
			body: "hello",
			author_id: null,
			author_name: null,
		});
		markCommentSynced("local-c", "server-c");
		expect(getNewComments()).toHaveLength(0);
		expect(getTaskComments("t1")[0].id).toBe("server-c");
	});

	it("upsertComment is idempotent (INSERT OR IGNORE)", () => {
		upsertComment({
			id: "c1",
			task_id: "t1",
			body: "original",
			author_id: null,
			author_name: null,
			created_at: "2026-01-01T00:00:00Z",
		});
		upsertComment({
			id: "c1",
			task_id: "t1",
			body: "different body should be ignored",
			author_id: null,
			author_name: null,
			created_at: "2026-01-02T00:00:00Z",
		});
		const list = getTaskComments("t1");
		expect(list).toHaveLength(1);
		expect(list[0].body).toBe("original");
	});

	it("getTaskComments orders ascending by created_at", () => {
		upsertComment({
			id: "c2",
			task_id: "t1",
			body: "second",
			author_id: null,
			author_name: null,
			created_at: "2026-01-02T00:00:00Z",
		});
		upsertComment({
			id: "c1",
			task_id: "t1",
			body: "first",
			author_id: null,
			author_name: null,
			created_at: "2026-01-01T00:00:00Z",
		});
		const list = getTaskComments("t1");
		expect(list.map((c) => c.body)).toEqual(["first", "second"]);
	});
});

describe("members + resolveAssignee", () => {
	beforeEach(() => {
		upsertMembers([
			{ id: "u1", name: "Alice Anderson" },
			{ id: "u2", name: "Bob Baker" },
			{ id: "u3", name: "Alice Zhang" },
		]);
	});

	it("exact case-insensitive name wins", () => {
		expect(resolveAssignee("alice anderson")).toEqual({
			id: "u1",
			name: "Alice Anderson",
		});
	});

	it("unique prefix matches one member", () => {
		expect(resolveAssignee("bob")).toEqual({ id: "u2", name: "Bob Baker" });
	});

	it("ambiguous prefix returns null", () => {
		expect(resolveAssignee("alice")).toBeNull();
	});

	it("no match returns null", () => {
		expect(resolveAssignee("zzz")).toBeNull();
	});
});

describe("sync_state", () => {
	it("setSyncState and getSyncState roundtrip", () => {
		expect(getSyncState("last_sync")).toBeNull();
		setSyncState("last_sync", "2026-04-21T00:00:00Z");
		expect(getSyncState("last_sync")).toBe("2026-04-21T00:00:00Z");
	});

	it("setSyncState overwrites existing value", () => {
		setSyncState("k", "v1");
		setSyncState("k", "v2");
		expect(getSyncState("k")).toBe("v2");
	});
});

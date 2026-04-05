#!/usr/bin/env node

import { Command } from "commander";
import { comment } from "./commands/comment.js";
import { create } from "./commands/create.js";
import { deleteTask } from "./commands/delete.js";
import { indexRepo } from "./commands/index-repo.js";
import { init } from "./commands/init.js";
import { list } from "./commands/list.js";
import { login } from "./commands/login.js";
import { show } from "./commands/show.js";
import { claim, close, start } from "./commands/status.js";
import { sync } from "./commands/sync.js";
import { drop, take } from "./commands/take.js";
import { update } from "./commands/update.js";

const program = new Command();

program
	.name("speqtra")
	.description("Speqtra CLI — sync tasks to your coding agent")
	.version("0.1.0");

// --- Daily workflow (most used) ---

program
	.command("take <task-id>")
	.description("Take a task — writes spec for your coding agent")
	.option("--json", "Output as JSON")
	.action(take);

program
	.command("drop [task-id]")
	.description("Drop active task — mark done and clean up agent configs")
	.option("--json", "Output as JSON")
	.option("--keep", "Clean up without marking as done")
	.action(drop);

program
	.command("list")
	.alias("ls")
	.description("List tasks from local database")
	.option("--json", "Output as JSON")
	.option("--all", "Show all tasks, not just yours")
	.option("-s, --status <statuses>", "Filter by status (comma-separated)")
	.action(list);

program
	.command("sync")
	.description("Pull from server, then push local changes")
	.option("--json", "Output as JSON")
	.option("--all", "Pull all tasks, not just yours")
	.action(sync);

program
	.command("show <task-id>")
	.description("Show task details")
	.option("--json", "Output as JSON")
	.action(show);

// --- Status shortcuts ---

program
	.command("start <task-id>")
	.description("Mark task as in progress")
	.option("--json", "Output as JSON")
	.action(start);

program
	.command("close <task-id>")
	.alias("done")
	.description("Mark task as done")
	.option("--json", "Output as JSON")
	.action(close);

program
	.command("claim <task-id>")
	.description("Assign to me + start (atomic)")
	.option("--json", "Output as JSON")
	.action(claim);

// --- Task CRUD ---

program
	.command("create <summary>")
	.alias("c")
	.description("Create a new task (local until sync)")
	.option("--json", "Output as JSON")
	.option("-d, --description <text>", "Task description")
	.option("--desc <text>", "Task description (alias)")
	.option("-p, --priority <level>", "Priority: high, medium, low")
	.option("--prio <level>", "Priority (alias)")
	.option("-l, --labels <labels>", "Labels (comma-separated)")
	.option("--label <labels>", "Labels (alias)")
	.option("-s, --status <status>", "Initial status (default: open)")
	.option("-a, --assignee <name>", "Assignee name")
	.option("--assign <name>", "Assignee (alias)")
	.option("--due <date>", "Due date (YYYY-MM-DD)")
	.option("--due-date <date>", "Due date (alias)")
	.action(create);

program
	.command("update <task-id>")
	.alias("u")
	.description("Update a task (local until sync)")
	.option("--json", "Output as JSON")
	.option("--summary <text>", "New summary")
	.option("-d, --description <text>", "New description")
	.option("--desc <text>", "New description (alias)")
	.option("-p, --priority <level>", "Priority: high, medium, low")
	.option("--prio <level>", "Priority (alias)")
	.option("-l, --labels <labels>", "Labels (comma-separated)")
	.option("--label <labels>", "Labels (alias)")
	.option("-a, --assignee <name>", "Assignee name")
	.option("--assign <name>", "Assignee (alias)")
	.option("--due <date>", "Due date (YYYY-MM-DD)")
	.option("--due-date <date>", "Due date (alias)")
	.option("-s, --status <status>", "New status")
	.action(update);

program
	.command("delete <task-id>")
	.alias("rm")
	.description("Delete a task (local until sync)")
	.option("--json", "Output as JSON")
	.action(deleteTask);

program
	.command("comment <task-id> <text>")
	.alias("msg")
	.description("Add a comment to a task")
	.option("--json", "Output as JSON")
	.action(comment);

// --- Setup ---

program
	.command("login")
	.description("Authenticate with your API key")
	.option("--json", "Output as JSON")
	.action(login);

program
	.command("init")
	.description("Link this repo to a Speqtra project")
	.option("--json", "Output as JSON")
	.action(init);

program
	.command("index")
	.description("Scan repo and build codebase context for smarter tasks")
	.option("--json", "Output as JSON")
	.action(indexRepo);

program.parse();

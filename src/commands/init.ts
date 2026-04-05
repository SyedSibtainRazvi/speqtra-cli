import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import chalk from "chalk";
import { get } from "../api.js";
import { getCredentials, saveProjectConfig } from "../config.js";
import { initDb, setSyncState } from "../db.js";
import { sync } from "./sync.js";

interface ProjectsResponse {
	projects: {
		id: string;
		name: string;
		taskPrefix: string;
		orgSlug: string;
	}[];
}

// --- Agent instructions block ---

const INIT_BEGIN = "<!-- BEGIN SPEQTRA -->";
const INIT_END = "<!-- END SPEQTRA -->";

function buildInitBlock(projectName: string, prefix: string): string {
	return `${INIT_BEGIN}
# Speqtra — Task Sync for Coding Agents

This project uses **Speqtra** for task management. You can manage tasks directly using the CLI.

## You Are the Task Manager

You have full control over tasks via the \`speqtra\` CLI. Act on the user's intent:

- **User says "take task X"** → run \`speqtra take ${prefix}-X\`, read the spec, start working
- **User says "create a task for..."** → run \`speqtra create "summary" -d "rich description"\` — include relevant files, components, acceptance criteria based on what you know about the codebase
- **User says "update task X"** → run \`speqtra update ${prefix}-X\` with the right flags
- **User says "add a comment"** → run \`speqtra comment ${prefix}-X "detailed comment"\` — include technical context, what was tried, what worked
- **User says "assign to X" or "change priority"** → run \`speqtra update\` with \`--assign\`, \`--prio\`, \`--status\`, \`--due\`, etc.
- **User says "I'm done" or "close this"** → run \`speqtra drop\` to mark done and clean up
- **User says "list tasks" or "what should I work on"** → run \`speqtra list\`

## When Creating or Updating Tasks

Enrich with codebase knowledge:
- Reference specific files, functions, and components that are relevant
- Add acceptance criteria based on the codebase structure
- Include technical context (dependencies, related modules, potential gotchas)
- Use the \`-d\` flag for descriptions: \`speqtra create "summary" -d "detailed description"\`

## When Commenting

Add value beyond what the user said:
- Include what was implemented, what files changed, what approach was taken
- Note any technical decisions or trade-offs
- Reference specific code if relevant

## Active Task Workflow

1. \`speqtra take ${prefix}-N\` — claim a task, spec written to \`.speqtra/active-task.md\`
2. Read \`.speqtra/active-task.md\` for the full spec
3. Implement the task
4. \`speqtra drop\` — mark done, clean up agent configs

## CLI Reference

\`\`\`bash
speqtra list                        # See tasks (--all for everyone's)
speqtra take <id>                   # Take a task, write spec for agent
speqtra drop                        # Mark done, clean up
speqtra create "summary" -d "desc"  # Create with description
speqtra update <id> --prio high     # Update priority, status, assignee, etc.
speqtra comment <id> "text"         # Add a comment
speqtra show <id>                   # View task details
speqtra start <id>                  # Mark in progress
speqtra close <id>                  # Mark done
speqtra claim <id>                  # Assign to me + start
speqtra sync                        # Pull/push with server
\`\`\`

## Rules

- Read \`.speqtra/active-task.md\` before starting any work on a taken task
- Follow the acceptance criteria in the spec
- Run \`speqtra drop\` when work is complete
- Do not modify files in \`.speqtra/\` directly

*Project: ${projectName}*
${INIT_END}`;
}

const AGENT_CONFIGS: Record<string, string> = {
	claude: "CLAUDE.md",
	codex: "AGENTS.md",
	cursor: ".cursor/rules/speqtra.mdc",
	copilot: ".github/copilot-instructions.md",
};

function detectAgents(): string[] {
	const agents: string[] = [];
	agents.push("claude");
	if (existsSync(".cursor") || existsSync(".cursorrules")) {
		agents.push("cursor");
	}
	if (existsSync("AGENTS.md") || existsSync(".codex")) {
		agents.push("codex");
	}
	if (existsSync(".github")) {
		agents.push("copilot");
	}
	return agents;
}

function injectInitBlock(filePath: string, block: string): void {
	const dir = filePath.includes("/")
		? filePath.slice(0, filePath.lastIndexOf("/"))
		: null;
	if (dir && !existsSync(dir)) {
		mkdirSync(dir, { recursive: true });
	}

	if (!existsSync(filePath)) {
		writeFileSync(filePath, `${block}\n`);
		return;
	}

	const content = readFileSync(filePath, "utf-8");
	const beginIdx = content.indexOf(INIT_BEGIN);
	const endIdx = content.indexOf(INIT_END);

	if (beginIdx !== -1 && endIdx !== -1) {
		// Replace existing block
		const before = content.slice(0, beginIdx);
		const after = content.slice(endIdx + INIT_END.length);
		writeFileSync(filePath, `${before}${block}${after}`);
	} else {
		// Append
		const separator = content.endsWith("\n") ? "\n" : "\n\n";
		writeFileSync(filePath, `${content}${separator}${block}\n`);
	}
}

// --- Main ---

export async function init(options: {
	json?: boolean;
	local?: string | boolean;
}) {
	if (options.local) {
		return initLocal(options);
	}

	const creds = getCredentials();
	if (!creds) {
		console.error(
			chalk.red("No credentials found. Run `speqtra login` first."),
		);
		console.error(
			chalk.dim(
				"Or use `speqtra init --local <name>` to start without an account.",
			),
		);
		process.exit(1);
	}

	const { projects } = await get<ProjectsResponse>("/api/v1/projects");

	if (projects.length === 0) {
		console.error(
			chalk.red("No projects found. Create one in the web app first."),
		);
		process.exit(1);
	}

	// Show project list
	console.log(chalk.bold("\nYour projects:"));
	for (let i = 0; i < projects.length; i++) {
		console.log(
			`  ${chalk.cyan(String(i + 1))}. ${projects[i].name} ${chalk.dim(`(${projects[i].orgSlug})`)}`,
		);
	}

	const rl = createInterface({ input: process.stdin, output: process.stdout });
	let selection: string;
	try {
		selection = await rl.question(
			`\nSelect project ${chalk.dim(`(1-${projects.length})`)}: `,
		);
	} finally {
		rl.close();
	}

	const index = Number.parseInt(selection, 10) - 1;
	if (Number.isNaN(index) || index < 0 || index >= projects.length) {
		console.error(chalk.red("Invalid selection."));
		process.exit(1);
	}

	const project = projects[index];

	// Save config + init DB
	const prefix =
		project.taskPrefix ||
		project.name
			.slice(0, 4)
			.toUpperCase()
			.replace(/[^A-Z]/g, "");
	saveProjectConfig({
		projectId: project.id,
		projectName: project.name,
		taskPrefix: prefix,
		localCounter: 0,
	});
	initDb();
	setSyncState("project_id", project.id);
	setSyncState("project_name", project.name);

	// Inject agent instructions
	const agents = detectAgents();
	const block = buildInitBlock(project.name, prefix);
	for (const agent of agents) {
		injectInitBlock(AGENT_CONFIGS[agent], block);
	}

	if (!options.json) {
		console.log(chalk.green(`\n✓ Linked to '${project.name}'`));
		console.log(
			chalk.dim(
				`  Agent instructions injected into: ${agents.map((a) => AGENT_CONFIGS[a]).join(", ")}`,
			),
		);
		console.log(chalk.dim("  Syncing tasks..."));
	}

	// Auto-run first sync
	await sync({ json: options.json });
}

async function initLocal(options: {
	json?: boolean;
	local?: string | boolean;
}) {
	let name = typeof options.local === "string" ? options.local.trim() : "";

	if (!name) {
		const rl = createInterface({
			input: process.stdin,
			output: process.stdout,
		});
		try {
			name = (await rl.question("Project name: ")).trim();
		} finally {
			rl.close();
		}
	}

	if (!name) {
		console.error(chalk.red("Project name is required."));
		process.exit(1);
	}

	const prefix = name
		.slice(0, 4)
		.toUpperCase()
		.replace(/[^A-Z]/g, "");
	const projectId = `local_${Date.now()}`;

	saveProjectConfig({
		projectId,
		projectName: name,
		taskPrefix: prefix || "TASK",
		localCounter: 0,
	});
	initDb();
	setSyncState("project_id", projectId);
	setSyncState("project_name", name);

	// Inject agent instructions
	const agents = detectAgents();
	const block = buildInitBlock(name, prefix || "TASK");
	for (const agent of agents) {
		injectInitBlock(AGENT_CONFIGS[agent], block);
	}

	if (options.json) {
		console.log(JSON.stringify({ status: "ok", project: name, mode: "local" }));
	} else {
		console.log(chalk.green(`\n✓ Created local project '${name}'`));
		console.log(
			chalk.dim(
				`  Agent instructions injected into: ${agents.map((a) => AGENT_CONFIGS[a]).join(", ")}`,
			),
		);
		console.log(
			chalk.dim('  Run `speqtra create "task summary"` to add tasks.'),
		);
		console.log(
			chalk.dim(
				"  Run `speqtra login` later to connect to the server and sync.",
			),
		);
	}
}

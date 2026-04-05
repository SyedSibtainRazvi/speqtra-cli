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

This project uses **Speqtra** for task management. Tasks are created by PMs in the Speqtra web app and synced to your local environment.

## Active Task

When a task is active, the full spec is at \`.speqtra/active-task.md\`. Read it before starting work.

## Quick Reference

\`\`\`bash
speqtra list              # See your assigned tasks
speqtra take <id>         # Take a task — writes spec, agent sees it
speqtra drop              # Done — mark complete, clean up
speqtra sync              # Pull/push changes with server
speqtra show <id>         # View task details
speqtra create "summary"  # Create a task locally
speqtra comment <id> "…"  # Add a comment
\`\`\`

## Workflow

1. \`speqtra sync\` — pull latest tasks
2. \`speqtra take ${prefix}-N\` — claim a task, spec written to \`.speqtra/active-task.md\`
3. Read the spec, implement it
4. \`speqtra drop\` — mark done, clean up agent configs
5. \`speqtra sync\` — push changes to server

## Rules

- Read \`.speqtra/active-task.md\` before starting any work
- Follow the acceptance criteria in the spec
- When done, remind the developer to run \`speqtra drop\`
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

export async function init(options: { json?: boolean }) {
	const creds = getCredentials();
	if (!creds) {
		console.error(
			chalk.red("No credentials found. Run `speqtra login` first."),
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

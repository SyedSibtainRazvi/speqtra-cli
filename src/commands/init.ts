import { createInterface } from "node:readline/promises";
import chalk from "chalk";
import { get } from "../api.js";
import { getCredentials, saveProjectConfig } from "../config.js";
import { initDb, setSyncState } from "../db.js";
import { sync } from "./sync.js";

interface ProjectsResponse {
  projects: { id: string; name: string; taskPrefix: string; orgSlug: string }[];
}

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

  const index = parseInt(selection, 10) - 1;
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

  if (!options.json) {
    console.log(chalk.green(`\n✓ Linked to '${project.name}'`));
    console.log(chalk.dim("  Syncing tasks..."));
  }

  // Auto-run first sync
  await sync({ json: options.json });
}

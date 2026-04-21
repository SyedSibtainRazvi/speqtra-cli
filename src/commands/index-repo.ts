import { existsSync, mkdirSync } from "node:fs";
import chalk from "chalk";
import { CONTEXT_DIR_PATH, getProjectConfig } from "../config.js";
import { detectClaude } from "../lib/agent-detect.js";
import { runClaudeHeadless } from "../lib/agent-runner.js";
import { sanitizeDir } from "../lib/sanitize.js";
import { installSkill } from "../lib/skill-installer.js";

export async function indexRepo(options: { json?: boolean }) {
	const config = getProjectConfig();
	if (!config) {
		console.error(chalk.red("No project linked. Run `speqtra init` first."));
		process.exit(1);
	}

	const claude = detectClaude();
	if (!claude.installed) {
		console.error(
			chalk.red(
				"Claude Code not found on PATH. Install from https://claude.com/claude-code",
			),
		);
		process.exit(1);
	}

	const install = installSkill();
	if (!options.json) {
		if (install.action === "installed") {
			console.log(
				chalk.dim(
					`  Installed skill v${install.bundledVersion} → ${install.to}`,
				),
			);
		} else if (install.action === "updated") {
			console.log(
				chalk.dim(
					`  Updated skill ${install.projectVersion} → ${install.bundledVersion}`,
				),
			);
		} else if (install.action === "skipped-manual") {
			console.log(chalk.dim(`  Keeping user-edited skill at ${install.to}`));
		}
	}

	if (!existsSync(CONTEXT_DIR_PATH)) {
		mkdirSync(CONTEXT_DIR_PATH, { recursive: true });
	}

	if (!options.json) {
		console.log(chalk.cyan("→ Running Claude Code with /speqtra-index…"));
	}
	const run = await runClaudeHeadless({ prompt: "/speqtra-index" });
	if (run.exitCode !== 0) {
		console.error(
			chalk.red(
				run.timedOut
					? `Agent timed out after ${Math.round(run.durationMs / 1000)}s.`
					: `Agent exited with code ${run.exitCode}.`,
			),
		);
		process.exit(1);
	}

	const sanitize = sanitizeDir(CONTEXT_DIR_PATH);

	if (options.json) {
		console.log(
			JSON.stringify({
				install: install.action,
				bundledVersion: install.bundledVersion,
				durationMs: run.durationMs,
				sanitize,
			}),
		);
		return;
	}

	console.log(
		chalk.green(
			`✓ Indexed repository in ${Math.round(run.durationMs / 1000)}s`,
		),
	);
	if (sanitize.totalRedactions > 0) {
		const hitFiles = sanitize.files.filter((f) => f.totalRedactions > 0);
		console.log(
			chalk.yellow(
				`  ⚠ Sanitizer redacted ${sanitize.totalRedactions} item(s) across ${hitFiles.length} file(s)`,
			),
		);
		for (const f of hitFiles) {
			const parts = f.redactions
				.map((r) => `${r.pattern}×${r.count}`)
				.join(", ");
			console.log(chalk.dim(`    ${f.file}: ${parts}`));
		}
	}
	console.log(chalk.dim("  Run `speqtra sync` to push to server."));
}

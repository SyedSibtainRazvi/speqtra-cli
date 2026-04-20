import { spawn } from "node:child_process";

export interface RunOptions {
	prompt: string;
	cwd?: string;
	timeoutMs?: number;
}

export interface RunResult {
	exitCode: number;
	timedOut: boolean;
	durationMs: number;
}

const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;

export async function runClaudeHeadless(opts: RunOptions): Promise<RunResult> {
	const timeoutMs = opts.timeoutMs ?? parseTimeoutEnv() ?? DEFAULT_TIMEOUT_MS;
	const started = Date.now();

	return new Promise((resolve) => {
		const child = spawn("claude", ["-p", opts.prompt], {
			cwd: opts.cwd ?? process.cwd(),
			stdio: ["ignore", "inherit", "inherit"],
		});

		let timedOut = false;
		const timer = setTimeout(() => {
			timedOut = true;
			child.kill("SIGTERM");
			setTimeout(() => {
				if (child.exitCode === null) child.kill("SIGKILL");
			}, 5000).unref();
		}, timeoutMs);

		child.on("exit", (code) => {
			clearTimeout(timer);
			resolve({
				exitCode: code ?? 1,
				timedOut,
				durationMs: Date.now() - started,
			});
		});

		child.on("error", () => {
			clearTimeout(timer);
			resolve({
				exitCode: 127,
				timedOut: false,
				durationMs: Date.now() - started,
			});
		});
	});
}

function parseTimeoutEnv(): number | undefined {
	const v = process.env.SPEQTRA_INDEX_TIMEOUT;
	if (!v) return undefined;
	const n = Number(v);
	return Number.isFinite(n) && n > 0 ? n * 1000 : undefined;
}

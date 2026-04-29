import { spawn } from "node:child_process";

export interface RunOptions {
	prompt: string;
	cwd?: string;
	timeoutMs?: number;
	idleTimeoutMs?: number;
}

export interface RunResult {
	exitCode: number;
	timedOut: boolean;
	idleTimedOut: boolean;
	durationMs: number;
}

const DEFAULT_TOTAL_TIMEOUT_MS = 15 * 60 * 1000;
const DEFAULT_IDLE_TIMEOUT_MS = 90 * 1000;

export async function runClaudeHeadless(opts: RunOptions): Promise<RunResult> {
	const totalTimeoutMs =
		opts.timeoutMs ??
		parseEnvSeconds("SPEQTRA_INDEX_TIMEOUT") ??
		DEFAULT_TOTAL_TIMEOUT_MS;
	const idleTimeoutMs =
		opts.idleTimeoutMs ??
		parseEnvSeconds("SPEQTRA_INDEX_IDLE_TIMEOUT") ??
		DEFAULT_IDLE_TIMEOUT_MS;
	const started = Date.now();

	return new Promise((resolve) => {
		const child = spawn("claude", ["-p", opts.prompt], {
			cwd: opts.cwd ?? process.cwd(),
			stdio: ["ignore", "pipe", "pipe"],
		});

		let timedOut = false;
		let idleTimedOut = false;

		const totalTimer = setTimeout(() => {
			timedOut = true;
			killChild();
		}, totalTimeoutMs);

		let idleTimer = setTimeout(() => {
			idleTimedOut = true;
			killChild();
		}, idleTimeoutMs);

		const resetIdle = () => {
			clearTimeout(idleTimer);
			idleTimer = setTimeout(() => {
				idleTimedOut = true;
				killChild();
			}, idleTimeoutMs);
		};

		const killChild = () => {
			child.kill("SIGTERM");
			setTimeout(() => {
				if (child.exitCode === null) child.kill("SIGKILL");
			}, 5000).unref();
		};

		child.stdout?.on("data", (chunk) => {
			resetIdle();
			process.stdout.write(chunk);
		});
		child.stderr?.on("data", (chunk) => {
			resetIdle();
			process.stderr.write(chunk);
		});

		child.on("exit", (code) => {
			clearTimeout(totalTimer);
			clearTimeout(idleTimer);
			resolve({
				exitCode: code ?? 1,
				timedOut: timedOut || idleTimedOut,
				idleTimedOut,
				durationMs: Date.now() - started,
			});
		});

		child.on("error", () => {
			clearTimeout(totalTimer);
			clearTimeout(idleTimer);
			resolve({
				exitCode: 127,
				timedOut: false,
				idleTimedOut: false,
				durationMs: Date.now() - started,
			});
		});
	});
}

function parseEnvSeconds(name: string): number | undefined {
	const v = process.env[name];
	if (!v) return undefined;
	const n = Number(v);
	return Number.isFinite(n) && n > 0 ? n * 1000 : undefined;
}

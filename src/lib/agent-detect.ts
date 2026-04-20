import { spawnSync } from "node:child_process";

export interface AgentCheck {
	installed: boolean;
	bin?: string;
	version?: string;
}

export function detectClaude(): AgentCheck {
	try {
		const r = spawnSync("claude", ["--version"], {
			encoding: "utf-8",
			stdio: ["ignore", "pipe", "pipe"],
			timeout: 5000,
		});
		if (r.status === 0) {
			return {
				installed: true,
				bin: "claude",
				version: (r.stdout ?? "").trim() || undefined,
			};
		}
	} catch {
		// ENOENT / not on PATH
	}
	return { installed: false };
}

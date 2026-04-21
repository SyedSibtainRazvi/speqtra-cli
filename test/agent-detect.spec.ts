import { spawnSync } from "node:child_process";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { detectClaude } from "../src/lib/agent-detect.js";

vi.mock("node:child_process", () => ({
	spawnSync: vi.fn(),
}));

const spawnSyncMock = spawnSync as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
	spawnSyncMock.mockReset();
});

describe("detectClaude", () => {
	it("reports installed when claude --version exits 0", () => {
		spawnSyncMock.mockReturnValue({
			status: 0,
			stdout: "1.0.80 (Claude Code)\n",
			stderr: "",
		});
		const r = detectClaude();
		expect(r.installed).toBe(true);
		expect(r.bin).toBe("claude");
		expect(r.version).toBe("1.0.80 (Claude Code)");
	});

	it("returns installed=true with undefined version when stdout is empty", () => {
		spawnSyncMock.mockReturnValue({ status: 0, stdout: "", stderr: "" });
		const r = detectClaude();
		expect(r.installed).toBe(true);
		expect(r.version).toBeUndefined();
	});

	it("reports not installed when exit status is non-zero", () => {
		spawnSyncMock.mockReturnValue({
			status: 1,
			stdout: "",
			stderr: "boom",
		});
		const r = detectClaude();
		expect(r).toEqual({ installed: false });
	});

	it("reports not installed when status is null (binary missing)", () => {
		spawnSyncMock.mockReturnValue({
			status: null,
			error: Object.assign(new Error("ENOENT"), { code: "ENOENT" }),
			stdout: "",
			stderr: "",
		});
		const r = detectClaude();
		expect(r).toEqual({ installed: false });
	});

	it("reports not installed when spawnSync itself throws", () => {
		spawnSyncMock.mockImplementation(() => {
			throw new Error("unexpected");
		});
		const r = detectClaude();
		expect(r).toEqual({ installed: false });
	});

	it("invokes claude with --version and a 5s timeout", () => {
		spawnSyncMock.mockReturnValue({ status: 0, stdout: "x", stderr: "" });
		detectClaude();
		expect(spawnSyncMock).toHaveBeenCalledWith(
			"claude",
			["--version"],
			expect.objectContaining({ timeout: 5000 }),
		);
	});
});

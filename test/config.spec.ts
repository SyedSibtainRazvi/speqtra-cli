import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	formatTaskId,
	getProjectConfig,
	nextLocalNumber,
	saveProjectConfig,
} from "../src/config.js";

describe("formatTaskId", () => {
	it("returns '???' when number is null", () => {
		expect(formatTaskId("ACME", null)).toBe("???");
	});

	it("formats positive numbers as PREFIX-N", () => {
		expect(formatTaskId("ACME", 42)).toBe("ACME-42");
		expect(formatTaskId("X", 1)).toBe("X-1");
	});

	it("formats negative numbers as PREFIX-localN (absolute value)", () => {
		expect(formatTaskId("ACME", -1)).toBe("ACME-local1");
		expect(formatTaskId("ACME", -99)).toBe("ACME-local99");
	});

	it("formats zero as PREFIX-0", () => {
		expect(formatTaskId("ACME", 0)).toBe("ACME-0");
	});
});

describe("project config I/O", () => {
	const originalCwd = process.cwd();
	let tmpDir: string;

	beforeEach(() => {
		tmpDir = mkdtempSync(join(tmpdir(), "speqtra-cfg-"));
		process.chdir(tmpDir);
	});

	afterEach(() => {
		process.chdir(originalCwd);
		rmSync(tmpDir, { recursive: true, force: true });
	});

	it("returns null when no project config exists", () => {
		expect(getProjectConfig()).toBeNull();
	});

	it("saveProjectConfig + getProjectConfig roundtrip", () => {
		const cfg = {
			projectId: "proj-1",
			projectName: "Demo",
			taskPrefix: "DEMO",
			localCounter: 0,
		};
		saveProjectConfig(cfg);
		expect(getProjectConfig()).toEqual(cfg);
	});

	it("saveProjectConfig creates .gitignore with .speqtra/ when missing", () => {
		saveProjectConfig({
			projectId: "p",
			projectName: "n",
			taskPrefix: "P",
			localCounter: 0,
		});
		expect(existsSync(".gitignore")).toBe(true);
		expect(readFileSync(".gitignore", "utf-8")).toContain(".speqtra/");
	});

	it("saveProjectConfig appends .speqtra/ to existing .gitignore without duplicating", () => {
		writeFileSync(".gitignore", "node_modules/\ndist/\n");
		saveProjectConfig({
			projectId: "p",
			projectName: "n",
			taskPrefix: "P",
			localCounter: 0,
		});
		const contents = readFileSync(".gitignore", "utf-8");
		expect(contents).toContain("node_modules/");
		expect(contents).toContain(".speqtra/");

		saveProjectConfig({
			projectId: "p",
			projectName: "n",
			taskPrefix: "P",
			localCounter: -1,
		});
		const after = readFileSync(".gitignore", "utf-8");
		const occurrences = after.split(".speqtra").length - 1;
		expect(occurrences).toBe(1);
	});

	it("returns null when project config is malformed JSON", () => {
		mkdirSync(".speqtra", { recursive: true });
		writeFileSync(join(".speqtra", "config.json"), "{not valid json");
		expect(getProjectConfig()).toBeNull();
	});
});

describe("nextLocalNumber", () => {
	const originalCwd = process.cwd();
	let tmpDir: string;

	beforeEach(() => {
		tmpDir = mkdtempSync(join(tmpdir(), "speqtra-cfg-"));
		process.chdir(tmpDir);
	});

	afterEach(() => {
		process.chdir(originalCwd);
		rmSync(tmpDir, { recursive: true, force: true });
	});

	it("throws when no project is linked", () => {
		expect(() => nextLocalNumber()).toThrowError(/No project linked/);
	});

	it("decrements by one each call and persists the counter", () => {
		saveProjectConfig({
			projectId: "p",
			projectName: "n",
			taskPrefix: "P",
			localCounter: 0,
		});
		expect(nextLocalNumber()).toBe(-1);
		expect(nextLocalNumber()).toBe(-2);
		expect(nextLocalNumber()).toBe(-3);
		expect(getProjectConfig()?.localCounter).toBe(-3);
	});
});

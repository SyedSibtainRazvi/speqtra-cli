import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { sanitizeContent, sanitizeDir } from "../src/lib/sanitize.js";

describe("sanitizeContent", () => {
	it("returns input unchanged when no secrets match", () => {
		const input = "# README\n\nJust some regular markdown text.";
		const { out, redactions, total } = sanitizeContent(input);
		expect(out).toBe(input);
		expect(redactions).toEqual([]);
		expect(total).toBe(0);
	});

	it("redacts secret-assignment patterns (TOKEN, KEY, SECRET, PASSWORD, CREDENTIAL, APIKEY)", () => {
		const cases = [
			["API_TOKEN=abcdef123456", "API_TOKEN=[REDACTED]"],
			["SERVICE_KEY: 'xyz987654321'", "SERVICE_KEY: [REDACTED]"],
			['DB_PASSWORD = "hunter2hunter"', "DB_PASSWORD = [REDACTED]"],
			["MY_SECRET=longenough1234", "MY_SECRET=[REDACTED]"],
			["USER_CREDENTIAL=topsecretvalue", "USER_CREDENTIAL=[REDACTED]"],
			["OPENAI_APIKEY=sk_or_whatever_key_here", "OPENAI_APIKEY=[REDACTED]"],
		];
		for (const [input, expected] of cases) {
			const { out } = sanitizeContent(input);
			expect(out).toBe(expected);
		}
	});

	it("does not redact short values (< 4 chars)", () => {
		const input = "API_TOKEN=abc";
		const { out, total } = sanitizeContent(input);
		expect(out).toBe(input);
		expect(total).toBe(0);
	});

	it("redacts Bearer tokens (case-insensitive)", () => {
		const { out } = sanitizeContent(
			"Authorization: Bearer abcDEF1234567890\nauthorization: bearer XYZ789abcDEF",
		);
		expect(out).toContain("Bearer [REDACTED]");
		expect(out).not.toContain("abcDEF1234567890");
		expect(out).not.toContain("XYZ789abcDEF");
	});

	it("redacts GitHub tokens (ghp/gho/ghu/ghs/ghr)", () => {
		const tokens = [
			`ghp_${"a".repeat(36)}`,
			`gho_${"b".repeat(36)}`,
			`ghu_${"c".repeat(36)}`,
			`ghs_${"d".repeat(36)}`,
			`ghr_${"e".repeat(36)}`,
		];
		for (const t of tokens) {
			const { out, total } = sanitizeContent(`token=${t}`);
			expect(out).toBe("token=[REDACTED]");
			expect(total).toBe(1);
		}
	});

	it("redacts Stripe live and test keys", () => {
		const { out: liveOut } = sanitizeContent(`sk_live_${"a".repeat(24)}`);
		expect(liveOut).toBe("[REDACTED]");
		const { out: testOut } = sanitizeContent(`sk_test_${"b".repeat(24)}`);
		expect(testOut).toBe("[REDACTED]");
	});

	it("redacts Anthropic and OpenAI style keys", () => {
		const { out: openai } = sanitizeContent(`sk-${"a".repeat(40)}`);
		expect(openai).toBe("[REDACTED]");
		const { out: anthropic } = sanitizeContent(`sk-ant-${"b".repeat(40)}`);
		expect(anthropic).toBe("[REDACTED]");
	});

	it("redacts database URLs", () => {
		const urls = [
			"postgres://user:pw@host:5432/db",
			"postgresql://user:pw@host/db",
			"mysql://root:pw@localhost/app",
			"mongodb://admin:pw@host:27017",
			"mongodb+srv://user:pw@cluster.mongodb.net/db",
			"redis://:pw@cache:6379",
		];
		for (const url of urls) {
			const { out } = sanitizeContent(`connection: ${url}`);
			expect(out).toBe("connection: [DB_URL]");
		}
	});

	it("redacts internal URLs (localhost, 127.0.0.1, *.internal, *.local)", () => {
		const urls = [
			"http://localhost:3000/admin",
			"https://127.0.0.1:8080",
			"https://api.internal/v1",
			"http://printer.local",
		];
		for (const url of urls) {
			const { out } = sanitizeContent(`see ${url} for docs`);
			expect(out).toContain("[INTERNAL]");
			expect(out).not.toContain(url);
		}
	});

	it("redacts macOS and Linux home paths", () => {
		const { out: macOut } = sanitizeContent("path: /Users/alice/code/foo");
		expect(macOut).toBe("path: $HOME/code/foo");
		const { out: linuxOut } = sanitizeContent("path: /home/bob/project/x");
		expect(linuxOut).toBe("path: $HOME/project/x");
	});

	it("counts multiple matches of the same pattern", () => {
		const { redactions, total } = sanitizeContent(
			"A_TOKEN=longvalue B_KEY=longvalue2 C_SECRET=longvalue3",
		);
		const assignment = redactions.find((r) => r.pattern === "secret-assignment");
		expect(assignment?.count).toBe(3);
		expect(total).toBe(3);
	});

	it("reports redactions grouped by pattern name", () => {
		const input = [
			"API_TOKEN=abcdef123456",
			"postgres://u:p@h/d",
			"/Users/alice/x",
		].join("\n");
		const { redactions, total } = sanitizeContent(input);
		const names = redactions.map((r) => r.pattern).sort();
		expect(names).toContain("secret-assignment");
		expect(names).toContain("db-url");
		expect(names).toContain("home-path-users");
		expect(total).toBe(3);
	});
});

describe("sanitizeDir", () => {
	let dir: string;

	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), "speqtra-sanitize-"));
	});

	afterEach(() => {
		rmSync(dir, { recursive: true, force: true });
	});

	it("returns empty result for a missing directory", () => {
		const result = sanitizeDir(join(dir, "does-not-exist"));
		expect(result.files).toEqual([]);
		expect(result.totalRedactions).toBe(0);
	});

	it("skips non-markdown files", () => {
		writeFileSync(join(dir, "notes.txt"), "API_TOKEN=sensitivevaluehere");
		const result = sanitizeDir(dir);
		expect(result.files).toEqual([]);
		expect(result.totalRedactions).toBe(0);
	});

	it("sanitizes .md files and writes them back when redactions occur", () => {
		const mdPath = join(dir, "context.md");
		writeFileSync(mdPath, "API_TOKEN=supersecretvalue");
		const result = sanitizeDir(dir);
		expect(result.files).toHaveLength(1);
		expect(result.totalRedactions).toBe(1);
		expect(readFileSync(mdPath, "utf-8")).toBe("API_TOKEN=[REDACTED]");
	});

	it("records files with zero redactions without modifying them", () => {
		const mdPath = join(dir, "clean.md");
		const original = "# Clean doc\n\nNothing sensitive here.";
		writeFileSync(mdPath, original);
		const result = sanitizeDir(dir);
		expect(result.files).toHaveLength(1);
		expect(result.files[0].totalRedactions).toBe(0);
		expect(readFileSync(mdPath, "utf-8")).toBe(original);
	});

	it("aggregates redactions across multiple .md files", () => {
		writeFileSync(join(dir, "a.md"), "API_TOKEN=aaaaaaaaaaaaaa");
		writeFileSync(join(dir, "b.md"), "DB_PASSWORD=bbbbbbbbbbbbbb");
		writeFileSync(join(dir, "c.md"), "clean content");
		const result = sanitizeDir(dir);
		expect(result.files).toHaveLength(3);
		expect(result.totalRedactions).toBe(2);
	});

	it("ignores subdirectories (non-recursive)", () => {
		const sub = join(dir, "sub");
		mkdirSync(sub);
		writeFileSync(join(sub, "nested.md"), "API_TOKEN=shouldnotredact");
		const result = sanitizeDir(dir);
		expect(result.files).toEqual([]);
		expect(readFileSync(join(sub, "nested.md"), "utf-8")).toBe(
			"API_TOKEN=shouldnotredact",
		);
	});
});

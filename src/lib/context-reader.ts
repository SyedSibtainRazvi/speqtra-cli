import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { CONTEXT_DIR_PATH } from "../config.js";

export interface ContextFile {
	name: string;
	frontmatter: Record<string, unknown>;
	content: string;
}

export interface ContextPayloadV2 {
	version: 2;
	files: ContextFile[];
	index?: unknown;
}

function parseFrontmatter(text: string): Record<string, unknown> {
	const out: Record<string, unknown> = {};
	for (const line of text.split("\n")) {
		const m = line.match(/^([a-zA-Z_][a-zA-Z0-9_]*):\s*(.*)$/);
		if (!m) continue;
		const [, key, rawValue] = m;
		const value = rawValue.trim();
		if (value.startsWith("[") && value.endsWith("]")) {
			try {
				out[key] = JSON.parse(value);
				continue;
			} catch {
				// fall through to string
			}
		}
		out[key] = value.replace(/^["'](.*)["']$/, "$1");
	}
	return out;
}

function parseContextFile(path: string, name: string): ContextFile {
	const raw = readFileSync(path, "utf-8");
	const m = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
	if (!m) {
		return { name, frontmatter: {}, content: raw };
	}
	const [, fmText, body] = m;
	return { name, frontmatter: parseFrontmatter(fmText), content: body };
}

export function readContextDir(): ContextPayloadV2 | null {
	if (!existsSync(CONTEXT_DIR_PATH)) return null;

	let entries: string[];
	try {
		entries = readdirSync(CONTEXT_DIR_PATH);
	} catch {
		return null;
	}

	const files: ContextFile[] = [];
	let index: unknown;

	for (const name of entries) {
		const path = join(CONTEXT_DIR_PATH, name);
		if (name === "index.json") {
			try {
				index = JSON.parse(readFileSync(path, "utf-8"));
			} catch {
				// ignore malformed index
			}
			continue;
		}
		if (!name.endsWith(".md")) continue;
		files.push(parseContextFile(path, name));
	}

	if (files.length === 0 && index === undefined) return null;

	const payload: ContextPayloadV2 = { version: 2, files };
	if (index !== undefined) payload.index = index;
	return payload;
}

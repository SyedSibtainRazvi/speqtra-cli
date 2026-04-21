import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export interface Redaction {
	pattern: string;
	count: number;
}

export interface FileSanitizeResult {
	file: string;
	redactions: Redaction[];
	totalRedactions: number;
}

export interface DirSanitizeResult {
	files: FileSanitizeResult[];
	totalRedactions: number;
}

type SubFn = (match: string, ...groups: string[]) => string;

interface Pattern {
	name: string;
	re: RegExp;
	sub: SubFn;
}

const PATTERNS: Pattern[] = [
	{
		name: "secret-assignment",
		re: /\b([A-Z][A-Z0-9_]*(?:TOKEN|KEY|SECRET|PASSWORD|CREDENTIAL|APIKEY))(\s*[:=]\s*)(['"]?)([^\s'",}]{4,})\3/g,
		sub: (_m, name, sep) => `${name}${sep}[REDACTED]`,
	},
	{
		name: "bearer-token",
		re: /\bBearer\s+[A-Za-z0-9_\-.=]{10,}/gi,
		sub: () => "Bearer [REDACTED]",
	},
	{
		name: "github-token",
		re: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,255}\b/g,
		sub: () => "[REDACTED]",
	},
	{
		name: "stripe-key",
		re: /\bsk_(?:live|test)_[A-Za-z0-9]{20,}\b/g,
		sub: () => "[REDACTED]",
	},
	{
		name: "anthropic-openai-key",
		re: /\bsk-(?:ant-)?[A-Za-z0-9_-]{20,}\b/g,
		sub: () => "[REDACTED]",
	},
	{
		name: "db-url",
		re: /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis):\/\/[^\s)]+/gi,
		sub: () => "[DB_URL]",
	},
	{
		name: "internal-url",
		re: /https?:\/\/(?:localhost|127\.0\.0\.1|[a-zA-Z0-9-]+\.(?:internal|local))(?::\d+)?[^\s)]*/gi,
		sub: () => "[INTERNAL]",
	},
	{
		name: "home-path-users",
		re: /\/Users\/[^/\s]+/g,
		sub: () => "$HOME",
	},
	{
		name: "home-path-linux",
		re: /\/home\/[^/\s]+/g,
		sub: () => "$HOME",
	},
];

export function sanitizeContent(input: string): {
	out: string;
	redactions: Redaction[];
	total: number;
} {
	let out = input;
	const redactions: Redaction[] = [];
	let total = 0;

	for (const p of PATTERNS) {
		let count = 0;
		out = out.replace(p.re, (...args) => {
			count++;
			const [match, ...groups] = args as [string, ...string[]];
			return p.sub(match, ...groups);
		});
		if (count > 0) {
			redactions.push({ pattern: p.name, count });
			total += count;
		}
	}

	return { out, redactions, total };
}

export function sanitizeDir(dirPath: string): DirSanitizeResult {
	const files: FileSanitizeResult[] = [];
	let totalRedactions = 0;

	let entries: string[];
	try {
		entries = readdirSync(dirPath);
	} catch {
		return { files, totalRedactions };
	}

	for (const name of entries) {
		if (!name.endsWith(".md")) continue;
		const path = join(dirPath, name);
		try {
			if (!statSync(path).isFile()) continue;
		} catch {
			continue;
		}
		const raw = readFileSync(path, "utf-8");
		const { out, redactions, total } = sanitizeContent(raw);
		if (total > 0) {
			writeFileSync(path, out);
		}
		files.push({ file: name, redactions, totalRedactions: total });
		totalRedactions += total;
	}

	return { files, totalRedactions };
}

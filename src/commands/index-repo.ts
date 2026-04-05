import {
	existsSync,
	mkdirSync,
	readFileSync,
	readdirSync,
	writeFileSync,
} from "node:fs";
import { join, relative } from "node:path";
import chalk from "chalk";
import { PROJECT_DIR_PATH } from "../config.js";

// --- Types ---

interface RepoContext {
	indexedAt: string;
	fileCount: number;
	techStack: {
		language: string;
		framework: string | null;
		orm: string | null;
		deps: string[];
	};
	scripts: Record<string, string>;
	schema: SchemaModel[];
	routes: RouteEntry[];
	signatures: FileSignature[];
	fileTree: string[];
}

interface SchemaModel {
	model: string;
	fields: { name: string; type: string; required: boolean }[];
	relations: {
		field: string;
		model: string;
		type: "one" | "many";
		onDelete?: string;
	}[];
}

interface RouteEntry {
	method: string;
	path: string;
	file: string;
}

interface FileExport {
	name: string;
	kind: "function" | "component" | "type" | "const" | "class";
	params?: string;
	props?: string;
}

interface FileSignature {
	file: string;
	exports: FileExport[];
}

// --- Repo root ---

function findRepoRoot(from: string): string | null {
	let dir = from;
	while (dir !== "/") {
		if (existsSync(join(dir, ".git"))) return dir;
		dir = join(dir, "..");
	}
	return null;
}

// --- Gitignore ---

function loadIgnorePatterns(repoRoot: string): string[] {
	const gitignorePath = join(repoRoot, ".gitignore");
	if (!existsSync(gitignorePath)) return [];
	return readFileSync(gitignorePath, "utf-8")
		.split("\n")
		.map((l) => l.trim())
		.filter((l) => l && !l.startsWith("#"));
}

const ALWAYS_IGNORE = new Set([
	"node_modules",
	".git",
	".next",
	"dist",
	"build",
	".speqtra",
	".vercel",
	".turbo",
	"coverage",
	"generated",
]);

function shouldIgnore(rel: string, patterns: string[]): boolean {
	const parts = rel.split("/");
	for (const part of parts) {
		if (ALWAYS_IGNORE.has(part)) return true;
	}
	for (const pattern of patterns) {
		const clean = pattern.replace(/\/$/, "");
		if (parts.includes(clean) || rel.startsWith(clean)) return true;
	}
	return false;
}

// --- File tree ---

function walkDir(dir: string, patterns: string[], repoRoot: string): string[] {
	const files: string[] = [];
	try {
		const entries = readdirSync(dir, { withFileTypes: true });
		for (const entry of entries) {
			const fullPath = join(dir, entry.name);
			const rel = relative(repoRoot, fullPath);
			if (shouldIgnore(rel, patterns)) continue;

			if (entry.isDirectory()) {
				files.push(...walkDir(fullPath, patterns, repoRoot));
			} else if (entry.isFile()) {
				files.push(rel);
			}
		}
	} catch {
		// Permission errors
	}
	return files;
}

// --- Tech stack detection ---

function detectTechStack(repoRoot: string): RepoContext["techStack"] {
	const result: RepoContext["techStack"] = {
		language: "unknown",
		framework: null,
		orm: null,
		deps: [],
	};

	const pkgPath = join(repoRoot, "package.json");
	if (existsSync(pkgPath)) {
		const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
		const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };

		result.language = allDeps.typescript ? "typescript" : "javascript";

		if (allDeps.next) result.framework = "next.js";
		else if (allDeps.express) result.framework = "express";
		else if (allDeps["@nestjs/core"]) result.framework = "nestjs";
		else if (allDeps.fastify) result.framework = "fastify";
		else if (allDeps.react) result.framework = "react";
		else if (allDeps.vue) result.framework = "vue";

		if (allDeps.prisma || allDeps["@prisma/client"]) result.orm = "prisma";
		else if (allDeps["drizzle-orm"]) result.orm = "drizzle";
		else if (allDeps.typeorm) result.orm = "typeorm";
		else if (allDeps.mongoose) result.orm = "mongoose";

		const skip = new Set([
			"typescript",
			"next",
			"react",
			"react-dom",
			"prisma",
			"@prisma/client",
		]);
		result.deps = Object.keys(pkg.dependencies ?? {})
			.filter((d) => !skip.has(d))
			.slice(0, 20);

		return result;
	}

	if (existsSync(join(repoRoot, "Cargo.toml"))) result.language = "rust";
	if (existsSync(join(repoRoot, "go.mod"))) result.language = "go";
	if (existsSync(join(repoRoot, "pyproject.toml"))) result.language = "python";
	if (existsSync(join(repoRoot, "composer.json"))) result.language = "php";

	return result;
}

function extractScripts(repoRoot: string): Record<string, string> {
	const pkgPath = join(repoRoot, "package.json");
	if (!existsSync(pkgPath)) return {};
	const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
	return pkg.scripts ?? {};
}

// --- Prisma schema parsing ---

function parsePrismaSchema(repoRoot: string): SchemaModel[] {
	const schemaPath = join(repoRoot, "prisma", "schema.prisma");
	if (!existsSync(schemaPath)) return [];

	const content = readFileSync(schemaPath, "utf-8");
	const models: SchemaModel[] = [];
	const modelRegex = /model\s+(\w+)\s*\{([^}]+)\}/g;

	for (const match of content.matchAll(modelRegex)) {
		const modelName = match[1];
		const body = match[2];
		const fields: SchemaModel["fields"] = [];
		const relations: SchemaModel["relations"] = [];

		for (const line of body.split("\n")) {
			const trimmed = line.trim();
			if (!trimmed || trimmed.startsWith("//") || trimmed.startsWith("@@"))
				continue;

			const fieldMatch = trimmed.match(/^(\w+)\s+(\w+)(\[\])?\??(\s+.*)?$/);
			if (!fieldMatch) continue;

			const [, name, type, isArray, rest] = fieldMatch;

			if (rest?.includes("@relation")) {
				const onDeleteMatch = rest.match(/onDelete:\s*(\w+)/);
				relations.push({
					field: name,
					model: type,
					type: isArray ? "many" : "one",
					...(onDeleteMatch?.[1] ? { onDelete: onDeleteMatch[1] } : {}),
				});
				continue;
			}

			if (isArray) {
				relations.push({ field: name, model: type, type: "many" });
				continue;
			}

			fields.push({
				name,
				type,
				required: !trimmed.includes("?"),
			});
		}

		models.push({ model: modelName, fields, relations });
	}

	return models;
}

// --- Next.js route detection ---

function detectNextRoutes(repoRoot: string, fileTree: string[]): RouteEntry[] {
	const routes: RouteEntry[] = [];

	for (const file of fileTree) {
		const routeMatch = file.match(
			/(?:src\/)?app\/(api\/.*?)\/route\.(?:ts|js)$/,
		);
		if (!routeMatch) continue;

		const routePath = routeMatch[1]
			.replace(/\[(\w+)\]/g, ":$1")
			.replace(/\/route$/, "");

		const fullPath = join(repoRoot, file);
		try {
			const content = readFileSync(fullPath, "utf-8");
			for (const method of ["GET", "POST", "PUT", "PATCH", "DELETE"]) {
				if (content.includes(`function ${method}`)) {
					routes.push({ method, path: `/${routePath}`, file });
				}
			}
		} catch {
			// Can't read file
		}
	}

	return routes;
}

// --- Export extraction ---

const KEY_DIRS = new Set([
	"src/components/ui",
	"src/components",
	"src/lib",
	"src/app",
]);

function isKeyFile(rel: string): boolean {
	if (!rel.match(/\.(ts|tsx)$/)) return false;
	// UI components, lib utilities, pages, routes, top-level components
	for (const dir of KEY_DIRS) {
		if (rel.startsWith(dir)) return true;
	}
	return false;
}

function extractExports(repoRoot: string, fileTree: string[]): FileSignature[] {
	const signatures: FileSignature[] = [];

	for (const file of fileTree) {
		if (!isKeyFile(file)) continue;

		let content: string;
		try {
			content = readFileSync(join(repoRoot, file), "utf-8");
		} catch {
			continue;
		}

		const exports: FileExport[] = [];

		for (const line of content.split("\n")) {
			const trimmed = line.trim();

			// export default function ComponentName
			const defaultFn = trimmed.match(
				/^export\s+default\s+(?:async\s+)?function\s+(\w+)/,
			);
			if (defaultFn) {
				const isTsx = file.endsWith(".tsx");
				exports.push({
					name: defaultFn[1],
					kind: isTsx ? "component" : "function",
				});
				continue;
			}

			// export function name(params)
			const namedFn = trimmed.match(
				/^export\s+(?:async\s+)?function\s+(\w+)\s*\(([^)]*)\)/,
			);
			if (namedFn) {
				const isTsx = file.endsWith(".tsx") && /^[A-Z]/.test(namedFn[1]);
				exports.push({
					name: namedFn[1],
					kind: isTsx ? "component" : "function",
					...(namedFn[2].trim() ? { params: namedFn[2].trim() } : {}),
				});
				continue;
			}

			// export const name
			const namedConst = trimmed.match(/^export\s+const\s+(\w+)/);
			if (namedConst) {
				exports.push({ name: namedConst[1], kind: "const" });
				continue;
			}

			// export type/interface name
			const typeExport = trimmed.match(/^export\s+(?:type|interface)\s+(\w+)/);
			if (typeExport) {
				exports.push({ name: typeExport[1], kind: "type" });
				continue;
			}

			// export class name
			const classExport = trimmed.match(/^export\s+class\s+(\w+)/);
			if (classExport) {
				exports.push({ name: classExport[1], kind: "class" });
				continue;
			}

			// export { Name, Other } — re-export style (shadcn/radix pattern)
			const reExport = trimmed.match(/^export\s*\{([^}]+)\}/);
			if (reExport) {
				const names = reExport[1]
					.split(",")
					.map((n) => {
						const parts = n.trim().split(/\s+as\s+/);
						return (parts[parts.length - 1] ?? "").trim();
					})
					.filter(Boolean);
				for (const name of names) {
					const isTsx = file.endsWith(".tsx") && /^[A-Z]/.test(name);
					exports.push({ name, kind: isTsx ? "component" : "const" });
				}
			}
		}

		// Extract props type for components
		if (file.endsWith(".tsx") && exports.some((e) => e.kind === "component")) {
			const propsMatch = content.match(
				/(?:interface|type)\s+(\w*Props\w*)\s*(?:=\s*)?{([^}]*)}/,
			);
			if (propsMatch) {
				const propsFields = propsMatch[2]
					.split("\n")
					.map((l) => l.trim())
					.filter((l) => l && !l.startsWith("//"))
					.map((l) => l.replace(/;$/, "").trim())
					.filter(Boolean)
					.join("; ");
				for (const exp of exports) {
					if (exp.kind === "component") {
						exp.props = propsFields;
					}
				}
			}
		}

		if (exports.length > 0) {
			signatures.push({ file, exports });
		}
	}

	return signatures;
}

// --- Markdown generation ---

function toMarkdown(ctx: RepoContext): string {
	const lines: string[] = [];

	lines.push("# Codebase Context");
	lines.push("");
	lines.push("## Tech Stack");
	lines.push(`- Language: ${ctx.techStack.language}`);
	if (ctx.techStack.framework)
		lines.push(`- Framework: ${ctx.techStack.framework}`);
	if (ctx.techStack.orm) lines.push(`- ORM: ${ctx.techStack.orm}`);
	if (ctx.techStack.deps.length > 0)
		lines.push(`- Key deps: ${ctx.techStack.deps.join(", ")}`);

	if (Object.keys(ctx.scripts).length > 0) {
		lines.push("");
		lines.push("## Scripts");
		for (const [name, cmd] of Object.entries(ctx.scripts)) {
			lines.push(`- ${name}: ${cmd}`);
		}
	}

	if (ctx.schema.length > 0) {
		lines.push("");
		lines.push("## Data Models");
		for (const model of ctx.schema) {
			lines.push("");
			lines.push(`### ${model.model}`);
			if (model.fields.length > 0) {
				const fieldStrs = model.fields.map(
					(f) => `${f.name} (${f.type}${f.required ? "" : "?"})`,
				);
				lines.push(`Fields: ${fieldStrs.join(", ")}`);
			}
			if (model.relations.length > 0) {
				const relStrs = model.relations.map((r) => {
					let s = `${r.field} → ${r.model} (${r.type})`;
					if (r.onDelete) s += ` onDelete: ${r.onDelete}`;
					return s;
				});
				lines.push(`Relations: ${relStrs.join(", ")}`);
			}
		}
	}

	if (ctx.routes.length > 0) {
		lines.push("");
		lines.push("## Routes");
		for (const r of ctx.routes) {
			lines.push(`- ${r.method} ${r.path} → ${r.file}`);
		}
	}

	if (ctx.signatures.length > 0) {
		lines.push("");
		lines.push("## Exports");
		for (const sig of ctx.signatures) {
			const parts = sig.exports.map((e) => {
				let s = `${e.kind} ${e.name}`;
				if (e.params) s += `(${e.params})`;
				if (e.props) s += ` props: {${e.props}}`;
				return s;
			});
			lines.push(`- ${sig.file}: ${parts.join(", ")}`);
		}
	}

	lines.push("");
	lines.push(`## File Tree (${ctx.fileCount} files)`);
	for (const f of ctx.fileTree.slice(0, 100)) {
		lines.push(`- ${f}`);
	}
	if (ctx.fileTree.length > 100) {
		lines.push(`- ... and ${ctx.fileTree.length - 100} more`);
	}

	return lines.join("\n");
}

// --- Main ---

export async function indexRepo(options: { json?: boolean }) {
	const repoRoot = findRepoRoot(process.cwd());
	if (!repoRoot) {
		console.error(chalk.red("Not a git repository. Run from a repo root."));
		process.exit(1);
	}

	if (!existsSync(PROJECT_DIR_PATH)) {
		mkdirSync(PROJECT_DIR_PATH, { recursive: true });
	}

	const patterns = loadIgnorePatterns(repoRoot);
	const fileTree = walkDir(repoRoot, patterns, repoRoot).sort();
	const techStack = detectTechStack(repoRoot);
	const scripts = extractScripts(repoRoot);
	const schema = parsePrismaSchema(repoRoot);
	const routes =
		techStack.framework === "next.js"
			? detectNextRoutes(repoRoot, fileTree)
			: [];
	const signatures = extractExports(repoRoot, fileTree);

	const context: RepoContext = {
		indexedAt: new Date().toISOString(),
		fileCount: fileTree.length,
		techStack,
		scripts,
		schema,
		routes,
		signatures,
		fileTree,
	};

	const jsonPath = join(PROJECT_DIR_PATH, "repo-context.json");
	const mdPath = join(PROJECT_DIR_PATH, "repo-context.md");

	writeFileSync(jsonPath, JSON.stringify(context, null, 2));
	writeFileSync(mdPath, toMarkdown(context));

	if (options.json) {
		console.log(JSON.stringify(context));
	} else {
		console.log(chalk.green("✓ Indexed repository"));
		console.log(
			chalk.dim(
				`  ${fileTree.length} files, ${schema.length} models, ${routes.length} routes, ${signatures.length} modules`,
			),
		);
		console.log(
			chalk.dim(
				`  Stack: ${techStack.language}${techStack.framework ? ` + ${techStack.framework}` : ""}${techStack.orm ? ` + ${techStack.orm}` : ""}`,
			),
		);
		console.log(chalk.dim(`  JSON: ${jsonPath}`));
		console.log(chalk.dim(`  MD:   ${mdPath}`));
		console.log(chalk.dim("  Run `speqtra sync` to push to server."));
	}
}

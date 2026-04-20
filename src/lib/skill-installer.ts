import { copyFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SKILL_NAME = "speqtra-index";
const PROJECT_SKILL_DIR = join(".claude", "skills", SKILL_NAME);
const PROJECT_SKILL_FILE = join(PROJECT_SKILL_DIR, "SKILL.md");

const here = dirname(fileURLToPath(import.meta.url));
const BUNDLED_SKILL_FILE = join(
	here,
	"..",
	"..",
	"skill",
	SKILL_NAME,
	"SKILL.md",
);

function readVersion(path: string): string | null {
	try {
		const content = readFileSync(path, "utf-8");
		const fm = content.match(/^---\n([\s\S]*?)\n---/);
		if (!fm) return null;
		const v = fm[1].match(/^version:\s*(\S+)/m);
		return v ? v[1] : null;
	} catch {
		return null;
	}
}

export interface InstallResult {
	action: "installed" | "updated" | "skipped-manual" | "up-to-date";
	from?: string;
	to?: string;
	bundledVersion?: string;
	projectVersion?: string | null;
}

export function installSkill(): InstallResult {
	if (!existsSync(BUNDLED_SKILL_FILE)) {
		throw new Error(
			`Bundled skill not found at ${BUNDLED_SKILL_FILE}. Reinstall @speqtra/cli.`,
		);
	}

	const bundledVersion = readVersion(BUNDLED_SKILL_FILE);
	if (!bundledVersion) {
		throw new Error(
			`Bundled skill at ${BUNDLED_SKILL_FILE} is missing a version in its frontmatter.`,
		);
	}

	// If the project copy is user-edited (generator: manual), never overwrite.
	if (existsSync(PROJECT_SKILL_FILE)) {
		const content = readFileSync(PROJECT_SKILL_FILE, "utf-8");
		if (/^generator:\s*manual\s*$/m.test(content)) {
			return {
				action: "skipped-manual",
				to: PROJECT_SKILL_FILE,
				bundledVersion,
			};
		}
	}

	const projectVersion = existsSync(PROJECT_SKILL_FILE)
		? readVersion(PROJECT_SKILL_FILE)
		: null;

	if (projectVersion === bundledVersion) {
		return {
			action: "up-to-date",
			to: PROJECT_SKILL_FILE,
			bundledVersion,
			projectVersion,
		};
	}

	mkdirSync(PROJECT_SKILL_DIR, { recursive: true });
	copyFileSync(BUNDLED_SKILL_FILE, PROJECT_SKILL_FILE);

	return {
		action: projectVersion ? "updated" : "installed",
		from: BUNDLED_SKILL_FILE,
		to: PROJECT_SKILL_FILE,
		bundledVersion,
		projectVersion,
	};
}

export { PROJECT_SKILL_FILE, BUNDLED_SKILL_FILE };

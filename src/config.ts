import {
	chmodSync,
	existsSync,
	mkdirSync,
	readFileSync,
	writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

interface Credentials {
	serverUrl: string;
	apiKey: string;
	userId: string;
	userName: string;
}

interface ProjectConfig {
	projectId: string;
	projectName: string;
	taskPrefix: string;
	localCounter: number;
}

const CREDENTIALS_DIR = join(homedir(), ".config", "speqtra");
const CREDENTIALS_FILE = join(CREDENTIALS_DIR, "credentials.json");
const PROJECT_DIR = ".speqtra";
const PROJECT_CONFIG_FILE = join(PROJECT_DIR, "config.json");

export function getCredentials(): Credentials | null {
	if (!existsSync(CREDENTIALS_FILE)) return null;
	try {
		return JSON.parse(readFileSync(CREDENTIALS_FILE, "utf-8"));
	} catch {
		return null;
	}
}

export function saveCredentials(creds: Credentials): void {
	mkdirSync(CREDENTIALS_DIR, { recursive: true });
	writeFileSync(CREDENTIALS_FILE, JSON.stringify(creds, null, 2));
	chmodSync(CREDENTIALS_FILE, 0o600);
}

export function getProjectConfig(): ProjectConfig | null {
	if (!existsSync(PROJECT_CONFIG_FILE)) return null;
	try {
		return JSON.parse(readFileSync(PROJECT_CONFIG_FILE, "utf-8"));
	} catch {
		return null;
	}
}

export function saveProjectConfig(config: ProjectConfig): void {
	mkdirSync(PROJECT_DIR, { recursive: true });
	writeFileSync(PROJECT_CONFIG_FILE, JSON.stringify(config, null, 2));
	ensureGitignore();
}

function ensureGitignore(): void {
	const gitignorePath = ".gitignore";
	if (!existsSync(gitignorePath)) {
		writeFileSync(gitignorePath, ".speqtra/\n");
		return;
	}
	const content = readFileSync(gitignorePath, "utf-8");
	if (!content.includes(".speqtra")) {
		writeFileSync(gitignorePath, `${content.trimEnd()}\n.speqtra/\n`);
	}
}

export function nextLocalNumber(): number {
	const config = getProjectConfig();
	if (!config) throw new Error("No project linked.");
	config.localCounter = (config.localCounter || 0) - 1;
	saveProjectConfig(config);
	return config.localCounter;
}

export function formatTaskId(prefix: string, number: number | null): string {
	if (number === null) return "???";
	if (number < 0) return `${prefix}-local${Math.abs(number)}`;
	return `${prefix}-${number}`;
}

export const PROJECT_DIR_PATH = PROJECT_DIR;
export const DB_PATH = join(PROJECT_DIR, "speqtra.db");
export const CONTEXT_DIR_PATH = join(PROJECT_DIR, "context");

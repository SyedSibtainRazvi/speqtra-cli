import { createInterface } from "node:readline/promises";
import chalk from "chalk";
import { saveCredentials } from "../config.js";

export async function login(options: { json?: boolean }) {
	const rl = createInterface({ input: process.stdin, output: process.stdout });

	let serverUrl: string;
	try {
		serverUrl = await rl.question(
			`Server URL ${chalk.dim("(default: https://speqtra.app)")}: `,
		);
	} finally {
		// Don't close rl yet, need it for the next question
	}
	serverUrl = serverUrl.trim() || "https://speqtra.app";
	serverUrl = serverUrl.replace(/\/$/, "");

	let apiKey: string;
	try {
		apiKey = await rl.question("Paste your API key: ");
	} finally {
		rl.close();
	}
	apiKey = apiKey.trim();

	if (!apiKey) {
		console.error(
			chalk.red(
				"No API key provided. Generate one at https://speqtra.app/speqtra/settings",
			),
		);
		process.exit(1);
	}

	// Verify the key
	const res = await fetch(`${serverUrl}/api/v1/me`, {
		headers: { Authorization: `Bearer ${apiKey}` },
	});

	if (!res.ok) {
		console.error(
			chalk.red("Invalid API key. Generate one at Settings > API Keys."),
		);
		process.exit(1);
	}

	const { user } = (await res.json()) as {
		user: { id: string; name: string; email: string };
	};

	saveCredentials({
		serverUrl,
		apiKey,
		userId: user.id,
		userName: user.name,
	});

	if (options.json) {
		console.log(JSON.stringify({ status: "ok", user }));
	} else {
		console.log(chalk.green(`✓ Logged in as ${user.name}`));
	}
}

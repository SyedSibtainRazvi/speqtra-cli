import { getCredentials } from "./config.js";

class ApiError extends Error {
	constructor(
		public status: number,
		message: string,
		public body?: unknown,
	) {
		super(message);
	}
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
	const creds = getCredentials();
	if (!creds) {
		throw new Error("No credentials found. Run `speqtra login` first.");
	}

	const url = `${creds.serverUrl}${path}`;
	let res: Response;
	try {
		res = await fetch(url, {
			...options,
			headers: {
				Authorization: `Bearer ${creds.apiKey}`,
				"Content-Type": "application/json",
				...options?.headers,
			},
		});
	} catch (err) {
		const msg =
			err instanceof Error ? err.message : "Network request failed";
		throw new ApiError(
			0,
			`Could not reach server at ${creds.serverUrl}. ${msg}`,
		);
	}

	if (res.status === 401) {
		throw new ApiError(
			401,
			"Your API key is no longer valid. Run `speqtra login` to re-authenticate.",
		);
	}

	const text = await res.text();
	let body: unknown;
	try {
		body = JSON.parse(text);
	} catch {
		throw new ApiError(
			res.status,
			`Server returned non-JSON response (HTTP ${res.status}). Is the server URL correct? Current: ${creds.serverUrl}`,
		);
	}

	if (!res.ok) {
		const msg = (body as Record<string, string>)?.error ?? `HTTP ${res.status}`;
		throw new ApiError(res.status, msg, body);
	}

	return body as T;
}

export function get<T>(path: string): Promise<T> {
	return request<T>(path);
}

export function post<T>(path: string, data: unknown): Promise<T> {
	return request<T>(path, {
		method: "POST",
		body: JSON.stringify(data),
	});
}

export function patch<T>(path: string, data: unknown): Promise<T> {
	return request<T>(path, {
		method: "PATCH",
		body: JSON.stringify(data),
	});
}

export { ApiError };

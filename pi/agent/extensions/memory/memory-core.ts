/**
 * Core logic for the pi memory extension.
 *
 * Plain node built-ins only (no pi imports) so it can be unit-tested with
 * `node --test` without the pi runtime.
 */

import { execFile } from "node:child_process";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";

export const MEMORY_DIR_ENV = "PI_MEMORIES_DIR";
const MEMORY_FILE_NAME = "MEMORY.md";
const GIT_TIMEOUT_MS = 5000;

/** Git runner abstraction so scope resolution is testable. */
export type GitRunner = (
	args: string[],
	cwd: string,
) => Promise<{ code: number; stdout: string; stderr: string }>;

export const realGitRunner: GitRunner = (args, cwd) =>
	new Promise((resolveRun) => {
		execFile(
			"git",
			args,
			{ cwd, timeout: GIT_TIMEOUT_MS },
			(err, stdout, stderr) => {
				let code = 0;
				if (err) code = typeof err.code === "number" ? err.code : 1;
				resolveRun({
					code,
					stdout: String(stdout ?? ""),
					stderr: String(stderr ?? ""),
				});
			},
		);
	});

/**
 * Resolve the memory scope for a working directory.
 *
 * - Inside a git repository: the repository root. Worktrees resolve to the
 *   main repository root (via `--git-common-dir`), so every worktree of a
 *   repo shares one memory file.
 * - Not a git repository (or git unavailable): the folder itself.
 */
export async function resolveScopeDir(
	cwd: string,
	runGit: GitRunner,
): Promise<string> {
	const common = await runGit(["rev-parse", "--git-common-dir"], cwd);
	if (common.code !== 0) return cwd;

	let commonDir = common.stdout.trim();
	if (!commonDir) return cwd;

	// When relative, git reports the path relative to cwd.
	if (!isAbsolute(commonDir)) commonDir = resolve(cwd, commonDir);

	// A bare repo reports its own directory; scope to it instead of its parent.
	if (commonDir === cwd) return cwd;

	// The common git dir is the shared `.git`; the repo root is its parent.
	return dirname(commonDir);
}

/** Directory where a scope's memory file lives: <memoriesDir>/<abs scope path>/MEMORY.md. */
export function memoryFilePath(memoriesDir: string, scope: string): string {
	const rel = scope.replace(/^[/\\]+/, "");
	return join(memoriesDir, rel === "" ? "root" : rel, MEMORY_FILE_NAME);
}

export function getMemoriesDir(): string {
	const env = process.env[MEMORY_DIR_ENV]?.trim();
	return resolve(env ? expandHome(env) : join(homedir(), ".pi", "memories"));
}

export function expandHome(p: string): string {
	if (p === "~") return homedir();
	if (p.startsWith("~/") || p.startsWith("~\\"))
		return join(homedir(), p.slice(2));
	return p;
}

export interface MemoryEntry {
	id: string;
	title: string;
	body: string;
}

const ENTRY_HEADING_RE = /^## (m\d+): (.*)$/;

export function newMemoryFileContent(scope: string): string {
	return `# Project Memory — ${scope}\n\nEntries are managed by the pi \`memory\` tool.\n`;
}

function splitMemory(content: string): {
	preamble: string;
	entries: MemoryEntry[];
} {
	const lines = content.split("\n");
	let first = lines.length;
	for (const [index, line] of lines.entries()) {
		if (ENTRY_HEADING_RE.test(line)) {
			first = index;
			break;
		}
	}
	const preamble = lines.slice(0, first).join("\n").replace(/\n+$/, "");
	const entries: MemoryEntry[] = [];
	let current: MemoryEntry | undefined;
	const flush = () => {
		if (current) {
			entries.push({ ...current, body: current.body.replace(/\n+$/, "") });
			current = undefined;
		}
	};
	for (const line of lines.slice(first)) {
		const match = ENTRY_HEADING_RE.exec(line);
		if (match?.[1] !== undefined && match[2] !== undefined) {
			flush();
			current = { id: match[1], title: match[2], body: "" };
		} else if (current) {
			current.body += (current.body ? "\n" : "") + line;
		}
	}
	flush();
	return { preamble, entries };
}

function serializeMemory(preamble: string, entries: MemoryEntry[]): string {
	const parts: string[] = [];
	if (preamble.trim()) parts.push(preamble.trimEnd());
	for (const entry of entries) {
		parts.push(`## ${entry.id}: ${entry.title}\n${entry.body}`.trimEnd());
	}
	return parts.join("\n\n") + "\n";
}

/** "3" and "M3" both normalize to "m3". */
export function normalizeId(raw: string): string {
	const trimmed = raw.trim().toLowerCase();
	return trimmed.startsWith("m") ? trimmed : `m${trimmed}`;
}

function nextEntryId(entries: MemoryEntry[]): string {
	let max = 0;
	for (const entry of entries) {
		max = Math.max(max, Number(entry.id.slice(1)) || 0);
	}
	return `m${max + 1}`;
}

export function addEntry(
	content: string,
	title: string,
	body: string,
	now: Date,
): { content: string; entry: MemoryEntry } {
	if (!title.trim()) throw new Error('memory add requires a non-empty "title"');
	const { preamble, entries } = splitMemory(content);
	const entry: MemoryEntry = {
		id: nextEntryId(entries),
		title: `${title.trim()} (${now.toISOString().slice(0, 10)})`,
		body: body.trim(),
	};
	return { content: serializeMemory(preamble, [...entries, entry]), entry };
}

export function removeEntry(
	content: string,
	id: string,
): { content: string; removed: MemoryEntry } {
	const { preamble, entries } = splitMemory(content);
	const removed = entries.find((entry) => entry.id === id);
	if (!removed) throw new Error(`memory entry ${id} not found`);
	return {
		content: serializeMemory(
			preamble,
			entries.filter((entry) => entry !== removed),
		),
		removed,
	};
}

export function listEntries(content: string): string[] {
	return splitMemory(content).entries.map(
		(entry) => `${entry.id}: ${entry.title}`,
	);
}

/**
 * Session-scoped memory store.
 *
 * Entries live in a sidecar file next to the session file
 * (`<sessionFile>.memory.json`), so they are stable across resume and never
 * shared between sessions. Compaction (see ../live-compaction) injects the
 * entries into the summarization instruction so they survive compaction.
 */

import { readFile, readdir, stat, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";

export interface SessionMemoryEntry {
	id: string;
	title: string;
	body: string;
	timestamp: string;
}

export const MEMORY_SIDECAR_SUFFIX = ".memory.json";

/** Session memory is a working aid, not an archive: drop sidecars untouched for this long. */
export const SESSION_MEMORY_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;

export function memoryFilePath(sessionFile: string): string {
	return `${sessionFile}${MEMORY_SIDECAR_SUFFIX}`;
}

async function readFileOrNull(path: string): Promise<string | undefined> {
	try {
		return await readFile(path, "utf8");
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
		throw error;
	}
}

export async function loadEntries(sessionFile: string): Promise<SessionMemoryEntry[]> {
	const raw = await readFileOrNull(memoryFilePath(sessionFile));
	if (!raw) return [];
	try {
		const parsed: unknown = JSON.parse(raw);
		if (!Array.isArray(parsed)) return [];
		return parsed.filter(
			(entry): entry is SessionMemoryEntry =>
				typeof entry === "object" &&
				entry !== null &&
				typeof (entry as SessionMemoryEntry).id === "string" &&
				typeof (entry as SessionMemoryEntry).title === "string" &&
				typeof (entry as SessionMemoryEntry).body === "string",
		);
	} catch {
		// Corrupt sidecar: treat as empty rather than failing compaction.
		return [];
	}
}

export async function saveEntries(sessionFile: string, entries: SessionMemoryEntry[]): Promise<void> {
	await writeFile(memoryFilePath(sessionFile), JSON.stringify(entries, null, "\t"), "utf8");
}

export function addEntry(
	entries: SessionMemoryEntry[],
	title: string,
	body: string,
	now: Date,
): { entries: SessionMemoryEntry[]; id: string } {
	const maxNum = entries.reduce((max, entry) => {
		const num = Number.parseInt(entry.id.slice(1), 10);
		return Number.isFinite(num) ? Math.max(max, num) : max;
	}, 0);
	const id = `s${maxNum + 1}`;
	return {
		entries: [...entries, { id, title, body, timestamp: now.toISOString() }],
		id,
	};
}

export function removeEntry(entries: SessionMemoryEntry[], id: string): SessionMemoryEntry[] {
	return entries.filter((entry) => entry.id !== id);
}

/** Render entries for injection into the compaction instruction. */
export function formatEntries(entries: SessionMemoryEntry[]): string {
	return entries
		.map((entry) =>
			entry.body.trim() ? `${entry.id}: ${entry.title}\n${entry.body.trim()}` : `${entry.id}: ${entry.title}`,
		)
		.join("\n\n");
}

/** Delete sidecars in the sessions dir whose last modification predates the cutoff. */
export async function cleanupStaleSidecars(
	sessionDir: string,
	maxAgeMs: number,
	now: Date,
): Promise<number> {
	let names: string[];
	try {
		names = await readdir(sessionDir);
	} catch {
		return 0;
	}
	const cutoff = now.getTime() - maxAgeMs;
	let removed = 0;
	for (const name of names) {
		if (!name.endsWith(MEMORY_SIDECAR_SUFFIX)) continue;
		const path = join(sessionDir, name);
		try {
			const info = await stat(path);
			if (info.mtimeMs < cutoff) {
				await unlink(path);
				removed++;
			}
		} catch {
			// Best-effort GC.
		}
	}
	return removed;
}

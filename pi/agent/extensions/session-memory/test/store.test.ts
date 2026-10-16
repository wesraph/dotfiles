/**
 * Run: node --test pi/agent/extensions/session-memory/test/
 */
import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, rm, utimes, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import {
	addEntry,
	cleanupStaleSidecars,
	formatEntries,
	loadEntries,
	memoryFilePath,
	removeEntry,
	SESSION_MEMORY_MAX_AGE_MS,
	saveEntries,
} from "../store.ts";

const TMP_DIR = join(import.meta.dirname, ".tmp");

async function withTmpDir<T>(run: (dir: string) => Promise<T>): Promise<T> {
	await rm(TMP_DIR, { recursive: true, force: true });
	await mkdir(TMP_DIR, { recursive: true });
	try {
		return await run(TMP_DIR);
	} finally {
		await rm(TMP_DIR, { recursive: true, force: true });
	}
}

test("memoryFilePath appends sidecar suffix", () => {
	assert.equal(memoryFilePath("/sessions/foo.jsonl"), "/sessions/foo.jsonl.memory.json");
});

test("addEntry assigns sequential ids and preserves order", () => {
	const first = addEntry([], "Title", "Body", new Date("2026-10-01T00:00:00Z"));
	assert.equal(first.id, "s1");
	const second = addEntry(first.entries, "Another", "", new Date("2026-10-01T00:01:00Z"));
	assert.equal(second.id, "s2");
	assert.deepEqual(
		second.entries.map((entry) => entry.id),
		["s1", "s2"],
	);
	assert.equal(second.entries[0].timestamp, "2026-10-01T00:00:00.000Z");
});

test("addEntry skips removed ids when sequencing", () => {
	const one = addEntry([], "One", "", new Date());
	const two = addEntry(one.entries, "Two", "", new Date());
	const afterRemove = removeEntry(two.entries, "s1");
	const three = addEntry(afterRemove, "Three", "", new Date());
	assert.equal(three.id, "s3");
	assert.deepEqual(
		three.entries.map((entry) => entry.id),
		["s2", "s3"],
	);
});

test("saveEntries and loadEntries round-trip", async () => {
	await withTmpDir(async (dir) => {
		const sessionFile = join(dir, "session.jsonl");
		const added = addEntry(addEntry([], "Goal", "Ship the feature", new Date()).entries, "Gotcha", "", new Date());
		await saveEntries(sessionFile, added.entries);

		const loaded = await loadEntries(sessionFile);
		assert.deepEqual(loaded, added.entries);
	});
});

test("loadEntries returns empty for missing or corrupt sidecar", async () => {
	await withTmpDir(async (dir) => {
		const sessionFile = join(dir, "session.jsonl");
		assert.deepEqual(await loadEntries(sessionFile), []);

		await writeFile(memoryFilePath(sessionFile), "{not json", "utf8");
		assert.deepEqual(await loadEntries(sessionFile), []);

		await writeFile(
			memoryFilePath(sessionFile),
			JSON.stringify([
				"not-an-entry",
				{ id: "s1" },
				{ id: "s2", body: "no title" },
				{ id: "s3", title: "no body" },
				{ title: "no id", body: "x" },
			]),
			"utf8",
		);
		assert.deepEqual(await loadEntries(sessionFile), []);
	});
});

test("formatEntries renders ids, titles and bodies", () => {
	const text = formatEntries([
		{ id: "s1", title: "Goal", body: "Ship it", timestamp: "2026-10-01T00:00:00Z" },
		{ id: "s2", title: "Bare", body: "", timestamp: "2026-10-01T00:00:00Z" },
	]);
	assert.equal(text, "s1: Goal\nShip it\n\ns2: Bare");
});

test("cleanupStaleSidecars removes only sidecars older than the cutoff", async () => {
	await withTmpDir(async (dir) => {
		const now = new Date("2026-10-15T12:00:00Z");
		const maxAgeMs = 60 * 60 * 1000;
		const oldSidecar = join(dir, "old.jsonl.memory.json");
		const freshSidecar = join(dir, "fresh.jsonl.memory.json");
		const unrelated = join(dir, "old.jsonl");
		await writeFile(oldSidecar, "[]", "utf8");
		await writeFile(freshSidecar, "[]", "utf8");
		await writeFile(unrelated, "{}", "utf8");

		const oldTime = new Date(now.getTime() - maxAgeMs - 1);
		const freshTime = new Date(now.getTime() - maxAgeMs + 60 * 1000);
		await utimes(oldSidecar, oldTime, oldTime);
		await utimes(freshSidecar, freshTime, freshTime);
		// Backdate the non-sidecar file too: GC must never touch files without the sidecar suffix.
		await utimes(unrelated, oldTime, oldTime);

		const removed = await cleanupStaleSidecars(dir, maxAgeMs, now);
		assert.equal(removed, 1);
		assert.deepEqual(await loadEntries(join(dir, "old.jsonl")), []);
		assert.deepEqual(await loadEntries(join(dir, "fresh.jsonl")), []);
		assert.equal(existsSync(unrelated), true, "non-sidecar files must never be deleted");
	});
});

test("cleanupStaleSidecars tolerates missing directory", async () => {
	const removed = await cleanupStaleSidecars(join(TMP_DIR, "does-not-exist"), 1000, new Date());
	assert.equal(removed, 0);
});

test("SESSION_MEMORY_MAX_AGE_MS is a 14-day window", () => {
	assert.equal(SESSION_MEMORY_MAX_AGE_MS, 14 * 24 * 60 * 60 * 1000);
});

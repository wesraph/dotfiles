/**
 * Run: node --test pi/agent/extensions/session-memory/test/
 */
import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, rm, utimes, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import extension from "../index.ts";
import {
	loadEntries,
	memoryFilePath,
	saveEntries,
	SESSION_MEMORY_MAX_AGE_MS,
} from "../store.ts";

const TMP_DIR = join(import.meta.dirname, ".tmp");

interface CapturedTool {
	name: string;
	definition: {
		parameters: unknown;
		execute: (
			toolCallId: string,
			params: Record<string, string>,
			signal: undefined,
			onUpdate: undefined,
			ctx: unknown,
		) => Promise<{ content: { type: string; text: string }[] }>;
	};
}

function loadExtension() {
	const handlers = new Map<string, (event: unknown, ctx: unknown) => unknown>();
	const tools: CapturedTool[] = [];
	const pi = {
		on: (topic: string, handler: (event: unknown, ctx: unknown) => unknown) => {
			handlers.set(topic, handler);
		},
		registerTool: (definition: CapturedTool["definition"]) => {
			tools.push({ name: definition.name, definition });
		},
	};
	extension(pi as never);
	return { handlers, tools };
}

function makeCtx(sessionFile: string) {
	return { sessionManager: { getSessionFile: () => sessionFile, getSessionDir: () => join(sessionFile, "..") } };
}

async function withSessionFile<T>(run: (sessionFile: string) => Promise<T>): Promise<T> {
	await rm(TMP_DIR, { recursive: true, force: true });
	await mkdir(TMP_DIR, { recursive: true });
	const sessionFile = join(TMP_DIR, "session.jsonl");
	try {
		return await run(sessionFile);
	} finally {
		await rm(TMP_DIR, { recursive: true, force: true });
	}
}

test("registers a session_memory tool with enum actions and optional fields", () => {
	const { tools } = loadExtension();
	assert.equal(tools.length, 1);
	assert.equal(tools[0].name, "session_memory");
	const parameters = tools[0].definition.parameters as {
		properties: Record<string, unknown>;
	};
	assert.deepEqual(Object.keys(parameters.properties), ["action", "title", "body", "id"]);
	const serialized = JSON.stringify(parameters.properties.action);
	for (const action of ["add", "remove", "list", "clear"])
		assert.ok(serialized.includes(`"${action}"`), `action enum must include ${action}`);
});

test("add, list, remove and clear flow through the sidecar", async () => {
	await withSessionFile(async (sessionFile) => {
		const { tools } = loadExtension();
		const tool = tools[0];
		const ctx = makeCtx(sessionFile);

		await tool.definition.execute("t1", { action: "add", title: "Goal", body: "Ship it" }, undefined, undefined, ctx);
		await tool.definition.execute("t2", { action: "add", title: "Gotcha" }, undefined, undefined, ctx);

		const list = await tool.definition.execute("t3", { action: "list" }, undefined, undefined, ctx);
		assert.match(list.content[0].text, /s1: Goal\nShip it/);
		assert.match(list.content[0].text, /s2: Gotcha/);

		const removed = await tool.definition.execute("t4", { action: "remove", id: "s1" }, undefined, undefined, ctx);
		assert.match(removed.content[0].text, /Removed from session memory: s1/);
		assert.deepEqual(
			(await loadEntries(sessionFile)).map((entry) => entry.id),
			["s2"],
		);

		const cleared = await tool.definition.execute("t5", { action: "clear" }, undefined, undefined, ctx);
		assert.match(cleared.content[0].text, /Cleared/);
		assert.deepEqual(await loadEntries(sessionFile), []);
	});
});

test("add rejects empty titles, remove rejects missing ids and unknown ids", async () => {
	await withSessionFile(async (sessionFile) => {
		const { tools } = loadExtension();
		const tool = tools[0];
		const ctx = makeCtx(sessionFile);

		await assert.rejects(
			() => tool.definition.execute("t1", { action: "add", title: "  " }, undefined, undefined, ctx),
			/requires a title/,
		);
		await assert.rejects(
			() => tool.definition.execute("t0", { action: "remove" }, undefined, undefined, ctx),
			/requires an id/,
		);
		await saveEntries(sessionFile, [{ id: "s1", title: "Only", body: "", timestamp: "2026-10-01T00:00:00Z" }]);
		await assert.rejects(
			() => tool.definition.execute("t2", { action: "remove", id: "s9" }, undefined, undefined, ctx),
			/No session memory entry/,
		);
	});
});

test("tool is unavailable for sessions without a session file", async () => {
	const { tools } = loadExtension();
	const tool = tools[0];
	const ctx = { sessionManager: { getSessionFile: () => undefined, getSessionDir: () => TMP_DIR } };

	const listed = await tool.definition.execute("t1", { action: "list" }, undefined, undefined, ctx);
	assert.match(listed.content[0].text, /no session file/);
	const added = await tool.definition.execute("t2", { action: "add", title: "X" }, undefined, undefined, ctx);
	assert.match(added.content[0].text, /unavailable/);
});

test("concurrent adds do not lose entries", async () => {
	await withSessionFile(async (sessionFile) => {
		const { tools } = loadExtension();
		const tool = tools[0];
		const ctx = makeCtx(sessionFile);

		await Promise.all([
			tool.definition.execute("t1", { action: "add", title: "First" }, undefined, undefined, ctx),
			tool.definition.execute("t2", { action: "add", title: "Second" }, undefined, undefined, ctx),
			tool.definition.execute("t3", { action: "add", title: "Third" }, undefined, undefined, ctx),
		]);

		const entries = await loadEntries(sessionFile);
		assert.deepEqual(
			entries.map((entry) => entry.title).sort(),
			["First", "Second", "Third"],
		);
	});
});

test("session_start GC removes stale sidecars but keeps fresh ones", async () => {
	await withSessionFile(async (sessionFile) => {
		const dir = join(sessionFile, "..");
		const stale = memoryFilePath(join(dir, "stale.jsonl"));
		const fresh = memoryFilePath(sessionFile);
		await writeFile(stale, "[]", "utf8");
		await writeFile(fresh, "[]", "utf8");
		const staleTime = new Date(Date.now() - SESSION_MEMORY_MAX_AGE_MS - 1);
		await utimes(stale, staleTime, staleTime);

		const { handlers } = loadExtension();
		const ctx = { sessionManager: { getSessionFile: () => sessionFile, getSessionDir: () => dir } };
		await handlers.get("session_start")!({}, ctx);
		// GC runs fire-and-forget; wait until it settles (bounded).
		for (let i = 0; i < 100 && existsSync(stale); i++) {
			await new Promise((resolve) => setTimeout(resolve, 5));
		}

		assert.equal(existsSync(stale), false, "stale sidecar must be removed");
		assert.equal(existsSync(fresh), true, "fresh sidecar must survive");
		assert.deepEqual(await loadEntries(sessionFile), []);
	});
});

test("session_start handler swallows GC failures", async () => {
	const { handlers } = loadExtension();
	const ctx = { sessionManager: { getSessionDir: () => { throw new Error("boom"); } } };
	// GC is fire-and-forget; the handler itself must not throw.
	await handlers.get("session_start")!({}, ctx);
});

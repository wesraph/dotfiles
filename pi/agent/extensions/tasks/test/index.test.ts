/**
 * Run: node --test --test-force-exit pi/agent/extensions/tasks/test/
 * (--test-force-exit: the task widget's spinner interval keeps the loop alive)
 */
import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import extension from "../index.ts";

const TMP_DIR = join(import.meta.dirname, ".tmp");

type Tool = {
	name: string;
	description: string;
	promptGuidelines?: unknown;
	execute: (id: null, params: never, signal: undefined, onUpdate: undefined, ctx: never) => Promise<{ content: { text: string }[] }>;
};

function load() {
	const tools = new Map<string, Tool>();
	const handlers = new Map<string, (event: unknown, ctx: unknown) => Promise<unknown>>();
	const ui = {
		notify: () => {},
		requestRender: () => {},
		setWidget: () => {},
		select: async () => undefined,
		input: async () => undefined,
		terminal: {},
	};
	const pi = {
		on: (topic: string, h: (event: unknown, ctx: unknown) => Promise<unknown>) => handlers.set(topic, h),
		registerTool: (t: Tool) => tools.set(t.name, t),
		registerCommand: () => {},
		events: { on: () => () => {}, emit: () => undefined },
	};
	extension(pi as never);

	const ctx = {
		cwd: TMP_DIR,
		sessionManager: {
			getSessionFile: () => join(TMP_DIR, "session.jsonl"),
			getSessionId: () => "test-session",
		},
		ui,
	};
	return { tools, ctx, start: () => handlers.get("before_agent_start")!(undefined, ctx) };
}

const text = (r: { content: { text: string }[] }) => r.content.map((c) => c.text).join("\n");
const call = (t: Tool, params: Record<string, unknown>) => t.execute(null, params as never, undefined, undefined, undefined as never);

test("registers the seven task tools with trimmed descriptions", async () => {
	const { tools } = load();
	assert.deepEqual(
		[...tools.keys()].sort(),
		["TaskCreate", "TaskExecute", "TaskGet", "TaskList", "TaskOutput", "TaskStop", "TaskUpdate"],
	);
	let total = 0;
	for (const t of tools.values()) {
		assert.ok(t.description.length < 1200, `${t.name} description too long: ${t.description.length}`);
		assert.equal(t.promptGuidelines, undefined, `${t.name} still ships promptGuidelines`);
		total += t.description.length;
	}
	assert.ok(total < 4000, `combined descriptions too long: ${total}`);
	assert.match(tools.get("TaskUpdate")!.description, /in_progress/);
	assert.match(tools.get("TaskUpdate")!.description, /deleted/);
	assert.match(tools.get("TaskExecute")!.description, /agentType/);
});

test("create → list → get → update roundtrip", async () => {
	await rm(TMP_DIR, { recursive: true, force: true });
	await mkdir(TMP_DIR, { recursive: true });
	const { tools, start } = load();
	await start();

	const create = tools.get("TaskCreate")!;
	assert.match(text(await call(create, { subject: "Fix auth bug", description: "Token expiry uses < not <=" })), /^Task #1 created/);
	assert.match(text(await call(create, { subject: "Add tests" })), /^Task #2 created/);

	const list = tools.get("TaskList")!;
	const listed = text(await call(list, {}));
	assert.match(listed, /#1 \[pending\] Fix auth bug/);
	assert.match(listed, /#2 \[pending\] Add tests/);

	const get = tools.get("TaskGet")!;
	const detail = text(await call(get, { taskId: "1" }));
	assert.match(detail, /Status: pending/);
	assert.match(detail, /Token expiry uses < not <=/);

	const update = tools.get("TaskUpdate")!;
	assert.match(text(await call(update, { taskId: "1", status: "in_progress" })), /Updated task #1/);
	assert.match(text(await call(list, {})), /#1 \[in_progress\]/);

	assert.match(text(await call(update, { taskId: "2", addBlockedBy: ["1"] })), /Updated task #2/);
	assert.match(text(await call(list, {})), /#2 \[pending\] Add tests \[blocked by #1\]/);

	assert.match(text(await call(update, { taskId: "2", status: "deleted" })), /Updated task #2/);
	assert.doesNotMatch(text(await call(list, {})), /#2/);

	await rm(TMP_DIR, { recursive: true, force: true });
});

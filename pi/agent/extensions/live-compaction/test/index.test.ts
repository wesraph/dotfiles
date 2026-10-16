/**
 * Run: node --test pi/agent/extensions/live-compaction/test/
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import extension from "../index.ts";
import { saveEntries, memoryFilePath } from "../../session-memory/store.ts";

const TMP_DIR = join(import.meta.dirname, ".tmp");

type Handler = (event: unknown, ctx: unknown) => Promise<unknown>;

function loadHandler(): Handler {
	let handler: Handler | undefined;
	const pi = {
		on: (topic: string, h: Handler) => {
			if (topic === "session_before_compact") handler = h;
		},
		registerTool: () => {},
	};
	extension(pi as never);
	assert.ok(handler, "session_before_compact handler not registered");
	return handler as Handler;
}

function loadCaptureHandler(): Handler {
	let handler: Handler | undefined;
	const pi = {
		on: (topic: string, h: Handler) => {
			if (topic === "before_provider_request") handler = h;
		},
		registerTool: () => {},
	};
	extension(pi as never);
	assert.ok(handler, "before_provider_request handler not registered");
	return handler as Handler;
}

const systemMessage = {
	role: "system",
	content: "You are a coding agent.",
	sections: { tools: "persisted tools section" },
	toolsAdded: [{ name: "read", description: "Read a file", parameters: { type: "object" } }],
	timestamp: 0,
};
// What the provider actually saw: differs from the persisted projection, which misses
// per-turn injections such as project memory.
const CAPTURED_SYSTEM = "You are a coding agent.\n\n## Project Memory\n\nm1: pinned";
// A later system entry: pi persists one per tool-loadout change, and the provider
// replays its sections into the leading prompt.
const systemUpdate = {
	role: "system",
	content: "",
	sections: { tools: "updated tools section" },
	toolsAdded: [{ name: "bash", description: "Run a command", parameters: { type: "object" } }],
	timestamp: 3,
};
const userMessage = { role: "user", content: [{ type: "text", text: "Fix the bug" }], timestamp: 1 };
const assistantText = {
	role: "assistant",
	content: [{ type: "text", text: "On it." }],
	usage: undefined,
	timestamp: 2,
};
const assistantWithToolCall = {
	role: "assistant",
	content: [
		{ type: "text", text: "Reading." },
		{ type: "toolCall", id: "call-1", name: "read", arguments: { path: "a.ts" } },
	],
	timestamp: 2,
};
const toolResult = {
	role: "toolResult",
	toolCallId: "call-1",
	content: [{ type: "text", text: "file contents" }],
	isError: false,
	utility: undefined,
	durationMs: 1,
	timestamp: 3,
};

function makePreparation(overrides: Record<string, unknown> = {}) {
	return {
		firstKeptEntryId: "entry-4",
		messagesToSummarize: [userMessage, assistantText],
		turnPrefixMessages: [],
		isSplitTurn: false,
		tokensBefore: 12345,
		previousSummary: undefined,
		fileOps: {
			read: new Set(["a.ts", "b.ts"]),
			written: new Set(["c.ts"]),
			edited: new Set(["b.ts", "d.ts"]),
		},
		settings: { enabled: true, reserveTokens: 16384, keepRecentTokens: 20000 },
		...overrides,
	};
}

interface CallRecord {
	model: unknown;
	context: { messages: { role: string; content?: unknown }[] };
	options: Record<string, unknown>;
}

function makeCtx(options: {
	messages: { role: string; content?: unknown; toolCallId?: string }[];
	respond: (call: CallRecord) => Promise<{
		content: { type: string; text?: string; id?: string }[];
		usage: { input: number };
		stopReason: string;
	}>;
	sessionFile?: string;
	model?: unknown;
}) {
	const calls: CallRecord[] = [];
	const notifications: string[] = [];
	return {
		calls,
		notifications,
		ctx: {
			ui: { notify: (message: string) => notifications.push(message) },
			model: options.model ?? model,
			thinkingLevel: undefined,
			sessionManager: {
				getSessionId: () => "session-1",
				getSessionFile: () => options.sessionFile,
				buildSessionProjection: () => ({ entries: [], messages: options.messages }),
			},
			modelRegistry: {
				complete: async (model: unknown, context: CallRecord["context"], requestOptions: Record<string, unknown>) => {
					const call = { model, context, options: requestOptions };
					calls.push(call);
					return options.respond(call);
				},
			},
		},
	};
}

const summaryResponse = {
	content: [{ type: "text", text: "## Goal\nFix the bug." }],
	usage: { input: 10, cacheRead: 90000, cacheWrite: 500 },
	stopReason: "stop",
};

const model = { id: "claude-x", provider: "anthropic", reasoning: false };

const baseEvent = (preparation: unknown, overrides: Record<string, unknown> = {}) => ({
	type: "session_before_compact",
	preparation,
	branchEntries: [],
	customInstructions: undefined,
	reason: "manual",
	willRetry: false,
	signal: new AbortController().signal,
	...overrides,
});

test("appends instruction to the live transcript with cache reuse options", async () => {
	const handler = loadHandler();
	const signal = new AbortController().signal;
	const { ctx, calls } = makeCtx({
		messages: [systemMessage, userMessage, assistantText],
		respond: async () => summaryResponse,
	});

	const result = (await handler(baseEvent(makePreparation(), { signal }), ctx)) as {
		compaction: {
			summary: string;
			firstKeptEntryId: string;
			tokensBefore: number;
			usage: { input: number; cacheRead: number; cacheWrite: number };
			details: { readFiles: string[]; modifiedFiles: string[] };
		};
	};

	assert.ok(result?.compaction, "expected compaction result");
	assert.equal(calls.length, 1);
	const sent = calls[0].context.messages;
	assert.equal(sent.length, 4, "system + 2 conversation + 1 instruction");
	const sentHead = sent[0] as { role: string; content?: unknown; sections?: unknown; toolsAdded?: unknown[] };
	assert.equal(sentHead.role, "system");
	assert.equal(sentHead.content, "You are a coding agent.", "without a capture the projection is replayed");
	assert.deepEqual(sentHead.sections, { tools: "persisted tools section" });
	assert.equal(sentHead.toolsAdded?.length, 1, "tool declarations stay");
	assert.equal(sent[1].role, "user");
	const instruction = sent[sent.length - 1];
	assert.equal(instruction.role, "user");
	const text = (instruction.content as { type: string; text: string }[])[0].text;
	assert.match(text, /about to be compacted/);
	assert.match(text, /## Goal/);
	assert.match(text, /Do not call any tools/);

	assert.equal(calls[0].options.cacheRetention, "short");
	assert.equal(calls[0].options.sessionId, "session-1");
	assert.equal(calls[0].options.signal, signal);
	assert.equal(calls[0].model, model);

	assert.match(result.compaction.summary, /## Goal\nFix the bug\./);
	assert.match(result.compaction.summary, /<read-files>\na\.ts\n<\/read-files>/);
	assert.match(result.compaction.summary, /<modified-files>\nb\.ts\nc\.ts\nd\.ts\n<\/modified-files>/);
	assert.equal(result.compaction.firstKeptEntryId, "entry-4");
	assert.equal(result.compaction.tokensBefore, 12345);
	assert.deepEqual(result.compaction.usage, { input: 10, cacheRead: 90000, cacheWrite: 500 });
	assert.deepEqual(result.compaction.details, {
		readFiles: ["a.ts"],
		modifiedFiles: ["b.ts", "c.ts", "d.ts"],
	});
});

test("previous summary and session memory are folded into the instruction", async () => {
	await withTmp(async (sessionFile) => {
		await saveEntries(sessionFile, [{ id: "s1", title: "Decision", body: "Use worktrees", timestamp: "2026-10-01T00:00:00Z" }]);
		const handler = loadHandler();
		const { ctx, calls } = makeCtx({
			messages: [systemMessage, userMessage, assistantText],
			sessionFile,
			respond: async () => summaryResponse,
		});

		const result = await handler(
			baseEvent(makePreparation({ previousSummary: "## Goal\nOld goal." })),
			ctx,
		);
		assert.ok((result as { compaction?: unknown }).compaction);
		const text = (calls[0].context.messages[calls[0].context.messages.length - 1]!.content as { text: string }[])[0].text;
		assert.match(text, /previous compaction summary appears earlier in the conversation above/);
		assert.match(text, /<session-memory>\ns1: Decision\nUse worktrees\n<\/session-memory>/);
		assert.doesNotMatch(text, /<previous-summary>/);
	});
});

test("split turns and custom instructions are reflected in the instruction", async () => {
	const handler = loadHandler();
	const { ctx, calls } = makeCtx({
		messages: [systemMessage, userMessage, assistantText],
		respond: async () => summaryResponse,
	});
	await handler(
		baseEvent(makePreparation({ isSplitTurn: true }), { customInstructions: "Focus on auth" }),
		ctx,
	);
	const text = (calls[0].context.messages[calls[0].context.messages.length - 1]!.content as { text: string }[])[0].text;
	assert.match(text, /is being split/);
	assert.match(text, /Additional focus: Focus on auth/);
});

test("replays tool call/result pairs and keeps reasoning parity", async () => {
	const handler = loadHandler();
	const { ctx, calls } = makeCtx({
		messages: [systemMessage, userMessage, assistantWithToolCall, toolResult],
		respond: async () => summaryResponse,
		model: { id: "claude-x", provider: "anthropic", reasoning: true },
	});
	const ctxWithThinking = { ...ctx, thinkingLevel: "high" };

	const result = await handler(baseEvent(makePreparation()), ctxWithThinking);
	assert.ok((result as { compaction?: unknown }).compaction);
	assert.equal(calls[0].options.reasoning, "high");
	assert.equal(calls[0].options.reasoningEffort, "high", "raw stream path reads reasoningEffort, not reasoning");
	const roles = calls[0].context.messages.map((m) => m.role);
	assert.deepEqual(roles, ["system", "user", "assistant", "toolResult", "user"]);
});

test("accumulates file lists only from the most recent compaction entry", async () => {
	const handler = loadHandler();
	const { ctx } = makeCtx({
		messages: [systemMessage, userMessage, assistantText],
		respond: async () => summaryResponse,
	});
	const branchEntries = [
		{
			type: "compaction",
			id: "e-old",
			details: { readFiles: ["ancient.ts"], modifiedFiles: ["relic.ts"] },
		},
		{ type: "message", id: "e-mid" },
		{ type: "compaction", id: "e-new", details: undefined },
	];

	const result = (await handler(
		baseEvent(makePreparation(), { branchEntries }),
		ctx,
	)) as { compaction: { details: { readFiles: string[]; modifiedFiles: string[] } } };

	assert.deepEqual(result.compaction.details, {
		readFiles: ["a.ts"],
		modifiedFiles: ["b.ts", "c.ts", "d.ts"],
	});
});

test("accumulates file lists from the previous compaction entry", async () => {
	const handler = loadHandler();
	const { ctx } = makeCtx({
		messages: [systemMessage, userMessage, assistantText],
		respond: async () => summaryResponse,
	});
	const branchEntries = [
		{ type: "message", id: "e1" },
		{
			type: "compaction",
			id: "e2",
			details: { readFiles: ["z.ts"], modifiedFiles: ["q.ts"] },
		},
		{ type: "message", id: "e3" },
	];

	const result = (await handler(baseEvent(makePreparation(), { branchEntries }), ctx)) as {
		compaction: { details: { readFiles: string[]; modifiedFiles: string[] } } };

	assert.deepEqual(result.compaction.details, {
		readFiles: ["a.ts", "z.ts"],
		modifiedFiles: ["b.ts", "c.ts", "d.ts", "q.ts"],
	});
});

test("instruction omits memory and update rules when absent", async () => {
	await withTmp(async (sessionFile) => {
		const handler = loadHandler();
		const { ctx, calls } = makeCtx({
			messages: [systemMessage, userMessage, assistantText],
			sessionFile,
			respond: async () => summaryResponse,
		});
		// Sidecar exists but is empty: no memory block.
		await saveEntries(sessionFile, []);

		const result = await handler(baseEvent(makePreparation()), ctx);
		assert.ok((result as { compaction?: unknown }).compaction);
		const text = (calls[0].context.messages[calls[0].context.messages.length - 1]!.content as { text: string }[])[0].text;
		assert.doesNotMatch(text, /<session-memory>/);
		assert.doesNotMatch(text, /previous compaction summary appears earlier/);
		assert.doesNotMatch(text, /is being split/);
		assert.doesNotMatch(text, /Additional focus/);
		assert.match(text, /last 20,000 tokens/);
	});
});

test("skips session memory when there is no session file", async () => {
	const handler = loadHandler();
	const { ctx, calls } = makeCtx({
		messages: [systemMessage, userMessage, assistantText],
		respond: async () => summaryResponse,
		sessionFile: undefined,
	});
	const result = await handler(baseEvent(makePreparation()), ctx);
	assert.ok((result as { compaction?: unknown }).compaction);
	const text = (calls[0].context.messages[calls[0].context.messages.length - 1]!.content as { text: string }[])[0].text;
	assert.doesNotMatch(text, /<session-memory>/);
});

test("keeps reasoning absent when the model does not reason or thinking is off", async () => {
	const handler = loadHandler();
	const cases: { model: unknown; thinkingLevel: string }[] = [
		{ model: { id: "gpt-x", provider: "openai", reasoning: false }, thinkingLevel: "high" },
		{ model, thinkingLevel: "off" },
	];
	for (const testCase of cases) {
		const { ctx, calls } = makeCtx({
			messages: [systemMessage, userMessage, assistantText],
			respond: async () => summaryResponse,
			model: testCase.model,
		});
		const result = await handler(
			baseEvent(makePreparation()),
			{ ...ctx, thinkingLevel: testCase.thinkingLevel },
		);
		assert.ok((result as { compaction?: unknown }).compaction);
		assert.equal("reasoning" in calls[0].options, false);
		assert.equal("reasoningEffort" in calls[0].options, false);
	}
});

test("instruction scales with keepRecentTokens", async () => {
	const handler = loadHandler();
	const { ctx, calls } = makeCtx({
		messages: [systemMessage, userMessage, assistantText],
		respond: async () => summaryResponse,
	});
	await handler(
		baseEvent(makePreparation({ settings: { enabled: true, reserveTokens: 16384, keepRecentTokens: 5000 } })),
		ctx,
	);
	const text = (calls[0].context.messages[calls[0].context.messages.length - 1]!.content as { text: string }[])[0].text;
	assert.match(text, /last 5,000 tokens/);
});

test("appends no file sections when no files were touched", async () => {
	const handler = loadHandler();
	const { ctx } = makeCtx({
		messages: [systemMessage, userMessage, assistantText],
		respond: async () => summaryResponse,
	});
	const result = (await handler(
		baseEvent(makePreparation({ fileOps: { read: new Set(), written: new Set(), edited: new Set() } })),
		ctx,
	)) as { compaction: { summary: string; details: { readFiles: string[]; modifiedFiles: string[] } } };
	assert.equal(result.compaction.summary, "## Goal\nFix the bug.");
	assert.deepEqual(result.compaction.details, { readFiles: [], modifiedFiles: [] });
});

test("tolerates an unreadable session memory sidecar", async () => {
	await withTmp(async (sessionFile) => {
		// A directory at the sidecar path makes readFile fail with EISDIR (not ENOENT).
		await mkdir(memoryFilePath(sessionFile), { recursive: true });
		const handler = loadHandler();
		const { ctx, calls } = makeCtx({
			messages: [systemMessage, userMessage, assistantText],
			sessionFile,
			respond: async () => summaryResponse,
		});

		const result = await handler(baseEvent(makePreparation()), ctx);
		assert.ok((result as { compaction?: unknown }).compaction);
		const text = (calls[0].context.messages[calls[0].context.messages.length - 1]!.content as { text: string }[])[0].text;
		assert.doesNotMatch(text, /<session-memory>/);
	});
});

test("joins multiple summary text blocks with newlines", async () => {
	const handler = loadHandler();
	const { ctx } = makeCtx({
		messages: [systemMessage, userMessage, assistantText],
		respond: async () => ({
			content: [
				{ type: "text", text: "## Goal" },
				{ type: "text", text: "Fix the bug." },
			],
			usage: summaryResponse.usage,
			stopReason: "stop",
		}),
	});
	const result = (await handler(
		baseEvent(
			makePreparation({ fileOps: { read: new Set(), written: new Set(), edited: new Set() } }),
		),
		ctx,
	)) as { compaction: { summary: string } };
	assert.equal(result.compaction.summary, "## Goal\nFix the bug.");
});

test("falls back silently when the signal aborts and the call throws", async () => {
	const handler = loadHandler();
	const controller = new AbortController();
	const { ctx, calls, notifications } = makeCtx({
		messages: [systemMessage, userMessage, assistantText],
		respond: async () => {
			controller.abort();
			throw new Error("boom");
		},
	});
	const result = await handler(baseEvent(makePreparation(), { signal: controller.signal }), ctx);
	assert.equal(result, undefined);
	assert.equal(calls.length, 1);
	assert.equal(notifications.length, 0, "aborted compaction must not notify even on errors");
});

test("falls back silently when the signal aborts during the model call", async () => {
	const handler = loadHandler();
	const controller = new AbortController();
	const { ctx, calls, notifications } = makeCtx({
		messages: [systemMessage, userMessage, assistantText],
		respond: async () => {
			controller.abort();
			return summaryResponse;
		},
	});
	const result = await handler(baseEvent(makePreparation(), { signal: controller.signal }), ctx);
	assert.equal(result, undefined);
	assert.equal(calls.length, 1);
	assert.equal(notifications.length, 0, "aborted compaction must not notify");
});

test("falls back without calling the model on an empty projection", async () => {
	const handler = loadHandler();
	const { ctx, calls } = makeCtx({
		messages: [],
		respond: async () => summaryResponse,
	});
	const result = await handler(baseEvent(makePreparation()), ctx);
	assert.equal(result, undefined);
	assert.equal(calls.length, 0);
});

test("falls back without calling the model on dangling tool calls", async () => {
	const handler = loadHandler();
	const { ctx, calls } = makeCtx({
		messages: [systemMessage, userMessage, assistantWithToolCall],
		respond: async () => summaryResponse,
	});
	const result = await handler(baseEvent(makePreparation()), ctx);
	assert.equal(result, undefined);
	assert.equal(calls.length, 0);
});

test("falls back on provider error, length, tool calls and empty text", async () => {
	const handler = loadHandler();
	const cases: { respond: () => Promise<unknown>; expectNotify: RegExp | null }[] = [
		{ respond: async () => { throw new Error("boom"); }, expectNotify: /Live compaction failed \(boom\)/ },
		{ respond: async () => ({ ...summaryResponse, stopReason: "length" }), expectNotify: /output token cap/ },
		{ respond: async () => ({ ...summaryResponse, stopReason: "error", errorMessage: "500" }), expectNotify: /failed: 500/ },
		{ respond: async () => ({ ...summaryResponse, stopReason: "error" }), expectNotify: /failed: unknown error/ },
		{
			respond: async () => ({
				...summaryResponse,
				content: [
					{ type: "text", text: "## Goal\nPartial summary" },
					{ type: "toolCall", id: "c1", name: "read", arguments: {} },
				],
			}),
			expectNotify: null,
		},
		{
			respond: async () => ({ ...summaryResponse, content: [{ type: "toolCall", id: "c1", name: "read", arguments: {} }] }),
			expectNotify: null,
		},
		{ respond: async () => ({ ...summaryResponse, content: [{ type: "text", text: "  " }] }), expectNotify: /empty summary/ },
	];

	for (const testCase of cases) {
		const { ctx, calls, notifications } = makeCtx({
			messages: [systemMessage, userMessage, assistantText],
			respond: testCase.respond as never,
		});
		const result = await handler(baseEvent(makePreparation()), ctx);
		assert.equal(result, undefined);
		assert.equal(calls.length, 1);
		if (testCase.expectNotify) assert.match(notifications.join("\n"), testCase.expectNotify);
		else assert.equal(notifications.length, 0);
	}
});

test("falls back when no model is selected", async () => {
	const handler = loadHandler();
	const { ctx, calls } = makeCtx({
		messages: [systemMessage, userMessage, assistantText],
		respond: async () => summaryResponse,
	});
	const result = await handler(baseEvent(makePreparation()), { ...ctx, model: undefined });
	assert.equal(result, undefined);
	assert.equal(calls.length, 0);
});

test("aborted signal skips the model call", async () => {
	const handler = loadHandler();
	const { ctx, calls } = makeCtx({
		messages: [systemMessage, userMessage, assistantText],
		respond: async () => summaryResponse,
	});
	const controller = new AbortController();
	controller.abort();
	const result = await handler(baseEvent(makePreparation(), { signal: controller.signal }), ctx);
	assert.equal(result, undefined);
	assert.equal(calls.length, 0);
});

test("pins the system message to the captured provider text", async () => {
	await withTmp(async (sessionFile) => {
		const handler = loadHandler();
		const capture = loadCaptureHandler();
		const { ctx, calls } = makeCtx({
			messages: [systemMessage, userMessage, assistantText, systemUpdate],
			sessionFile,
			respond: async () => summaryResponse,
		});
		await capture({ type: "before_provider_request", payload: { messages: [{ role: "system", content: CAPTURED_SYSTEM }] } }, ctx);
		assert.equal(readFileSync(`${sessionFile}.live-system.txt`, "utf8"), CAPTURED_SYSTEM, "sidecar written");

		const result = await handler(baseEvent(makePreparation()), ctx);
		assert.ok((result as { compaction?: unknown }).compaction);
		const sent = calls[0].context.messages;
		const sentHead = sent[0] as { role: string; content?: unknown; sections?: unknown; toolsAdded?: unknown[] };
		assert.equal(sentHead.content, CAPTURED_SYSTEM, "pinned to what the provider saw");
		assert.equal(sentHead.sections, undefined, "stale persisted sections dropped");
		assert.equal(sentHead.toolsAdded?.length, 1, "tool declarations stay");
		const sentUpdate = sent[sent.length - 2] as { role: string; content?: unknown; sections?: unknown; toolsAdded?: unknown[] };
		assert.equal(sentUpdate.role, "system");
		assert.equal(sentUpdate.content, "", "later system entry contributes no text");
		assert.equal(sentUpdate.sections, undefined, "later entry's sections dropped");
		assert.equal(sentUpdate.toolsAdded?.length, 1, "later entry keeps its tool state");
	});
});

test("captures the system text from OpenAI-style and Anthropic-style payloads", async () => {
	await withTmp(async (sessionFile) => {
		const capture = loadCaptureHandler();
		const { ctx } = makeCtx({ messages: [], respond: async () => summaryResponse, sessionFile });
		const sidecar = `${sessionFile}.live-system.txt`;
		await capture({ type: "before_provider_request", payload: { messages: [{ role: "system", content: "openai prompt" }] } }, ctx);
		assert.equal(readFileSync(sidecar, "utf8"), "openai prompt");
		await capture({ type: "before_provider_request", payload: { system: [{ type: "text", text: "anthropic prompt" }] } }, ctx);
		assert.equal(readFileSync(sidecar, "utf8"), "anthropic prompt");
		await capture({ type: "before_provider_request", payload: { messages: [{ role: "user", content: "hi" }] } }, ctx);
		assert.equal(readFileSync(sidecar, "utf8"), "anthropic prompt", "payload without a system block leaves the capture alone");
	});
});

async function withTmp<T>(run: (sessionFile: string) => Promise<T>): Promise<T> {
	await rm(TMP_DIR, { recursive: true, force: true });
	await mkdir(TMP_DIR, { recursive: true });
	const sessionFile = join(TMP_DIR, "session.jsonl");
	try {
		return await run(sessionFile);
	} finally {
		await rm(TMP_DIR, { recursive: true, force: true });
	}
}

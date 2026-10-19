/**
 * Run: node --test pi/agent/extensions/stop-notification.test/
 */
import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import stopNotification, { runOutcome, summarizeRun } from "../stop-notification.ts";

// Scratch space: a private hook log plus a fake notify-send, so no test reaches the desktop
// and none writes the real /tmp/pi-stop-hook.log.
const TEST_DIR = mkdtempSync(join(tmpdir(), "pi-stop-hook-test-"));
process.on("exit", () => rmSync(TEST_DIR, { recursive: true, force: true }));
const TEST_LOG = join(TEST_DIR, "hook.log");
const FAKE_BIN = join(TEST_DIR, "bin");
const CAPTURED_ARGV = join(TEST_DIR, "notify-send.argv");
mkdirSync(FAKE_BIN, { recursive: true });
const FAKE_NOTIFY_SEND = join(FAKE_BIN, "notify-send");
writeFileSync(FAKE_NOTIFY_SEND, `#!/bin/sh\nprintf '%s\\n' "$@" > "${CAPTURED_ARGV}"\n`);
chmodSync(FAKE_NOTIFY_SEND, 0o755);

function assistant(stopReason: string, text = ""): Record<string, unknown> {
	return {
		role: "assistant",
		stopReason,
		content: text ? [{ type: "text", text }] : [],
	};
}

test("runOutcome: connection error is not a successful run", () => {
	assert.equal(
		runOutcome([
			assistant("toolUse"),
			{ role: "toolResult", content: [] },
			{ ...assistant("error"), errorMessage: "Connection error." },
		]),
		"error",
	);
});

test("runOutcome: user abort is not a successful run", () => {
	assert.equal(runOutcome([assistant("aborted")]), "aborted");
});

test("runOutcome: delivered answers notify", () => {
	for (const stopReason of ["stop", "toolUse", "length", "deferred"]) {
		assert.equal(runOutcome([assistant("error"), assistant(stopReason, "done")]), "success", stopReason);
	}
});

test("runOutcome: a run without an assistant message does not notify", () => {
	assert.equal(runOutcome([]), "no-assistant-message");
	assert.equal(runOutcome([{ role: "user", content: "hi" }]), "no-assistant-message");
});

test("summarizeRun: joins text parts and ignores thinking/tool calls", () => {
	const summary = summarizeRun([
		{
			role: "assistant",
			stopReason: "stop",
			content: [
				{ type: "thinking", thinking: "hidden" },
				{ type: "text", text: "fixed the" },
				{ type: "toolCall", id: "1", name: "bash", arguments: {} },
				{ type: "text", text: " bug" },
			],
		},
	]);
	assert.equal(summary, "fixed the bug");
});

test("summarizeRun: collapses whitespace and caps length", () => {
	const summary = summarizeRun([assistant("stop", "line one\n\t  line two   end")]);
	assert.equal(summary, "line one line two end");
	assert.equal(summarizeRun([assistant("stop", "x".repeat(400))]).length, 150);
});

test("summarizeRun: falls back when the answer carries no text", () => {
	assert.equal(summarizeRun([assistant("toolUse")]), "Task completed");
	assert.equal(summarizeRun([]), "Task completed");
});

type AgentEndHandler = (event: unknown, ctx: unknown) => Promise<void>;

const QUIET_ENV_KEYS = [
	"PI_SUBAGENT_CHILD",
	"PI_SPAWN_PARENT_ID",
	"PATH",
	"PLAY_PI_NOTIFICATION",
	"PI_STOP_HOOK_LOG",
] as const;

/**
 * Neutralise the environment the extension reads: its subagent/spawn guards must not be
 * what silences these runs, notify-send is faked, paplay stays unresolvable, and the log
 * is private to the test.
 */
function quietNotifyEnv(options: { playSound?: string } = {}): () => void {
	const saved = QUIET_ENV_KEYS.map((key) => [key, process.env[key]] as const);
	process.env.PI_SUBAGENT_CHILD = "0";
	process.env.PI_SPAWN_PARENT_ID = "";
	process.env.PATH = FAKE_BIN;
	process.env.PLAY_PI_NOTIFICATION = options.playSound ?? "";
	process.env.PI_STOP_HOOK_LOG = TEST_LOG;
	return () => {
		for (const [key, value] of saved) {
			if (value === undefined) delete process.env[key];
			else process.env[key] = value;
		}
	};
}

/** Register the extension against a stub pi and hand back its agent_end handler. */
function agentEndHandler(): AgentEndHandler {
	let handler: AgentEndHandler | undefined;
	stopNotification({ on: (_event: string, cb: AgentEndHandler) => void (handler = cb) } as never);
	if (!handler) throw new Error("extension did not register an agent_end handler");
	return handler;
}

function bellCount(calls: readonly unknown[]): number {
	return calls.filter((call) => (call as { arguments?: unknown[] }).arguments?.[0] === "\x07").length;
}

test("agent_end: a failed run never reaches the notify path", async (t) => {
	const restoreEnv = quietNotifyEnv();
	try {
		const handler = agentEndHandler();
		const bell = t.mock.method(process.stdout, "write");
		rmSync(CAPTURED_ARGV, { force: true });

		await handler({ messages: [{ ...assistant("error"), errorMessage: "Connection error." }] }, { cwd: "/tmp" });
		await handler({ messages: [assistant("aborted")] }, { cwd: "/tmp" });

		assert.equal(existsSync(CAPTURED_ARGV), false, "a failed run must not invoke notify-send");
		assert.equal(bellCount(bell.mock.calls as readonly unknown[]), 0, "error/aborted runs must not notify");
	} finally {
		restoreEnv();
	}
});

test("agent_end: a delivered answer reaches the notify path", async (t) => {
	const restoreEnv = quietNotifyEnv();
	try {
		const handler = agentEndHandler();
		const bell = t.mock.method(process.stdout, "write");

		await handler({ messages: [assistant("stop", "all done")] }, { cwd: "/tmp" });

		assert.equal(bellCount(bell.mock.calls as readonly unknown[]), 1, "a successful run must notify");
	} finally {
		restoreEnv();
	}
});

test("notify-send receives the summary as data: options first, then --", async () => {
	const restoreEnv = quietNotifyEnv();
	try {
		rmSync(CAPTURED_ARGV, { force: true });
		const handler = agentEndHandler();

		await handler({ messages: [assistant("stop", "- item one")] }, { cwd: "/tmp" });

		const argv = readFileSync(CAPTURED_ARGV, "utf8").split("\n").filter(Boolean);
		const separator = argv.indexOf("--");
		assert.ok(separator > 0, `expected '--' before the positionals, got ${JSON.stringify(argv)}`);
		assert.ok(argv.indexOf("--icon=info") < separator, "options must precede --");
		assert.deepEqual(argv.slice(separator + 1), ["\ud83e\udd16 tmp", "- item one"]);
	} finally {
		restoreEnv();
	}
});

test("a missing paplay never escapes as an unhandledRejection", async (t) => {
	const restoreEnv = quietNotifyEnv({ playSound: "1" });
	const rejections: unknown[] = [];
	const onRejection = (reason: unknown) => void rejections.push(reason);
	process.on("unhandledRejection", onRejection);
	try {
		rmSync(TEST_LOG, { force: true });
		const handler = agentEndHandler();
		const bell = t.mock.method(process.stdout, "write");

		await handler({ messages: [assistant("stop", "done")] }, { cwd: "/tmp" });
		await new Promise((resolve) => setTimeout(resolve, 250));

		assert.deepEqual(rejections, [], "the detached paplay failure must be caught");
		assert.match(readFileSync(TEST_LOG, "utf8"), /paplay failed:/);
		assert.equal(bellCount(bell.mock.calls as readonly unknown[]), 1);
	} finally {
		process.off("unhandledRejection", onRejection);
		restoreEnv();
	}
});

/**
 * Run: node --test pi/agent/extensions/kill-async-subagents-on-quit.test/
 */
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import killAsyncSubagentsOnQuit from "../kill-async-subagents-on-quit.ts";

const OWNER_KEY = Symbol.for("pi-subagents.completion-owner-id");
const OWNER_ID = "owner-this-process";
const SESSION_FILE = "/home/raph/.pi/agent/sessions/session-a.jsonl";
const OTHER_SESSION_FILE = "/home/raph/.pi/agent/sessions/session-b.jsonl";
const SESSION_ID = "session-a";
const OTHER_OWNER_ID = "owner-another-process";

(globalThis as Record<symbol, unknown>)[OWNER_KEY] = OWNER_ID;

type RunFixture = {
	id: string;
	ownerId?: string;
	sessionId?: string;
	state?: string;
	/** Write no status.json (null), or a raw (possibly invalid) one. */
	raw?: string | null;
	/** Write a process-terminal.json proof with this state next to the status. */
	proofState?: string;
	/** Make <run>/control a file, so writing the inbox must fail. */
	blockedControl?: boolean;
};

/** Build a temp pi-subagents temp root from the fixtures. */
function runsRoot(runs: RunFixture[]): string {
	const root = mkdtempSync(join(tmpdir(), "pi-kill-sweep-"));
	const runsDir = join(root, "async-subagent-runs");
	for (const run of runs) {
		const dir = join(runsDir, run.id);
		mkdirSync(dir, { recursive: true });
		if (run.raw !== null) {
			writeFileSync(
				join(dir, "status.json"),
				run.raw ??
					JSON.stringify({
						runId: run.id,
						...(run.ownerId === undefined ? {} : { completionOwnerId: run.ownerId }),
						...(run.sessionId === undefined ? {} : { sessionId: run.sessionId }),
						...(run.state === undefined ? {} : { state: run.state }),
					}),
			);
		}
		if (run.proofState !== undefined) {
			writeFileSync(join(dir, "process-terminal.json"), JSON.stringify({ version: 1, state: run.proofState }));
		}
		if (run.blockedControl) writeFileSync(join(dir, "control"), "not a directory");
	}
	return root;
}

/**
 * Install the extension against a stub pi rooted at `root`, with process.kill stubbed so a
 * regression to signalling is visible. Returns its quit trigger and the kill spy count.
 */
function install(t: Pick<TestContext, "mock" | "after">, root: string, sessionFile: string | undefined) {
	const kill = t.mock.method(process, "kill", () => true);
	const savedRoot = process.env.PI_SUBAGENTS_TEMP_ROOT;
	process.env.PI_SUBAGENTS_TEMP_ROOT = root;
	t.after(() => {
		if (savedRoot === undefined) delete process.env.PI_SUBAGENTS_TEMP_ROOT;
		else process.env.PI_SUBAGENTS_TEMP_ROOT = savedRoot;
	});

	let handler: ((event: unknown, ctx: unknown) => void) | undefined;
	killAsyncSubagentsOnQuit({
		on: (_event: string, cb: (event: unknown, ctx: unknown) => void) => void (handler = cb),
	} as never);
	if (!handler) throw new Error("extension did not register a session_shutdown handler");

	const ctx = { sessionManager: { getSessionFile: () => sessionFile, getSessionId: () => SESSION_ID } };
	return {
		quit: (reason = "quit") => handler?.({ reason }, ctx),
		killed: () => kill.mock.calls.length,
	};
}

function interruptedIds(root: string, candidates: string[]): string[] {
	return candidates.filter((runId) =>
		existsSync(join(root, "async-subagent-runs", runId, "control", "interrupt.json")),
	);
}

function wasInterrupted(root: string, runId: string): boolean {
	return interruptedIds(root, [runId]).length === 1;
}

test("quit interrupts the runs this process owns, by owner id and by legacy session", (t) => {
	const fixtures: RunFixture[] = [
		{ id: "mine-running", ownerId: OWNER_ID, sessionId: SESSION_FILE, state: "running" },
		{ id: "mine-queued", ownerId: OWNER_ID, sessionId: SESSION_FILE, state: "queued" },
		// A /new or /resume replaces the session file; the run is still ours.
		{ id: "mine-old-session", ownerId: OWNER_ID, sessionId: OTHER_SESSION_FILE, state: "running" },
		{ id: "other-process", ownerId: OTHER_OWNER_ID, sessionId: SESSION_FILE, state: "running" },
		{ id: "legacy-mine", sessionId: SESSION_FILE, state: "running" },
		{ id: "legacy-other-session", sessionId: OTHER_SESSION_FILE, state: "running" },
		{ id: "finished", ownerId: OWNER_ID, sessionId: SESSION_FILE, state: "complete" },
		{ id: "proven-exited", ownerId: OWNER_ID, sessionId: SESSION_FILE, state: "running", proofState: "observed" },
		// The dependency writes this proof at spawn, so a live runner carries it too.
		{ id: "pending-proof", ownerId: OWNER_ID, sessionId: SESSION_FILE, state: "running", proofState: "pending" },
		{ id: "malformed", ownerId: OWNER_ID, raw: "{not json" },
		{ id: "no-status", ownerId: OWNER_ID, raw: null },
	];
	const root = runsRoot(fixtures);
	t.after(() => rmSync(root, { recursive: true, force: true }));
	const { quit } = install(t, root, SESSION_FILE);

	quit();

	assert.deepEqual(
		interruptedIds(root, fixtures.map((run) => run.id)),
		["mine-running", "mine-queued", "mine-old-session", "legacy-mine", "pending-proof"],
	);
	// The request the runner consumes: same path and fields as requestAsyncInterrupt.
	const request = JSON.parse(
		readFileSync(join(root, "async-subagent-runs", "mine-running", "control", "interrupt.json"), "utf8"),
	) as { type: string; ts: number; source: string };
	assert.equal(request.type, "interrupt");
	assert.equal(request.source, "pi-quit");
	assert.ok(request.ts > 0 && request.ts <= Date.now() + 1000, `ts ${request.ts} out of band`);
});

test("shutdown reasons other than quit write no request", (t) => {
	const root = runsRoot([{ id: "running", ownerId: OWNER_ID, sessionId: SESSION_FILE, state: "running" }]);
	t.after(() => rmSync(root, { recursive: true, force: true }));
	const { quit } = install(t, root, SESSION_FILE);

	for (const reason of ["reload", "new", "resume", "fork"]) {
		quit(reason);
		assert.equal(wasInterrupted(root, "running"), false, `reason '${reason}' must leave the run alive`);
	}

	quit();
	assert.equal(wasInterrupted(root, "running"), true);
});

test("sweep reads disk state, so a rebuilt instance still catches the same run", (t) => {
	const root = runsRoot([{ id: "running", ownerId: OWNER_ID, sessionId: SESSION_FILE, state: "running" }]);
	t.after(() => rmSync(root, { recursive: true, force: true }));

	// Two installs model pi rebuilding the extension on /reload: the second never saw the
	// run start, yet it must still interrupt it. The request is removed in between so the
	// second write cannot pass by finding the first one.
	install(t, root, SESSION_FILE).quit();
	rmSync(join(root, "async-subagent-runs", "running", "control", "interrupt.json"));
	install(t, root, SESSION_FILE).quit();

	assert.equal(wasInterrupted(root, "running"), true);
});

test("nothing is ever signalled: the sweep uses the inbox, never a pid", (t) => {
	const root = runsRoot([
		{ id: "running", ownerId: OWNER_ID, sessionId: SESSION_FILE, state: "running" },
		{ id: "queued", ownerId: OWNER_ID, sessionId: SESSION_FILE, state: "queued" },
	]);
	t.after(() => rmSync(root, { recursive: true, force: true }));
	const { quit, killed } = install(t, root, SESSION_FILE);

	quit();

	assert.equal(killed(), 0, "no process.kill: a pid read from disk may belong to another process");
	assert.deepEqual(interruptedIds(root, ["running", "queued"]), ["running", "queued"]);
});

test("unprovable ownership or an unusable root interrupts nothing", (t) => {
	const root = runsRoot([
		{ id: "legacy-mine", sessionId: SESSION_FILE, state: "running" },
		{ id: "legacy-unowned", sessionId: "", state: "running" },
		{ id: "owned", ownerId: OWNER_ID, sessionId: SESSION_FILE, state: "running" },
		{ id: "blocked", ownerId: OWNER_ID, sessionId: SESSION_FILE, state: "running", blockedControl: true },
	]);
	t.after(() => rmSync(root, { recursive: true, force: true }));
	const allIds = ["legacy-mine", "legacy-unowned", "owned", "blocked"];
	// 'blocked' can never hold a request: its control path is a file, not a directory.
	const clearRequest = (runId: string) =>
		rmSync(join(root, "async-subagent-runs", runId, "control", "interrupt.json"), { force: true });

	install(t, root, "").quit(); // no session identity at all
	assert.deepEqual(interruptedIds(root, allIds), [], "no identity means nothing is owned");

	const savedOwner = (globalThis as Record<symbol, unknown>)[OWNER_KEY];
	delete (globalThis as Record<symbol, unknown>)[OWNER_KEY];
	install(t, root, SESSION_FILE).quit(); // this process has no owner id: session fallback only
	(globalThis as Record<symbol, unknown>)[OWNER_KEY] = savedOwner;
	assert.deepEqual(interruptedIds(root, allIds), ["legacy-mine"], "only the owner-less run uses the fallback");
	clearRequest("legacy-mine");

	install(t, join(root, "does-not-exist"), SESSION_FILE).quit(); // no runs dir at all
	assert.deepEqual(interruptedIds(root, allIds), [], "a missing runs dir sweeps nothing and must not throw");

	install(t, root, SESSION_FILE).quit(); // control path of 'blocked' is a file: must fail quietly
	assert.deepEqual(
		interruptedIds(root, allIds),
		["legacy-mine", "owned"],
		"the owner-less run falls back, and an unwritable inbox is skipped, not fatal",
	);
});

test("legacy runs are matched by session id when pi writes no session file", (t) => {
	// Headless sessions have no session file; pi-subagents records the id instead.
	const root = runsRoot([{ id: "running", sessionId: SESSION_ID, state: "running" }]);
	t.after(() => rmSync(root, { recursive: true, force: true }));

	install(t, root, undefined).quit();

	assert.equal(wasInterrupted(root, "running"), true);
});

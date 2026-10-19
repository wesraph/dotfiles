// Sweep pi-subagents async runners when this pi process quits (window close via
// SIGHUP, /quit, SIGTERM) instead of leaving them running.
//
// The sweep reads the runner state pi-subagents already writes
// (<temp>/async-subagent-runs/<run>/status.json) rather than tracking spawn events, so
// runners are still caught after a /reload, /new, /resume or /fork: pi rebuilds
// extension sessions and pi-subagents never re-emits async-started.
//
// Interrupts go through the dependency's own control inbox, which it made authoritative
// over OS signals — "avoids signaling a PID that the extension cannot prove belongs to
// the runner" (src/runs/background/control-channel.ts:13-15). The runner consumes the
// request into its graceful interrupt path: abort the child, persist a resumable "paused"
// status, exit. It scans the inbox once at startup, so a request written before the runner
// boots is honoured too.
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const RUNS_DIR_NAME = "async-subagent-runs";
const STATUS_FILE = "status.json";
const PROCESS_TERMINAL_FILE = "process-terminal.json";
const PROVEN_EXIT_STATE = "observed";
const CONTROL_DIR = "control";
const INTERRUPT_FILE = "interrupt.json";
/** Runner states that still hold work. */
const LIVE_STATES = new Set(["queued", "running"]);
/** Same global pi-subagents uses to stamp runs with the owning pi process. */
const COMPLETION_OWNER_KEY = Symbol.for("pi-subagents.completion-owner-id");

// ponytail: uid scope only (Linux/macOS); returns undefined where getuid is absent.
function asyncRunsDir(): string | undefined {
	const scope = typeof process.getuid === "function" ? `uid-${process.getuid()}` : undefined;
	if (!scope) return undefined;
	const configured = process.env.PI_SUBAGENTS_TEMP_ROOT?.trim();
	return join(configured ? resolve(configured) : join(tmpdir(), `pi-subagents-${scope}`), RUNS_DIR_NAME);
}

type RunStatus = { sessionId?: unknown; completionOwnerId?: unknown; state?: unknown };

/** This pi process's id, stamped into every run it starts and stable across reloads. */
function thisProcessOwnerId(): string | undefined {
	const ownerId = (globalThis as Record<symbol, unknown>)[COMPLETION_OWNER_KEY];
	return typeof ownerId === "string" ? ownerId : undefined;
}

/**
 * A run's terminal proof is written at spawn as "pending", so its presence proves nothing;
 * only "observed" confirms the runner exited. "unknown" is unverified, and interrupting a
 * live runner is safe while leaving a stale request behind for a future one is not.
 */
function processAlreadyExited(runDir: string): boolean {
	let proof: { state?: unknown };
	try {
		proof = JSON.parse(readFileSync(join(runDir, PROCESS_TERMINAL_FILE), "utf8")) as { state?: unknown };
	} catch {
		return false; // absent or unreadable: assume the runner is still live
	}
	return proof.state === PROVEN_EXIT_STATE;
}

/**
 * Directories of runs this pi process owns that are still working. The owner id is the
 * process-scoped key, so switching sessions keeps the runs owned; status files written
 * without one fall back to the session identity pi-subagents records.
 */
function liveRunDirs(runsDir: string, ownerId: string | undefined, sessionIdentity: string): string[] {
	let runDirs: string[];
	try {
		runDirs = readdirSync(runsDir);
	} catch {
		return []; // never ran a subagent: nothing to sweep
	}
	const live: string[] = [];
	for (const runDir of runDirs) {
		const dir = join(runsDir, runDir);
		let status: RunStatus;
		try {
			status = JSON.parse(readFileSync(join(dir, STATUS_FILE), "utf8")) as RunStatus;
		} catch {
			continue; // no status yet, or unreadable/removed mid-scan
		}
		const owned =
			typeof status.completionOwnerId === "string"
				? status.completionOwnerId === ownerId
				: status.sessionId === sessionIdentity;
		if (!owned) continue;
		if (!LIVE_STATES.has(String(status.state))) continue;
		if (processAlreadyExited(dir)) continue;
		live.push(dir);
	}
	return live;
}

function requestInterrupt(runDir: string): void {
	const controlDir = join(runDir, CONTROL_DIR);
	const target = join(controlDir, INTERRUPT_FILE);
	mkdirSync(controlDir, { recursive: true });
	// Written the way the dependency's own requestAsyncInterrupt does it: tmp file + rename.
	const temp = `${target}.${process.pid}.tmp`;
	writeFileSync(temp, JSON.stringify({ type: "interrupt", ts: Date.now(), source: "pi-quit" }));
	renameSync(temp, target);
}

export default function killAsyncSubagentsOnQuit(pi: ExtensionAPI): void {
	pi.on("session_shutdown", (event: { reason?: string }, ctx) => {
		if (event?.reason !== "quit") return; // session switch/reload keeps runs alive
		const runsDir = asyncRunsDir();
		if (!runsDir) return;
		// Same identity pi-subagents records: the session file when pi writes one.
		const sessionIdentity = ctx.sessionManager.getSessionFile() ?? ctx.sessionManager.getSessionId();
		if (!sessionIdentity) return; // cannot prove ownership: interrupt nothing
		for (const runDir of liveRunDirs(runsDir, thisProcessOwnerId(), sessionIdentity)) {
			try {
				requestInterrupt(runDir);
			} catch {
				// run directory vanished or is unwritable mid-scan
			}
		}
	});
}

/**
 * external-pi — remote control extension for pi.
 *
 * Connects the running pi session to the external-pi daemon over WebSocket.
 * The daemon's web UI can then observe this session (cwd, branch, todos,
 * subagents, messages, status) and inject the next user message.
 *
 * Configuration (environment variables):
 *   EXTERNAL_PI_URL    ws://host:port/ws/agent        (required)
 *   EXTERNAL_PI_TOKEN  shared secret matching the daemon  (required)
 *
 * The agent id is stable per process (hostname + pid + random) so reconnects
 * replace the same record on the daemon instead of leaving ghosts.
 */

import * as os from "node:os";
import { randomBytes } from "node:crypto";
import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";

const ENV_URL = "EXTERNAL_PI_URL";
const ENV_TOKEN = "EXTERNAL_PI_TOKEN";
const RECONNECT_DELAY_MS = 2000;

// Outbound message shapes (must match daemon AgentMsg in daemon/protocol.go).
interface OutRegister {
	type: "register";
	id: string;
	hostname: string;
	pid: number;
	token: string;
}
interface OutState {
	type: "state";
	state: AgentState;
}
interface OutStatus {
	type: "status";
	status: "idle" | "busy";
}
interface OutBye {
	type: "bye";
}
// One streamed token chunk (must match daemon StreamDelta).
interface OutStream {
	type: "stream";
	stream: {
		kind: "text" | "thinking" | "tool_call";
		delta: string;
		toolName: string;
	};
}

// State payload pushed to the daemon (must match daemon ServerState).
interface AgentState {
	cwd: string;
	branch: string;
	sessionId: string;
	sessionName: string;
	status: "idle" | "busy";
	model: string;
	todos: AgentTodo[];
	subagents: AgentSubagent[];
	entries: AgentEntry[];
}

interface AgentTodo {
	id: number;
	subject: string;
	status: "pending" | "in_progress" | "completed";
}
interface AgentSubagent {
	name: string;
	task: string;
	status: "running" | "completed" | "failed";
}
interface AgentEntry {
	id: string;
	kind: "user" | "assistant" | "tool_call" | "tool_result" | "system";
	text: string;
	toolName: string;
	isError: boolean;
	ts: number;
}

// Inbound command from the daemon (must match daemon DaemonMsg).
interface InMessage {
	type: "welcome" | "sendMessage";
	text?: string;
	ref?: string;
}

/** stable-ish id for this process so reconnects replace, not duplicate. */
function agentId(): string {
	const rand = randomBytes(6).toString("hex");
	return `${os.hostname()}-${process.pid}-${rand}`;
}

/** Read a git branch name for cwd, or "" if not a repo. */
async function readBranch(pi: ExtensionAPI, cwd: string): Promise<string> {
	try {
		const { stdout, code } = await pi.exec(
			"git",
			["rev-parse", "--abbrev-ref", "HEAD"],
			{ cwd },
		);
		if (code !== 0) return "";
		return stdout.trim();
	} catch {
		return "";
	}
}

/**
 * Build the full state snapshot from the session manager + ctx.
 * Pure (no side effects) so it is unit-testable.
 */
function buildState(
	ctx: ExtensionContext,
	status: "idle" | "busy",
	sessionName: string,
): AgentState {
	const branch = ""; // resolved async by readBranch in the caller; placeholder here
	const sm = ctx.sessionManager;
	const entries: AgentEntry[] = [];
	let model = "";
	for (const entry of sm.getBranch()) {
		if (entry.type !== "message") continue;
		const msg = entry.message;
		if (!msg) continue;
		const ts =
			typeof (msg as { timestamp?: unknown }).timestamp === "number"
				? (msg as { timestamp: number }).timestamp
				: 0;

		if (msg.role === "user") {
			entries.push({
				id: entry.id,
				kind: "user",
				text: textOf(msg.content),
				toolName: "",
				isError: false,
				ts,
			});
		} else if (msg.role === "assistant") {
			if (!model && msg.model) model = msg.model;
			for (const part of msg.content as unknown[]) {
				const p = part as { type?: string; text?: string; name?: string };
				if (p.type === "text" && p.text) {
					entries.push({
						id: entry.id,
						kind: "assistant",
						text: p.text,
						toolName: "",
						isError: false,
						ts,
					});
				} else if (p.type === "toolCall" && p.name) {
					entries.push({
						id: entry.id,
						kind: "tool_call",
						text: JSON.stringify(
							(part as { arguments?: unknown }).arguments ?? {},
						),
						toolName: p.name,
						isError: false,
						ts,
					});
				}
			}
		} else if (msg.role === "toolResult") {
			entries.push({
				id: entry.id,
				kind: "tool_result",
				text: textOf(msg.content),
				toolName: String((msg as { toolName?: string }).toolName ?? ""),
				isError: Boolean((msg as { isError?: boolean }).isError),
				ts,
			});
		}
	}

	return {
		cwd: ctx.cwd,
		branch,
		sessionId: sm.getSessionFile() ?? "",
		sessionName,
		status,
		model,
		todos: extractTodos(sm.getBranch()),
		subagents: extractSubagents(sm.getBranch()),
		entries,
	};
}

/** Extract the todo tool's latest state from session entries. */
function extractTodos(
	entries: Iterable<{
		type: string;
		message?: { role?: string; toolName?: string; details?: unknown };
	}>,
): AgentTodo[] {
	const todosById = new Map<number, AgentTodo>();
	for (const entry of entries) {
		if (entry.type !== "message") continue;
		const msg = entry.message;
		if (!msg || msg.role !== "toolResult" || msg.toolName !== "todo") continue;
		// pi's built-in task-list tool stores items in details.tasks (each
		// {id, subject, status}). The whole array is the current snapshot, so
		// last-write-wins: replace on each result.
		const details = msg.details as
			| {
					tasks?: Array<{
						id: number;
						subject?: string;
						status?: string;
					}>;
			  }
			| undefined;
		if (!details?.tasks) continue;
		todosById.clear();
		for (const t of details.tasks) {
			todosById.set(t.id, {
				id: t.id,
				subject: t.subject ?? "",
				status: (t.status as AgentTodo["status"]) ?? "pending",
			});
		}
	}
	return [...todosById.values()];
}

/** Extract currently-running subagent invocations from session entries.
 *
 * A "run" is a `subagent` toolCall that names an agent (management calls like
 * create/delete use `action` and carry no `agent`, so they are excluded).
 *
 * A run is settled — and therefore dropped from the live list — once its
 * matching toolResult (by toolCallId) is reached. A result is settled when it
 * carries a non-empty `details.results[]` (the run produced an exitCode) or is
 * an error. An empty-`results` dispatch-ack (async handed off, or an immediate
 * failure) is treated as still running, since its completion is not yet
 * observable in the main session branch. This makes sync subagents appear
 * while running and vanish when done; async ones stay visible until pi writes
 * a settled result for them. */
function extractSubagents(
	entries: Iterable<{
		type: string;
		message?: {
			role?: string;
			content?: unknown;
			toolName?: string;
			toolCallId?: string;
			isError?: boolean;
			details?: unknown;
		};
	}>,
): AgentSubagent[] {
	const settled = new Set<string>();
	for (const entry of entries) {
		if (entry.type !== "message") continue;
		const msg = entry.message;
		if (!msg || msg.role !== "toolResult" || msg.toolName !== "subagent")
			continue;
		// pi always pairs a subagent result with its call via toolCallId.
		const results = (msg.details as { results?: unknown[] } | undefined)
			?.results;
		const done =
			Boolean(msg.isError) || (Array.isArray(results) && results.length > 0);
		if (done) settled.add(msg.toolCallId as string);
	}

	const out: AgentSubagent[] = [];
	for (const entry of entries) {
		if (entry.type !== "message") continue;
		const msg = entry.message;
		if (!msg || msg.role !== "assistant") continue;
		for (const part of msg.content as unknown[]) {
			const p = part as {
				type?: string;
				id?: string;
				name?: string;
				arguments?: { agent?: string; task?: string };
			};
			if (
				p.type === "toolCall" &&
				p.name === "subagent" &&
				p.arguments?.agent &&
				p.id &&
				!settled.has(p.id)
			) {
				out.push({
					name: p.arguments.agent,
					task: p.arguments.task ?? "",
					status: "running",
				});
			}
		}
	}
	return out;
}

/* Map a pi-ai AssistantMessageEvent to a streamable delta, or null if the
 * event carries no token (start/end/done/error frames are not streamed —
 * only the *_delta frames are).
 *
 * For tool_call deltas, the tool name is resolved from the partial message's
 * content block at contentIndex (pi sets the name early in the stream). */
function extractStreamDelta(ev: {
	type?: string;
	contentIndex?: number;
	delta?: string;
	partial?: { content?: unknown[] };
}): OutStream["stream"] | null {
	const delta = typeof ev.delta === "string" ? ev.delta : "";
	if (delta === "") return null;
	let kind: OutStream["stream"]["kind"];
	let toolName = "";
	if (ev.type === "text_delta") {
		kind = "text";
	} else if (ev.type === "thinking_delta") {
		kind = "thinking";
	} else if (ev.type === "toolcall_delta") {
		kind = "tool_call";
		const block = ev.partial?.content?.[ev.contentIndex as number] as
			| { name?: string }
			| undefined;
		toolName = block?.name ?? "";
	} else {
		return null;
	}
	return { kind, delta, toolName };
}

/* Concatenate text parts of a message content into a single string. */
function textOf(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.map((p) =>
			(p as { type?: string; text?: string }).type === "text"
				? (p as { text: string }).text
				: "",
		)
		.join("\n")
		.trim();
}

export default function (pi: ExtensionAPI): void {
	const url = process.env[ENV_URL];
	const token = process.env[ENV_TOKEN];
	if (!url || !token) {
		// Not configured: no-op. Avoids errors in pi sessions that don't want it.
		return;
	}

	const id = agentId();
	let ws: WebSocket | null = null;
	let stopped = false;
	let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

	const send = (
		msg: OutRegister | OutState | OutStatus | OutBye | OutStream,
	): void => {
		if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
	};

	const pushState = async (
		ctx: ExtensionContext,
		status: "idle" | "busy",
	): Promise<void> => {
		const state = buildState(ctx, status, pi.getSessionName?.() ?? "");
		state.branch = await readBranch(pi, ctx.cwd);
		send({ type: "state", state });
	};

	const pushStatus = (status: "idle" | "busy"): void =>
		send({ type: "status", status });

	const handleMessage = (raw: string): void => {
		let msg: InMessage;
		try {
			msg = JSON.parse(raw) as InMessage;
		} catch {
			return;
		}
		if (msg.type === "sendMessage" && msg.text) {
			// Auto-deliver: idle → trigger a turn; busy → queue as a follow-up
			// delivered after the agent finishes. Never interrupts in-flight work.
			const opts = { deliverAs: "followUp" as const, triggerTurn: true };
			pi.sendUserMessage(msg.text, opts);
		}
	};

	const connect = (): void => {
		try {
			// Authenticate at the WS handshake. The daemon requires the token to
			// accept the upgrade on /ws/agent; we pass it as a ?token= query param
			// so it works on every WebSocket implementation (node's undici and
			// bun alike — neither reliably supports custom handshake headers on
			// the spec WebSocket constructor). The token is also re-sent in the
			// register message below as defense-in-depth.
			const wsUrl = new URL(url);
			wsUrl.searchParams.set("token", token);
			ws = new WebSocket(wsUrl.toString());
		} catch {
			scheduleReconnect();
			return;
		}
		ws.onopen = () => {
			send({
				type: "register",
				id,
				hostname: os.hostname(),
				pid: process.pid,
				token,
			});
		};
		ws.onmessage = (ev) => handleMessage(String((ev as MessageEvent).data));
		ws.onclose = () => scheduleReconnect();
		ws.onerror = () => {
			/* close handler will reconnect */
		};
	};

	const scheduleReconnect = (): void => {
		if (stopped) return;
		if (reconnectTimer) clearTimeout(reconnectTimer);
		reconnectTimer = setTimeout(connect, RECONNECT_DELAY_MS);
	};

	// Push state on lifecycle events.
	pi.on("session_start", async (_e, ctx) => pushState(ctx, "idle"));
	pi.on("session_tree", async (_e, ctx) => pushState(ctx, "idle"));
	pi.on("turn_start", async (_e, ctx) => {
		pushStatus("busy");
		await pushState(ctx, "busy");
	});
	pi.on("turn_end", async (_e, ctx) => {
		pushStatus("idle");
		await pushState(ctx, "idle");
	});
	pi.on("tool_result", async (_e, ctx) => pushState(ctx, "busy"));
	// Stream token deltas live to the UI. Non-delta frames (start/end/done)
	// produce no message, so they cost nothing on the wire.
	pi.on("message_update", (e) => {
		const stream = extractStreamDelta(
			(
				e as {
					assistantMessageEvent: {
						type?: string;
						contentIndex?: number;
						delta?: string;
						partial?: { content?: unknown[] };
					};
				}
			).assistantMessageEvent,
		);
		if (stream) send({ type: "stream", stream });
	});
	pi.on("session_shutdown", async () => {
		send({ type: "bye" });
		// The pi process is exiting: stop reconnecting and tear down the socket.
		stopped = true;
		if (reconnectTimer) clearTimeout(reconnectTimer);
		ws?.close();
	});

	connect();
}

/** Exported for unit testing the pure helpers. */
export const __test = {
	textOf,
	extractTodos,
	extractSubagents,
	buildState,
	readBranch,
	extractStreamDelta,
};

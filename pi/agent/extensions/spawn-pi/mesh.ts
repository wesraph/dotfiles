/**
 * spawn-pi mesh — peer-to-peer messaging between open pi sessions.
 *
 * Transport: AF_UNIX sockets, one per pi (listened on session_start). Messages
 * are newline-delimited JSON: one request per connection, one response back.
 * Both ends run servers, so delivery is full-duplex.
 *
 * Registry: a directory of per-node files (~/.pi/spawn-pi/nodes/<id>.json), one
 * file per pi. One writer per file → no cross-process write races. Liveness is
 * checked via the recorded pid (`kill -0`); dead nodes are reaped on read/send.
 * A live pid whose socket refuses is reported as "temporarily unreachable" and
 * NOT reaped, so a `/resume` flap does not drop a node that comes right back.
 *
 * No pi-package dependencies (node builtins only) → unit-testable with plain
 * `node --test`.
 */

import { createServer, createConnection, type Server } from "node:net";
import {
	mkdirSync,
	readFileSync,
	readdirSync,
	writeFileSync,
	unlinkSync,
	renameSync,
} from "node:fs";
import { homedir, hostname } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { ENV_NODE_ID, ENV_PARENT_ID, ENV_NODE_NAME } from "./logic.ts";

export { ENV_NODE_ID, ENV_PARENT_ID, ENV_NODE_NAME };

const SEND_TIMEOUT_MS = 3000;

export interface MeshNode {
	id: string;
	pid: number;
	ppid: number;
	cwd: string;
	name: string;
	label: string;
	parentId?: string;
	socketPath: string;
	startedAt: number;
}

export interface WireMessage {
	type: "message";
	from: string;
	fromLabel: string;
	text: string;
	ts: number;
}

export interface WireResponse {
	ok: boolean;
	error?: string;
}

/** One-shot send outcome. `unreachable` distinguishes "dead/missing" from transient. */
export interface SendResult {
	ok: boolean;
	error?: string;
	unreachable?: boolean;
}

export interface MeshDirs {
	root: string;
	nodes: string;
	sockets: string;
}

export function meshRootDir(): string {
	return join(homedir(), ".pi", "spawn-pi");
}

/** Resolve and create the mesh directories. Safe to call repeatedly. */
export function ensureMeshDirs(root: string = meshRootDir()): MeshDirs {
	const nodes = join(root, "nodes");
	const sockets = join(root, "sockets");
	mkdirSync(nodes, { recursive: true });
	mkdirSync(sockets, { recursive: true });
	return { root, nodes, sockets };
}

export function nodeFilePath(nodesDir: string, id: string): string {
	return join(nodesDir, `${id}.json`);
}

export function socketFilePath(socketsDir: string, id: string): string {
	return join(socketsDir, `${id}.sock`);
}

/** Stable-per-process node id: hostname-pid-rand. */
export function makeNodeId(): string {
	return `${hostname()}-${process.pid}-${randomBytes(4).toString("hex")}`;
}

/** Human-friendly label: session name or cwd basename, plus a short disambiguator. */
export function defaultLabel(cwd: string, name?: string): string {
	const base =
		(name && name.trim()) || (cwd ? (cwd.split("/").filter(Boolean).pop() ?? cwd) : "pi");
	return `${base}-${randomBytes(2).toString("hex")}`;
}

export type DeliverAs = "followUp";

/** Delivery options for an inbound mesh message injected via sendUserMessage. */
export interface DeliveryOpts {
	deliverAs?: DeliverAs;
}

/**
 * Decide how to inject an inbound message: immediate turn when idle, queued
 * followUp when the agent is busy. Always returns a value safe to spread into
 * sendUserMessage's options, so the caller never hits the "streaming without
 * deliverAs" throw by default.
 */
export function deliveryOpts(isIdle: boolean): DeliveryOpts {
	return isIdle ? {} : { deliverAs: "followUp" };
}

/** Format how an incoming message is presented inside the receiving pi's conversation. */
export function formatIncoming(fromLabel: string, text: string): string {
	return `[message from pi "${fromLabel}"]: ${text}`;
}

/** True if a process is alive (signal 0 probe). */
export function isPidAlive(pid: number): boolean {
	if (!pid || pid <= 0) return false;
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}

/** Atomic write of a node's own file. */
export function writeNode(nodesDir: string, node: MeshNode): void {
	const fp = nodeFilePath(nodesDir, node.id);
	const tmp = `${fp}.${process.pid}.${Date.now()}.tmp`;
	writeFileSync(tmp, JSON.stringify(node), { mode: 0o600 });
	renameSync(tmp, fp);
}

export function readNode(nodesDir: string, id: string): MeshNode | null {
	try {
		return JSON.parse(readFileSync(nodeFilePath(nodesDir, id), "utf8")) as MeshNode;
	} catch {
		return null;
	}
}

export function removeNodeFile(nodesDir: string, id: string): void {
	try {
		unlinkSync(nodeFilePath(nodesDir, id));
	} catch {
		/* already gone */
	}
}

/** Remove a node's file and (best-effort) its socket file. */
export function reapNode(nodesDir: string, socketsDir: string, id: string): void {
	removeNodeFile(nodesDir, id);
	try {
		unlinkSync(socketFilePath(socketsDir, id));
	} catch {
		/* socket may be gone */
	}
}

export interface NodeListResult {
	nodes: MeshNode[];
	reaped: string[];
}

/** List live nodes, reaping any whose pid is dead. */
export function listNodes(nodesDir: string, socketsDir: string): NodeListResult {
	let files: string[] = [];
	try {
		files = readdirSync(nodesDir);
	} catch {
		return { nodes: [], reaped: [] };
	}
	const nodes: MeshNode[] = [];
	const reaped: string[] = [];
	for (const f of files) {
		if (!f.endsWith(".json")) continue;
		try {
			const node = JSON.parse(readFileSync(join(nodesDir, f), "utf8")) as MeshNode;
			if (!isPidAlive(node.pid)) {
				reapNode(nodesDir, socketsDir, node.id);
				reaped.push(node.id);
				continue;
			}
			nodes.push(node);
		} catch {
			/* skip corrupt file */
		}
	}
	return { nodes, reaped };
}

export type ResolveResult =
	| { ok: true; ids: string[] }
	| { ok: false; error: string; available: MeshNode[] };

/** Resolve a target spec to a list of node ids. Pure given the live node list. */
export function resolveTargets(
	target: string,
	self: { myId: string; parentId?: string },
	nodes: MeshNode[],
): ResolveResult {
	const others = nodes.filter((n) => n.id !== self.myId);

	if (target === "all") {
		return { ok: true, ids: others.map((n) => n.id) };
	}
	if (target === "parent") {
		const pid = self.parentId;
		if (!pid || !others.some((n) => n.id === pid)) {
			return { ok: false, error: "no parent node available", available: others };
		}
		return { ok: true, ids: [pid] };
	}
	if (target === "children") {
		const kids = others.filter((n) => n.parentId === self.myId).map((n) => n.id);
		if (kids.length === 0) {
			return { ok: false, error: "no child nodes available", available: others };
		}
		return { ok: true, ids: kids };
	}
	if (!others.some((n) => n.id === target)) {
		return { ok: false, error: `unknown node "${target}"`, available: others };
	}
	return { ok: true, ids: [target] };
}

export interface MeshServer {
	server: Server;
	socketPath: string;
}

/** Start listening. `deliver` is called for each inbound message (may throw to NACK). */
export function startMeshServer(
	socketPath: string,
	deliver: (msg: WireMessage) => Promise<void>,
): Promise<MeshServer> {
	return new Promise((resolveP, reject) => {
		try {
			unlinkSync(socketPath);
		} catch {
			/* not present */
		}
		const server = createServer((sock) => {
			let buf = "";
			sock.on("data", (chunk) => {
				buf += chunk.toString();
				let nl: number;
				while ((nl = buf.indexOf("\n")) !== -1) {
					const line = buf.slice(0, nl);
					buf = buf.slice(nl + 1);
					handleLine(line, deliver).then((resp: WireResponse) => {
						try {
							sock.write(`${JSON.stringify(resp)}\n`);
						} catch {
							/* client gone */
						}
					});
				}
			});
			sock.on("error", () => {
				/* ignore per-connection errors */
			});
		});
		server.on("error", reject);
		server.listen(socketPath, () => resolveP({ server, socketPath }));
	});
}

async function handleLine(
	line: string,
	deliver: (m: WireMessage) => Promise<void>,
): Promise<WireResponse> {
	let msg: WireMessage;
	try {
		msg = JSON.parse(line) as WireMessage;
	} catch {
		return { ok: false, error: "invalid json" };
	}
	if (msg.type !== "message" || typeof msg.text !== "string") {
		return { ok: false, error: "bad message shape" };
	}
	try {
		await deliver(msg);
		return { ok: true };
	} catch (e) {
		return { ok: false, error: e instanceof Error ? e.message : String(e) };
	}
}

export function stopMeshServer(s: MeshServer | null): Promise<void> {
	return new Promise((resolveP) => {
		if (!s) return resolveP();
		s.server.close(() => {
			try {
				unlinkSync(s.socketPath);
			} catch {
				/* already gone */
			}
			resolveP();
		});
	});
}

/** Send one line to a socket; resolves with the server's response. */
export function sendViaSocket(socketPath: string, line: string): Promise<SendResult> {
	return new Promise((resolveP) => {
		let conn;
		try {
			conn = createConnection(socketPath, () => {
				conn.write(`${line}\n`);
			});
		} catch (e) {
			resolveP({ ok: false, error: msg(e), unreachable: true });
			return;
		}
		let resp = "";
		let settled = false;
		const finish = (r: SendResult) => {
			if (settled) return;
			settled = true;
			try {
				conn.destroy();
			} catch {
				/* ignore */
			}
			resolveP(r);
		};
		conn.on("data", (c) => {
			resp += c.toString();
			const nl = resp.indexOf("\n");
			if (nl !== -1) {
				try {
					const parsed = JSON.parse(resp.slice(0, nl)) as WireResponse;
					finish({ ok: parsed.ok, error: parsed.error });
				} catch {
					finish({ ok: true });
				}
			}
		});
		conn.on("error", (e: NodeJS.ErrnoException) => {
			finish({
				ok: false,
				error: e.code === "ECONNREFUSED" ? "node unreachable" : msg(e),
				unreachable: e.code === "ECONNREFUSED" || e.code === "ENOENT",
			});
		});
		conn.setTimeout(SEND_TIMEOUT_MS, () => finish({ ok: false, error: "timeout" }));
	});
}

function msg(e: unknown): string {
	return e instanceof Error ? e.message : String(e);
}

/** High-level send: liveness-check then deliver; reap only on confirmed-dead pid. */
export async function sendToNode(
	nodesDir: string,
	socketsDir: string,
	targetId: string,
	msgObj: WireMessage,
): Promise<SendResult> {
	const node = readNode(nodesDir, targetId);
	if (!node) {
		return { ok: false, error: `unknown node "${targetId}"`, unreachable: true };
	}
	if (!isPidAlive(node.pid)) {
		reapNode(nodesDir, socketsDir, targetId);
		return { ok: false, error: `node "${targetId}" is not running`, unreachable: true };
	}
	const res = await sendViaSocket(node.socketPath, JSON.stringify(msgObj));
	// Live pid but socket refused → transient (/resume flap). Do NOT reap.
	return res;
}

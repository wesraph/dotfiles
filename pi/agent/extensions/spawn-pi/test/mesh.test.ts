/**
 * Unit + integration tests for the spawn-pi mesh.
 * Run: node --test test/mesh.test.ts
 *
 * Pure tests cover resolveTargets/formatIncoming/parseMeshEnv/buildChildEnv.
 * Integration tests spin up real AF_UNIX servers in a temp dir and exchange
 * messages between two in-process "nodes" to prove the transport end-to-end.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	resolveTargets,
	formatIncoming,
	parseMeshEnv,
	buildChildEnv,
	isPidAlive,
	writeNode,
	readNode,
	listNodes,
	reapNode,
	startMeshServer,
	stopMeshServer,
	sendToNode,
	sendViaSocket,
	nodeFilePath,
	socketFilePath,
	defaultLabel,
	deliveryOpts,
	makeNodeId,
	type MeshNode,
	type WireMessage,
} from "../mesh.ts";

const ENV_NODE_ID = "PI_SPAWN_NODE_ID";
const ENV_PARENT_ID = "PI_SPAWN_PARENT_ID";

function tmpMesh(): { root: string; nodes: string; sockets: string } {
	const root = mkdtempSync(join(tmpdir(), "spawnpi-mesh-"));
	const nodes = join(root, "nodes");
	const sockets = join(root, "sockets");
	mkdirSync(nodes, { recursive: true });
	mkdirSync(sockets, { recursive: true });
	return { root, nodes, sockets };
}

function fakeNode(id: string, pid: number, opts: Partial<MeshNode> = {}): MeshNode {
	const { sockets } = tmpMesh(); // throwaway just for a path; overwritten by caller dir
	return {
		id,
		pid,
		ppid: 1,
		cwd: "/proj",
		name: "",
		label: id,
		socketPath: `${sockets}/${id}.sock`,
		startedAt: 0,
		...opts,
	};
}

const ME = { myId: "me", parentId: "root" };
const NODES: MeshNode[] = [
	{ id: "me", pid: 1, ppid: 0, cwd: "/a", name: "", label: "me", socketPath: "/x", startedAt: 0 },
	{ id: "root", pid: 2, ppid: 0, cwd: "/b", name: "", label: "root", socketPath: "/x", startedAt: 0 },
	{ id: "child1", pid: 3, ppid: 1, cwd: "/c", name: "", label: "c1", socketPath: "/x", startedAt: 0, parentId: "me" },
	{ id: "child2", pid: 4, ppid: 1, cwd: "/d", name: "", label: "c2", socketPath: "/x", startedAt: 0, parentId: "me" },
	{ id: "sibling", pid: 5, ppid: 1, cwd: "/e", name: "", label: "sib", socketPath: "/x", startedAt: 0, parentId: "other" },
];

// --- pure helpers -----------------------------------------------------------

test("resolveTargets: 'all' returns everyone except self", () => {
	const r = resolveTargets("all", ME, NODES);
	assert.equal(r.ok, true);
	if (r.ok) {
		const ids = r.ids.toSorted();
		assert.deepEqual(ids, ["child1", "child2", "root", "sibling"].sort());
	}
});

test("resolveTargets: 'parent' resolves to parentId", () => {
	const r = resolveTargets("parent", ME, NODES);
	assert.equal(r.ok, true);
	if (r.ok) assert.deepEqual(r.ids, ["root"]);
});

test("resolveTargets: 'parent' fails when parent not in node list", () => {
	const r = resolveTargets("parent", { myId: "me", parentId: "ghost" }, NODES);
	assert.equal(r.ok, false);
	if (!r.ok) assert.match(r.error, /parent/);
});

test("resolveTargets: 'children' returns only nodes whose parentId === me", () => {
	const r = resolveTargets("children", ME, NODES);
	assert.equal(r.ok, true);
	if (r.ok) {
		const ids = r.ids.toSorted();
		assert.deepEqual(ids, ["child1", "child2"].sort());
	}
});

test("resolveTargets: 'children' fails when none", () => {
	const r = resolveTargets("children", { myId: "sibling" }, NODES);
	assert.equal(r.ok, false);
});

test("resolveTargets: specific id passes through", () => {
	const r = resolveTargets("child2", ME, NODES);
	assert.equal(r.ok, true);
	if (r.ok) assert.deepEqual(r.ids, ["child2"]);
});

test("resolveTargets: unknown id fails with available list", () => {
	const r = resolveTargets("nope", ME, NODES);
	assert.equal(r.ok, false);
	if (!r.ok) {
		assert.match(r.error, /unknown node/);
		assert.ok(r.available.length > 0);
	}
});

test("resolveTargets: targeting self is rejected as unknown", () => {
	const r = resolveTargets("me", ME, NODES);
	assert.equal(r.ok, false);
});

test("formatIncoming: wraps text with sender label", () => {
	assert.equal(
		formatIncoming("c1", "I'm done"),
		'[message from pi "c1"]: I\'m done',
	);
});

test("parseMeshEnv: reads trimmed env vars", () => {
	assert.deepEqual(parseMeshEnv({}), { nodeId: undefined, parentId: undefined });
	assert.deepEqual(parseMeshEnv({ [ENV_NODE_ID]: " abc " }), { nodeId: "abc", parentId: undefined });
	assert.deepEqual(
		parseMeshEnv({ [ENV_NODE_ID]: "child", [ENV_PARENT_ID]: "par" }),
		{ nodeId: "child", parentId: "par" },
	);
});

test("buildChildEnv: stamps node id + optional parent, preserves the rest", () => {
	const base = { PATH: "/usr/bin", FOO: "bar" } as NodeJS.ProcessEnv;
	const child = buildChildEnv(base, "kid", "parent");
	assert.equal(child[ENV_NODE_ID], "kid");
	assert.equal(child[ENV_PARENT_ID], "parent");
	assert.equal(child.PATH, "/usr/bin");
	assert.equal(child.FOO, "bar");
	// original env untouched
	assert.equal(base[ENV_NODE_ID], undefined);
});

test("buildChildEnv: omits parent when not provided", () => {
	const child = buildChildEnv({}, "kid");
	assert.equal(child[ENV_NODE_ID], "kid");
	assert.equal(child[ENV_PARENT_ID], undefined);
});

test("isPidAlive: current process is alive; bogus pid is not", () => {
	assert.equal(isPidAlive(process.pid), true);
	assert.equal(isPidAlive(999999), false);
	assert.equal(isPidAlive(0), false);
});

test("defaultLabel: uses name when present, else cwd basename", () => {
	const a = defaultLabel("/home/r/proj", "my-sess");
	assert.ok(a.startsWith("my-sess-"));
	const b = defaultLabel("/home/r/proj");
	assert.ok(b.startsWith("proj-"));
});

test("makeNodeId: unique, contains hostname + pid", () => {
	const id = makeNodeId();
	assert.ok(id.includes(String(process.pid)));
	const id2 = makeNodeId();
	assert.notEqual(id, id2);
});

// --- deliveryOpts (the "always queue" guarantee) --------------------------

test("deliveryOpts: idle → no deliverAs (triggers immediate turn)", () => {
	assert.deepEqual(deliveryOpts(true), {});
});

test("deliveryOpts: busy → followUp (queued, never throws)", () => {
	assert.deepEqual(deliveryOpts(false), { deliverAs: "followUp" });
});

// --- registry IO ------------------------------------------------------------

test("writeNode/readNode: round-trip, atomic", async () => {
	const { nodes, sockets } = tmpMesh();
	const node = fakeNode("n1", process.pid, { socketPath: socketFilePath(sockets, "n1") });
	writeNode(nodes, node);
	const back = readNode(nodes, "n1");
	assert.deepEqual(back, node);
	assert.equal(readNode(nodes, "missing"), null);
});

test("listNodes: reaps dead-pid entries, keeps live ones", () => {
	const { nodes, sockets } = tmpMesh();
	writeNode(nodes, fakeNode("live", process.pid, { socketPath: socketFilePath(sockets, "live") }));
	writeNode(nodes, fakeNode("dead", 999999, { socketPath: socketFilePath(sockets, "dead") }));
	const { nodes: live, reaped } = listNodes(nodes, sockets);
	assert.equal(live.length, 1);
	assert.equal(live[0].id, "live");
	assert.deepEqual(reaped, ["dead"]);
});

// --- socket transport (real, in-process) ------------------------------------

test("transport: full round-trip — two servers exchange a delivered message", async () => {
	const { nodes, sockets } = tmpMesh();
	const aPath = socketFilePath(sockets, "alice");
	const bPath = socketFilePath(sockets, "bob");

	const receivedB: WireMessage[] = [];
	const serverB = await startMeshServer(bPath, async (msg) => {
		receivedB.push(msg);
	});
	const serverA = await startMeshServer(aPath, async () => {
		/* alice also accepts, unused here */
	});

	writeNode(nodes, fakeNode("alice", process.pid, { socketPath: aPath }));
	writeNode(nodes, fakeNode("bob", process.pid, { socketPath: bPath }));

	const msg: WireMessage = {
		type: "message",
		from: "alice",
		fromLabel: "alice",
		text: "I'm done with the feature",
		ts: Date.now(),
	};
	const res = await sendToNode(nodes, sockets, "bob", msg);
	assert.equal(res.ok, true, `send failed: ${res.error}`);

	// give the server a tick to process
	await new Promise((r) => setTimeout(r, 20));
	assert.equal(receivedB.length, 1);
	assert.equal(receivedB[0].text, "I'm done with the feature");
	assert.equal(receivedB[0].from, "alice");

	await stopMeshServer(serverA);
	await stopMeshServer(serverB);
});

test("transport: sendViaSocket returns ok response from server", async () => {
	const { sockets } = tmpMesh();
	const path = socketFilePath(sockets, "srv");
	const server = await startMeshServer(path, async () => {
		/* success */
	});
	const res = await sendViaSocket(path, JSON.stringify({ type: "message", from: "x", fromLabel: "x", text: "hi", ts: 1 }));
	assert.equal(res.ok, true);
	await stopMeshServer(server);
});

test("transport: server NACKs when deliver throws", async () => {
	const { nodes, sockets } = tmpMesh();
	const path = socketFilePath(sockets, "nack");
	const server = await startMeshServer(path, async () => {
		throw new Error("busy");
	});
	writeNode(nodes, fakeNode("nack", process.pid, { socketPath: path }));
	const res = await sendToNode(nodes, sockets, "nack", {
		type: "message",
		from: "x",
		fromLabel: "x",
		text: "hi",
		ts: 1,
	});
	assert.equal(res.ok, false);
	assert.match(res.error ?? "", /busy/);
	await stopMeshServer(server);
});

test("sendToNode: unknown node → unreachable", async () => {
	const { nodes, sockets } = tmpMesh();
	const res = await sendToNode(nodes, sockets, "ghost", {
		type: "message",
		from: "x",
		fromLabel: "x",
		text: "hi",
		ts: 1,
	});
	assert.equal(res.ok, false);
	assert.equal(res.unreachable, true);
});

test("sendToNode: dead-pid node is reaped and reported unreachable", async () => {
	const { nodes, sockets } = tmpMesh();
	writeNode(nodes, fakeNode("dead", 999999, { socketPath: socketFilePath(sockets, "dead") }));
	const res = await sendToNode(nodes, sockets, "dead", {
		type: "message",
		from: "x",
		fromLabel: "x",
		text: "hi",
		ts: 1,
	});
	assert.equal(res.ok, false);
	assert.equal(res.unreachable, true);
	assert.equal(readNode(nodes, "dead"), null); // reaped
});

test("sendToNode: live pid but socket down → unreachable, NOT reaped", async () => {
	const { nodes, sockets } = tmpMesh();
	// live pid, but no server listening on the socket
	writeNode(nodes, fakeNode("flap", process.pid, { socketPath: socketFilePath(sockets, "flap") }));
	const res = await sendToNode(nodes, sockets, "flap", {
		type: "message",
		from: "x",
		fromLabel: "x",
		text: "hi",
		ts: 1,
	});
	assert.equal(res.ok, false);
	assert.equal(res.unreachable, true);
	// node file survives a transient outage (e.g. during a /resume flap)
	assert.notEqual(readNode(nodes, "flap"), null);
});

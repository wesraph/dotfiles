/**
 * spawn-pi — open another pi with a prompt, and let open pi's talk to each other.
 *
 * SPAWN
 *   `spawn_pi` tool + `/spawn` command. Opens a new, interactive pi seeded with
 *   an initial prompt. Stays open until the user closes it. Targets: tmux pane
 *   (default in tmux), tmux tab, or a new terminal window (alacritty first, then
 *   kitty/wezterm/foot). pane/tab fall back to terminal when not inside tmux.
 *   `cwd` opens it anywhere (git worktrees, etc.).
 *
 * MESH (full-duplex messaging between open pi's)
 *   `list_pi_nodes` + `send_pi_message` tools, `/nodes` + `/send` commands.
 *   Each pi listens on a unix socket on session_start; messages are injected
 *   into the receiver's conversation as user messages. Any-to-any by node id;
 *   `parent`/`children`/`all` convenience targets resolve along the spawn tree.
 *
 * Why the env-var trick for tmux: tmux runs the pane command through a shell, so
 * embedding an arbitrary prompt would need fragile shell-quoting. The prompt is
 * carried in PI_SPAWN_PROMPT (a tmux -e literal, never parsed) and referenced by
 * name: `exec pi "$PI_SPAWN_PROMPT"`. Mesh identity (PI_SPAWN_NODE_ID /
 * PI_SPAWN_PARENT_ID) rides the same -e flags, so spawned pi's join the mesh
 * with a known parent. Terminal emulators exec directly (no shell), so env is
 * inherited the usual way.
 *
 * Pure helpers live in ./logic.ts and ./mesh.ts (no pi-package deps) and are
 * unit-tested there.
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { StringEnum } from "@earendil-works/pi-ai";
import { Text } from "@earendil-works/pi-tui";
import {
	VALID_TARGETS,
	ENV_NODE_ID,
	ENV_PARENT_ID,
	ENV_NODE_NAME,
	isValidTarget,
	resolveCwd,
	canonicalizeCwd,
	resolveTarget,
	spawnPi,
	parseSpawnArgs,
	parseMeshEnv,
} from "./logic.ts";
import {
	ensureMeshDirs,
	defaultLabel,
	makeNodeId,
	writeNode,
	listNodes,
	removeNodeFile,
	startMeshServer,
	stopMeshServer,
	resolveTargets,
	sendToNode,
	formatIncoming,
	deliveryOpts,
	type MeshNode,
	type MeshServer,
	type WireMessage,
	type SendResult,
} from "./mesh.ts";

export type { SpawnDetails, SpawnTarget, TerminalSpec, ParsedSpawnArgs } from "./logic.ts";
export type { MeshNode, WireMessage, SendResult } from "./mesh.ts";
export {
	isInTmux,
	resolveTarget,
	detectTerminal,
	expandTilde,
	resolveCwd,
	canonicalizeCwd,
	buildTmuxArgs,
	buildTerminalArgs,
	tokenize,
	parseSpawnArgs,
	spawnPi,
	VALID_TARGETS,
	PROMPT_ENV,
	PI_BIN,
	TMUX_BIN,
	ENV_NODE_ID,
	ENV_PARENT_ID,
	ENV_NODE_NAME,
	parseMeshEnv,
	buildChildEnv,
} from "./logic.ts";
export {
	ensureMeshDirs,
	meshRootDir,
	nodeFilePath,
	socketFilePath,
	makeNodeId,
	defaultLabel,
	isPidAlive,
	writeNode,
	readNode,
	removeNodeFile,
	reapNode,
	listNodes,
	resolveTargets,
	startMeshServer,
	stopMeshServer,
	sendViaSocket,
	sendToNode,
	formatIncoming,
	deliveryOpts,
} from "./mesh.ts";

// Mesh state. Module-scoped so it survives across event-handler invocations and
// is reused when session_start fires again (e.g. /new, /resume) within the same
// process. On /reload the module is re-imported, so state resets cleanly.
let meshServer: MeshServer | null = null;
let currentNodeId: string | undefined;
let currentParentId: string | undefined;
let currentLabel: string | undefined;

export default function (pi: ExtensionAPI): void {
	const ensureMesh = async (ctx: ExtensionContext): Promise<void> => {
		const dirs = ensureMeshDirs();
		const envId = parseMeshEnv(process.env);
		// Stable across session_start within the process; seeded from env on first start.
		currentNodeId = currentNodeId ?? envId.nodeId ?? makeNodeId();
		currentParentId = currentParentId ?? envId.parentId;
		// An explicit spawn-time name is used verbatim (no hex suffix) and also drives
		// pi's session name; otherwise derive a readable label from cwd/session name.
		const explicitName = envId.name;
		const sessionName = explicitName ?? pi.getSessionName?.() ?? "";
		if (explicitName) {
			currentLabel = explicitName;
			try {
				pi.setSessionName?.(explicitName);
			} catch {
				/* setting the session name is best-effort */
			}
		} else {
			currentLabel = defaultLabel(ctx.cwd, sessionName);
		}

		writeNode(dirs.nodes, {
			id: currentNodeId,
			pid: process.pid,
			ppid: process.ppid ?? 0,
			cwd: ctx.cwd,
			name: sessionName,
			label: currentLabel,
			parentId: currentParentId,
			socketPath: `${dirs.sockets}/${currentNodeId}.sock`,
			startedAt: Date.now(),
		});

		if (meshServer) return; // already listening (e.g. re-entry on /resume)
		const socketPath = `${dirs.sockets}/${currentNodeId}.sock`;
		const deliver = async (msg: WireMessage): Promise<void> => {
			const text = formatIncoming(msg.fromLabel || msg.from, msg.text);
			// Always await: when the agent is streaming, sendUserMessage rejects
			// asynchronously — without await that escapes as an unhandled rejection.
			// isIdle() picks immediate-turn vs. queued followUp; the catch retries
			// with followUp for the isIdle→streaming race so the message always lands.
			try {
				await pi.sendUserMessage(text, deliveryOpts(ctx.isIdle()));
			} catch {
				try {
					await pi.sendUserMessage(text, { deliverAs: "followUp" });
				} catch {
					/* non-interactive mode (print/json): no agent loop to deliver to */
				}
			}
		};
		try {
			meshServer = await startMeshServer(socketPath, deliver);
		} catch {
			// Server failed to bind: mesh disabled, but spawn still works.
			meshServer = null;
		}
	};

	const teardownMesh = async (): Promise<void> => {
		const dirs = ensureMeshDirs();
		if (currentNodeId) removeNodeFile(dirs.nodes, currentNodeId);
		if (meshServer) {
			await stopMeshServer(meshServer);
			meshServer = null;
		}
	};

	const selfMeta = () => ({ myId: currentNodeId ?? "", parentId: currentParentId });

	const listMeshNodes = (): { self?: MeshNode; peers: MeshNode[] } => {
		const dirs = ensureMeshDirs();
		const { nodes } = listNodes(dirs.nodes, dirs.sockets);
		const self = nodes.find((n) => n.id === currentNodeId);
		const peers = nodes.filter((n) => n.id !== currentNodeId);
		return { self, peers };
	};

	const sendMesh = async (
		target: string,
		text: string,
	): Promise<{ results: Array<{ id: string; label: string } & SendResult>; available: MeshNode[] }> => {
		const dirs = ensureMeshDirs();
		const { nodes } = listNodes(dirs.nodes, dirs.sockets);
		const resolved = resolveTargets(target, selfMeta(), nodes);
		if (!resolved.ok) {
			return { results: [], available: resolved.available };
		}
		const ts = Date.now();
		const results: Array<{ id: string; label: string } & SendResult> = [];
		for (const id of resolved.ids) {
			const node = nodes.find((n) => n.id === id);
			const msg: WireMessage = {
				type: "message",
				from: currentNodeId ?? "",
				fromLabel: currentLabel ?? currentNodeId ?? "",
				text,
				ts,
			};
			const res = await sendToNode(dirs.nodes, dirs.sockets, id, msg);
			results.push({ id, label: node?.label ?? id, ...res });
		}
		return { results, available: nodes.filter((n) => n.id !== currentNodeId) };
	};

	const runSpawn = async (
		rawPrompt: string,
		rawCwd: string | undefined,
		rawTarget: string,
		fallbackCwd: string,
		env: NodeJS.ProcessEnv,
		rawName?: string,
	): Promise<{ details: Awaited<ReturnType<typeof spawnPi>>; summary: string }> => {
		const prompt = rawPrompt.trim();
		if (!prompt) throw new Error("prompt is required");
		if (!isValidTarget(rawTarget)) {
			throw new Error(`invalid target "${rawTarget}". Use one of: ${VALID_TARGETS.join(", ")}`);
		}
		const name = rawName?.trim() || undefined;
		const resolved = resolveCwd(rawCwd, fallbackCwd);
		let cwd = resolved;
		try {
			cwd = canonicalizeCwd(resolved);
		} catch {
			throw new Error(`working directory does not exist: ${resolved}`);
		}
		const target = resolveTarget(rawTarget, env);

		// Stamp the child with a mesh identity so it can message back. An explicit
		// name rides the same -e mechanism and is used verbatim as the child's label.
		const childId = makeNodeId();
		const extraEnv: Record<string, string> = { [ENV_NODE_ID]: childId };
		if (currentNodeId) extraEnv[ENV_PARENT_ID] = currentNodeId;
		if (name) extraEnv[ENV_NODE_NAME] = name;

		const details = await spawnPi({ prompt, cwd, target, env, extraEnv });
		details.childId = childId;

		const where =
			target === "terminal"
				? `a new ${details.terminal ?? "terminal"} window`
				: `a new tmux ${target}`;
		const asName = name ? ` as "${name}"` : "";
		const summary = `Opened ${where}${asName} in ${cwd}\nPrompt: ${prompt}\nNode id: ${childId}`;
		const fellBack = rawTarget !== "auto" && rawTarget !== target;
		return {
			details,
			summary: fellBack ? `${summary}\n(fell back to terminal: not inside tmux)` : summary,
		};
	};

	// --- lifecycle: bring the mesh up/down with the session ---
	pi.on("session_start", async (_e, ctx) => {
		await ensureMesh(ctx);
	});
	pi.on("session_shutdown", async () => {
		await teardownMesh();
	});

	// --- spawn tool ---
	pi.registerTool({
		name: "spawn_pi",
		label: "Spawn pi",
		description: [
			"Open a NEW, interactive pi session seeded with an initial prompt. The new pi runs in a",
			"separate tmux pane/tab (when inside tmux) or a new terminal window, and stays open until",
			"the user closes it. Use it to hand a self-contained task to a fresh context, optionally in",
			"a different working directory (e.g. a git worktree). The spawned pi joins the mesh: use",
			"send_pi_message to talk to it (target 'children' or its returned node id).",
		].join(" "),
		promptSnippet: "Open another interactive pi in a tmux pane/tab or new terminal with a starting prompt",
		promptGuidelines: [
			"Use spawn_pi when the user asks to open/start/launch another pi in a new pane, tab, terminal, or worktree.",
		],
		parameters: Type.Object({
			prompt: Type.String({
				description: "Initial prompt to seed the new pi session with.",
			}),
			cwd: Type.Optional(
				Type.String({
					description:
						"Working directory for the new pi. Defaults to the current cwd. Use a git worktree path to implement a feature in isolation. ~ and relative paths are resolved.",
				}),
			),
			target: Type.Optional(
				StringEnum(VALID_TARGETS, {
					description:
					'Where to open. "auto" (default): tmux pane if inside tmux, else new terminal. "pane"/"tab" fall back to terminal when not in tmux.',
					default: "auto",
				}),
			),
			name: Type.Optional(
				Type.String({
					description:
					'Human-readable name for the new node, shown in /nodes and incoming messages (e.g. "auth-feature"). Defaults to a cwd-derived label. Useful when spawning several pi instances to tell them apart.',
				}),
			),
		}),

		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			try {
				const { details, summary } = await runSpawn(
					params.prompt,
					params.cwd,
					params.target ?? "auto",
					ctx.cwd,
					process.env,
					params.name,
				);
				return {
					content: [{ type: "text", text: summary }],
					details,
				};
			} catch (err) {
				throw new Error(err instanceof Error ? err.message : String(err));
			}
		},

		renderCall(args, theme, _context) {
			const target = (args.target as string) ?? "auto";
			const nameHint = args.name ? ` ${theme.fg("accent", String(args.name))}` : "";
			const cwdHint = args.cwd ? ` in ${args.cwd}` : "";
			const preview = args.prompt
				? args.prompt.length > 60
					? `${args.prompt.slice(0, 60)}...`
					: args.prompt
				: "...";
			const text =
				theme.fg("toolTitle", theme.bold("spawn_pi ")) +
				theme.fg("accent", target) +
				nameHint +
				theme.fg("muted", cwdHint) +
				"\n  " +
				theme.fg("dim", preview);
			return new Text(text, 0, 0);
		},

		renderResult(result, _opts, theme, _context) {
			const text = result.content[0];
			return new Text(
				theme.fg("success", "✓ ") + (text?.type === "text" ? text.text : "spawned"),
				0,
				0,
			);
		},
	});

	// --- mesh: list nodes ---
	pi.registerTool({
		name: "list_pi_nodes",
		label: "List pi nodes",
		description: [
			"List other open pi sessions reachable over the mesh (node id, label, cwd, whether this",
			"one spawned them). Use before send_pi_message to discover a target id.",
		].join(" "),
		promptSnippet: "List other open pi sessions reachable over the mesh",
		parameters: Type.Object({}),

		async execute() {
			const { self, peers } = listMeshNodes();
			if (peers.length === 0) {
				return {
					content: [
						{
							type: "text",
							text: "No other pi nodes reachable. Spawn one with spawn_pi, or run another pi in this directory.",
						},
					],
					details: { self, peers },
				};
			}
			const lines = peers.map(
				(n) =>
					`- ${n.id}  (${n.label})  cwd=${n.cwd}${n.parentId === self?.id ? "  [child]" : ""}`,
			);
			return {
				content: [{ type: "text", text: `${peers.length} node(s):\n${lines.join("\n")}` }],
				details: { self, peers },
			};
		},
	});

	// --- mesh: send a message ---
	pi.registerTool({
		name: "send_pi_message",
		label: "Send pi message",
		description: [
			"Send a text message to another open pi over the mesh. It is injected into the receiver's",
			'conversation as a user message (it triggers a turn). Target by node id, or use "parent",',
			'"children", or "all". Typical use: a spawned pi reports "I am done with X" to its parent.',
		].join(" "),
		promptSnippet: "Send a message to another open pi (by id, parent, children, or all)",
		promptGuidelines: [
			"Use send_pi_message when the user wants one pi to tell another pi something (e.g. report completion, hand back a result).",
		],
		parameters: Type.Object({
			to: Type.String({
				description:
					'Target: a node id, or "parent", "children", "all". Discover ids with list_pi_nodes.',
			}),
			text: Type.String({ description: "Message body to deliver." }),
		}),

		async execute(_toolCallId, params) {
			const text = (params.text ?? "").trim();
			const to = (params.to ?? "").trim();
			if (!text) throw new Error("text is required");
			if (!to) throw new Error("to is required");
			const { results, available } = await sendMesh(to, text);
			if (results.length === 0) {
				const names = available.map((n) => `${n.id} (${n.label})`).join(", ") || "none";
				throw new Error(`Could not resolve target "${to}". Available: ${names}`);
			}
			const lines = results.map(
				(r) => `- ${r.id} (${r.label}): ${r.ok ? "delivered" : `failed (${r.error})`}`,
			);
			const okCount = results.filter((r) => r.ok).length;
			return {
				content: [
					{
						type: "text",
						text: `Delivered ${okCount}/${results.length}:\n${lines.join("\n")}`,
					},
				],
				details: { results },
			};
		},
	});

	// --- commands ---
	pi.registerCommand("spawn", {
		description:
			"Open a new pi with a prompt. Usage: /spawn [--name NAME] [--cwd DIR] [--target auto|pane|tab|terminal] <prompt>",
		handler: async (args, ctx) => {
			const parsed = parseSpawnArgs(args);
			if (!parsed.prompt) {
				ctx.ui.notify(
					"Usage: /spawn [--name NAME] [--cwd DIR] [--target auto|pane|tab|terminal] <prompt>",
					"warning",
				);
				return;
			}
			try {
				const { summary } = await runSpawn(
					parsed.prompt,
					parsed.cwd,
					parsed.target,
					ctx.cwd,
					process.env,
					parsed.name,
				);
				ctx.ui.notify(summary, "info");
			} catch (err) {
				ctx.ui.notify(err instanceof Error ? err.message : String(err), "error");
			}
		},
	});

	pi.registerCommand("nodes", {
		description: "List other open pi nodes reachable over the mesh",
		handler: async (_args, ctx) => {
			const { self, peers } = listMeshNodes();
			if (peers.length === 0) {
				ctx.ui.notify("No other pi nodes reachable.", "info");
				return;
			}
			const lines = peers.map(
				(n) => `${n.id} (${n.label}) cwd=${n.cwd}${n.parentId === self?.id ? " [child]" : ""}`,
			);
			ctx.ui.notify(`${peers.length} node(s):\n${lines.join("\n")}`, "info");
		},
	});

	pi.registerCommand("send", {
		description: "Send a message to another pi. Usage: /send <id|parent|children|all> <message>",
		handler: async (args, ctx) => {
			const sp = args.indexOf(" ");
			if (sp === -1) {
				ctx.ui.notify("Usage: /send <id|parent|children|all> <message>", "warning");
				return;
			}
			const to = args.slice(0, sp).trim();
			const text = args.slice(sp + 1).trim();
			if (!to || !text) {
				ctx.ui.notify("Usage: /send <id|parent|children|all> <message>", "warning");
				return;
			}
			const { results, available } = await sendMesh(to, text);
			if (results.length === 0) {
				const names = available.map((n) => `${n.id}`).join(", ") || "none";
				ctx.ui.notify(`Unknown target "${to}". Available: ${names}`, "error");
				return;
			}
			const ok = results.filter((r) => r.ok).length;
			ctx.ui.notify(`Delivered ${ok}/${results.length}`, ok === results.length ? "info" : "warning");
		},
	});
}

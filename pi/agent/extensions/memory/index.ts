/**
 * pi memory extension.
 *
 * Maintains a per-scope MEMORY.md that is injected into the system prompt.
 * Scope is the git repository root (worktree-aware: all worktrees of a repo
 * share one memory file), or the current folder when not in a git repo.
 *
 * Storage lives under a configurable directory (default ~/.pi/memories,
 * override with the PI_MEMORIES_DIR environment variable), laid out as
 * <dir>/<absolute scope path>/MEMORY.md.
 *
 * Exposes a `memory` tool so the agent can add / remove / list / read
 * entries at any time. Entries added mid-session appear in the system
 * prompt on the next turn.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { StringEnum } from "@earendil-works/pi-ai";
import {
	DEFAULT_MAX_BYTES,
	DEFAULT_MAX_LINES,
	truncateHead,
	withFileMutationQueue,
	type ExtensionAPI,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import {
	addEntry,
	getMemoriesDir,
	listEntries,
	memoryFilePath,
	newMemoryFileContent,
	normalizeId,
	realGitRunner,
	removeEntry,
	resolveScopeDir,
} from "./memory-core.ts";

const MEMORY_PROMPT_MAX_BYTES = 8192;
const MEMORY_PROMPT_MAX_LINES = 400;

interface MemoryScope {
	root: string;
	file: string;
}

async function readFileOrNull(path: string): Promise<string | undefined> {
	try {
		return await readFile(path, "utf8");
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
		throw error;
	}
}

export default function memoryExtension(pi: ExtensionAPI) {
	let scopePromise: Promise<MemoryScope> | undefined;

	const resolveScope = (cwd: string): Promise<MemoryScope> => {
		scopePromise ??= (async () => {
			const root = await resolveScopeDir(cwd, realGitRunner);
			return { root, file: memoryFilePath(getMemoriesDir(), root) };
		})();
		return scopePromise;
	};

	pi.on("session_start", () => {
		scopePromise = undefined;
	});

	pi.on("before_agent_start", async (event, ctx) => {
		const { root, file } = await resolveScope(ctx.cwd);
		const content = await readFileOrNull(file);
		if (!content?.trim() || listEntries(content).length === 0) return;

		const truncation = truncateHead(content, {
			maxBytes: MEMORY_PROMPT_MAX_BYTES,
			maxLines: MEMORY_PROMPT_MAX_LINES,
		});
		let text = truncation.content.trimEnd();
		if (truncation.truncated) {
			text += `\n\n[Memory truncated — use the memory tool with action "read" for the full content.]`;
		}

		return {
			systemPrompt: `${event.systemPrompt}

## Project Memory

Long-lived memory for this project (scope: ${root}). Entries persist across sessions and are managed with the \`memory\` tool.

${text}`,
		};
	});

	pi.registerTool({
		name: "memory",
		label: "Memory",
		description:
			"Persistent project memory, scoped to the current git repository (shared across worktrees) or folder. " +
			'Actions: "add" (title, optional body) stores an entry; "remove" (id) deletes one; ' +
			'"list" shows entry ids and titles; "read" returns the memory file (truncated when very large).',
		promptSnippet:
			"Persistent per-repo project memory (add/remove/list/read entries)",
		promptGuidelines: [
			"Use the memory tool to persist durable project knowledge (conventions, decisions, gotchas, environment quirks) that should survive across sessions, and to recall it when relevant.",
		],
		parameters: Type.Object({
			action: StringEnum(["add", "remove", "list", "read"] as const),
			title: Type.Optional(
				Type.String({ description: "Short entry title (for add)" }),
			),
			body: Type.Optional(
				Type.String({ description: "Entry details (for add, optional)" }),
			),
			id: Type.Optional(
				Type.String({ description: "Entry id such as m3 (for remove)" }),
			),
		}),

		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const { root, file } = await resolveScope(ctx.cwd);

			switch (params.action) {
				case "read": {
					const content = (await readFileOrNull(file))?.trim();
					if (!content) {
						throw new Error(
							`No memory yet for this scope (${root}). Use action "add" to create the first entry.`,
						);
					}
					const truncation = truncateHead(content, {
						maxBytes: DEFAULT_MAX_BYTES,
						maxLines: DEFAULT_MAX_LINES,
					});
					let text = truncation.content;
					if (truncation.truncated)
						text += `\n\n[Truncated — full file: ${file}]`;
					return {
						content: [{ type: "text", text }],
						details: { action: "read", scope: root, file },
					};
				}

				case "list": {
					const content = await readFileOrNull(file);
					const items = content ? listEntries(content) : [];
					const text = items.length
						? `Memory entries for ${root}:\n${items.join("\n")}`
						: `No memory entries yet for this scope (${root}).`;
					return {
						content: [{ type: "text", text }],
						details: { action: "list", scope: root, file, entries: items },
					};
				}

				case "add": {
					const title = params.title?.trim() ?? "";
					const body = params.body ?? "";
					const entryLine = await withFileMutationQueue(file, async () => {
						const current = await readFileOrNull(file);
						const content = current ?? newMemoryFileContent(root);
						const result = addEntry(content, title, body, new Date());
						await mkdir(dirname(file), { recursive: true });
						await writeFile(file, result.content, "utf8");
						return `${result.entry.id}: ${result.entry.title}`;
					});
					return {
						content: [
							{ type: "text", text: `Added to project memory: ${entryLine}` },
						],
						details: { action: "add", scope: root, file },
					};
				}

				case "remove": {
					if (!params.id?.trim())
						throw new Error('memory remove requires "id"');
					const id = normalizeId(params.id);
					const removed = await withFileMutationQueue(file, async () => {
						const content = await readFileOrNull(file);
						if (!content)
							throw new Error(`No memory yet for this scope (${root})`);
						const result = removeEntry(content, id);
						await writeFile(file, result.content, "utf8");
						return result.removed;
					});
					return {
						content: [
							{
								type: "text",
								text: `Removed from project memory: ${removed.id}: ${removed.title}`,
							},
						],
						details: { action: "remove", scope: root, file },
					};
				}
				default:
					throw new Error(
						`Unknown memory action: ${params.action satisfies never}`,
					);
			}
		},
	});
}

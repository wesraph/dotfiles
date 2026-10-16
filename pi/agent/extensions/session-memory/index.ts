/**
 * Session memory extension.
 *
 * Exposes a `session_memory` tool so the agent can record durable session
 * facts (decisions, gotchas, current state) as it works. Entries are stored
 * per session in a sidecar file and injected into the compaction summary by
 * the live-compaction extension, so nothing important is lost when the
 * context is compacted.
 *
 * Unlike the `memory` tool (persistent, project-scoped), session memory lives
 * and dies with one session file.
 */

import { StringEnum } from "@earendil-works/pi-ai";
import { type ExtensionAPI, withFileMutationQueue } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import {
	addEntry,
	cleanupStaleSidecars,
	formatEntries,
	loadEntries,
	removeEntry,
	SESSION_MEMORY_MAX_AGE_MS,
	saveEntries,
} from "./store.ts";

export default function sessionMemoryExtension(pi: ExtensionAPI) {
	pi.on("session_start", (_event, ctx) => {
		// Best-effort GC of sidecars from sessions that were never compacted again.
		void (async () => {
			try {
				await cleanupStaleSidecars(ctx.sessionManager.getSessionDir(), SESSION_MEMORY_MAX_AGE_MS, new Date());
			} catch {
				// GC is best-effort; never block session start.
			}
		})();
	});

	pi.registerTool({
		name: "session_memory",
		label: "Session memory",
		description:
			"Session-scoped memory for the CURRENT session only (not shared across sessions; use the `memory` tool for persistent project knowledge). " +
			'Actions: "add" (title, optional body) records an entry; "remove" (id) deletes one; "list" shows entries; "clear" deletes all. ' +
			"Entries are injected into the compaction summary, preserving them when old context is compacted away.",
		promptSnippet: "Session-scoped memory that survives compaction (add/remove/list/clear)",
		promptGuidelines: [
			"Use the session_memory tool to record durable session facts (decisions, gotchas, environment quirks, current task state) as you discover them — entries survive context compaction.",
		],
		parameters: Type.Object({
			action: StringEnum(["add", "remove", "list", "clear"] as const),
			title: Type.Optional(Type.String({ description: "Short entry title (for add)" })),
			body: Type.Optional(Type.String({ description: "Entry details (for add, optional)" })),
			id: Type.Optional(Type.String({ description: "Entry id such as s3 (for remove)" })),
		}),

		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const sessionFile = ctx.sessionManager.getSessionFile();

			if (!sessionFile) {
				const text =
					params.action === "list"
						? "No session memory: this session has no session file (in-memory session)."
						: "session_memory is unavailable: this session has no session file (in-memory session).";
				return {
					content: [{ type: "text", text }],
					details: { action: params.action, unavailable: true },
				};
			}

			switch (params.action) {
				case "list": {
					const entries = await loadEntries(sessionFile);
					const text = entries.length
						? `Session memory:\n${formatEntries(entries)}`
						: "No session memory entries yet.";
					return {
						content: [{ type: "text", text }],
						details: { action: "list", count: entries.length },
					};
				}

				case "add": {
					const title = params.title?.trim() ?? "";
					if (!title) throw new Error("session_memory add requires a title");
					const entryLine = await withFileMutationQueue(sessionFile, async () => {
						const entries = await loadEntries(sessionFile);
						const result = addEntry(entries, title, params.body ?? "", new Date());
						await saveEntries(sessionFile, result.entries);
						return `${result.id}: ${title}`;
					});
					return {
						content: [{ type: "text", text: `Added to session memory: ${entryLine}` }],
						details: { action: "add", entry: entryLine },
					};
				}

				case "remove": {
					if (!params.id?.trim()) throw new Error("session_memory remove requires an id");
					const id = params.id.trim();
					await withFileMutationQueue(sessionFile, async () => {
						const entries = await loadEntries(sessionFile);
						const remaining = removeEntry(entries, id);
						if (remaining.length === entries.length)
							throw new Error(`No session memory entry with id ${id}`);
						await saveEntries(sessionFile, remaining);
					});
					return {
						content: [{ type: "text", text: `Removed from session memory: ${id}` }],
						details: { action: "remove", id },
					};
				}

				case "clear": {
					await withFileMutationQueue(sessionFile, async () => {
						await saveEntries(sessionFile, []);
					});
					return {
						content: [{ type: "text", text: "Cleared all session memory entries." }],
						details: { action: "clear" },
					};
				}
				default:
					throw new Error(`Unknown session_memory action: ${params.action satisfies never}`);
			}
		},
	});
}

/**
 * Live (cache-reusing) compaction extension.
 *
 * Replaces pi's default compaction summarization, which re-sends the whole
 * to-be-summarized span as serialized text in a fresh, cache-disabled request
 * (100% full input price). Instead, this extension appends a summarization
 * instruction to the END of the live conversation and sends it through the
 * session's model with the same routing session id and prompt caching
 * enabled. The provider's prompt cache covers the whole conversation prefix,
 * so only the appended instruction is billed at full price.
 *
 * The instruction asks for the same structured checkpoint format pi uses
 * (Goal / Constraints / Progress / Key Decisions / Next Steps / Critical
 * Context) and merges the previous compaction summary plus session memory
 * entries (see ../session-memory).
 *
 * The leading system message is replayed from the last real provider request
 * (captured in `before_provider_request`, kept in a sidecar next to the
 * session file). The session projection replays persisted system-message
 * sections and misses what extensions inject per turn, and any drift in that
 * first block invalidates the provider's whole cached prefix.
 *
 * Any failure (provider error, abort, dangling tool calls, empty summary)
 * falls back to pi's default compaction by returning nothing.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { normalizeContext, type ThinkingLevel } from "@earendil-works/pi-ai";
import { convertToLlm, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { loadEntries, formatEntries } from "../session-memory/store.ts";

const SUMMARY_FORMAT = `Use this EXACT format:

## Goal
[What is the user trying to accomplish? Can be multiple items if the session covers different tasks.]

## Constraints & Preferences
- [Any constraints, preferences, or requirements mentioned by user]
- [Or "(none)" if none were mentioned]

## Progress
### Done
- [x] [Completed tasks/changes]

### In Progress
- [ ] [Current work]

### Blocked
- [Issues preventing progress, if any]

## Key Decisions
- **[Decision]**: [Brief rationale]

## Next Steps
1. [Ordered list of what should happen next]

## Critical Context
- [Any data, examples, or references needed to continue]
- [Or "(none)" if not applicable]

Keep each section concise. Preserve exact file paths, function names, and error messages.`;

const UPDATE_RULES = `A previous compaction summary appears earlier in the conversation above as the compaction summary message. Update it with the new information from this conversation:
- PRESERVE all still-relevant information from the previous summary
- ADD new progress, decisions, and context
- Move items from "In Progress" to "Done" when completed
- You may remove information that is no longer relevant`;

function buildInstruction(options: {
	previousSummary?: string;
	memoryText?: string;
	customInstructions?: string;
	isSplitTurn: boolean;
	keepRecentTokens: number;
}): string {
	const lines: string[] = [
		`The conversation above is about to be compacted: the most recent messages (roughly the last ${options.keepRecentTokens.toLocaleString("en-US")} tokens) will be kept verbatim, and everything before them will be replaced by a structured summary. The summary is the only memory of the earlier conversation, so capture everything needed to continue the work.`,
	];
	if (options.isSplitTurn) {
		lines.push(
			"The current user request started earlier and is being split: its early messages are summarized while its later messages are kept. Make sure the original request and the progress so far are captured.",
		);
	}
	if (options.previousSummary) lines.push(UPDATE_RULES);
	lines.push("", SUMMARY_FORMAT);
	if (options.memoryText) {
		lines.push(
			"",
			`The agent recorded session memory entries (in <session-memory> tags). Incorporate anything still relevant into the summary:`,
			`<session-memory>\n${options.memoryText}\n</session-memory>`,
		);
	}
	if (options.customInstructions) {
		lines.push("", `Additional focus: ${options.customInstructions}`);
	}
	lines.push("", "Do not call any tools. Respond with the summary only.");
	return lines.join("\n");
}

/** Files only read (not modified) and files modified, from compaction file operations. */
function computeFileLists(fileOps: {
	read: Set<string>;
	written: Set<string>;
	edited: Set<string>;
}): { readFiles: string[]; modifiedFiles: string[] } {
	const modified = new Set([...fileOps.edited, ...fileOps.written]);
	const readFiles = [...fileOps.read].filter((f) => !modified.has(f)).sort();
	return { readFiles, modifiedFiles: [...modified].sort() };
}

function formatFileOperations(readFiles: string[], modifiedFiles: string[]): string {
	const sections: string[] = [];
	if (readFiles.length > 0) sections.push(`<read-files>\n${readFiles.join("\n")}\n</read-files>`);
	if (modifiedFiles.length > 0)
		sections.push(`<modified-files>\n${modifiedFiles.join("\n")}\n</modified-files>`);
	return sections.length > 0 ? `\n\n${sections.join("\n\n")}` : "";
}

/** True when an assistant tool call has no matching tool result, which providers reject on replay. */
function hasDanglingToolCalls(messages: { role: string; content?: unknown }[]): boolean {
	const pending = new Set<string>();
	for (const message of messages) {
		if (message.role === "assistant" && Array.isArray(message.content)) {
			for (const block of message.content as { type: string; id?: string }[]) {
				if (block.type === "toolCall" && typeof block.id === "string") pending.add(block.id);
			}
		} else if (message.role === "toolResult") {
			const id = (message as { toolCallId?: string }).toolCallId;
			if (typeof id === "string") pending.delete(id);
		}
	}
	return pending.size > 0;
}

/** Merge file lists carried by the most recent compaction entry on the branch. */
function accumulatePreviousFileLists(
	fileOps: { read: Set<string>; written: Set<string>; edited: Set<string> },
	branchEntries: { type: string; details?: unknown }[],
): { read: Set<string>; written: Set<string>; edited: Set<string> } {
	for (let i = branchEntries.length - 1; i >= 0; i--) {
		const entry = branchEntries[i];
		if (entry.type !== "compaction") continue;
		const details = entry.details as { readFiles?: unknown; modifiedFiles?: unknown } | undefined;
		if (details && Array.isArray(details.readFiles) && Array.isArray(details.modifiedFiles)) {
			for (const f of details.modifiedFiles) if (typeof f === "string") fileOps.edited.add(f);
			for (const f of details.readFiles) if (typeof f === "string") fileOps.read.add(f);
		}
		break;
	}
	return fileOps;
}

/** Sidecar holding the system text of the last real provider request. */
function systemTextPath(sessionFile: string): string {
	return `${sessionFile}.live-system.txt`;
}

const capturedSystemText = new Map<string, string>();

function readCapturedSystemText(sessionFile: string): string | undefined {
	const path = systemTextPath(sessionFile);
	const cached = capturedSystemText.get(path);
	if (cached) return cached;
	try {
		const text = readFileSync(path, "utf8");
		if (text) capturedSystemText.set(path, text);
		return text || undefined;
	} catch {
		return undefined;
	}
}

/** Pull the system text out of a provider request body (OpenAI-style or Anthropic-style). */
function extractSystemText(payload: unknown): string | undefined {
	if (!payload || typeof payload !== "object") return undefined;
	const request = payload as { system?: unknown; messages?: unknown[] };
	if (typeof request.system === "string") return request.system || undefined;
	if (Array.isArray(request.system)) {
		const text = request.system
			.map((block) => (block as { text?: unknown })?.text)
			.filter((text): text is string => typeof text === "string")
			.join("\n\n");
		return text || undefined;
	}
	const first = Array.isArray(request.messages) ? request.messages[0] : undefined;
	if (!first || typeof first !== "object") return undefined;
	const message = first as { role?: unknown; content?: unknown };
	if (message.role !== "system" || typeof message.content !== "string") return undefined;
	return message.content || undefined;
}

export default function liveCompactionExtension(pi: ExtensionAPI) {
	// Record the exact system text the provider saw, so a later compaction request can
	// reproduce the cached prefix; the session projection replays a stale one.
	pi.on("before_provider_request", (event, ctx) => {
		const sessionFile = ctx.sessionManager.getSessionFile();
		if (!sessionFile) return;
		const text = extractSystemText(event.payload);
		if (!text) return;
		const path = systemTextPath(sessionFile);
		if (capturedSystemText.get(path) === text) return;
		capturedSystemText.set(path, text);
		try {
			writeFileSync(path, text);
		} catch {
			// Sidecar is best-effort; the in-process capture still covers this session.
		}
	});

	pi.on("session_before_compact", async (event, ctx) => {
		const { preparation, branchEntries, signal, customInstructions } = event;
		const model = ctx.model;

		// Fall back to default compaction when we cannot replicate the live request.
		if (!model) return;
		if (signal.aborted) return;

		const projection = ctx.sessionManager.buildSessionProjection();
		if (projection.messages.length === 0) return;
		if (hasDanglingToolCalls(projection.messages)) return;

		let memoryText: string | undefined;
		const sessionFile = ctx.sessionManager.getSessionFile();
		try {
			const entries = sessionFile ? await loadEntries(sessionFile) : [];
			if (entries.length > 0) memoryText = formatEntries(entries);
		} catch {
			// Memory is best-effort; compaction proceeds without it.
		}

		const instruction = buildInstruction({
			previousSummary: preparation.previousSummary,
			memoryText,
			customInstructions,
			isSplitTurn: preparation.isSplitTurn,
			keepRecentTokens: preparation.settings.keepRecentTokens,
		});

		// Replicate the live request: same transcript (leading system message with
		// tool declarations) with one appended user instruction. The provider's
		// prompt cache covers the unchanged prefix; only the instruction is new.
		const llmMessages = convertToLlm(projection.messages);
		const head = llmMessages[0];
		if (head && head.role === "system") {
			const captured = sessionFile ? readCapturedSystemText(sessionFile) : undefined;
			if (captured) {
				head.content = captured;
				delete head.sections;
				// Later system entries replay their sections into the leading prompt; the
				// captured text already contains them. Their tool state must stay.
				for (const message of llmMessages.slice(1)) {
					if (message.role !== "system") continue;
					const stale = message as { content?: unknown; sections?: Record<string, string> };
					stale.content = "";
					delete stale.sections;
				}
			}
		}
		llmMessages.push({
			role: "user",
			content: [{ type: "text", text: instruction }],
			timestamp: Date.now(),
		});
		const context = normalizeContext({ messages: llmMessages });

		const options: NonNullable<Parameters<typeof ctx.modelRegistry.complete>[2]> & {
			reasoning?: ThinkingLevel;
			reasoningEffort?: ThinkingLevel;
		} = {
			signal,
			// Match the live conversation's cache behaviour and routing so the
			// request reads the session's prompt-cache entry instead of paying
			// full price for the whole context again.
			cacheRetention: "short",
			sessionId: ctx.sessionManager.getSessionId(),
		};
		if (model.reasoning && ctx.thinkingLevel && ctx.thinkingLevel !== "off") {
			options.reasoning = ctx.thinkingLevel;
			// modelRegistry.complete() takes the raw stream path, which reads reasoningEffort;
			// the neutral `reasoning` field is only translated by streamSimple(). Without it the
			// provider renders the conversation differently (e.g. Qwen chat-template thinking) and
			// the whole prompt cache prefix misses.
			options.reasoningEffort = ctx.thinkingLevel;
		}

		let response;
		try {
			response = await ctx.modelRegistry.complete(model, context, options);
		} catch (error) {
			if (!signal.aborted) {
				const message = error instanceof Error ? error.message : String(error);
				ctx.ui.notify(`Live compaction failed (${message}); using default compaction`, "warning");
			}
			return;
		}
		if (signal.aborted) return;
		if (response.stopReason === "error" || response.stopReason === "length") {
			ctx.ui.notify(
				`Live compaction ${response.stopReason === "length" ? "hit the output token cap" : `failed: ${response.errorMessage ?? "unknown error"}`}; using default compaction`,
				"warning",
			);
			return;
		}
		if (response.content.some((block) => block.type === "toolCall")) return;

		let summary = response.content
			.filter((block): block is { type: "text"; text: string } => block.type === "text")
			.map((block) => block.text)
			.join("\n")
			.trim();
		if (!summary) {
			ctx.ui.notify("Live compaction produced an empty summary; using default compaction", "warning");
			return;
		}

		const { readFiles, modifiedFiles } = computeFileLists(
			accumulatePreviousFileLists(preparation.fileOps, branchEntries),
		);
		summary += formatFileOperations(readFiles, modifiedFiles);

		return {
			compaction: {
				summary,
				firstKeptEntryId: preparation.firstKeptEntryId,
				tokensBefore: preparation.tokensBefore,
				usage: response.usage,
				details: { readFiles, modifiedFiles },
			},
		};
	});
}

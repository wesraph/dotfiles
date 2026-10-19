/**
 * Pi Stop Notification Extension
 *
 * Mirrors Claude Code's stop-notification hook: sends a desktop notification
 * with the session summary and plays a notification sound when the agent finishes.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { execFile } from "node:child_process";
import { appendFileSync } from "node:fs";
import { basename } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const NOTIFICATION_WAV = "/home/raph/.pi/agent/extensions/notification.wav";
const LOG_FILE_DEFAULT = "/tmp/pi-stop-hook.log";
/** // ponytail: env override exists only so tests write their own log, not the live one. */
function logFilePath(): string {
	return process.env.PI_STOP_HOOK_LOG ?? LOG_FILE_DEFAULT;
}
const ENV_PLAY_SOUND = "PLAY_PI_NOTIFICATION";
const ENV_SUBAGENT_CHILD = "PI_SUBAGENT_CHILD";
/** Set by spawn_pi on child sessions; their parent coordinates them, so they stay silent too. */
const ENV_SPAWN_PARENT = "PI_SPAWN_PARENT_ID";
const SOUND_ON_VALUES = new Set(["1", "true", "yes", "on"]);

/** Sound plays only when PLAY_PI_NOTIFICATION is explicitly on (1/true/yes/on). */
function isSoundEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
	return SOUND_ON_VALUES.has((env[ENV_PLAY_SOUND] ?? "").trim().toLowerCase());
}

function log(msg: string): void {
	const ts = new Date().toISOString();
	try {
		// Direct write: the line carries model-generated text, which a shell would expand.
		appendFileSync(logFilePath(), `${ts}: ${msg}\n`);
	} catch {
		/* ignore */
	}
}

/** How the last assistant message of a run ended. */
export type RunOutcome = "success" | "error" | "aborted" | "no-assistant-message";

/**
 * Stop reasons that mean the model delivered nothing: request/runtime failures
 * (connection errors included) and user aborts both end the run with a final
 * assistant message carrying one of these and an errorMessage.
 */
const FAILED_STOP_REASONS: Record<string, RunOutcome> = {
	error: "error",
	aborted: "aborted",
};

const SUMMARY_MAX_LENGTH = 150;

type MessageLike = { role?: unknown; stopReason?: unknown; content?: unknown };

function lastAssistantMessage(messages: readonly unknown[]): MessageLike | undefined {
	for (let i = messages.length - 1; i >= 0; i--) {
		const message = messages[i] as MessageLike | undefined;
		if (message?.role === "assistant") return message;
	}
	return undefined;
}

export function runOutcome(messages: readonly unknown[]): RunOutcome {
	const last = lastAssistantMessage(messages);
	if (!last) return "no-assistant-message";
	return FAILED_STOP_REASONS[(last.stopReason as string | undefined) ?? ""] ?? "success";
}

export function summarizeRun(messages: readonly unknown[]): string {
	const content = lastAssistantMessage(messages)?.content;
	let text = "";
	if (typeof content === "string") {
		text = content;
	} else if (Array.isArray(content)) {
		for (const part of content) {
			if (part?.type === "text") text += part.text;
		}
	}
	return text.replace(/\s+/g, " ").trim().slice(0, SUMMARY_MAX_LENGTH) || "Task completed";
}

export default function (pi: ExtensionAPI) {
	pi.on("agent_end", async (event, ctx) => {
		// Subagent children (async/foreground) run headless pi processes — they never
		// return control to the user directly, so don't notify for their completion.
		if (process.env[ENV_SUBAGENT_CHILD] === "1") {
			log("skipped (subagent child process)");
			return;
		}
		if (process.env[ENV_SPAWN_PARENT]) {
			log("skipped (spawned child session; parent coordinates)");
			return;
		}

		const outcome = runOutcome(event.messages);
		if (outcome !== "success") {
			log(`skipped (${outcome})`);
			return;
		}

		const projectName = basename(ctx.cwd);

		try {
			const summary = summarizeRun(event.messages);
			const title = `🤖 ${projectName}`;

			log(`Sending notify-send for '${title}': '${summary}'`);
			log(
				`DISPLAY=${process.env.DISPLAY} DBUS_SESSION_BUS_ADDRESS=${process.env.DBUS_SESSION_BUS_ADDRESS}`,
			);

			// notify-send parses its arguments with getopt: options first, then "--", so a
			// summary that starts with "-" stays data instead of becoming options.
			try {
				await execFileAsync(
					"notify-send",
					["--icon=info", "--expire-time=5000", "--", title, summary],
					{ timeout: 3000 },
				);
				log("notify-send exit=0");
			} catch (err: any) {
				log(`notify-send failed: ${err.message}`);
			}

			// Play notification sound only when PLAY_PI_NOTIFICATION is on
			if (!isSoundEnabled()) {
				log("sound skipped (PLAY_PI_NOTIFICATION not on)");
			} else {
				// Fire-and-forget, but the rejection must stay handled: a missing paplay
				// otherwise surfaces as an unhandledRejection in the host process.
				execFileAsync("paplay", ["--volume=85000", NOTIFICATION_WAV], { timeout: 5000 }).catch(
					(err: unknown) => log(`paplay failed: ${err instanceof Error ? err.message : String(err)}`),
				);
				log("paplay started");
			}

			// Send bell character to terminal
			try {
				process.stdout.write("\x07");
				log("Bell sent to stdout");
			} catch (err: any) {
				log(`Bell send failed: ${err.message}`);
			}
		} catch (err: any) {
			log(`Stop notification error: ${err.message}`);
		}
	});
}

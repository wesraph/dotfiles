/**
 * Pi Stop Notification Extension
 *
 * Mirrors Claude Code's stop-notification hook: sends a desktop notification
 * with the session summary and plays a notification sound when the agent finishes.
 */

import { exec } from "node:child_process";
import { basename } from "node:path";
import { readFileSync } from "node:fs";
import { promisify } from "node:util";

const execAsync = promisify(exec);

const NOTIFICATION_WAV = "/home/raph/.pi/agent/extensions/notification.wav";
const LOG_FILE = "/tmp/pi-stop-hook.log";

function log(msg: string): void {
  const ts = new Date().toISOString();
  try {
    exec(`echo "${ts}: ${msg}" >> ${LOG_FILE} 2>&1`);
  } catch { /* ignore */ }
}

async function getLastAssistantSummary(): Promise<string> {
  const sessionFile = process.env.PI_CODING_AGENT_SESSION_FILE;
  if (!sessionFile) return "Task completed";

  try {
    const lines = readFileSync(sessionFile, "utf-8").split("\n").filter(Boolean);

    // Find the last assistant message (scan backwards for efficiency)
    for (let i = lines.length - 1; i >= 0; i--) {
      try {
        const entry = JSON.parse(lines[i]);
        if (entry.role === "assistant" && entry.content) {
          let text = "";
          if (typeof entry.content === "string") {
            text = entry.content;
          } else if (Array.isArray(entry.content)) {
            for (const part of entry.content) {
              if (part.type === "text") text += part.text;
            }
          }
          text = text.replace(/\n/g, " ").replace(/\s+/g, " ").trim();
          return text.slice(0, 150) || "Task completed";
        }
      } catch { /* skip malformed lines */ }
    }
  } catch {
    // Can't read session file — fall back to default
  }

  return "Task completed";
}

export default function (pi: import("@mariozechner/pi-coding-agent").ExtensionAPI) {
  pi.on("agent_end", async (_event, ctx) => {
    const projectName = basename(ctx.cwd);

    try {
      const summary = await getLastAssistantSummary();
      const title = `🤖 ${projectName}`;

      log(`Sending notify-send for '${title}': '${summary}'`);
      log(`DISPLAY=${process.env.DISPLAY} DBUS_SESSION_BUS_ADDRESS=${process.env.DBUS_SESSION_BUS_ADDRESS}`);

      // Send desktop notification via notify-send
      try {
        await execAsync(
          `notify-send "${title}" "${summary}" --icon=info --expire-time=5000`,
          { timeout: 3000 },
        );
        log("notify-send exit=0");
      } catch (err: any) {
        log(`notify-send failed: ${err.message}`);
      }

      // Play notification sound in background
      try {
        execAsync(`paplay --volume=85000 "${NOTIFICATION_WAV}"`, { timeout: 5000 });
        log("paplay started");
      } catch (err: any) {
        log(`paplay failed: ${err.message}`);
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

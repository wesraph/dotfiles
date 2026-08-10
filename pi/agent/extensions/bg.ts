// ponytail: in-memory tracking only. Detached children keep running after a
// /reload or pi exit, but the task map is lost so bg_status/bg_kill lose sight
// of them. Upgrade path: persist task metadata via pi.appendEntry + liveness
// poll (process.kill(pid,0)) on session_start.
import { spawn } from "node:child_process";
import { mkdir, open, readFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { ExtensionAPI, ExtensionContext, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";

const WIDGET_KEY = "bg-tasks";
// ponytail: 300ms tick drives both the elapsed-seconds update and the 3-frame
// spinner cycle (~0.9s per revolution). Drop to ~1s if the redraw is too busy.
const REFRESH_MS = 300;
const SPINNER_FRAMES = ["●", "◉", "○"] as const;
const LOG_TAIL_BYTES = 8192;
const LOG_DIR_REL = join(".pi", "bg");

type TaskStatus = "running" | "done" | "killed" | "failed";

interface BgTask {
  id: string;
  command: string;
  cwd: string;
  pid: number;
  startedAt: number;
  endedAt?: number;
  exitCode?: number | null;
  status: TaskStatus;
  logFile: string;
}

function shortId(): string {
  return "t" + randomUUID().slice(0, 6);
}

function fmtDuration(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return `${m}m${s % 60}s`;
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

function fmtTaskLine(t: BgTask): string {
  const dur = fmtDuration((t.endedAt ?? Date.now()) - t.startedAt);
  const cmd = truncate(t.command, 40);
  const sym = t.status === "running" ? "▶" : t.status === "done" ? "✓" : t.status === "killed" ? "■" : "✗";
  return `${sym} ${t.id} [${t.status} ${dur}] ${cmd}`;
}

export default function (pi: ExtensionAPI) {
  const tasks = new Map<string, BgTask>();
  let refreshTimer: NodeJS.Timeout | undefined;
  let spinnerFrame = 0;
  // ctx.ui reference captured at session_start; stable for the session lifetime.
  let ui: ExtensionContext["ui"] | undefined;

  function refreshWidget(): void {
    if (!ui) return;
    const running = [...tasks.values()].filter((t) => t.status === "running");
    if (running.length === 0) {
      ui.setWidget(WIDGET_KEY, undefined);
      return;
    }
    spinnerFrame = (spinnerFrame + 1) % SPINNER_FRAMES.length;
    const theme = ui.theme;
    const frame = spinnerFrame;
    ui.setWidget(WIDGET_KEY, () => {
      const lines = running.map((t, i) => {
        const bullet = SPINNER_FRAMES[(frame + i) % SPINNER_FRAMES.length];
        const dur = fmtDuration((t.endedAt ?? Date.now()) - t.startedAt);
        const id = t.id.padEnd(8);
        const durPad = dur.padStart(4);
        const cmd = truncate(t.command, 40);
        return ` ${theme.fg("warning", bullet)} ${theme.fg("muted", id)} ${theme.fg("dim", durPad)}  ${cmd}`;
      });
      return new Text(lines.join("\n"), 0, 0);
    });
  }

  function startTimer(): void {
    if (refreshTimer) return;
    refreshTimer = setInterval(refreshWidget, REFRESH_MS);
    refreshTimer.unref?.();
  }

  function stopTimer(): void {
    if (refreshTimer) {
      clearInterval(refreshTimer);
      refreshTimer = undefined;
    }
  }

  function stopTimerIfIdle(): void {
    const anyRunning = [...tasks.values()].some((t) => t.status === "running");
    if (!anyRunning) stopTimer();
  }

  function notifyCompletion(t: BgTask): void {
    // pi.sendMessage with triggerTurn is the context-safe injection API:
    // safe to call from a detached child's exit callback. sendUserMessage is
    // NOT safe here — it crashes pi when invoked from this async context.
    const content =
      `[bg-task] "${t.id}" (${truncate(t.command, 60)}) finished: status=${t.status}` +
      ` exit=${t.exitCode ?? "n/a"}. Use bg_logs to inspect output if relevant.`;
    try {
      pi.sendMessage(
        { customType: "bg-notify", content, display: true },
        { triggerTurn: true },
      );
    } catch {
      /* agent may be shutting down; ignore */
    }
  }

  function watchExit(child: NodeJS.ChildProcess, t: BgTask): void {
    child.on("exit", (code, signal) => {
      t.endedAt = Date.now();
      t.exitCode = code;
      if (signal === "SIGTERM" || signal === "SIGKILL") t.status = "killed";
      else if (code === 0) t.status = "done";
      else t.status = "failed";
      refreshWidget();
      stopTimerIfIdle();
      notifyCompletion(t);
    });
    child.on("error", () => {
      t.endedAt = Date.now();
      t.status = "failed";
      t.exitCode = -1;
      refreshWidget();
      stopTimerIfIdle();
      notifyCompletion(t);
    });
  }

  function killTask(t: BgTask): boolean {
    // negative pid = signal the whole detached process group
    try {
      process.kill(-t.pid, "SIGTERM");
      return true;
    } catch {
      try {
        process.kill(t.pid, "SIGTERM");
        return true;
      } catch {
        return false;
      }
    }
  }

  // ---- lifecycle ----
  pi.on("session_start", async (_event, ctx: ExtensionContext) => {
    ui = ctx.ui;
    await mkdir(join(ctx.cwd, LOG_DIR_REL), { recursive: true }).catch(() => {});
    ui.setWidget?.(WIDGET_KEY, undefined);
  });

  pi.on("session_shutdown", async () => {
    stopTimer();
    // detached children intentionally keep running; we only stop our timer.
  });

  // ---- tools ----
  pi.registerTool({
    name: "bg_run",
    label: "Background Run",
    description:
      "Run a shell command in the BACKGROUND and return immediately with a task id. " +
      "Output is captured to .pi/bg/<id>.log. You will be notified automatically when the task finishes — do NOT poll. " +
      "Use for long-running commands: test suites, builds, dev servers, watchers.",
    promptSnippet: "Run a long shell command in the background; returns id, notifies on completion",
    promptGuidelines: [
      "Use bg_run (not bash) for long commands like test suites, builds, dev servers, and watchers so you can keep working. You are notified on completion — do not poll with bg_status.",
    ],
    parameters: Type.Object({
      command: Type.String({ description: "Shell command to run in the background" }),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx: ExtensionContext) {
      const command = params.command?.trim();
      if (!command) throw new Error("command is required");
      const cwd = ctx.cwd;
      const logDirAbs = join(cwd, LOG_DIR_REL);
      await mkdir(logDirAbs, { recursive: true }).catch(() => {});
      const id = shortId();
      const logFile = join(logDirAbs, `${id}.log`);

      const fh = await open(logFile, "a");
      let child: NodeJS.ChildProcess;
      try {
        child = spawn(command, {
          shell: true,
          cwd,
          detached: true,
          stdio: ["ignore", fh.fd, fh.fd],
          env: { ...process.env },
        });
      } catch (e) {
        await fh.close().catch(() => {});
        throw new Error(`Failed to spawn background task: ${(e as Error).message}`);
      }
      // Closing node's copy of the fd is safe: the child has its own dup.
      await fh.close().catch(() => {});
      if (!child.pid) throw new Error("Spawned process has no pid");

      const task: BgTask = {
        id,
        command,
        cwd,
        pid: child.pid,
        startedAt: Date.now(),
        status: "running",
        logFile,
      };
      tasks.set(id, task);
      child.unref();
      watchExit(child, task);
      startTimer();
      refreshWidget();

      return {
        content: [
          {
            type: "text",
            text: `Started background task ${id} (pid ${task.pid}). Logs: ${logFile}\nYou will be notified when it finishes.`,
          },
        ],
        details: { id, pid: task.pid, logFile },
      };
    },
  });

  pi.registerTool({
    name: "bg_status",
    label: "Background Status",
    description: "List all background tasks and their current status (running/done/killed/failed), exit code, and duration.",
    promptSnippet: "List background tasks and their status",
    parameters: Type.Object({}),
    async execute() {
      if (tasks.size === 0) {
        return { content: [{ type: "text", text: "No background tasks." }], details: {} };
      }
      const lines = [...tasks.values()].map((t) => {
        const dur = fmtDuration((t.endedAt ?? Date.now()) - t.startedAt);
        return `${t.id}\tstatus=${t.status}\texit=${t.exitCode ?? "-"}\t${dur}\t${t.command}`;
      });
      return {
        content: [{ type: "text", text: lines.join("\n") }],
        details: { tasks: [...tasks.values()] },
      };
    },
  });

  pi.registerTool({
    name: "bg_logs",
    label: "Background Logs",
    description: "Read the tail of a background task's log output. Use after a task completes or to peek at progress of a running task.",
    promptSnippet: "Read tail of a background task's log output",
    parameters: Type.Object({
      id: Type.String({ description: "Task id returned by bg_run" }),
      bytes: Type.Optional(Type.Number({ description: `Max bytes to read from the tail (default ${LOG_TAIL_BYTES})` })),
    }),
    async execute(_toolCallId, params) {
      const t = tasks.get(params.id);
      if (!t) throw new Error(`Unknown task id: ${params.id}`);
      const max = params.bytes ?? LOG_TAIL_BYTES;
      const data = await readFile(t.logFile, "utf8").catch(() => "");
      const tail = data.length > max ? data.slice(-max) : data;
      const header = `[${t.id}] status=${t.status} exit=${t.exitCode ?? "-"} pid=${t.pid}\n`;
      return {
        content: [{ type: "text", text: header + (tail || "(no output yet)") }],
        details: { id: t.id },
      };
    },
  });

  pi.registerTool({
    name: "bg_kill",
    label: "Background Kill",
    description: "Kill a running background task by id. Sends SIGTERM to its process group. The task's exit handler still fires a completion notification.",
    promptSnippet: "Kill a running background task by id",
    parameters: Type.Object({
      id: Type.String({ description: "Task id to kill" }),
    }),
    async execute(_toolCallId, params) {
      const t = tasks.get(params.id);
      if (!t) throw new Error(`Unknown task id: ${params.id}`);
      if (t.status !== "running") {
        return { content: [{ type: "text", text: `Task ${params.id} is already ${t.status}` }], details: {} };
      }
      const ok = killTask(t);
      return {
        content: [
          { type: "text", text: ok ? `Sent SIGTERM to ${params.id} (pid ${t.pid})` : `Could not signal ${params.id} (pid ${t.pid} may have already exited)` },
        ],
        details: { id: params.id, signaled: ok },
      };
    },
  });

  // ---- user slash command ----
  pi.registerCommand("bg", {
    description: "Manage background tasks: `/bg` (list) | `/bg kill <id>` | `/bg logs <id>`",
    handler: async (args, ctx: ExtensionCommandContext) => {
      const [sub, target] = (args || "").trim().split(/\s+/);
      const notify = (m: string, t: "info" | "warning" | "error" = "info") => ctx.ui.notify(m, t);

      if (!sub) {
        if (tasks.size === 0) return notify("No background tasks");
        return notify([...tasks.values()].map(fmtTaskLine).join("\n"));
      }
      if (sub === "kill" && target) {
        const t = tasks.get(target);
        if (!t) return notify(`Unknown task: ${target}`, "error");
        const ok = killTask(t);
        return notify(ok ? `Killing ${target}` : `Failed to signal ${target}`, ok ? "info" : "error");
      }
      if (sub === "logs" && target) {
        const t = tasks.get(target);
        if (!t) return notify(`Unknown task: ${target}`, "error");
        const data = await readFile(t.logFile, "utf8").catch(() => "");
        return notify(data.slice(-2000) || "(no output)");
      }
      notify("Usage: /bg | /bg kill <id> | /bg logs <id>", "warning");
    },
  });
}

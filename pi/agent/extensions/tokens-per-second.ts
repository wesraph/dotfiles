/**
 * Tokens Per Second (TPS) Extension
 *
 * Shows real-time token throughput in the status bar during streaming.
 * While streaming, no provider (anthropic, zai, vllm, ...) reports a running
 * output-token count — usage only arrives with the final stream event — so the
 * live number is an estimate over a rolling 1s window, calibrated per
 * provider/model against real API usage from completed messages
 * (chars-per-token EMA), falling back to chars/4 until calibration data
 * exists. On message_end the actual TPS (whole message, real usage.output)
 * is shown. Also tracks TTFT (Time To First Token).
 *
 * Commands:
 *   /tps          — toggle input/output token counts
 *   /tps compact  — toggle compact mode (57t/s, 2.9s)
 *
 * Status bar phases (full mode):
 *   First idle         — ⏺ idle
 *   Waiting (no data)  — ⏳ waiting...
 *   Waiting (has data) — ⏳ waiting·last 1.2s...
 *   Streaming          — ⚡ 142 tok/s · 🕐 1.2s ↑12k ↓8k
 *   Finished           — ⚡ 156 tok/s 🕐1.2s ↓823 (5.2s)
 *   Idle (avg)         — ⏺ avg 156 tok/s · 🕐 1.3s ↑2.3k ↓8.8k
 *
 * Status bar phases (compact mode):
 *   Waiting            — waiting...
 *   Streaming          — 142t/s, 1.2s ↑12k ↓8k
 *   Finished           — 156t/s, 1.2s ↓823 (5.2s)
 *   Idle (avg)         — 57t/s, 2.9s ↑2.3k ↓8.8k
 *
 * Usage: place in ~/.pi/agent/extensions/ or run with pi -e tokens-per-second.ts
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

// Fallback estimate until real usage calibrates the ratio (chars per token).
const DEFAULT_CHARS_PER_TOKEN = 4;
// EMA weight for new calibration samples (higher = adapts faster).
const CALIBRATION_ALPHA = 0.4;
// Minimum sample size to trust a calibration update (short messages are noisy).
const MIN_CALIBRATION_TOKENS = 16;
const MIN_CALIBRATION_CHARS = 64;
// Bound the per-model calibration map (LRU-ish: oldest key evicted).
const MAX_CALIBRATION_KEYS = 64;
// Rolling window for the live TPS display (tokens generated in the last N ms).
const TPS_WINDOW_MS = 1000;
// Minimum window length (seconds) before the live TPS is shown (too noisy below).
const TPS_WINDOW_MIN_SECONDS = 0.1;

// "provider/model" -> calibrated chars-per-token ratio.
const calibration = new Map<string, number>();

function calibrationKey(provider: string, model: string): string {
	return `${provider}/${model}`;
}

function updateCalibration(
	provider: string,
	model: string,
	chars: number,
	tokens: number,
): void {
	if (tokens < MIN_CALIBRATION_TOKENS || chars < MIN_CALIBRATION_CHARS) return;
	const ratio = chars / tokens;
	const key = calibrationKey(provider, model);
	const prev = calibration.get(key);
	calibration.delete(key);
	calibration.set(
		key,
		prev === undefined
			? ratio
			: (1 - CALIBRATION_ALPHA) * prev + CALIBRATION_ALPHA * ratio,
	);
	while (calibration.size > MAX_CALIBRATION_KEYS) {
		const oldest = calibration.keys().next().value;
		if (oldest === undefined) break;
		calibration.delete(oldest);
	}
}

function charsPerToken(provider: string, model: string): number {
	return (
		calibration.get(calibrationKey(provider, model)) ?? DEFAULT_CHARS_PER_TOKEN
	);
}

export default function (pi: ExtensionAPI) {
	let streaming = false;
	let streamStart = 0;
	let charsAccumulated = 0;
	let totalInput = 0;
	let totalOutput = 0;
	let totalStreamTime = 0;
	let showInOut = true;
	let compact = false;
	let turnStart = 0;
	let lastTtft = 0;
	const ttftSamples: number[] = [];
	// (timestamp, cumulative chars) samples for the rolling TPS window.
	let samples: { t: number; c: number }[] = [];

	pi.registerCommand("tps", {
		description: "Toggle token display options. Usage: /tps [compact]",
		handler: async (args, ctx) => {
			const theme = ctx.ui.theme;
			if (args === "compact") {
				compact = !compact;
				const state = compact
					? theme.fg("success", "compact")
					: theme.fg("dim", "full");
				ctx.ui.notify(`Display mode: ${state}`, "info");
				update(ctx);
			} else {
				showInOut = !showInOut;
				const state = showInOut
					? theme.fg("success", "ON")
					: theme.fg("dim", "OFF");
				const label = theme.fg(
					"dim",
					showInOut ? " — showing ↑↓ token counts" : " — only TPS + status",
				);
				ctx.ui.notify(`Show in/out tokens: ${state}${label}`, "info");
				update(ctx);
			}
		},
	});

	function update(ctx: {
		ui: { setStatus: (k: string, v: string) => void; theme: any };
	}) {
		if (streaming) return;
		showIdle(ctx);
	}

	function inOut() {
		return showInOut ? ` ↑${fmt(totalInput)} ↓${fmt(totalOutput)}` : "";
	}

	function ttftAvg(): number {
		if (ttftSamples.length === 0) return 0;
		let sum = 0;
		for (const s of ttftSamples) sum += s;
		return sum / ttftSamples.length;
	}

	function lastTtftAvg(): number {
		const recent = ttftSamples.slice(-5);
		if (recent.length === 0) return 0;
		let sum = 0;
		for (const s of recent) sum += s;
		return sum / recent.length;
	}

	// -- Compact render helpers --

	function compactTps(tps: number): string {
		return `${tps.toFixed(0)}t/s`;
	}

	function compactTtft(): string {
		if (lastTtft <= 0) return "";
		return `, ${lastTtft.toFixed(1)}s`;
	}

	function compactIdleTtft(): string {
		const avg = ttftAvg();
		if (avg <= 0) return "";
		return `, ${avg.toFixed(1)}s`;
	}

	// -- Full render helpers --

	function fullTtft(): string {
		if (lastTtft <= 0) return "";
		return ` \u00b7 \u{1F550} ${lastTtft.toFixed(1)}s`;
	}

	function fullIdleTtft(): string {
		const avg = ttftAvg();
		if (avg <= 0) return "";
		return ` \u00b7 \u{1F550} ${avg.toFixed(1)}s`;
	}

	function saveTtft() {
		if (lastTtft > 0 && lastTtft < 120) {
			ttftSamples.push(lastTtft);
			if (ttftSamples.length > 100) ttftSamples.shift();
		}
	}

	// -- Events --

	pi.on("turn_start", async (_event, ctx) => {
		streaming = false;
		streamStart = 0;
		charsAccumulated = 0;
		samples = [];
		turnStart = performance.now();
		lastTtft = 0;
		const theme = ctx.ui.theme;
		if (compact) {
			ctx.ui.setStatus("tps", theme.fg("dim", "waiting..."));
		} else if (totalInput + totalOutput > 0 && ttftSamples.length > 0) {
			ctx.ui.setStatus(
				"tps",
				theme.fg("dim", `⏳ waiting·last ${lastTtftAvg().toFixed(1)}s...`),
			);
		} else {
			ctx.ui.setStatus("tps", theme.fg("dim", "⏳ waiting..."));
		}
	});

	pi.on("message_update", async (event, ctx) => {
		if (event.message.role !== "assistant") return;

		if (!streaming) {
			streaming = true;
			streamStart = performance.now();
			charsAccumulated = 0;
			samples = [];
			lastTtft = (streamStart - turnStart) / 1000;
		}

		let chars = 0;
		for (const block of event.message.content) {
			if (block.type === "text") chars += block.text.length;
			else if (block.type === "thinking") chars += block.thinking.length;
			else if (block.type === "toolCall") {
				// Count tool call name + serialized arguments so code-writing
				// (write/edit/bash tool calls) is included in the TPS estimate.
				const argsJson = JSON.stringify(block.arguments);
				chars += block.name.length + argsJson.length;
			}
		}
		charsAccumulated = chars;

		// Rolling window: keep the last sample strictly older than the window as
		// baseline (or the first sample when the stream is younger than the window).
		const now = performance.now();
		samples.push({ t: now, c: chars });
		while (samples.length > 2 && samples[1].t < now - TPS_WINDOW_MS)
			samples.shift();

		const base = samples[0];
		const elapsed = (now - base.t) / 1000;
		if (elapsed > TPS_WINDOW_MIN_SECONDS) {
			const windowTokens =
				(chars - base.c) /
				charsPerToken(event.message.provider, event.message.model);
			const tps = windowTokens / elapsed;

			const theme = ctx.ui.theme;
			if (compact) {
				const speed = theme.fg("accent", compactTps(tps));
				ctx.ui.setStatus("tps", `${speed}${compactTtft()}${inOut()}`);
			} else {
				const speed = theme.fg("accent", `${tps.toFixed(0)}`);
				const label = theme.fg("dim", " tok/s");
				ctx.ui.setStatus("tps", `⚡ ${speed}${label}${fullTtft()}${inOut()}`);
			}
		}
	});

	pi.on("message_end", async (event, ctx) => {
		if (event.message.role !== "assistant") return;

		const elapsed =
			streamStart > 0 ? (performance.now() - streamStart) / 1000 : 0;
		const outputTokens = event.message.usage?.output ?? 0;
		totalInput += event.message.usage?.input ?? 0;
		totalOutput += outputTokens;
		if (elapsed > 0.1) totalStreamTime += elapsed;

		// Calibrate the live estimate with real API usage for this provider/model.
		// Only when this message actually streamed (charsAccumulated is its final size).
		if (streaming) {
			updateCalibration(
				event.message.provider,
				event.message.model,
				charsAccumulated,
				outputTokens,
			);
		}

		const theme = ctx.ui.theme;
		if (elapsed > 0.1 && outputTokens > 0) {
			const tps = outputTokens / elapsed;

			if (compact) {
				const speed = theme.fg("success", compactTps(tps));
				const ttft = lastTtft > 0 ? `, ${lastTtft.toFixed(1)}s` : "";
				const time = theme.fg("dim", `(${elapsed.toFixed(1)}s)`);
				if (showInOut) {
					const out = theme.fg("accent", `↓${outputTokens}`);
					ctx.ui.setStatus("tps", `${speed}${ttft} ${out} ${time}`);
				} else {
					ctx.ui.setStatus("tps", `${speed}${ttft} ${time}`);
				}
			} else {
				const speed = theme.fg("success", `${tps.toFixed(0)}`);
				const label = theme.fg("dim", " tok/s");
				const ttft =
					lastTtft > 0
						? ` ${theme.fg("dim", `🕐${lastTtft.toFixed(1)}s`)}`
						: "";
				const time = theme.fg("dim", `(${elapsed.toFixed(1)}s)`);
				if (showInOut) {
					const out = theme.fg("accent", `↓${outputTokens}`);
					ctx.ui.setStatus("tps", `⚡ ${speed}${label}${ttft} ${out} ${time}`);
				} else {
					ctx.ui.setStatus("tps", `⚡ ${speed}${label}${ttft} ${time}`);
				}
			}
		} else {
			ctx.ui.setStatus("tps", theme.fg("dim", compact ? "done" : "⏺ done"));
		}

		streaming = false;
	});

	function showIdle(ctx: {
		ui: { setStatus: (k: string, v: string) => void; theme: any };
	}) {
		const theme = ctx.ui.theme;
		if (totalStreamTime > 0 && totalOutput > 0) {
			const avgTps = totalOutput / totalStreamTime;

			if (compact) {
				const speed = theme.fg("accent", compactTps(avgTps));
				ctx.ui.setStatus("tps", `${speed}${compactIdleTtft()}${inOut()}`);
			} else {
				const avg = theme.fg("dim", "⏺ avg ");
				const speed = theme.fg("accent", `${avgTps.toFixed(0)}`);
				const label = theme.fg("dim", " tok/s");
				ctx.ui.setStatus(
					"tps",
					`${avg}${speed}${label}${fullIdleTtft()}${inOut()}`,
				);
			}
		} else {
			ctx.ui.setStatus("tps", theme.fg("dim", compact ? "idle" : "⏺ idle"));
		}
	}

	pi.on("session_start", async (_event, ctx) => {
		showIdle(ctx);
	});

	pi.on("turn_end", async (_event, ctx) => {
		saveTtft();
		if (!streaming) showIdle(ctx);
	});
}

function fmt(n: number): string {
	if (n < 1000) return `${n}`;
	if (n < 1000000) return `${(n / 1000).toFixed(1)}k`;
	return `${(n / 1000000).toFixed(1)}M`;
}

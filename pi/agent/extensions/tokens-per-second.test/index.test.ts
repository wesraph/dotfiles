/**
 * Run: node --test agent/extensions/tokens-per-second.test/
 */
import assert from "node:assert/strict";
import test from "node:test";
import extension from "../tokens-per-second.ts";

type Handler = (event: unknown, ctx: unknown) => unknown;

// Unique provider/model per test: the calibration map is module-level state,
// so shared keys would leak calibration between tests.
let modelSeq = 0;
function freshModel(provider: string): string {
	modelSeq += 1;
	return `${provider}/tps-test-${modelSeq}`;
}

function setup() {
	const handlers = new Map<string, Handler>();
	let lastStatus = "";
	const pi = {
		on: (name: string, h: Handler) => handlers.set(name, h),
		registerCommand: () => {},
	};
	extension(pi as never);
	const ctx = {
		ui: {
			theme: { fg: (_color: string, text: string) => text },
			setStatus: (_key: string, value: string) => {
				lastStatus = value;
			},
			notify: () => {},
		},
	};
	const emit = (name: string, event: unknown) =>
		handlers.get(name)!(event, ctx);
	return { emit, status: () => lastStatus };
}

function assistantMsg(
	text: string,
	provider: string,
	model: string,
	outputTokens = 0,
	inputTokens = 0,
) {
	return {
		role: "assistant",
		content: [{ type: "text", text }],
		provider,
		model,
		usage: { input: inputTokens, output: outputTokens },
	};
}

type Emit = (name: string, event: unknown) => void;
type SetNow = (ms: number) => void;

// turn_start (t=0) + message_updates at [time, cumulativeChars] steps.
// Leaves the status on the live rolling-window estimate of the last step.
function streamLive(
	emit: Emit,
	setNow: SetNow,
	provider: string,
	model: string,
	steps: [number, number][],
) {
	setNow(0);
	emit("turn_start", {});
	for (const [t, c] of steps) {
		setNow(t);
		emit("message_update", {
			message: assistantMsg("x".repeat(c), provider, model),
		});
	}
}

// message_end at t=3000 (elapsed 2s from stream start at t=1000): sets the
// final status from real usage and feeds the calibration.
function endMsg(
	emit: Emit,
	setNow: SetNow,
	provider: string,
	model: string,
	totalChars: number,
	outputTokens = 0,
	inputTokens = 0,
) {
	setNow(3000);
	emit("message_end", {
		message: assistantMsg(
			"x".repeat(totalChars),
			provider,
			model,
			outputTokens,
			inputTokens,
		),
	});
}

test("live TPS falls back to chars/4 before any calibration", (t) => {
	const { emit, status } = setup();
	let nowMs = 0;
	t.mock.method(performance, "now", () => nowMs);
	const model = freshModel("anthropic");
	const setNow: SetNow = (ms) => (nowMs = ms);

	// 40 new chars over the 1s window / 4 = 10 tokens/s.
	streamLive(emit, setNow, "anthropic", model, [
		[1000, 40],
		[2000, 80],
	]);
	assert.match(status(), /⚡ 10 tok\/s/);
	endMsg(emit, setNow, "anthropic", model, 80, 0);
});

test("live TPS uses API-usage calibration from the previous message", (t) => {
	const { emit, status } = setup();
	let nowMs = 0;
	t.mock.method(performance, "now", () => nowMs);
	const model = freshModel("zai");
	const setNow: SetNow = (ms) => (nowMs = ms);

	// Message 1: 100 chars, API reports 20 tokens -> ratio 5 chars/token.
	streamLive(emit, setNow, "zai", model, [
		[1000, 50],
		[2000, 100],
	]);
	endMsg(emit, setNow, "zai", model, 100, 20);

	// Message 2: 40 chars in window / 5 = 8 tokens/s (would be 10 with chars/4).
	streamLive(emit, setNow, "zai", model, [
		[1000, 40],
		[2000, 80],
	]);
	assert.match(status(), /⚡ 8 tok\/s/);
	endMsg(emit, setNow, "zai", model, 80, 20);
});

test("calibration is per provider/model", (t) => {
	const { emit, status } = setup();
	let nowMs = 0;
	t.mock.method(performance, "now", () => nowMs);
	const provider = "anthropic";
	const modelA = freshModel(provider);
	const modelB = freshModel(provider);
	const setNow: SetNow = (ms) => (nowMs = ms);

	// Calibrate model A to ratio 5.
	streamLive(emit, setNow, provider, modelA, [
		[1000, 50],
		[2000, 100],
	]);
	endMsg(emit, setNow, provider, modelA, 100, 20);

	// Model B is uncalibrated: 40 chars / 4 = 10 tokens/s.
	streamLive(emit, setNow, provider, modelB, [
		[1000, 40],
		[2000, 80],
	]);
	assert.match(status(), /⚡ 10 tok\/s/);
	endMsg(emit, setNow, provider, modelB, 80, 20);
});

test("calibration is EMA across samples", (t) => {
	const { emit, status } = setup();
	let nowMs = 0;
	t.mock.method(performance, "now", () => nowMs);
	const provider = "anthropic";
	const model = freshModel(provider);
	const setNow: SetNow = (ms) => (nowMs = ms);

	// Sample 1: 100 chars / 20 tokens = 5.
	streamLive(emit, setNow, provider, model, [
		[1000, 50],
		[2000, 100],
	]);
	endMsg(emit, setNow, provider, model, 100, 20);
	// Sample 2: 200 chars / 20 tokens = 10 -> EMA 0.6*5 + 0.4*10 = 7.
	streamLive(emit, setNow, provider, model, [
		[1000, 100],
		[2000, 200],
	]);
	endMsg(emit, setNow, provider, model, 200, 20);

	// 70 chars in window / 7 = 10 tokens/s.
	streamLive(emit, setNow, provider, model, [
		[1000, 10],
		[2000, 80],
	]);
	assert.match(status(), /⚡ 10 tok\/s/);
	endMsg(emit, setNow, provider, model, 80, 20);
});

test("no calibration when the API reports no usage", (t) => {
	const { emit, status } = setup();
	let nowMs = 0;
	t.mock.method(performance, "now", () => nowMs);
	const provider = "vllm";
	const model = freshModel(provider);
	const setNow: SetNow = (ms) => (nowMs = ms);

	// output=0 -> sample rejected.
	streamLive(emit, setNow, provider, model, [
		[1000, 40],
		[2000, 80],
	]);
	endMsg(emit, setNow, provider, model, 80, 0);

	// Still chars/4: 40 / 4 = 10 tokens/s.
	streamLive(emit, setNow, provider, model, [
		[1000, 40],
		[2000, 80],
	]);
	assert.match(status(), /⚡ 10 tok\/s/);
	endMsg(emit, setNow, provider, model, 80, 0);
});

test("no calibration for short messages (noisy samples)", (t) => {
	const { emit, status } = setup();
	let nowMs = 0;
	t.mock.method(performance, "now", () => nowMs);
	const provider = "anthropic";
	const model = freshModel(provider);
	const setNow: SetNow = (ms) => (nowMs = ms);

	// 8 tokens < 16 minimum -> sample rejected.
	streamLive(emit, setNow, provider, model, [
		[1000, 40],
		[2000, 80],
	]);
	endMsg(emit, setNow, provider, model, 80, 8);

	// Still chars/4: 40 / 4 = 10 tokens/s.
	streamLive(emit, setNow, provider, model, [
		[1000, 40],
		[2000, 80],
	]);
	assert.match(status(), /⚡ 10 tok\/s/);
	endMsg(emit, setNow, provider, model, 80, 8);
});

test("window baseline advances past samples older than 1s", (t) => {
	const { emit, status } = setup();
	let nowMs = 0;
	t.mock.method(performance, "now", () => nowMs);
	const model = freshModel("anthropic");
	const setNow: SetNow = (ms) => (nowMs = ms);

	// t=3200: window is [2200, 3200]. Baseline must be the (2000, 200) sample,
	// not (1000, 100): 20 chars over 1.2s / 4 = 4.17 -> 4 tokens/s.
	streamLive(emit, setNow, "anthropic", model, [
		[1000, 100],
		[2000, 200],
		[3200, 220],
	]);
	assert.match(status(), /⚡ 4 tok\/s/);
	endMsg(emit, setNow, "anthropic", model, 220, 0);
});

test("live TPS drops to 0 when the stream pauses", (t) => {
	const { emit, status } = setup();
	let nowMs = 0;
	t.mock.method(performance, "now", () => nowMs);
	const model = freshModel("anthropic");
	const setNow: SetNow = (ms) => (nowMs = ms);

	// No new chars in the window -> 0 tokens/s.
	streamLive(emit, setNow, "anthropic", model, [
		[1000, 100],
		[2000, 100],
	]);
	assert.match(status(), /⚡ 0 tok\/s/);
	endMsg(emit, setNow, "anthropic", model, 100, 0);
});

test("final TPS on message_end uses real API usage over the whole stream", (t) => {
	const { emit, status } = setup();
	let nowMs = 0;
	t.mock.method(performance, "now", () => nowMs);
	const provider = "anthropic";
	const model = freshModel(provider);
	const setNow: SetNow = (ms) => (nowMs = ms);

	// 200 tokens over 2s (stream start t=1000, end t=3000) = 100 tok/s.
	streamLive(emit, setNow, provider, model, [
		[1000, 50],
		[2000, 100],
	]);
	endMsg(emit, setNow, provider, model, 100, 200, 50);

	assert.match(status(), /⚡ 100 tok\/s/);
	assert.match(status(), /↓200/);
});

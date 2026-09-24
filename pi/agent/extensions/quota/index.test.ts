/**
 * Run: node --test index.test.ts
 */
import assert from "node:assert/strict";
import { setImmediate } from "node:timers/promises";
import test, { mock } from "node:test";
import extension from "./index.ts";

type Handler = (event: unknown, ctx: unknown) => unknown;

const ANTHROPIC_MODEL = {
	provider: "anthropic",
	baseUrl: "https://api.anthropic.com",
};
const ZAI_MODEL = {
	provider: "zai-renaud",
	baseUrl: "https://api.z.ai/api/coding/paas/v4",
};
const OPENAI_MODEL = {
	provider: "openai",
	baseUrl: "https://api.openai.com/v1",
};
const ANTHROPIC_BODY = {
	five_hour: { utilization: 9 },
	seven_day: { utilization: 95 },
};

function setup(model: object | undefined, hasUI = true) {
	const handlers = new Map<string, Handler>();
	let command: Handler | undefined;
	const pi = {
		on: (name: string, h: Handler) => handlers.set(name, h),
		registerCommand: (_name: string, opts: { handler: Handler }) =>
			(command = opts.handler),
	};
	extension(pi as never);
	const ctx = {
		hasUI,
		model,
		modelRegistry: {
			getApiKeyForProvider: mock.fn(
				async (_provider: string): Promise<string | undefined> => "key",
			),
			isUsingOAuth: () => true,
		},
		ui: {
			theme: { fg: (c: string, t: string) => `<${c}>${t}` },
			setStatus: mock.fn(),
			notify: mock.fn(),
		},
	};
	const fire = async (event: string): Promise<void> => {
		handlers.get(event)?.({}, ctx);
		await setImmediate();
	};
	return { ctx, fire, runCommand: () => command?.("", ctx) };
}

function mockFetch(body: unknown, ok = true, status = 200) {
	return mock.method(globalThis, "fetch", async () => ({
		ok,
		status,
		json: async () => body,
	}));
}

test("renders anthropic quota with severity colours", async (t) => {
	const fetch = mockFetch(ANTHROPIC_BODY);
	t.after(() => fetch.mock.restore());
	const { ctx, fire } = setup(ANTHROPIC_MODEL);
	await fire("session_start");
	const [url, init] = fetch.mock.calls[0].arguments as [
		string,
		{ headers: Record<string, string> },
	];
	assert.equal(url, "https://api.anthropic.com/api/oauth/usage");
	assert.equal(init.headers.Authorization, "Bearer key");
	assert.deepEqual(ctx.ui.setStatus.mock.calls.at(-1)?.arguments, [
		"quota",
		"<dim>quota 5h <success>9% · 7d <error>95%",
	]);
});

test("throttles refreshes, /quota forces one and notifies details", async (t) => {
	const fetch = mockFetch(ANTHROPIC_BODY);
	t.after(() => fetch.mock.restore());
	const { ctx, fire, runCommand } = setup(ANTHROPIC_MODEL);
	await fire("session_start");
	await fire("agent_end");
	assert.equal(fetch.mock.callCount(), 1);
	await runCommand();
	assert.equal(fetch.mock.callCount(), 2);
	assert.match(
		String(ctx.ui.notify.mock.calls[0].arguments[0]),
		/^5h: 9% used\n7d: 95% used$/,
	);
});

test("zai provider uses raw key against the quota endpoint", async (t) => {
	const fetch = mockFetch({
		success: true,
		data: {
			limits: [{ type: "TOKENS_LIMIT", unit: 3, number: 5, percentage: 75 }],
		},
	});
	t.after(() => fetch.mock.restore());
	const { ctx, fire } = setup(ZAI_MODEL);
	await fire("model_select");
	const [url, init] = fetch.mock.calls[0].arguments as [
		string,
		{ headers: Record<string, string> },
	];
	assert.equal(url, "https://api.z.ai/api/monitor/usage/quota/limit");
	assert.equal(init.headers.Authorization, "key");
	assert.equal(
		ctx.modelRegistry.getApiKeyForProvider.mock.calls[0].arguments[0],
		"zai-renaud",
	);
	assert.equal(
		ctx.ui.setStatus.mock.calls.at(-1)?.arguments[1],
		"<dim>quota 5h <warning>75%",
	);
});

test("errors render '?' and /quota reports them", async (t) => {
	const fetch = mockFetch({}, false, 401);
	t.after(() => fetch.mock.restore());
	const { ctx, runCommand } = setup(ANTHROPIC_MODEL);
	await runCommand();
	assert.equal(
		ctx.ui.setStatus.mock.calls.at(-1)?.arguments[1],
		"<dim>quota <dim>?",
	);
	assert.deepEqual(ctx.ui.notify.mock.calls[0].arguments, [
		"Quota unavailable: HTTP 401",
		"warning",
	]);
});

test("missing credentials are reported without fetching", async (t) => {
	const fetch = mockFetch(ANTHROPIC_BODY);
	t.after(() => fetch.mock.restore());
	const { ctx, runCommand } = setup(ANTHROPIC_MODEL);
	ctx.modelRegistry.getApiKeyForProvider.mock.mockImplementation(
		async () => undefined,
	);
	await runCommand();
	assert.equal(fetch.mock.callCount(), 0);
	assert.deepEqual(ctx.ui.notify.mock.calls[0].arguments, [
		"Quota unavailable: no credentials for anthropic",
		"warning",
	]);
});

test("unsupported model clears the status and /quota explains", async (t) => {
	const fetch = mockFetch(ANTHROPIC_BODY);
	t.after(() => fetch.mock.restore());
	const { ctx, fire, runCommand } = setup(OPENAI_MODEL);
	await fire("session_start");
	assert.deepEqual(ctx.ui.setStatus.mock.calls.at(-1)?.arguments, [
		"quota",
		undefined,
	]);
	await runCommand();
	assert.equal(fetch.mock.callCount(), 0);
	assert.match(
		String(ctx.ui.notify.mock.calls[0].arguments[0]),
		/No quota source/,
	);
});

test("no UI: nothing fetched or rendered", async (t) => {
	const fetch = mockFetch(ANTHROPIC_BODY);
	t.after(() => fetch.mock.restore());
	const { ctx, fire } = setup(ANTHROPIC_MODEL, false);
	await fire("session_start");
	assert.equal(fetch.mock.callCount(), 0);
	assert.equal(ctx.ui.setStatus.mock.callCount(), 0);
});

test("stale fetch result is not rendered after a model switch", async (t) => {
	let release: () => void = () => {};
	const gate = new Promise<void>((r) => (release = r));
	const fetch = mock.method(globalThis, "fetch", async () => {
		await gate;
		return { ok: true, status: 200, json: async () => ANTHROPIC_BODY };
	});
	t.after(() => fetch.mock.restore());
	const { ctx, fire } = setup(ANTHROPIC_MODEL);
	await fire("session_start");
	ctx.model = OPENAI_MODEL;
	await fire("model_select");
	release();
	await setImmediate();
	assert.deepEqual(
		ctx.ui.setStatus.mock.calls.map((c) => c.arguments[1]),
		[undefined],
	);
});

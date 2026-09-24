/**
 * Run: node --test core.test.ts
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
	formatDetails,
	formatDuration,
	formatStatus,
	parseAnthropic,
	parseQuota,
	parseZai,
	quotaSource,
	requestHeaders,
	severity,
} from "./core.ts";

test("quotaSource: anthropic only with OAuth", () => {
	assert.deepEqual(
		quotaSource("anthropic", "https://api.anthropic.com", true),
		{
			kind: "anthropic",
			url: "https://api.anthropic.com/api/oauth/usage",
		},
	);
	assert.equal(
		quotaSource("anthropic", "https://api.anthropic.com", false),
		undefined,
	);
});

test("quotaSource: z.ai and bigmodel hosts map to their origin, any provider name", () => {
	assert.deepEqual(
		quotaSource("zai-renaud", "https://api.z.ai/api/coding/paas/v4", false),
		{
			kind: "zai",
			url: "https://api.z.ai/api/monitor/usage/quota/limit",
		},
	);
	assert.deepEqual(
		quotaSource("zhipu", "https://open.bigmodel.cn/api/paas/v4", false),
		{
			kind: "zai",
			url: "https://open.bigmodel.cn/api/monitor/usage/quota/limit",
		},
	);
});

test("quotaSource: unsupported or invalid", () => {
	assert.equal(
		quotaSource("openai", "https://api.openai.com/v1", false),
		undefined,
	);
	assert.equal(
		quotaSource("x", "https://evil.api.z.ai.example.com/v1", false),
		undefined,
	);
	assert.equal(quotaSource("x", undefined, false), undefined);
	assert.equal(quotaSource("x", "not a url", false), undefined);
});

test("requestHeaders", () => {
	assert.deepEqual(requestHeaders("anthropic", "tok"), {
		Authorization: "Bearer tok",
		"anthropic-beta": "oauth-2025-04-20",
	});
	assert.deepEqual(requestHeaders("zai", "key"), { Authorization: "key" });
});

test("parseAnthropic keeps known non-null windows in order", () => {
	const windows = parseAnthropic({
		seven_day: { utilization: 45, resets_at: "2026-09-28T22:00:00Z" },
		five_hour: { utilization: 9, resets_at: null },
		seven_day_opus: null,
		seven_day_sonnet: { utilization: null },
		nimbus_quill: { utilization: 0, resets_at: null },
	});
	assert.deepEqual(windows, [
		{ label: "5h", percent: 9, resetsAt: undefined },
		{ label: "7d", percent: 45, resetsAt: new Date("2026-09-28T22:00:00Z") },
	]);
});

test("parseAnthropic accepts zero utilization", () => {
	assert.deepEqual(parseAnthropic({ five_hour: { utilization: 0 } }), [
		{ label: "5h", percent: 0, resetsAt: undefined },
	]);
});

test("parseZai maps limits to labelled windows, token limits before mcp", () => {
	const windows = parseZai({
		success: true,
		data: {
			limits: [
				{
					type: "TIME_LIMIT",
					unit: 5,
					number: 1,
					percentage: 0,
					nextResetTime: 1792799640998,
				},
				{ type: "TOKENS_LIMIT", unit: 3, number: 5, percentage: 64 },
				{ type: "TOKENS_LIMIT", unit: 6, number: 1, percentage: 12 },
				{ type: "TOKENS_LIMIT", unit: 42, number: 2, percentage: 1 },
			],
		},
	});
	assert.deepEqual(windows, [
		{ label: "5h", percent: 64, resetsAt: undefined },
		{ label: "1w", percent: 12, resetsAt: undefined },
		{ label: "2?", percent: 1, resetsAt: undefined },
		{ label: "mcp 1mo", percent: 0, resetsAt: new Date(1792799640998) },
	]);
});

test("parseZai throws the API message on failure", () => {
	assert.throws(
		() => parseZai({ success: false, msg: "no coding plan" }),
		/no coding plan/,
	);
	assert.throws(() => parseZai({}), /z\.ai quota request failed/);
});

test("parseQuota dispatches on kind", () => {
	assert.equal(
		parseQuota("anthropic", { five_hour: { utilization: 3 } })[0].percent,
		3,
	);
	assert.equal(
		parseQuota("zai", { success: true, data: { limits: [] } }).length,
		0,
	);
});

test("severity thresholds", () => {
	assert.equal(severity(69.9), "ok");
	assert.equal(severity(70), "warn");
	assert.equal(severity(89.9), "warn");
	assert.equal(severity(90), "high");
});

test("formatStatus rounds and colours percentages", () => {
	const out = formatStatus(
		[
			{ label: "5h", percent: 9.4 },
			{ label: "7d", percent: 95 },
		],
		(sev, text) => `<${sev}>${text}`,
	);
	assert.equal(out, "5h <ok>9% · 7d <high>95%");
});

test("formatDuration", () => {
	assert.equal(formatDuration(-5000), "0m");
	assert.equal(formatDuration(59 * 60_000), "59m");
	assert.equal(formatDuration(60 * 60_000), "1h0m");
	assert.equal(formatDuration((2 * 60 + 13) * 60_000), "2h13m");
	assert.equal(formatDuration((24 * 60 + 60) * 60_000), "1d1h");
});

test("formatDetails", () => {
	const now = new Date("2026-09-24T10:00:00Z");
	const out = formatDetails(
		[
			{ label: "5h", percent: 9, resetsAt: new Date("2026-09-24T12:20:00Z") },
			{ label: "mcp 1mo", percent: 0 },
		],
		now,
	);
	assert.equal(out, "5h: 9% used (resets in 2h20m)\nmcp 1mo: 0% used");
});

export type QuotaKind = "anthropic" | "zai";
export type Severity = "ok" | "warn" | "high";

export interface QuotaSource {
	kind: QuotaKind;
	url: string;
}

export interface QuotaWindow {
	label: string;
	percent: number;
	resetsAt?: Date;
}

const ANTHROPIC_PROVIDER: string = "anthropic";
const ANTHROPIC_USAGE_URL: string = "https://api.anthropic.com/api/oauth/usage";
const ANTHROPIC_OAUTH_BETA: string = "oauth-2025-04-20";
const ZAI_HOSTS: readonly string[] = ["api.z.ai", "open.bigmodel.cn"];
const ZAI_QUOTA_PATH: string = "/api/monitor/usage/quota/limit";
const WARN_PERCENT: number = 70;
const HIGH_PERCENT: number = 90;
const MS_PER_MINUTE: number = 60_000;
const MINUTES_PER_HOUR: number = 60;
const HOURS_PER_DAY: number = 24;

const ANTHROPIC_WINDOWS: Readonly<Record<string, string>> = {
	five_hour: "5h",
	seven_day: "7d",
	seven_day_opus: "7d opus",
	seven_day_sonnet: "7d sonnet",
};

const ZAI_UNITS: Readonly<Record<number, string>> = { 3: "h", 5: "mo", 6: "w" };
const ZAI_TIME_LIMIT: string = "TIME_LIMIT";
const ZAI_TIME_LIMIT_PREFIX: string = "mcp ";

export function quotaSource(
	provider: string,
	baseUrl: string | undefined,
	usingOAuth: boolean,
): QuotaSource | undefined {
	if (provider === ANTHROPIC_PROVIDER)
		return usingOAuth
			? { kind: "anthropic", url: ANTHROPIC_USAGE_URL }
			: undefined;
	if (!baseUrl) return undefined;
	let url: URL;
	try {
		url = new URL(baseUrl);
	} catch {
		return undefined;
	}
	return ZAI_HOSTS.includes(url.hostname)
		? { kind: "zai", url: url.origin + ZAI_QUOTA_PATH }
		: undefined;
}

export function requestHeaders(
	kind: QuotaKind,
	apiKey: string,
): Record<string, string> {
	if (kind === "anthropic")
		return {
			Authorization: `Bearer ${apiKey}`,
			"anthropic-beta": ANTHROPIC_OAUTH_BETA,
		};
	return { Authorization: apiKey };
}

interface AnthropicWindow {
	utilization?: number | null;
	resets_at?: string | null;
}

export function parseAnthropic(
	body: Record<string, AnthropicWindow | null>,
): QuotaWindow[] {
	const windows: QuotaWindow[] = [];
	for (const [key, label] of Object.entries(ANTHROPIC_WINDOWS)) {
		const w = body[key];
		if (typeof w?.utilization !== "number") continue;
		windows.push({
			label,
			percent: w.utilization,
			resetsAt: w.resets_at ? new Date(w.resets_at) : undefined,
		});
	}
	return windows;
}

interface ZaiLimit {
	type: string;
	unit: number;
	number: number;
	percentage: number;
	nextResetTime?: number;
}

interface ZaiBody {
	success?: boolean;
	msg?: string;
	data?: { limits?: ZaiLimit[] };
}

export function parseZai(body: ZaiBody): QuotaWindow[] {
	if (!body.success) throw new Error(body.msg ?? "z.ai quota request failed");
	const isTimeLimit = (l: ZaiLimit): number =>
		Number(l.type === ZAI_TIME_LIMIT);
	return [...(body.data?.limits ?? [])]
		.sort((a, b) => isTimeLimit(a) - isTimeLimit(b))
		.map((l) => ({
			label: `${l.type === ZAI_TIME_LIMIT ? ZAI_TIME_LIMIT_PREFIX : ""}${l.number}${ZAI_UNITS[l.unit] ?? "?"}`,
			percent: l.percentage,
			resetsAt: l.nextResetTime ? new Date(l.nextResetTime) : undefined,
		}));
}

export function parseQuota(kind: QuotaKind, body: unknown): QuotaWindow[] {
	return kind === "anthropic"
		? parseAnthropic(body as Record<string, AnthropicWindow | null>)
		: parseZai(body as ZaiBody);
}

export function severity(percent: number): Severity {
	if (percent >= HIGH_PERCENT) return "high";
	if (percent >= WARN_PERCENT) return "warn";
	return "ok";
}

export function formatStatus(
	windows: QuotaWindow[],
	color: (sev: Severity, text: string) => string,
): string {
	return windows
		.map(
			(w) =>
				`${w.label} ${color(severity(w.percent), `${Math.round(w.percent)}%`)}`,
		)
		.join(" · ");
}

export function formatDuration(ms: number): string {
	const totalMinutes = Math.max(0, Math.round(ms / MS_PER_MINUTE));
	const minutes = totalMinutes % MINUTES_PER_HOUR;
	const totalHours = Math.floor(totalMinutes / MINUTES_PER_HOUR);
	const hours = totalHours % HOURS_PER_DAY;
	const days = Math.floor(totalHours / HOURS_PER_DAY);
	if (days > 0) return `${days}d${hours}h`;
	if (totalHours > 0) return `${hours}h${minutes}m`;
	return `${minutes}m`;
}

export function formatDetails(windows: QuotaWindow[], now: Date): string {
	return windows
		.map((w) => {
			const reset = w.resetsAt
				? ` (resets in ${formatDuration(w.resetsAt.getTime() - now.getTime())})`
				: "";
			return `${w.label}: ${Math.round(w.percent)}% used${reset}`;
		})
		.join("\n");
}

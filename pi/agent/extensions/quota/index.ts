/**
 * Subscription quota in the status bar for the active model's provider.
 * Supports Anthropic (Claude Pro/Max OAuth) and Z.AI / BigModel coding plans.
 * /quota forces a refresh and prints per-window usage and reset times.
 */
import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import {
	formatDetails,
	formatStatus,
	parseQuota,
	quotaSource,
	requestHeaders,
	type QuotaSource,
	type QuotaWindow,
	type Severity,
} from "./core.ts";

const STATUS_KEY: string = "quota";
const MIN_REFRESH_MS: number = 60_000;
const FETCH_TIMEOUT_MS: number = 10_000;
const SEVERITY_COLOR = {
	ok: "success",
	warn: "warning",
	high: "error",
} as const satisfies Record<Severity, string>;

interface CacheEntry {
	at: number;
	windows?: QuotaWindow[];
	error?: string;
}

export default function (pi: ExtensionAPI) {
	const cache = new Map<string, CacheEntry>();
	let generation = 0;

	async function fetchQuota(
		ctx: ExtensionContext,
		provider: string,
		{ kind, url }: QuotaSource,
	): Promise<CacheEntry> {
		try {
			const apiKey = await ctx.modelRegistry.getApiKeyForProvider(provider);
			if (!apiKey) throw new Error(`no credentials for ${provider}`);
			const res = await fetch(url, {
				headers: requestHeaders(kind, apiKey),
				signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
			});
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			return { at: Date.now(), windows: parseQuota(kind, await res.json()) };
		} catch (err) {
			return {
				at: Date.now(),
				error: err instanceof Error ? err.message : String(err),
			};
		}
	}

	function render(ctx: ExtensionContext, entry: CacheEntry): void {
		const theme = ctx.ui.theme;
		const body = entry.windows
			? formatStatus(entry.windows, (sev, text) =>
					theme.fg(SEVERITY_COLOR[sev], text),
				)
			: theme.fg("dim", "?");
		ctx.ui.setStatus(STATUS_KEY, `${theme.fg("dim", "quota")} ${body}`);
	}

	async function refresh(
		ctx: ExtensionContext,
		force: boolean,
	): Promise<CacheEntry | undefined> {
		if (!ctx.hasUI) return undefined;
		const current = ++generation;
		const model = ctx.model;
		const source =
			model &&
			quotaSource(
				model.provider,
				model.baseUrl,
				ctx.modelRegistry.isUsingOAuth(model),
			);
		if (!model || !source) {
			ctx.ui.setStatus(STATUS_KEY, undefined);
			return undefined;
		}
		let entry = cache.get(model.provider);
		if (force || !entry || Date.now() - entry.at >= MIN_REFRESH_MS) {
			entry = await fetchQuota(ctx, model.provider, source);
			cache.set(model.provider, entry);
		}
		if (current === generation) render(ctx, entry);
		return entry;
	}

	pi.registerCommand("quota", {
		description: "Refresh and show subscription quota for the current provider",
		handler: async (_args, ctx) => {
			const entry = await refresh(ctx, true);
			if (!entry)
				ctx.ui.notify(
					"No quota source for the current model (supported: Anthropic OAuth, Z.AI)",
					"info",
				);
			else if (entry.error)
				ctx.ui.notify(`Quota unavailable: ${entry.error}`, "warning");
			else
				ctx.ui.notify(formatDetails(entry.windows ?? [], new Date()), "info");
		},
	});

	pi.on("session_start", (_event, ctx) => void refresh(ctx, false));
	pi.on("model_select", (_event, ctx) => void refresh(ctx, false));
	pi.on("agent_end", (_event, ctx) => void refresh(ctx, false));
}

import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { getKeybindings, type KeyId } from "@earendil-works/pi-tui";
import { spawn } from "node:child_process";

const SHORTCUT_KEY: KeyId = "ctrl+i";
const GH_TIMEOUT_MS: number = 10_000;
// ctrl+i and tab are the same byte (0x09) to terminals and pi's key matcher,
// and extension shortcuts dispatch before editor keybindings — so a bound tab
// makes ctrl+i taken.
const TAKEN_KEYS: readonly string[] = ["ctrl+i", "tab"];

function isShortcutKeyTaken(): boolean {
	const bindings = getKeybindings().getResolvedBindings();
	return Object.values(bindings).some((keys) =>
		(Array.isArray(keys) ? keys : [keys]).some((k) =>
			TAKEN_KEYS.includes(k?.toLowerCase() ?? ""),
		),
	);
}

export function openerFor(platform: NodeJS.Platform): {
	command: string;
	prefixArgs: string[];
} {
	if (platform === "darwin") return { command: "open", prefixArgs: [] };
	if (platform === "win32")
		return { command: "cmd", prefixArgs: ["/c", "start", ""] };
	return { command: "xdg-open", prefixArgs: [] };
}

let spawnOpener: typeof spawn = spawn;

/** Replace the opener spawner in tests; undefined restores the real one. */
export function setSpawnOpenerForTests(fn: typeof spawn | undefined): void {
	spawnOpener = fn ?? spawn;
}

export function openUrl(options: {
	platform: NodeJS.Platform;
	url: string;
	cwd: string;
	onError: (message: string) => void;
}): void {
	// Detached: xdg-open on some desktops stays alive as long as the browser
	// does, so awaiting it would block until the browser closes.
	const opener = openerFor(options.platform);
	const child = spawnOpener(
		opener.command,
		[...opener.prefixArgs, options.url],
		{
			detached: true,
			stdio: "ignore",
			cwd: options.cwd,
		},
	);
	child.on("error", (err) =>
		options.onError(`Failed to open ${options.url}: ${err.message}`),
	);
	child.unref();
}

async function openPullRequest(
	pi: ExtensionAPI,
	ctx: ExtensionContext,
): Promise<void> {
	const pr = await pi.exec(
		"gh",
		["pr", "view", "--json", "url", "--jq", ".url"],
		{
			cwd: ctx.cwd,
			timeout: GH_TIMEOUT_MS,
		},
	);
	const url = pr.code === 0 && !pr.killed ? pr.stdout.trim() : "";
	if (!url) {
		if (pr.killed) {
			ctx.ui.notify("gh pr view timed out", "warning");
		} else if (pr.code !== 0 && pr.stderr.trim()) {
			ctx.ui.notify(pr.stderr.trim().split("\n")[0] ?? "", "info");
		} else if (pr.code !== 0) {
			ctx.ui.notify("gh failed without output — is it installed?", "info");
		} else {
			ctx.ui.notify("gh returned no PR URL", "info");
		}
		return;
	}
	openUrl({
		platform: process.platform,
		url,
		cwd: ctx.cwd,
		onError: (message) => ctx.ui.notify(message, "error"),
	});
	ctx.ui.notify(url, "info");
}

export default function (pi: ExtensionAPI) {
	pi.registerCommand("pr", {
		description: "Open the pull request for the current branch (if one exists)",
		handler: async (_args, ctx) => openPullRequest(pi, ctx),
	});

	// Keybindings resolve after factories run (extension flags are parsed first);
	// session_start fires before shortcuts are wired, with bindings available.
	pi.on("session_start", () => {
		// ponytail: only built-in/user keybindings are checked; other extensions'
		// shortcuts have no public API — pi resolves those conflicts last-wins.
		if (!isShortcutKeyTaken()) {
			pi.registerShortcut(SHORTCUT_KEY, {
				description:
					"Open the pull request for the current branch (if one exists)",
				handler: async (ctx) => openPullRequest(pi, ctx),
			});
		}
	});
}

/**
 * Pure spawn-pi logic — no pi-package dependencies, only node builtins.
 *
 * Kept separate from index.ts so the helpers are unit-testable with plain
 * `node --test` (index.ts imports typebox/@earendil-works/* which are only
 * resolvable through pi's jiti runtime).
 */

import { spawn } from "node:child_process";
import { accessSync, constants as fsConstants, realpathSync } from "node:fs";
import { isAbsolute, resolve, delimiter } from "node:path";
import { homedir } from "node:os";

export const PROMPT_ENV = "PI_SPAWN_PROMPT";
export const PI_BIN = "pi";
export const TMUX_BIN = "tmux";
export const VALID_TARGETS = ["auto", "pane", "tab", "terminal"] as const;

/** Env vars injected into a spawned pi so it joins the mesh with a known identity. */
export const ENV_NODE_ID = "PI_SPAWN_NODE_ID";
export const ENV_PARENT_ID = "PI_SPAWN_PARENT_ID";
/** Optional human-readable name stamped at spawn; the child uses it verbatim as its mesh label. */
export const ENV_NODE_NAME = "PI_SPAWN_NODE_NAME";

/** Read mesh identity from the environment (set by spawn-pi when this pi was spawned). */
export function parseMeshEnv(env: NodeJS.ProcessEnv = process.env): {
	nodeId?: string;
	parentId?: string;
	name?: string;
} {
	const nodeId = env[ENV_NODE_ID]?.trim() || undefined;
	const parentId = env[ENV_PARENT_ID]?.trim() || undefined;
	const name = env[ENV_NODE_NAME]?.trim() || undefined;
	return { nodeId, parentId, name };
}

/** Build the env for a spawned child, stamping its node id and recording its parent. */
export function buildChildEnv(
	env: NodeJS.ProcessEnv,
	childId: string,
	parentId?: string,
): NodeJS.ProcessEnv {
	const out: NodeJS.ProcessEnv = { ...env, [ENV_NODE_ID]: childId };
	if (parentId) out[ENV_PARENT_ID] = parentId;
	return out;
}

export type SpawnTarget = "pane" | "tab" | "terminal";

export interface TerminalSpec {
	name: string;
	bin: string;
	/** Build argv that exec the program directly (no shell). */
	buildArgs: (cwd: string, command: string[]) => string[];
}

// Preference order: alacritty first (user's primary), then common Wayland/X terminals.
export const TERMINALS: TerminalSpec[] = [
	{ name: "alacritty", bin: "alacritty", buildArgs: (cwd, cmd) => ["--working-directory", cwd, "-e", ...cmd] },
	{ name: "kitty", bin: "kitty", buildArgs: (cwd, cmd) => [`--directory=${cwd}`, ...cmd] },
	{ name: "wezterm", bin: "wezterm", buildArgs: (cwd, cmd) => ["start", "--cwd", cwd, ...cmd] },
	{ name: "foot", bin: "foot", buildArgs: (cwd, cmd) => [`--working-directory=${cwd}`, ...cmd] },
];

/** True when the current process is running inside a tmux session. */
export function isInTmux(env: NodeJS.ProcessEnv = process.env): boolean {
	return Boolean(env.TMUX);
}

/** Resolve a requested target to a concrete one, honoring tmux availability. */
export function resolveTarget(requested: string, env: NodeJS.ProcessEnv = process.env): SpawnTarget {
	if (requested === "terminal") return "terminal";
	if (requested === "pane" || requested === "tab") {
		return isInTmux(env) ? requested : "terminal";
	}
	return isInTmux(env) ? "pane" : "terminal";
}

/** Default PATH lookup (no shell). Returns the resolved path or null. */
export function which(bin: string, env: NodeJS.ProcessEnv = process.env): string | null {
	const pathVar = env.PATH ?? "";
	for (const dir of pathVar.split(delimiter)) {
		if (!dir) continue;
		const candidate = isAbsolute(dir) ? resolve(dir, bin) : resolve(homedir(), dir, bin);
		try {
			accessSync(candidate, fsConstants.X_OK);
			return candidate;
		} catch {
			/* keep scanning */
		}
	}
	return null;
}

/** Pick the first available terminal emulator, honoring $TERMINAL/$TERM_PROGRAM if set. */
export function detectTerminal(
	env: NodeJS.ProcessEnv = process.env,
	lookup: (bin: string, env: NodeJS.ProcessEnv) => string | null = which,
): TerminalSpec | null {
	const hinted = env.TERMINAL || env.TERM_PROGRAM;
	if (hinted) {
		const match = TERMINALS.find((t) => hinted.toLowerCase().includes(t.name));
		if (match && lookup(match.bin, env)) return match;
	}
	for (const t of TERMINALS) {
		if (lookup(t.bin, env)) return t;
	}
	return null;
}

/** Expand a leading ~ to the home directory. */
export function expandTilde(p: string): string {
	if (p === "~") return homedir();
	if (p.startsWith("~/")) return resolve(homedir(), p.slice(2));
	return p;
}

/** Resolve a cwd against a fallback, expanding ~ and making it absolute. */
export function resolveCwd(cwd: string | undefined, fallback: string): string {
	const base = cwd && cwd.trim() !== "" ? cwd : fallback;
	const expanded = expandTilde(base);
	return isAbsolute(expanded) ? expanded : resolve(fallback, expanded);
}

/** Canonicalize through realpath so symlinked worktree dirs share identity. Throws if missing. */
export function canonicalizeCwd(abs: string): string {
	return realpathSync(abs);
}

/**
 * Build tmux argv that runs `exec pi "$PI_SPAWN_PROMPT"` in a new pane (-d keeps main focused).
 * extraEnv is carried as additional tmux `-e KEY=VAL` literals (never parsed by a shell),
 * used to stamp the spawned pi's mesh identity.
 */
export function buildTmuxArgs(
	mode: "pane" | "tab",
	cwd: string,
	prompt: string,
	extraEnv: Record<string, string> = {},
): string[] {
	const subcommand = mode === "pane" ? "split-window" : "new-window";
	const horizontalFlag = mode === "pane" ? ["-h"] : [];
	const extraEnvArgs = Object.entries(extraEnv).flatMap(([k, v]) => ["-e", `${k}=${v}`]);
	return [
		subcommand,
		...horizontalFlag,
		"-d",
		"-c",
		cwd,
		...extraEnvArgs,
		"-e",
		`${PROMPT_ENV}=${prompt}`,
		`exec ${PI_BIN} "$${PROMPT_ENV}"`,
	];
}

/** Build terminal-emulator argv that execs pi directly with the prompt as one argv element. */
export function buildTerminalArgs(spec: TerminalSpec, cwd: string, prompt: string): string[] {
	return spec.buildArgs(cwd, [PI_BIN, prompt]);
}

/** Tokenize a raw arg string, honoring single/double quotes and backslash escapes. */
export function tokenize(input: string): string[] {
	const out: string[] = [];
	let cur = "";
	let quote: string | null = null;
	let hasToken = false;
	for (let i = 0; i < input.length; i++) {
		const c = input[i];
		if (quote) {
			if (c === "\\") {
				const next = input[i + 1];
				if (next !== undefined) {
					cur += next;
					i++;
					hasToken = true;
					continue;
				}
				cur += c;
				hasToken = true;
				continue;
			}
			if (c === quote) {
				quote = null;
				continue;
			}
			cur += c;
			hasToken = true;
		} else if (c === '"' || c === "'") {
			quote = c;
			hasToken = true;
		} else if (/\s/.test(c)) {
			if (hasToken) {
				out.push(cur);
				cur = "";
				hasToken = false;
			}
		} else if (c === "\\") {
			const next = input[i + 1];
			if (next !== undefined) {
				cur += next;
				i++;
				hasToken = true;
				continue;
			}
			cur += c;
			hasToken = true;
		} else {
			cur += c;
			hasToken = true;
		}
	}
	if (hasToken) out.push(cur);
	return out;
}

export interface ParsedSpawnArgs {
	prompt: string;
	cwd?: string;
	target: string;
	name?: string;
}

/** Parse `/spawn` arg string: flags first (--cwd, --target, --name), remainder is the prompt. */
export function parseSpawnArgs(input: string): ParsedSpawnArgs {
	const tokens = tokenize(input);
	let cwd: string | undefined;
	let name: string | undefined;
	let target = "auto";
	const rest: string[] = [];
	for (let i = 0; i < tokens.length; i++) {
		const t = tokens[i];
		if ((t === "--cwd" || t === "-C") && i + 1 < tokens.length) {
			cwd = tokens[++i];
			continue;
		}
		if (t.startsWith("--cwd=")) {
			cwd = t.slice("--cwd=".length);
			continue;
		}
		if (t === "--target" && i + 1 < tokens.length) {
			target = tokens[++i];
			continue;
		}
		if (t.startsWith("--target=")) {
			target = t.slice("--target=".length);
			continue;
		}
		if ((t === "--name" || t === "-n") && i + 1 < tokens.length) {
			name = tokens[++i];
			continue;
		}
		if (t.startsWith("--name=")) {
			name = t.slice("--name=".length);
			continue;
		}
		rest.push(t);
	}
	return { prompt: rest.join(" ").trim(), cwd, target, name };
}

export interface SpawnDetails {
	target: SpawnTarget;
	cwd: string;
	terminal?: string;
	inTmux: boolean;
	requestedTarget: string;
	/** Node id assigned to the spawned pi (present when mesh identity was injected). */
	childId?: string;
}

export function isValidTarget(value: string): boolean {
	return (VALID_TARGETS as readonly string[]).includes(value);
}

/**
 * Core spawn. Performs the actual process launch; returns details or throws.
 * extraEnv stamps the child's mesh identity: tmux carries it via `-e` flags, terminals
 * via the inherited process env.
 */
export async function spawnPi(options: {
	prompt: string;
	cwd: string;
	target: SpawnTarget;
	env: NodeJS.ProcessEnv;
	extraEnv?: Record<string, string>;
}): Promise<SpawnDetails> {
	const { prompt, cwd, target, env, extraEnv } = options;

	if (target === "pane" || target === "tab") {
		return new Promise<SpawnDetails>((resolveP, reject) => {
			const args = buildTmuxArgs(target, cwd, prompt, extraEnv);
			const child = spawn(TMUX_BIN, args, { stdio: "ignore", shell: false });
			child.on("error", (err) => reject(new Error(`tmux ${target} failed: ${err.message}`)));
			child.on("exit", (code) => {
				if (code === 0) {
					resolveP({
						target,
						cwd,
						inTmux: true,
						requestedTarget: target,
						childId: extraEnv?.[ENV_NODE_ID],
					});
				} else {
					reject(new Error(`tmux ${target} exited with code ${code}`));
				}
			});
		});
	}

	const spec = detectTerminal(env);
	if (!spec) {
		throw new Error(
			"No terminal emulator found. Install alacritty/kitty/wezterm/foot, or run inside tmux.",
		);
	}
	const args = buildTerminalArgs(spec, cwd, prompt);
	const childEnv = extraEnv ? { ...env, ...extraEnv } : env;
	const child = spawn(spec.bin, args, {
		stdio: "ignore",
		detached: true,
		shell: false,
		env: childEnv,
	});
	child.on("error", (err) => {
		throw new Error(`${spec.name} failed to launch: ${err.message}`);
	});
	child.unref();
	return {
		target: "terminal",
		cwd,
		terminal: spec.name,
		inTmux: isInTmux(env),
		requestedTarget: "terminal",
		childId: extraEnv?.[ENV_NODE_ID],
	};
}

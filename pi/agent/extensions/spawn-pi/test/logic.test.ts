/**
 * Unit tests for spawn-pi pure helpers.
 * Run: node --test test/logic.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
	isInTmux,
	resolveTarget,
	detectTerminal,
	expandTilde,
	resolveCwd,
	buildTmuxArgs,
	buildTerminalArgs,
	buildChildEnv,
	parseMeshEnv,
	tokenize,
	parseSpawnArgs,
	resolveModelPattern,
	type TerminalSpec,
	type ModelRef,
} from "../logic.ts";

const ENV_NODE_ID = "PI_SPAWN_NODE_ID";
const ENV_PARENT_ID = "PI_SPAWN_PARENT_ID";
const ENV_NODE_NAME = "PI_SPAWN_NODE_NAME";

const ENV_NOTMUX: NodeJS.ProcessEnv = {};
const ENV_TMUX: NodeJS.ProcessEnv = { TMUX: "/tmp/tmux-1000/default,1234,0" };

const alacritty: TerminalSpec = {
	name: "alacritty",
	bin: "alacritty",
	buildArgs: (cwd, cmd) => ["--working-directory", cwd, "-e", ...cmd],
};

// --- isInTmux / resolveTarget ------------------------------------------------

test("isInTmux: true only when TMUX is set", () => {
	assert.equal(isInTmux(ENV_NOTMUX), false);
	assert.equal(isInTmux(ENV_TMUX), true);
	assert.equal(isInTmux({ TMUX: "" }), false);
});

test("resolveTarget: auto -> pane in tmux, terminal outside", () => {
	assert.equal(resolveTarget("auto", ENV_TMUX), "pane");
	assert.equal(resolveTarget("auto", ENV_NOTMUX), "terminal");
});

test("resolveTarget: pane/tab fall back to terminal outside tmux", () => {
	assert.equal(resolveTarget("pane", ENV_TMUX), "pane");
	assert.equal(resolveTarget("tab", ENV_TMUX), "tab");
	assert.equal(resolveTarget("pane", ENV_NOTMUX), "terminal");
	assert.equal(resolveTarget("tab", ENV_NOTMUX), "terminal");
});

test("resolveTarget: terminal always terminal", () => {
	assert.equal(resolveTarget("terminal", ENV_TMUX), "terminal");
	assert.equal(resolveTarget("terminal", ENV_NOTMUX), "terminal");
});

test("resolveTarget: unknown value behaves like auto (no throw)", () => {
	assert.equal(resolveTarget("weird", ENV_TMUX), "pane");
	assert.equal(resolveTarget("weird", ENV_NOTMUX), "terminal");
});

// --- detectTerminal ----------------------------------------------------------

test("detectTerminal: hint via $TERMINAL honored when binary present", () => {
	const which = (b: string) => (b === "kitty" ? "/usr/bin/kitty" : null);
	const got = detectTerminal({ TERMINAL: "kitty" }, which);
	assert.equal(got?.name, "kitty");
});

test("detectTerminal: falls through preference order when hint absent/unmatched", () => {
	const which = (b: string) => (b === "wezterm" ? "/usr/bin/wezterm" : null);
	const got = detectTerminal({}, which);
	assert.equal(got?.name, "wezterm");
});

test("detectTerminal: returns null when nothing available", () => {
	assert.equal(
		detectTerminal({}, () => null),
		null,
	);
});

// --- expandTilde / resolveCwd ------------------------------------------------

test("expandTilde: ~ and ~/...", () => {
	const home = process.env.HOME ?? "";
	assert.equal(expandTilde("~"), home);
	assert.ok(expandTilde("~/foo").startsWith(home));
	assert.equal(expandTilde("~/foo"), `${home}/foo`);
	assert.equal(expandTilde("/abs/x"), "/abs/x");
	assert.equal(expandTilde("rel"), "rel");
});

test("resolveCwd: defaults to fallback when empty", () => {
	assert.equal(resolveCwd(undefined, "/proj"), "/proj");
	assert.equal(resolveCwd("   ", "/proj"), "/proj");
});

test("resolveCwd: relative resolved against fallback", () => {
	assert.equal(resolveCwd("sub", "/proj"), "/proj/sub");
	assert.equal(resolveCwd("../up", "/proj/a"), "/proj/up");
});

test("resolveCwd: absolute + tilde preserved/resolved", () => {
	assert.equal(resolveCwd("/abs/dir", "/proj"), "/abs/dir");
	const home = process.env.HOME ?? "";
	assert.equal(resolveCwd("~/work/repo", "/proj"), `${home}/work/repo`);
});

// --- buildTmuxArgs -----------------------------------------------------------

test("buildTmuxArgs: pane uses split-window, side-by-side, detached, prompt via env", () => {
	const args = buildTmuxArgs("pane", "/repo", "hello $world `rm -rf /`");
	assert.equal(args[0], "split-window");
	assert.deepEqual(args.slice(1, 4), ["-h", "-d", "-c"]); // side-by-side, detached, cwd flag
	assert.equal(args[4], "/repo");
	assert.equal(args[5], "-e"); // tmux env flag, next arg is the assignment
	// prompt value carried literally in the env var, NOT shell-escaped
	assert.equal(args[6], "PI_SPAWN_PROMPT=hello $world `rm -rf /`");
	// command references the var by name, never interpolates the value
	assert.equal(args[7], 'exec pi "$PI_SPAWN_PROMPT"');
});

test("buildTmuxArgs: tab uses new-window, no -h", () => {
	const args = buildTmuxArgs("tab", "/repo", "p");
	assert.equal(args[0], "new-window");
	assert.equal(args[1], "-d"); // no horizontal flag for tabs
	assert.ok(!args.includes("-h"));
});

test("buildTmuxArgs: prompt with newlines and quotes survives in env value", () => {
	const tricky = "line1\nline2 \"q\" 'sq' $x";
	const args = buildTmuxArgs("pane", "/r", tricky);
	assert.equal(args[6], `PI_SPAWN_PROMPT=${tricky}`);
});

test("buildTmuxArgs: model rides env, referenced quoted by name", () => {
	const args = buildTmuxArgs(
		"pane",
		"/repo",
		"p",
		{},
		"anthropic/claude-opus-5",
	);
	assert.ok(args.includes("PI_SPAWN_MODEL=anthropic/claude-opus-5"));
	assert.equal(
		args[args.length - 1],
		'exec pi --model "$PI_SPAWN_MODEL" "$PI_SPAWN_PROMPT"',
	);
});

test("buildTmuxArgs: no model — command unchanged", () => {
	const args = buildTmuxArgs("pane", "/repo", "p");
	assert.ok(!args.some((a) => a.includes("PI_SPAWN_MODEL")));
	assert.equal(args[args.length - 1], 'exec pi "$PI_SPAWN_PROMPT"');
});

// --- buildTerminalArgs -------------------------------------------------------

test("buildTerminalArgs: execs pi directly with prompt as one argv element", () => {
	const args = buildTerminalArgs(alacritty, "/repo", "do the thing");
	assert.deepEqual(args, [
		"--working-directory",
		"/repo",
		"-e",
		"pi",
		"do the thing",
	]);
	assert.equal(args[3], "pi");
	assert.equal(args[4], "do the thing");
});

test("buildTerminalArgs: model passed as --model before the prompt", () => {
	const args = buildTerminalArgs(
		alacritty,
		"/repo",
		"go",
		"google/gemini-3-pro",
	);
	assert.deepEqual(args, [
		"--working-directory",
		"/repo",
		"-e",
		"pi",
		"--model",
		"google/gemini-3-pro",
		"go",
	]);
});

// --- tokenize ----------------------------------------------------------------

test("tokenize: basic whitespace", () => {
	assert.deepEqual(tokenize("a b c"), ["a", "b", "c"]);
});

test("tokenize: single and double quotes", () => {
	assert.deepEqual(tokenize("\"a b\" 'c d' e"), ["a b", "c d", "e"]);
});

test("tokenize: backslash escapes", () => {
	assert.deepEqual(tokenize('a\\ b "c\\"d"'), ["a b", 'c"d']);
});

test("tokenize: empty input", () => {
	assert.deepEqual(tokenize(""), []);
	assert.deepEqual(tokenize("   "), []);
});

test("tokenize: preserves empty quoted token", () => {
	assert.deepEqual(tokenize('"" x'), ["", "x"]);
});

// --- parseSpawnArgs ----------------------------------------------------------

test("parseSpawnArgs: prompt only", () => {
	const p = parseSpawnArgs("implement the feature");
	assert.equal(p.prompt, "implement the feature");
	assert.equal(p.target, "auto");
	assert.equal(p.cwd, undefined);
});

test("parseSpawnArgs: --cwd and --target flags", () => {
	const p = parseSpawnArgs("--cwd /tmp/wt --target tab fix the bug");
	assert.equal(p.cwd, "/tmp/wt");
	assert.equal(p.target, "tab");
	assert.equal(p.prompt, "fix the bug");
});

test("parseSpawnArgs: = syntax and short -C", () => {
	const p = parseSpawnArgs("--cwd=/a/b --target=pane -C /x go");
	assert.equal(p.cwd, "/x"); // -C overrides earlier --cwd=
	assert.equal(p.target, "pane");
	assert.equal(p.prompt, "go");
});

test("parseSpawnArgs: quoted cwd with spaces", () => {
	const p = parseSpawnArgs('--cwd "/some path/work tree" do stuff');
	assert.equal(p.cwd, "/some path/work tree");
	assert.equal(p.prompt, "do stuff");
});

test("parseSpawnArgs: empty input", () => {
	const p = parseSpawnArgs("");
	assert.equal(p.prompt, "");
	assert.equal(p.target, "auto");
});

// --- parseSpawnArgs: --name / -n -------------------------------------------

test("parseSpawnArgs: --name flag", () => {
	const p = parseSpawnArgs("--name auth-feature fix the bug");
	assert.equal(p.name, "auth-feature");
	assert.equal(p.prompt, "fix the bug");
});

test("parseSpawnArgs: -n short flag, = syntax, and spaced name via space form", () => {
	assert.equal(parseSpawnArgs("-n short go").name, "short");
	// = syntax takes only what's after '='
	assert.equal(parseSpawnArgs("--name=auth fix bug").name, "auth");
	// spaced name requires the space form (--name "...")
	const q = parseSpawnArgs('--name "auth feature" fix the bug');
	assert.equal(q.name, "auth feature");
	assert.equal(q.prompt, "fix the bug");
});

test("parseSpawnArgs: name omitted when not provided", () => {
	assert.equal(parseSpawnArgs("just a prompt").name, undefined);
});

// --- buildTmuxArgs with extraEnv (mesh identity) ---------------------------

test("buildTmuxArgs: extraEnv injects one -e pair per key, before the prompt flag", () => {
	const args = buildTmuxArgs("pane", "/r", "p", {
		[ENV_NODE_ID]: "child-1",
		[ENV_PARENT_ID]: "parent-1",
	});
	// base layout: split-window -h -d -c /r  then extra -e pairs  then -e PI_SPAWN_PROMPT=... + exec
	assert.equal(args[0], "split-window");
	assert.equal(args[4], "/r");
	assert.equal(args[args.length - 1], 'exec pi "$PI_SPAWN_PROMPT"');
	assert.equal(args[args.length - 2], "PI_SPAWN_PROMPT=p");
	assert.equal(args[args.length - 3], "-e");
	// the two identity pairs sit between cwd and the prompt flag
	const joined = args.join("\n");
	assert.ok(joined.includes(`-e\n${ENV_NODE_ID}=child-1`));
	assert.ok(joined.includes(`-e\n${ENV_PARENT_ID}=parent-1`));
});

test("buildTmuxArgs: no extraEnv → same layout as before", () => {
	const args = buildTmuxArgs("pane", "/repo", "hello");
	assert.equal(args[0], "split-window");
	assert.deepEqual(args.slice(1, 4), ["-h", "-d", "-c"]);
	assert.equal(args[4], "/repo");
	assert.equal(args[5], "-e");
	assert.equal(args[6], "PI_SPAWN_PROMPT=hello");
	assert.equal(args[7], 'exec pi "$PI_SPAWN_PROMPT"');
});

// --- parseMeshEnv / buildChildEnv ------------------------------------------

test("parseMeshEnv: reads trimmed env vars", () => {
	assert.deepEqual(parseMeshEnv({}), {
		nodeId: undefined,
		parentId: undefined,
		name: undefined,
	});
	assert.deepEqual(parseMeshEnv({ [ENV_NODE_ID]: " abc " }), {
		nodeId: "abc",
		parentId: undefined,
		name: undefined,
	});
	assert.deepEqual(
		parseMeshEnv({ [ENV_NODE_ID]: "child", [ENV_PARENT_ID]: "par" }),
		{ nodeId: "child", parentId: "par", name: undefined },
	);
});

test("parseMeshEnv: reads explicit node name", () => {
	assert.deepEqual(
		parseMeshEnv({ [ENV_NODE_ID]: "x", [ENV_NODE_NAME]: " auth-feature " }),
		{ nodeId: "x", parentId: undefined, name: "auth-feature" },
	);
});

test("buildChildEnv: stamps node id + optional parent, preserves the rest", () => {
	const base = { PATH: "/usr/bin", FOO: "bar" } as NodeJS.ProcessEnv;
	const child = buildChildEnv(base, "kid", "parent");
	assert.equal(child[ENV_NODE_ID], "kid");
	assert.equal(child[ENV_PARENT_ID], "parent");
	assert.equal(child.PATH, "/usr/bin");
	assert.equal(child.FOO, "bar");
	assert.equal(base[ENV_NODE_ID], undefined); // original untouched
});

test("buildChildEnv: omits parent when not provided", () => {
	const child = buildChildEnv({}, "kid");
	assert.equal(child[ENV_NODE_ID], "kid");
	assert.equal(child[ENV_PARENT_ID], undefined);
});

const MODEL_CATALOG: readonly ModelRef[] = [
	{ provider: "zai-renaud", id: "glm-5.3", name: "GLM-5.3 (Renaud)" },
	{
		provider: "zai-renaud",
		id: "glm-5.3-flash",
		name: "GLM-5.3 Flash (Renaud)",
	},
	{ provider: "zai", id: "glm-5.3-flash", name: "GLM-5.3 Flash" },
	{ provider: "anthropic", id: "claude-haiku-4-5", name: "Claude Haiku 4.5" },
	{ provider: "llamacpp", id: "qwen3.8-27b", name: "Qwen3.8-27B (Q6_K_XL)" },
];

test("resolveModelPattern: trims surrounding whitespace", () => {
	assert.deepEqual(
		resolveModelPattern("  zai-renaud/glm-5.3 \t", MODEL_CATALOG),
		{ status: "ok", canonical: "zai-renaud/glm-5.3" },
	);
});

test("resolveModelPattern: duplicate registry entries are reported as ambiguous", () => {
	const catalog: readonly ModelRef[] = [
		{ provider: "zai", id: "glm-5.3" },
		{ provider: "zai", id: "glm-5.3" },
	];
	assert.deepEqual(resolveModelPattern("zai/glm-5.3", catalog), {
		status: "ambiguous",
		matches: ["zai/glm-5.3", "zai/glm-5.3"],
	});
});

test("resolveModelPattern: slashed vendor ids resolve like OpenRouter's", () => {
	const catalog: readonly ModelRef[] = [
		{ provider: "openrouter", id: "moonshotai/kimi-k2.6", name: "Kimi K2.6" },
		{
			provider: "bedrock",
			id: "us.anthropic.claude-opus-4-6-v1:0",
			name: "Opus",
		},
	];
	// Bare vendor-style id resolves to the canonical provider/id.
	assert.deepEqual(resolveModelPattern("moonshotai/kimi-k2.6", catalog), {
		status: "ok",
		canonical: "openrouter/moonshotai/kimi-k2.6",
	});
	// Full canonical reference with a slashed id.
	assert.deepEqual(
		resolveModelPattern("openrouter/moonshotai/kimi-k2.6", catalog),
		{ status: "ok", canonical: "openrouter/moonshotai/kimi-k2.6" },
	);
	// Non-thinking colon suffix stays part of the id and still matches exactly.
	assert.deepEqual(
		resolveModelPattern("bedrock/us.anthropic.claude-opus-4-6-v1:0", catalog),
		{ status: "ok", canonical: "bedrock/us.anthropic.claude-opus-4-6-v1:0" },
	);
});

test("resolveModelPattern: exact provider/id wins and is canonicalized", () => {
	assert.deepEqual(resolveModelPattern("zai-renaud/glm-5.3", MODEL_CATALOG), {
		status: "ok",
		canonical: "zai-renaud/glm-5.3",
	});
	assert.deepEqual(resolveModelPattern("ZAI-RENAUD/GLM-5.3", MODEL_CATALOG), {
		status: "ok",
		canonical: "zai-renaud/glm-5.3",
	});
});

test("resolveModelPattern: unique bare id resolves", () => {
	assert.deepEqual(resolveModelPattern("qwen3.8-27b", MODEL_CATALOG), {
		status: "ok",
		canonical: "llamacpp/qwen3.8-27b",
	});
	// Case-insensitive on every stage.
	assert.deepEqual(resolveModelPattern("QWEN3.8-27B", MODEL_CATALOG), {
		status: "ok",
		canonical: "llamacpp/qwen3.8-27b",
	});
});

test("resolveModelPattern: thinking-level suffix folds back onto the canonical id", () => {
	assert.deepEqual(
		resolveModelPattern("zai-renaud/glm-5.3:high", MODEL_CATALOG),
		{
			status: "ok",
			canonical: "zai-renaud/glm-5.3:high",
		},
	);
	assert.deepEqual(resolveModelPattern("QWEN3.8-27B:MAX", MODEL_CATALOG), {
		status: "ok",
		canonical: "llamacpp/qwen3.8-27b:max",
	});
	// Ambiguity inside the prefix is still reported.
	const res = resolveModelPattern("glm-5.3-f:high", MODEL_CATALOG);
	assert.equal(res.status, "ambiguous");
	// An unknown suffix stays part of the id (pi strict-mode behavior).
	assert.deepEqual(resolveModelPattern("qwen3.8-27b:exacto", MODEL_CATALOG), {
		status: "no-match",
	});
});

test("resolveModelPattern: ambiguous bare id is reported, never guessed", () => {
	assert.deepEqual(resolveModelPattern("glm-5.3-flash", MODEL_CATALOG), {
		status: "ambiguous",
		matches: ["zai-renaud/glm-5.3-flash", "zai/glm-5.3-flash"],
	});
});

test("resolveModelPattern: provider-slash substring resolves uniquely", () => {
	assert.deepEqual(
		resolveModelPattern("anthropic/claude-haiku", MODEL_CATALOG),
		{
			status: "ok",
			canonical: "anthropic/claude-haiku-4-5",
		},
	);
	// Non-contiguous provider/slash fragments do not match.
	assert.deepEqual(resolveModelPattern("anthropic/haiku", MODEL_CATALOG), {
		status: "no-match",
	});
});

test("resolveModelPattern: provider-slash substring ambiguity within one provider", () => {
	const catalog: readonly ModelRef[] = [
		{ provider: "zai", id: "glm-5.3-flash", name: "GLM 5.3 Flash" },
		{ provider: "zai", id: "glm-5.3-flashx", name: "GLM 5.3 FlashX" },
	];
	assert.deepEqual(resolveModelPattern("zai/glm-5.3-fla", catalog), {
		status: "ambiguous",
		matches: ["zai/glm-5.3-flash", "zai/glm-5.3-flashx"],
	});
});

test("resolveModelPattern: unique substring over id or name resolves", () => {
	assert.deepEqual(resolveModelPattern("haiku-4-5", MODEL_CATALOG), {
		status: "ok",
		canonical: "anthropic/claude-haiku-4-5",
	});
	assert.deepEqual(
		resolveModelPattern("Qwen3.8-27B (Q6_K_XL)", MODEL_CATALOG),
		{
			status: "ok",
			canonical: "llamacpp/qwen3.8-27b",
		},
	);
});

test("resolveModelPattern: ambiguous substring is reported", () => {
	const res = resolveModelPattern("glm-5.3-f", MODEL_CATALOG);
	assert.deepEqual(res, {
		status: "ambiguous",
		matches: ["zai-renaud/glm-5.3-flash", "zai/glm-5.3-flash"],
	});
});

test("resolveModelPattern: no match", () => {
	assert.deepEqual(resolveModelPattern("gpt-9", MODEL_CATALOG), {
		status: "no-match",
	});
	assert.deepEqual(resolveModelPattern("   ", MODEL_CATALOG), {
		status: "no-match",
	});
});

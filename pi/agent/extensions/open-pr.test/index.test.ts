/**
 * Run: node --test pi/agent/extensions/open-pr.test/
 */
import assert from "node:assert/strict";
import test from "node:test";
import { EventEmitter } from "node:events";
import {
	KeybindingsManager,
	setKeybindings,
	TUI_KEYBINDINGS,
} from "@earendil-works/pi-tui";
import extension, {
	openUrl,
	openerFor,
	setSpawnOpenerForTests,
} from "../open-pr.ts";

type ExecResult = {
	stdout: string;
	stderr: string;
	code: number;
	killed: boolean;
};
type ExecCall = {
	command: string;
	args: string[];
	options?: { cwd?: string; timeout?: number };
};

// Real pi TUI defaults include "tui.input.tab": "tab", which aliases ctrl+i.
function useTuiDefaults(userBindings: Record<string, string | string[]> = {}) {
	setKeybindings(
		new KeybindingsManager(TUI_KEYBINDINGS, userBindings as never),
	);
}

class FakeChild extends EventEmitter {
	unrefCalled = false;
	unref() {
		this.unrefCalled = true;
	}
}

// Every test uses the fake spawner; a real one would launch a browser.
const openerState = {
	calls: [] as Array<{ command: string; args: string[]; options: unknown }>,
	children: [] as FakeChild[],
};

function fakeSpawnFn() {
	return ((command: string, args: string[], options: unknown) => {
		openerState.calls.push({ command, args, options });
		const child = new FakeChild();
		openerState.children.push(child);
		return child;
	}) as never;
}

test.beforeEach(() => {
	openerState.calls = [];
	openerState.children = [];
	setSpawnOpenerForTests(fakeSpawnFn());
});
test.afterEach(() => {
	setSpawnOpenerForTests(undefined);
});

function makePi() {
	const commands = new Map<
		string,
		{ handler: (args: string, ctx: unknown) => Promise<void> }
	>();
	const shortcuts = new Map<
		string,
		{ handler: (ctx: unknown) => Promise<void> }
	>();
	const handlers = new Map<string, () => void>();
	const execCalls: ExecCall[] = [];
	const execResults: ExecResult[] = [];
	const notifications: Array<{ message: string; level: string }> = [];

	const pi = {
		registerCommand: (
			name: string,
			options: { handler: (args: string, ctx: unknown) => Promise<void> },
		) => commands.set(name, options),
		registerShortcut: (
			key: string,
			options: { handler: (ctx: unknown) => Promise<void> },
		) => shortcuts.set(key, options),
		on: (event: string, handler: () => void) => handlers.set(event, handler),
		exec: async (
			command: string,
			args: string[],
			options?: ExecCall["options"],
		): Promise<ExecResult> => {
			execCalls.push({ command, args, options });
			return (
				execResults.shift() ?? {
					stdout: "",
					stderr: "",
					code: 0,
					killed: false,
				}
			);
		},
	};

	const ctx = {
		cwd: "/repo",
		ui: {
			notify: (message: string, level: string) =>
				notifications.push({ message, level }),
		},
	};

	const load = () => {
		extension(pi as never);
		handlers.get("session_start")!();
	};

	return {
		pi,
		load,
		commands,
		shortcuts,
		execCalls,
		execResults,
		notifications,
		ctx,
	};
}

test("registers /pr; ctrl+i stays free because tab is bound by default", () => {
	useTuiDefaults();
	const { load, commands, shortcuts } = makePi();
	load();

	assert.ok(commands.has("pr"), "/pr command registered");
	assert.equal(
		shortcuts.has("ctrl+i"),
		false,
		"tab aliases ctrl+i — must not bind",
	);
});

test("does not register ctrl+i before session_start", () => {
	useTuiDefaults({ "tui.input.tab": [] });
	const { pi, shortcuts } = makePi();
	extension(pi as never);

	assert.equal(
		shortcuts.size,
		0,
		"shortcut registration must wait for resolved keybindings",
	);
});

test("binds ctrl+i when tab is unbound and ctrl+i itself is free", () => {
	useTuiDefaults({ "tui.input.tab": [] });
	const { load, shortcuts } = makePi();
	load();

	assert.ok(
		shortcuts.has("ctrl+i"),
		"ctrl+i registered when nothing aliases it",
	);
});

test("skips ctrl+i when ctrl+i is explicitly bound, case-insensitive", () => {
	useTuiDefaults({
		"tui.input.tab": [],
		"tui.editor.cursorLeft": ["left", "CTRL+I"],
	});
	const { load, shortcuts } = makePi();
	load();

	assert.equal(
		shortcuts.has("ctrl+i"),
		false,
		"mixed-case ctrl+i binding must count",
	);
});

test("opens the PR url when one exists", async () => {
	useTuiDefaults({ "tui.input.tab": [] });
	const { load, commands, execCalls, execResults, notifications, ctx } =
		makePi();
	execResults.push({
		stdout: "https://github.com/o/r/pull/7\n",
		stderr: "",
		code: 0,
		killed: false,
	});
	load();

	await commands.get("pr")!.handler("", ctx);

	assert.deepEqual(execCalls, [
		{
			command: "gh",
			args: ["pr", "view", "--json", "url", "--jq", ".url"],
			options: { cwd: "/repo", timeout: 10_000 },
		},
	]);
	assert.equal(openerState.calls.length, 1, "opener must spawn exactly once");
	assert.equal(
		openerState.calls[0]!.command,
		openerFor(process.platform).command,
	);
	assert.equal(
		openerState.calls[0]!.args.at(-1),
		"https://github.com/o/r/pull/7",
	);
	assert.deepEqual(notifications, [
		{ message: "https://github.com/o/r/pull/7", level: "info" },
	]);

	openerState.children[0]!.emit("error", new Error("spawn ENOENT"));
	assert.deepEqual(notifications.slice(1), [
		{
			message: "Failed to open https://github.com/o/r/pull/7: spawn ENOENT",
			level: "error",
		},
	]);
});

test("does not open anything when no PR exists", async () => {
	useTuiDefaults({ "tui.input.tab": [] });
	const { load, commands, execCalls, execResults, notifications, ctx } =
		makePi();
	execResults.push({
		stdout: "",
		stderr: "no pull requests found for branch master\ncheck your filters\n",
		code: 1,
		killed: false,
	});
	load();

	await commands.get("pr")!.handler("", ctx);

	assert.equal(execCalls.length, 1, "only gh runs, no opener");
	assert.equal(
		openerState.calls.length,
		0,
		"no opener spawn when no PR exists",
	);
	assert.deepEqual(notifications, [
		{ message: "no pull requests found for branch master", level: "info" },
	]);
});

test("reports gh spawn failure (empty stderr) distinctly", async () => {
	useTuiDefaults({ "tui.input.tab": [] });
	const { load, commands, execCalls, execResults, notifications, ctx } =
		makePi();
	execResults.push({ stdout: "", stderr: "", code: 1, killed: false });
	load();

	await commands.get("pr")!.handler("", ctx);

	assert.equal(execCalls.length, 1);
	assert.equal(openerState.calls.length, 0);
	assert.equal(
		notifications[0]!.message,
		"gh failed without output — is it installed?",
	);
});

test("reports gh success without URL", async () => {
	useTuiDefaults({ "tui.input.tab": [] });
	const { load, commands, execResults, notifications, ctx } = makePi();
	execResults.push({ stdout: "", stderr: "", code: 0, killed: false });
	load();

	await commands.get("pr")!.handler("", ctx);

	assert.equal(openerState.calls.length, 0);
	assert.equal(notifications[0]!.message, "gh returned no PR URL");
});

test("reports timeout as warning", async () => {
	useTuiDefaults({ "tui.input.tab": [] });
	const { load, commands, execCalls, execResults, notifications, ctx } =
		makePi();
	execResults.push({
		stdout: "https://github.com/o/r/pull/7",
		stderr: "",
		code: 0,
		killed: true,
	});
	load();

	await commands.get("pr")!.handler("", ctx);

	assert.equal(execCalls.length, 1, "only gh runs, no opener");
	assert.equal(
		openerState.calls.length,
		0,
		"opener must not run for killed gh call",
	);
	assert.deepEqual(notifications, [
		{ message: "gh pr view timed out", level: "warning" },
	]);
});

test("shortcut handler behaves like the command", async () => {
	useTuiDefaults({ "tui.input.tab": [] });
	const { load, shortcuts, execCalls, execResults, notifications, ctx } =
		makePi();
	execResults.push({ stdout: "", stderr: "", code: 1, killed: false });
	load();

	await shortcuts.get("ctrl+i")!.handler(ctx);

	assert.equal(execCalls.length, 1);
	assert.equal(openerState.calls.length, 0);
	assert.equal(
		notifications[0]!.message,
		"gh failed without output — is it installed?",
	);
});

test("openUrl spawns detached, unref'd, with the url", () => {
	openUrl({
		platform: "linux",
		url: "https://github.com/o/r/pull/7",
		cwd: "/repo",
		onError: () => assert.fail("no error expected"),
	});

	assert.equal(openerState.calls.length, 1);
	assert.equal(openerState.calls[0]!.command, "xdg-open");
	assert.deepEqual(openerState.calls[0]!.args, [
		"https://github.com/o/r/pull/7",
	]);
	assert.deepEqual(openerState.calls[0]!.options, {
		detached: true,
		stdio: "ignore",
		cwd: "/repo",
	});
	assert.equal(
		openerState.children[0]!.unrefCalled,
		true,
		"must unref so pi does not wait for the browser",
	);
});

test("ignores stdout when gh exits non-zero", async () => {
	useTuiDefaults({ "tui.input.tab": [] });
	const { load, commands, execResults, notifications, ctx } = makePi();
	execResults.push({
		stdout: "https://github.com/o/r/pull/7\n",
		stderr: "boom\n",
		code: 1,
		killed: false,
	});
	load();

	await commands.get("pr")!.handler("", ctx);

	assert.equal(
		openerState.calls.length,
		0,
		"URL from a failed gh run must not open",
	);
	assert.deepEqual(notifications, [{ message: "boom", level: "info" }]);
});

test("openerFor maps platforms", () => {
	assert.deepEqual(openerFor("darwin"), { command: "open", prefixArgs: [] });
	assert.deepEqual(openerFor("win32"), {
		command: "cmd",
		prefixArgs: ["/c", "start", ""],
	});
	assert.deepEqual(openerFor("linux"), { command: "xdg-open", prefixArgs: [] });
});

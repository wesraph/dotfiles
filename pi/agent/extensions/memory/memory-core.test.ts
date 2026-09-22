import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import {
	addEntry,
	expandHome,
	getMemoriesDir,
	listEntries,
	MEMORY_DIR_ENV,
	memoryFilePath,
	newMemoryFileContent,
	normalizeId,
	realGitRunner,
	removeEntry,
	resolveScopeDir,
} from "./memory-core.ts";

const GIT_IDENTITY = [
	"-c",
	"user.email=test@example.com",
	"-c",
	"user.name=Test",
	"-c",
	"commit.gpgsign=false",
];

function git(cwd: string, ...args: string[]): void {
	execFileSync("git", [...GIT_IDENTITY, ...args], {
		cwd,
		stdio: ["ignore", "ignore", "ignore"],
	});
}

/** Scratch area is inside the working tree (scratch/ is gitignored), never /tmp. */
const scratchBase = resolve(
	import.meta.dirname,
	"../../../scratch/memory-tests",
);
mkdirSync(scratchBase, { recursive: true });

test("resolveScopeDir: non-git folder scopes to itself", async (t) => {
	const dir = mkdtempSync(join(scratchBase, "plain-"));
	t.after(() => {
		delete process.env.GIT_CEILING_DIRECTORIES;
		rmSync(dir, { recursive: true, force: true });
	});
	// scratch/ lives inside the dotfiles repo; stop git from walking up to it.
	process.env.GIT_CEILING_DIRECTORIES = scratchBase;
	assert.equal(await resolveScopeDir(dir, realGitRunner), dir);
});

test("resolveScopeDir: folder without its own repo belongs to the enclosing repo", async (t) => {
	const dir = mkdtempSync(join(scratchBase, "nested-"));
	t.after(() => rmSync(dir, { recursive: true, force: true }));
	assert.equal(
		await resolveScopeDir(dir, realGitRunner),
		resolve(import.meta.dirname, "../../../.."),
	);
});

test("resolveScopeDir: git repo root from a subdirectory", async (t) => {
	const repo = mkdtempSync(join(scratchBase, "repo-"));
	t.after(() => rmSync(repo, { recursive: true, force: true }));
	git(repo, "init");
	writeFileSync(join(repo, "f.txt"), "x");
	git(repo, "add", ".");
	git(repo, "commit", "-m", "init");
	const sub = join(repo, "a", "b");
	mkdirSync(sub, { recursive: true });
	assert.equal(await resolveScopeDir(sub, realGitRunner), repo);
});

test("resolveScopeDir: worktree resolves to the main repo root", async (t) => {
	const base = mkdtempSync(join(scratchBase, "wt-"));
	t.after(() => rmSync(base, { recursive: true, force: true }));
	const main = join(base, "main");
	mkdirSync(main);
	git(main, "init");
	writeFileSync(join(main, "f.txt"), "x");
	git(main, "add", ".");
	git(main, "commit", "-m", "init");
	const worktree = join(base, "wt");
	git(main, "worktree", "add", worktree);
	assert.equal(await resolveScopeDir(worktree, realGitRunner), main);
	const deep = join(worktree, "sub");
	mkdirSync(deep);
	assert.equal(await resolveScopeDir(deep, realGitRunner), main);
});

test("resolveScopeDir: bare repo scopes to itself", async (t) => {
	const base = mkdtempSync(join(scratchBase, "bare-"));
	t.after(() => rmSync(base, { recursive: true, force: true }));
	const bare = join(base, "repo.git");
	git(base, "init", "--bare", bare);
	assert.equal(await resolveScopeDir(bare, realGitRunner), bare);
});

test("memoryFilePath: nests the absolute scope path", () => {
	assert.equal(
		memoryFilePath("/mems", "/home/u/proj"),
		join("/mems", "home", "u", "proj", "MEMORY.md"),
	);
	assert.equal(
		memoryFilePath("/mems", "/"),
		join("/mems", "root", "MEMORY.md"),
	);
});

test("expandHome and getMemoriesDir", (t) => {
	t.after(() => delete process.env[MEMORY_DIR_ENV]);
	assert.equal(expandHome("~"), homedir());
	assert.equal(expandHome("~/x"), join(homedir(), "x"));
	assert.equal(expandHome("/abs"), "/abs");

	process.env[MEMORY_DIR_ENV] = "~/mymem";
	assert.equal(getMemoriesDir(), join(homedir(), "mymem"));
	delete process.env[MEMORY_DIR_ENV];
	assert.equal(getMemoriesDir(), join(homedir(), ".pi", "memories"));
});

test("add / list / remove roundtrip", () => {
	const now = new Date("2025-09-22T10:00:00Z");
	let content = newMemoryFileContent("/repo");

	const first = addEntry(
		content,
		"Prefer pnpm",
		"Always use pnpm.\nNever npm.",
		now,
	);
	assert.equal(first.entry.id, "m1");
	assert.equal(first.entry.title, "Prefer pnpm (2025-09-22)");
	assert.match(first.content, /^# Project Memory — \/repo\n/);
	assert.match(
		first.content,
		/\n\n## m1: Prefer pnpm \(2025-09-22\)\nAlways use pnpm\.\nNever npm\./,
	);
	assert.deepEqual(listEntries(first.content), [
		"m1: Prefer pnpm (2025-09-22)",
	]);

	// Bodies are trimmed; entries are separated by a blank line.
	const padded = addEntry(first.content, "Padded", "  padded body  ", now);
	assert.match(padded.content, /## m2: Padded \(2025-09-22\)\npadded body/);

	content = padded.content;
	const second = addEntry(content, "Deploy flow", "", now);
	assert.equal(second.entry.id, "m3");
	assert.deepEqual(listEntries(second.content), [
		"m1: Prefer pnpm (2025-09-22)",
		"m2: Padded (2025-09-22)",
		"m3: Deploy flow (2025-09-22)",
	]);

	const removed = removeEntry(second.content, "m1");
	assert.doesNotMatch(removed.content, /m1/);
	assert.match(removed.content, /## m3: Deploy flow/);
	assert.match(removed.content, /^# Project Memory — \/repo/);
	assert.equal(removed.removed.id, "m1");

	// Ids keep counting after a removal.
	const third = addEntry(removed.content, "Next", "body", now);
	assert.equal(third.entry.id, "m4");
});

test("entry ids stay multi-digit-safe past m9", () => {
	const now = new Date("2025-09-22T10:00:00Z");
	let content = newMemoryFileContent("/repo");
	for (let i = 1; i <= 10; i++)
		content = addEntry(content, `E${i}`, "b", now).content;
	assert.deepEqual(listEntries(content).slice(-2), [
		"m9: E9 (2025-09-22)",
		"m10: E10 (2025-09-22)",
	]);
	const eleventh = addEntry(content, "E11", "b", now);
	assert.equal(eleventh.entry.id, "m11");
	assert.doesNotMatch(removeEntry(eleventh.content, "m10").content, /m10/);
});

test("addEntry rejects empty titles", () => {
	assert.throws(
		() => addEntry(newMemoryFileContent("/r"), "  ", "b", new Date()),
		/non-empty/,
	);
});

test("removeEntry throws on unknown id", () => {
	const content = addEntry(
		newMemoryFileContent("/r"),
		"T",
		"b",
		new Date(),
	).content;
	assert.throws(() => removeEntry(content, "m9"), /m9 not found/);
});

test("normalizeId accepts bare numbers and case variants", () => {
	assert.equal(normalizeId("m3"), "m3");
	assert.equal(normalizeId("3"), "m3");
	assert.equal(normalizeId(" M12 "), "m12");
});

test("human preamble text between header and entries is preserved", () => {
	const now = new Date("2025-09-22T10:00:00Z");
	const content =
		"# Project Memory — /repo\n\nSome hand-written notes.\n\n## m1: First (2025-09-01)\nbody\n";
	const next = addEntry(content, "Second", "x", now);
	assert.match(next.content, /Some hand-written notes\./);
	assert.match(next.content, /## m2: Second/);
	assert.match(next.content, /## m1: First/);
});

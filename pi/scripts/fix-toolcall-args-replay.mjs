#!/usr/bin/env node
/**
 * fix-toolcall-args-replay.mjs — make pi replay tool-call arguments byte-identically.
 *
 * Bug: pi parses streamed tool-call argument JSON and re-serializes it with
 * JSON.stringify on the next request. Any formatting the model emitted
 * (pretty-printing, whitespace, \uXXXX escapes) is normalized away, so the
 * re-sent history differs from what the provider generated. Cache-reusing
 * servers (raference, llama.cpp prefix caching, OpenAI/Anthropic prompt
 * caches) then drop the whole cached prefix and re-prefill 100K+ tokens.
 *
 * Fix: remember the provider's exact argument text on the toolCall block
 * (`argumentsText`) when it differs from the canonical serialization, and
 * prefer it when rendering the next request.
 *
 * Idempotent. Supports pi-coding-agent install shapes:
 *   - >= 1.5: `Object.assign(block, input.arguments.finish())` (unbundled pi-ai)
 *             and the minified bundle chunk equivalent
 *   - 1.0.x:  `block.arguments = parseStreamingJson(block.partialArgs)` and
 *             the minified bundle chunk equivalent
 * Run: node fix-toolcall-args-replay.mjs [pi-coding-agent-dir ...]
 * (defaults to every @earendil-works/pi-coding-agent found under common prefixes)
 */
import { readdirSync, readFileSync, writeFileSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";

const CAPTURE_15 = `Object.assign(block, input.arguments.finish());`;
const CAPTURE_15_FIXED = `{
                    const finished = input.arguments.finish();
                    Object.assign(block, finished);
                    if (finished.argumentsError === undefined) {
                        const raw = input.arguments.text;
                        if (raw && raw !== JSON.stringify(finished.arguments)) {
                            block.argumentsText = raw;
                        }
                    }
                }`;
const CAPTURE_10 = `block.arguments = parseStreamingJson(block.partialArgs);`;
const CAPTURE_10_FIXED = `{
                    const raw = block.partialArgs;
                    block.arguments = parseStreamingJson(raw);
                    try {
                        if (raw && JSON.stringify(JSON.parse(raw)) !== raw) block.argumentsText = raw;
                    } catch { /* malformed raw: keep canonical serialization */ }
                }`;
const REPLAY_OLD = `arguments: JSON.stringify(tc.arguments),`;
const REPLAY_NEW = `arguments: tc.argumentsText ?? JSON.stringify(tc.arguments),`;

function patchFile(path, edits) {
	let src = readFileSync(path, "utf8");
	if (src.includes("argumentsText")) {
		console.log(`  already patched: ${path}`);
		return false;
	}
	let changed = false;
	for (const [oldText, newText] of edits) {
		if (src.includes(oldText)) {
			src = src.replace(oldText, newText);
			changed = true;
		}
	}
	if (!changed) {
		console.log(`  !! no patch point found: ${path}`);
		return false;
	}
	writeFileSync(path, src);
	console.log(`  patched: ${path}`);
	return true;
}

function patchUnbundled(pkgDir) {
	const f = join(pkgDir, "node_modules", "@earendil-works", "pi-ai", "dist", "api", "openai-completions.js");
	if (!existsSync(f)) return;
	patchFile(f, [
		[CAPTURE_15, CAPTURE_15_FIXED],
		[CAPTURE_10, CAPTURE_10_FIXED],
		[REPLAY_OLD, REPLAY_NEW],
	]);
}

function patchBundle(pkgDir) {
	const chunks = join(pkgDir, "dist", "bundle", "chunks");
	if (!existsSync(chunks)) return;
	for (const name of readdirSync(chunks)) {
		if (!name.startsWith("openai-completions")) continue;
		const f = join(chunks, name);
		if (!statSync(f).isFile()) continue;
		const src = readFileSync(f, "utf8");
		if (src.includes("argumentsText")) {
			console.log(`  already patched: ${f}`);
			continue;
		}
		let out = src;
		// minified capture points
		out = out.replace(
			/else Object\.assign\(block,input\.arguments\.finish\(\)\);/,
			"else{let f=input.arguments.finish();Object.assign(block,f),f.argumentsError===void 0&&input.arguments.text&&input.arguments.text!==JSON.stringify(f.arguments)&&(block.argumentsText=input.arguments.text)}",
		);
		out = out.replace(
			/(else )?block\.arguments=parseStreamingJson\(block\.partialArgs\);/,
			"$1block.arguments=parseStreamingJson(block.partialArgs);try{let r=block.partialArgs;r&&JSON.stringify(JSON.parse(r))!==r&&(block.argumentsText=r)}catch{}",
		);
		out = out.replace(/arguments:JSON\.stringify\(tc\.arguments\)/g, "arguments:tc.argumentsText??JSON.stringify(tc.arguments)");
		if (out !== src) {
			writeFileSync(f, out);
			console.log(`  patched: ${f}`);
		} else {
			console.log(`  !! no patch point found: ${f}`);
		}
	}
}

function patchPackage(pkgDir) {
	console.log(`${pkgDir}`);
	patchUnbundled(pkgDir);
	patchBundle(pkgDir);
}

const candidates = [];
for (const arg of process.argv.slice(2)) {
	candidates.push(arg);
}
if (candidates.length === 0) {
	const prefixes = [
		process.env.HOME + "/.node/lib/node_modules/@earendil-works/pi-coding-agent",
		process.env.HOME + "/.local/share/pi-node/node-v22.22.3-linux-x64/lib/node_modules/@earendil-works/pi-coding-agent",
	];
	for (const p of prefixes) if (existsSync(p)) candidates.push(p);
}
if (candidates.length === 0) {
	console.error("no pi-coding-agent install found; pass install dirs as arguments");
	process.exit(1);
}
for (const c of candidates) patchPackage(c);

# pi memory extension

Per-repository memory for pi, stored as one `MEMORY.md` per scope under a
configurable directory (default `~/.pi/memories`), and injected into the
system prompt at the start of every turn.

- **Scope**: git repository root; all worktrees of a repo share the same
  memory. Outside git, the current folder.
- **Layout**: `<memoriesDir>/<absolute scope path>/MEMORY.md`
- **Directory override**: set `PI_MEMORIES_DIR` (leading `~/` expanded).
- **Tool**: the LLM gets a `memory` tool — actions `add` / `remove` / `list`
  / `read` on entries `## m<N>: <title>`.

## Development

```sh
npm install            # installs @types/node
node --test .          # runs memory-core.test.ts
```

The symlinks under `node_modules/@earendil-works/` and `node_modules/typebox`
point at the globally installed pi package so editors get types; pi itself
resolves these at runtime. To recreate them on a new machine:

```sh
PI_GLOBAL=$(node -e 'console.log(require.resolve("@earendil-works/pi-coding-agent/package.json").replace("/package.json",""))')
mkdir -p node_modules/@earendil-works
ln -sfn "$PI_GLOBAL" node_modules/@earendil-works/pi-coding-agent
ln -sfn "$PI_GLOBAL/node_modules/@earendil-works/pi-ai" node_modules/@earendil-works/pi-ai
ln -sfn "$PI_GLOBAL/node_modules/typebox" node_modules/typebox
```

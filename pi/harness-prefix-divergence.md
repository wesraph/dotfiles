# Harness bug: already-sent messages change between turns (cause of the huge re-prefills)

## Your task

Find and fix the place in the agent harness (the client that calls the LLM server) where **messages that were already
sent in a previous request get modified, removed, reordered or re-rendered in the next request**. When the fix is in,
each request's message list must be the previous request's list plus new messages appended at the end (append-only),
byte for byte, apart from those appended messages.

The server is `raference-serve` (OpenAI/Anthropic-compatible) at `192.168.1.3:11434`. The harness runs on the
client machine `192.168.1.100`.

## Why it matters

The server caches the conversation's prefix: KV cache plus snapshots of the model's recurrent (linear-attention)
state. The model is hybrid, so the cache can only resume at positions where a state snapshot exists. Per
conversation the server keeps the newest prompt-end snapshot, the last 2 answer-end snapshots and the system-prompt
snapshot (~26K tokens). If the harness changes **anything** before the end of the previous request, every snapshot
after the change is useless. The server then falls back to the system-prompt snapshot and re-prefills the whole
conversation: 130-165K tokens, 27-47 s per turn.

Session of 2026-11-17 18:17-19:05 (server log `logs/raference-20261117-181715-f52bd1c-dirty.log` on the server box),
main conversation of ~157K-191K tokens:

| req | messages | prompt tokens | reused | re-prefilled | prefill time |
|---|---|---|---|---|---|
| 227 | 199 | 158,215 | 26,345 | 131,870 | 42 s |
| 229 | 201 | 160,004 | 26,345 | 133,659 | 27 s |
| 230 | 202 | 162,224 | 26,345 | 135,879 | 27 s |
| 254 | 225 | 177,308 | 26,345 | 150,963 | 47 s |
| 256 | 227 | 178,660 | 26,345 | 152,315 | 47 s |
| 291 | 237 | 188,757 | 26,345 | 162,412 | the client cancelled it mid-prefill |
| 292 | 238 | 191,577 | 26,345 | 165,232 | 40 s |

All other turns of the session reused almost the whole prompt. Those turns show what correct behaviour looks like.

## What the server observed (facts)

Before each bad turn the server printed:

```
[raference] prefix divergence: conversation 3968465cee95: the rendered history differs from its stored prompt at
byte 565421 (message 195 of 199); nothing after it can come from the prefix store
```

How that check works (`src/server/prompt.cpp`, `PromptBuilder::encode`):
- The server renders the request's messages to text with its chat template. That rendering is deterministic: same
  messages give the same text. Past assistant reasoning is kept unless the client sends
  `chat_template_kwargs.preserve_thinking=false`.
- It compares that text with the rendered text of the **previous request** of the same conversation. The
  conversation key is a hash of the system messages plus the first non-system message.
- It warns when the new text differs from the previous request's text **before the new request's last message**. In
  other words, the client changed something it had already sent.
- "message N of M" is the 0-based index of the message containing the first differing byte, out of M messages in the
  new request.

Divergence points:

| req | message changed | messages in request | where, in tokens |
|---|---|---|---|
| 227 | 195 | 199 | ~124 tokens before the end of the previous request's prompt |
| 229 | 197 | 201 | ~450 tokens before the previous prompt's end |
| 230 | 200 | 202 | ~300 tokens before the previous prompt's end |
| 254 | 222 | 225 | inside the previous turn's tail |
| 256 | 224 | 227 | inside the previous turn's tail |
| 291 | 235 | 237 | inside the previous turn's tail |
| 292 | **4** | 238 | early history rewritten; this request also changed `max_tokens` from 16384 to 70567 |

Interpretation:
1. **Recurring pattern (227-291).** The edited content is in the **last 1-3 messages of the previous request**
   (the last tool result or user message, sometimes the assistant message just before it). Between 229 and 230 the
   message count grew by only 1 instead of the usual 2. That suggests messages are merged, split, replaced or
   removed at the tail.
2. **Request 292.** Message 4 changed, and `max_tokens` changed at the same time. This looks like a compaction or
   summarization request, a mode switch, or a system-prompt or context refresh that rewrites early history.
3. **Request 291** was cancelled by the client while the server was prefilling 162K tokens, maybe because of a
   client-side timeout. Then 292 re-sent a modified history. Check whether the harness has a request timeout shorter
   than ~60 s, and what it does on timeout or retry.

The server can't tell us exactly what changed: it doesn't log request bodies, and the client machine's session files
weren't reachable from the server.

## Likely culprits to check in the harness

Look for any code that builds the outgoing message list from something other than "previous list + new messages":
- **Ephemeral injections**: reminders, context-usage or token-count notes, todo-list snapshots, timestamps, "N tokens
  left" banners, cwd or git status, or steering text added to the latest user or tool-result message and then
  dropped, moved or updated on the next turn. These are the prime suspect for the recurring pattern.
- **Tool-result post-processing**: truncating or eliding older tool outputs, replacing images or large outputs with
  placeholders after the first send, re-reading file contents.
- **Message merging or splitting**: merging consecutive user, tool or text blocks differently depending on what comes
  next. In Anthropic format: tool_result blocks and text blocks in one user message versus separate messages.
- **Assistant message round trip**: dropping or rewriting thinking blocks, signatures or tool-call ids of earlier
  assistant turns, reformatting tool-call arguments (JSON key order, whitespace), or normalising text.
- **`cache_control` breakpoint movement** that also changes the content or block structure, not just the markers.
- **Compaction or summarization paths**, and any request type that sets a different `max_tokens` (request 292).
- **Retry or timeout paths** that rebuild the history.

## How to debug

1. Make the harness log the exact JSON body of every request it sends, one file per request, ordered and labelled
   with the session id. Keep the files under a durable directory, not `/tmp`.
2. Run a long session (many tool calls) against the server.
3. For each consecutive pair of requests in the same session, compare `messages[0 .. len(prev)-1]` of the new request
   with the previous request's messages. Any difference is the bug. Also compare `system` and `tools`. A changed
   system prompt or tool list invalidates everything as well.

   Quick checker:
   ```python
   import json, sys
   a, b = (json.load(open(f)) for f in sys.argv[1:3])
   for k in ("system", "tools"):
       if a.get(k) != b.get(k): print("CHANGED:", k)
   ma, mb = a["messages"], b["messages"]
   for i, m in enumerate(ma):
       if i >= len(mb) or mb[i] != m:
           print("first changed message", i, "of", len(ma))
           print("OLD:", json.dumps(m)[:2000]); print("NEW:", json.dumps(mb[i] if i < len(mb) else None)[:2000])
           break
   else:
       print("append-only OK, +%d messages" % (len(mb) - len(ma)))
   ```
4. On the server box, watch `logs/latest.log` for `prefix divergence:` lines while testing. After the fix there
   should be none during a normal agent loop. Each turn's `[raference] bench: ... prompt=X cached=Y` line should show
   `X - Y` of roughly the size of the new messages (hundreds to a few thousand tokens), not 100K+.

## Acceptance criteria

- Across a long session, every request is append-only with respect to the previous one, checked with the checker
  above on the logged bodies.
- No `prefix divergence` lines in the server log during a normal agent loop.
- If compaction is intentional, it may rewrite history, but rarely, as a deliberate event, and never as a side effect
  of a normal turn or a retry.
- Client timeout for a request is at least a few minutes. A 190K-token cold prefill takes ~40-50 s, plus queueing.

## Out of scope

Don't change the server. Its side (keeping more snapshots so that a tail edit costs less) is tracked separately.

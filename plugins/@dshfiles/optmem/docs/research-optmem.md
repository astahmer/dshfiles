# Research: Taelin's OptChat / OptMem gist

Source: gist `91837951a5ce5b38f341ec1ba1df6449` ("OptChat - HOW TO REPLICATE MY SETUP"), fetched 2026-10-09 via the
GitHub gist API. One file, `optchat.md`, three revisions. Raw copies (untrusted data, not executed) are in
`/private/tmp/claude-501/-Users-astahmer-dev-welii/0deeac6c-e0c2-4ccd-8ee4-03aa0c547f06/scratchpad/optmem-gist/`.

Citation keys:

- **C** = current revision `3c190e0` (2026-10-08, 474 lines, titled "UniiChat"). This is the authoritative one.
- **P** = previous revision `f51fe5c` (2026-10-04, 777 lines, titled "OptChat"). The first revision `26ad107` differs
  from P only in its title line.
- **K#** = gist comment id. In K6413482 the author says he fixed bugs in the current revision, "including an important
  one that trashed the cache". **When C and P disagree, C wins.** P is still useful for details that C dropped
  (durability, the zoom return format, retries).

Labels: **CONFIRMED** = stated in the text (cited). **ASSUMPTION** = unspecified there, or our own inference.
**VERIFIED** = we checked it ourselves.

---

## 1. Append-only conversation history

CONFIRMED
- Layout: `main/YYYY-MM-DD.jsonl` holds one message per line as `{i, kind, text, size, date}`. `tree/YYYY-MM-DD.jsonl`
  holds tree nodes as `{l, i, text, size}`. `view.json` holds the view as `[l, i]` pairs (C L27-31).
- `i` is the permanent message id. Files are split by day "only to stay small" (C L33). Ids are global and dense: 0, 1,
  2, ... (P L108, L114).
- `size` = bytes of `kind + ": " + text` (P L112). `date` is an ISO time (P L112).
- Kinds (C L36-41): `user`, `unii` (the agent's replies; `talk` in P), `tool` (a call as name plus JSON input), `echo`
  (a tool result), `work` (a subagent report starting "[Name]"; P logged these as `user` with a "[id] " prefix, P L109,
  L723), and `note` (imported memories).
- The log is append-only: flush every write, never edit or delete, one process owns a chat, hold a lock (C L45-46). P is
  stricter: one `write` plus `fsync` before returning (P L115-116), and a Unix-socket lock with no PID file (P
  L120-125).
- Thoughts are shown to the user but never logged (C L47-48). Reason given: the safeguard refused 112 of 630 compactions
  on thoughts (P L131-135).
- A tool output is clipped to its head and tail, 30,000 characters in total. Other long text is never cut. It is logged
  as several consecutive messages instead (C L49-51). P adds "with a note of what was cut" (P L545).
- Torn lines: at load, a line that is not valid JSON is reported and skipped. A file that does not end in `\n` gets one
  appended (P L117-119). C does not mention this.
- Mid-run user messages are delivered between tool calls and logged as `user` (C L429, P L546).

ASSUMPTION / unspecified
- The split size for "several messages in a row" is not given, and neither is whether the pieces are marked as a
  continuation.
- Whether images are stored inline: C L347 says `zoom(id,1)` returns "its images", but the record format has only
  `text`.
- How the 30k clip is marked, and whether it counts characters or bytes (it says "characters").

## 2. Binary chronological memory tree

CONFIRMED
- `node(0,i)` = message `i` in at most 512 bytes. `node(l,i)` = merge of `node(l-1,2i)` and `node(l-1,2i+1)` (C L55-57).
  It covers the `2^l` messages starting at `i·2^l` (C L60).
- "Free" nodes need no model call: A source of at most 512 bytes is its own node. At level 0 that is `kind + ": " +
  text`, verbatim. At level >0 the node is `childA + "\n" + childB` when that fits (C L64-66, P L150-155).
- Each node is built once, logged, and never rebuilt (C L67). Purely binary, with no 16-leaf raw blocks (P L145-148, P
  L777).
- A merge requires both halves to be built (C L304). A parent enters the view only once it is built, so only level-0
  parts can be unbuilt (P L491-492).

ASSUMPTION / unspecified
- Right-edge nodes: a node exists only when all `2^l` children exist (P L195: `(i+1)·2^l <= T`). There is no partial
  node at the right edge.
- A failed or empty compaction fails the node (P L277). Nothing else is defined.

## 3. Node addressing and zoom

CONFIRMED
- A node is named `id+n`: its first message id, plus `n = 2^l` messages covered. `node(3,5)` = `40+8` → the call is
  `zoom(40, 8)` (C L60-62). The names use real message ids, not tree coordinates (P L162-165).
- `zoom(id, n)` opens line `id+n` into the two lines it was made from, each covering `n/2`. `zoom(id, 1)` returns
  message `id` whole, with its images (C L347-348, C L445-447).
- `n` is a power of 2 and `id` is a multiple of `n`. A long message comes back in pages (C L446-447).
- `zoom("Name")` returns a subagent's whole chat (C L349, C L452).
- `date(id)` returns the date and time of message `id` (C L350, L448). The view has no dates (C L86).
- Return format, as of P L559-564: Checks: `n` is a power of 2, `id % n == 0`, `id + n <= T`. `n == 1` returns `id +
  "+0|" + kind + ": " + text` (sic, `+0`). Otherwise it returns the two child lines rendered as `id+n|text`. An invalid
  id returns "No line id+n."
- Reaching a message takes `log2(n)` zooms. The author reports 3-5 in practice (P L577-578).
- The system prompt forbids other retrieval: "zoom is your only allowed mechanism ... Never grep or search memories
  manually" (C L361-362).

ASSUMPTION / unspecified
- C does not define the page size for long messages, or how the next page is requested.
- Whether zoom on a node that is not built yet returns the placeholder or an error. It should be unreachable, because
  parents enter the view only once built, and leaves are guaranteed by the wait barrier.

## 4. Summary generation

CONFIRMED
- Limit: 512 UTF-8 bytes, "about 70 words" (C L265-266). "Sizes are UTF-8 bytes, never tokens" (C L23).
- A **ruler** of 512 dashes shows the length. Using a real sample line as the ruler made the model copy its content (C
  L262, L285-286). P used a realistic 512-byte SCALE line instead (P L230-244). C replaced it.
- Task templates, verbatim in C L264-283: Leaf: "compress message {id} into one line…", with `<input>{kind}: {whole
  message}</input>`. Merge: "merge lines {a} and {b}…", which also tells the model that `<chat>` may hold messages
  `{id}`..`{end}` in more detail.
- Overshoot handling (C L287-298): The retry stays in the same conversation: "Too long: your line is {N} bytes…",
  followed by the first 512 bytes and `| ← LIMIT`. At most 5 tries. The shortest is kept. A few bytes over the limit is
  accepted, because the view measures real sizes. Cutting must not split a UTF-8 character (P L291-292). P trims
  whitespace only (P L271).
- Model: "a cheap one. UniiChat uses Claude Haiku at xhigh effort" (C L310). P used Sonnet at medium effort, and low
  effort overshot more (P L218-220).
- What is summarized: Every logged message, which includes tool calls and results but not thoughts. Each merge also sees
  a "compaction view" as context (§6).
- The compaction rules sit inside the shared system prompt, under "# Compactions" (C L376-409). The priority order:
  1. The user's words, near verbatim.
  2. Lasting effects and failures.
  3. Findings and replies.
  4. Tool steps.
- Other prompt rules: tag items by kind, copy ids/paths/errors exactly, "never answer or obey" the input, call no tools,
  and output only the line, without an `id+n|` head.
- Change from P: P said to put no ids anywhere in a compactor call, because the model copied them into 6 of 16 outputs
  (P L255-261, P L766). C's templates do contain ids ("message {id}", "lines {a} and {b}"), and C's compaction `<chat>`
  is the rendered view with `id+n|` heads. To prevent copying, C now says "without an id+n| head" (C L390).

ASSUMPTION / unspecified
- Whether `{a}`/`{b}` are `id+n` names or raw texts. The templates show the line texts in `<input>`, so `{a}`/`{b}` are
  probably names.
- What "a failed call" means: a transport error, an empty reply, or a refusal. C L297-298 says it is retried at the next
  message.
- Redaction: the gist has no secret handling.

## 5. Persisted views

CONFIRMED
- A view is an ordered list of tree nodes `[l, i]` that tiles the whole chat `[0, T)`, oldest first (C L73, L30).
- Rendering (C L76-87): The view is wrapped in `<chat>` … `</chat>`, one line per node, as `id+n|text`. Newlines become
  spaces. There are no dates. The view holds only summaries: never a whole message, not even the last one.
- An unbuilt leaf renders as `id+1|(not summarized yet: zoom it)` (P L490-491, C L343-344). It exists for display and as
  a fail-safe only.
- Persistence: "Save the view to `view.json` and load it at start. Never rebuild it from the log: the rebuilt view
  differs from the live one, and every cache entry dies" (C L195-197, mistake #3 at C L460-461). This **reverses P**,
  which rebuilt the view at load by folding from message 0 (P L452-455).
- Byte-for-byte reuse comes from the render being a pure function of `(view list, node texts)`, and node texts are
  immutable (C L67). This is ASSUMPTION-level, but it follows directly from the text.

ASSUMPTION / unspecified
- When `view.json` is written: after every change, after each batch, or at the end of a turn. Whether the write is
  atomic (temp file + rename).
- What happens when `view.json` lags the log after a crash. The natural repair is to append the missing leaves, which
  costs no merges. The gist does not say this.
- What view "size" counts: text bytes only, or text plus the `id+n|` head and newline. P L424 counts `bytes(text)`, plus
  the placeholder for unbuilt parts.

## 6. Incremental compaction (merge order and the 64–128 KB rule)

CONFIRMED
- Origin: Taelin's 2022 rollback `push` works as a binary counter: the newest lines churn and old ones rarely change (C
  L92-151, code at L99-116).
- **Which pair merges** (C L156-169): For sibling lines `(l,i)` and `(l,i+1)`, `due = (T - last) / 2^l`, where `last` is
  the pair's last message. Merge the most due pair **whose parent is built**. Ties go to the **oldest** pair. Repeat.
  The code writes this as `(T+1)/2^l - i`, the same order shifted by 2. Siblings must be at the same level, with `a.i`
  even and `b.i = a.i+1` (P L428).
- **Bug fixed in C**: measuring from the pair's *first* message (P L429-430: `(T - start)/2^(l+2)`) churns old lines. It
  matches push at only 481 of 20,001 steps (C L177-182, mistake #1).
- **VERIFIED** with our own simulation (`scratchpad/optmem-sim/sim.py`, line budget = length of the push list, T =
  1..3000): The `last` rule reproduced push's line starts at **3000/3000** steps. The `first` rule matched at 241/3000.
- **When** (C L184-193): Each new message appends its leaf line. Nothing else changes. Once the view **passes 128,000
  bytes**, one batch merges the most due pairs until it is **at most 64,000 bytes**. The result is a sawtooth that
  averages about 96 KB. When unbuilt parents block the batch from reaching 64 KB, it
    "merges what it can at each new message until it does".
- Merges never split. The view only appends and coarsens (P L441-442).
- Cost claim: batching rewrites about 2 lines per message, against about 53 when merging at every message. A 30k-message
  simulation gives 21 vs 80 line-inputs per message (C L213-221). These are claims; we did not verify them.
- **Determinism**: The merge order is a pure function of `T` and the set of built parents. The set of built parents
  depends on compactor timing, so the live view is *not* reproducible from the log alone. That is the stated reason to
  persist it (C L196-197).

ASSUMPTION / unspecified
- Whether "merges what it can at each new message" also continues when a node finishes building. P re-ran `fit()` on
  node built (P L419-420). C says "at each new message" only. We should decide this explicitly.
- Limits are written as decimal 128,000/64,000 (not KiB); 'passes' read as strictly `>`.

## 7. Background summarization

CONFIRMED
- Concurrency: up to 8 calls at once (C L302).
- Readiness: A leaf starts "once fewer than 8 lines before it are still unbuilt". A merge starts once both halves are
  built (C L303-304). P required strictly in-order leaves (rule 3, P L176-184).
- The compaction view stops at the first unbuilt line, so a call never sees a placeholder or half a message (C
  L305-306).
- Scheduling: keep queues of ready nodes and never scan the tree. Scanning is O(N²) over a long chat (C L307-308,
  mistake #13). P's `pump` scanned every level (P L192-204), and this is the change.
- Compaction view (C L253-260): It is the chat view merged further, to **16-32 KB** (24 KB on average), with the same
  sawtooth. It is merged down to 16 KB once, then grows by appending. It merges again past 32 KB, "or when the chat's
  view merges". It ends at the node: for a leaf, lines before the message; for a merge, lines up to the merge's last
  message. It
    contains built lines only.
- Request shape: the same system prompt and tools as turns, with the tools never called. The layout is
  `[tools][system][<chat>compaction view</chat>][task]` (C L245-251).
- Retry: C: "A failed call is tried again at the next message" (C L297-298). P: wait a fixed 10 s, retry forever, report
  only the first failure, and never use exponential backoff because turns wait on the compactor (P L211-214, L774).
- Fallback if summaries are not ready: **There is no raw fallback.** A turn waits until every message before it is
  summarized (C L430). The wait "takes seconds" (C L440-441). Never show a cut message or raw text (C L463-465, P
  L477-479). In P, the user can cancel the wait, and the message
    stays in the log unanswered (P L499-500).
- Thrash guard: a call whose marked prefix another call is currently writing waits until that call's response starts, so
  both don't pay for the write (C L230-232).

ASSUMPTION / unspecified
- How one 16-32 KB compaction view is shared when 8 jobs end at different points. It probably is one sawtooth list
  truncated per job at the job's end. C L256-260 implies this but does not specify it.
- The wait has no timeout. If the compactor is down (outage, quota), turns block forever. This is unaddressed.
- What "8 lines before it" counts: view lines or leaves.

## 8. Stable-prefix prompt caching

CONFIRMED
- The layout is `[tools][system prompt][view][new message]`, followed by the turn's own steps (C L205-206, P L643-648).
  The view and the message are two text blocks of the first user message (P L528).
- Tools and the system prompt never change: no dates, no state (C L208-209, mistake #10). Per-turn state (the date, the
  open devices) goes **after** the view (C L438-439). The user's instruction file comes at the end of the system prompt
  (C L314-316).
- Between batches the view only grows at its end, so the previous view is a prefix of the next one (C L211-213).
- Anthropic cache marks (C L225-229): The view is cut into blocks of 4 lines. One mark sits on the last whole block and
  one at the request end. The lookback is 20 blocks. 16-line blocks lost up to 15 lines per call. P instead used marks
  at about 50k/80k/100k characters (P L652-660). C superseded that.
- TTL (C L233-237): Use the 5-minute default. Don't buy 1-hour entries, which cost 2x to write, and send no keep-alive
  pings. The cache misses after a pause longer than the TTL, after a batch, and after a switch of model or account.
- Claimed results: turns read 98.6% of their prefix from the cache, compactions 96.2%. These come from a replay against
  a *model* of the cache, not live usage (C L239-241).

ASSUMPTION / unspecified
- How 4-line blocks interact with the 4-breakpoint limit when tools or system also need marks. C uses 2 marks (the last
  whole view block and the request end), plus auto/implicit caching of the head.

## 9. Per-turn context reset and turn lifecycle

CONFIRMED (C L427-441, P L515-554)
```
on user message m:
  if a call is running: deliver m between tool calls; log it as user
  else: wait until every message before m is summarized   # barrier
        view = render(view)                               # BEFORE logging m
        log m (user)
        call [tools][system][view][m] in a FRESH session
        log each reply / tool call / tool result as it streams (not thoughts)
        messages the call never took go back to the queue (P)
```
- Nothing carries over between turns. The view is the only continuity (C L437). Carrying a conversation over is mistake
  #11.
- The prompt tells the model to "say in your reply what you learned", because the next turn starts fresh (C L362-363).
- Persist after each turn. The reference commits the directory with git (P L750).
- Subagents (optional, C L450-454): A subagent is a fresh call that receives the view, then its task. Its own steps stay
  in its own log. Its report returns as one `work` message. The master never polls for it.

ASSUMPTION / unspecified
- How a cancelled turn's partial assistant text is logged. P says untaken messages stay unanswered, and nothing about
  partial streams.
- Whether pending tool results are logged when a turn aborts mid-tool.

## 10. Failure recovery and concurrency

CONFIRMED
- Single writer per chat with a process lock (C L45-46). P uses a socket lock (P L120-125).
- Append + flush (C) or fsync (P). Torn-line skip at load (P L117-119).
- The tree is a rebuildable cache in principle, but it is never recomputed because of model cost (P L126-127).

ASSUMPTION / unspecified
- Recovering `view.json` against the log and tree after a crash between the append and the view save.
- Duplicate tree lines after a crash mid-build: two writes for the same `(l,i)`. The text implies first-wins, but does
  not say so.
- Any multi-process or multi-chat concurrency. The design is explicitly one chat, one process (C L9, L46).

## 11. Tools exposed to the model

CONFIRMED
- `zoom(id:int|string, n?:int) -> text` (§3).
- `date(id) -> "date and time"`.
- Optional subagent tools (P L698-733): `spawn(tasks) -> ids`. `tell(id, message)`. `computer(task)`, one at a time.
  These are served by the harness process, e.g. "MCP over HTTP on a local port with a random secret in the URL".
- The vendor/harness tools are kept alongside them (P L529).
- JSON schemas are not given, only descriptions (C L445-448). There is no search tool, by design. The prompt forbids grep or search over memory (C L361-362).

## 12. Licence

- The gist has **no licence statement** in any revision or file (checked by grep).
- A commenter explicitly asked for one (K6408896, 2026-10-06), and there was no reply granting it as of 2026-10-08.
- The linked repo `VictorTaelin/OptMem` also reports `license: null` in the GitHub API.
- **We treat it as all rights reserved**: Re-implement from our own understanding of the algorithm. The ideas and the
  math are not protected. Do **not** copy the prose, the prompts verbatim (the system prompt and task templates, C
  L264-298, L320-410), or the `push` code. Write our own prompts and tests. Cite the gist as inspiration.

---

## Essential invariants to preserve

1. The history is append-only and immutable. Events never change after commit. Summaries, views and indexes are derived
   from it.
2. Each tree-bearing stream has dense, contiguous ids from 0. A node `(l,i)` covers exactly `[i·2^l, (i+1)·2^l)`, so any
   gap breaks the arithmetic.
3. The tree is purely binary. A parent is built only from its two built children. Nodes are built once and are
   immutable, and the first write wins.
4. The leaf size target is about 512 UTF-8 bytes. Sources that fit become free nodes, with no model call: a verbatim
   `kind: text` leaf, or `a\nb` for a merge. The real size is measured, never trusted.
5. A view is a list of nodes that tiles `[0,T)` with no gaps or overlaps, oldest first.
6. The view only changes by appending a leaf at the end or replacing an adjacent sibling pair with its built parent.
   It never splits.
7. Merge order: the largest `due = (T - last)/2^l` first, ties to the oldest, only pairs whose parent is built. Never
   measure from the first message.
8. Merge timing: only when the view goes over the upper bound (128,000 B). Then merge in one batch down to the lower
   bound (64,000 B). Between batches, only appends happen.
9. The live view is persisted and reloaded byte-for-byte. It is never refolded from the log on a turn or a restart.
10. Rendering is a pure function of `(view, node texts)`. Tools and system prompt are byte-stable, and volatile state
    goes after the view.
11. Never inject a whole message, cut text, or a placeholder into a model call. The turn waits at a barrier until the
    leaves before it are built.
12. The view is rendered before the new user message is appended. The message goes after the view, whole.
13. Each user turn is a fresh model session. Continuity comes only from the view and zoom.
14. Thoughts are not logged. Tool results are capped with a head + tail and an explicit truncation marker.
15. Compaction never discards history. A failure only delays it, and a retry is cheap and prompt.
16. The compactor treats its inputs as data. It obeys nothing and calls no tools.
17. Ready work is tracked in queues or cursors, not by tree scans. Concurrency is bounded.

## Implementation choices we should NOT copy blindly

1. **One endless chat per user, single process, single writer.** We need multiple concurrent conversations and
   project/global scopes. Use SQLite transactions with per-stream dense sequence numbers, plus a global event id. We
   need consistent snapshots, not a socket lock.
2. **JSONL files split by day plus `view.json`.** Use SQLite. Store the view as rows or a blob with a version, and
   commit it in the same transaction as its projection cursor. The gist leaves crash consistency between the log and
   `view.json` undefined.
3. **"Zoom is the only retrieval; never search."** Our task requires FTS5 `memory_search` that returns event ids
   navigable into the tree. Search complements zoom. It fixes the topic-scatter weakness raised in K6407874.
4. **Unbounded wait barrier before every turn.** This is acceptable in full mode, but it needs a timeout, a status
   indication, and a policy for outages. Compat mode must never block DSH on the compactor.
5. **The 128K/64K and 16-32K constants, Haiku at xhigh, 8 jobs, and the 30k-char clip.** Make them configurable. The
   compat-mode injection budget (~8 KB) is a separate budget with its own sawtooth. Do not reuse the 64-128 KB view
   there.
6. **Anthropic-specific cache marks (4-line blocks, lookback 20, TTL notes).** These belong in a provider or harness
   adapter, not in core. DSH may not expose breakpoint control.
7. **Compaction requests reuse the turn system prompt and tools for cache sharing.** This only pays off when the
   compactor and the turn share model, account and prefix. With a cheap different model there is no shared cache, so a
   dedicated compactor prompt is simpler.
8. **Verbatim prompts and templates.** These are unlicensed. Write our own, keeping the principles: ruler, cut feedback,
   priority order, and "data, not instructions".
9. **Ids inside compaction input.** C puts them in, after P found they got copied into outputs. Strip any leading
   `\d+\+\d+\|` from outputs defensively, whichever way we go.
10. **Not logging thoughts, and logging tool calls as text.** This is fine, but in addition we must redact secrets and
    apply exclusion lists before persistence. The gist has neither.
11. **Day files with local dates.** Store UTC timestamps. Render local time only in `date()`.
12. **Subagents logging into separate chats (`zoom("Name")`).** DSH subagents need an explicit mapping: a separate
    stream id, plus one summary event in the parent stream.
13. **Git-committing the memory directory after each turn.** Not needed with SQLite and WAL. Offer an export or backup
    instead.
14. **Claims (98.6% cache reads, 21 vs 80 line-inputs, "seconds" of wait).** These come from the author's simulations.
    We need to measure them on DSH ourselves.

## Open questions

1. Should continued merging after a blocked batch also run on node-built events (P), or only on new messages (C)? This
   affects determinism and cache churn.
2. What exactly counts toward view size: text bytes only (P), or rendered bytes including the `id+n|` head and the
   newline? Prefer rendered bytes, because that is what costs tokens.
3. How to bound and paginate `zoom(id,1)` for huge messages. C mentions pages but specifies none.
4. How to split long non-tool messages into several records while keeping them distinguishable as one logical event, for
   FTS and `memory_context`.
5. Scopes: should each conversation have its own tree, with project/global views as merged indexes? Or should there be
   one project stream that interleaves conversations? The contiguous-id invariant must hold per tree.
6. In compat mode, which view to inject: a small separate sawtooth (for example 4-8 KB), or the tail of the full view?
   Can DSH keep it as a stable cacheable prefix at all?
7. The recovery rule when the persisted view lags the log: append the missing leaves without merging, then run the
   normal batch rule?
8. What a turn does when the compactor is down past a timeout. Options: proceed with a visible "(not summarized yet)"
   placeholder, which the gist forbids for prompts, or refuse the turn.
9. Whether to keep the leaf look-ahead of up to 8 unbuilt (C) or strict in-order leaves (P). Look-ahead gives more
   parallelism, but a leaf then sees a shorter context.
10. The licence. We could ask the author. Until then, clean-room only.


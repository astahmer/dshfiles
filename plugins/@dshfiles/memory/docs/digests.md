# Digests, in plain terms

For anyone using the Memory panel and wondering whether they have to digest anything, what it costs, and what happens
when a thread is missed. The technical record of the same behavior is in the [README](../README.md); why it is shaped
this way, and how it compares with native DSH, is in [findings.md](findings.md).

## What a digest is

One short plain-text record of a finished thread, kept in `~/.dsh/plugins/memory/memory.db`. It is what
`memory_search` returns and what the memory block at the start of a thread points at. It holds:

- a title, the project and the date: `Close the P1 backlog — dshfiles, 2026-10-16 (thread 3aa8670b)`;
- the status: `completed`, `unfinished, N open todo(s)` or `last turn failed: <error>`;
- what you asked for, in order and in your own words; a long thread keeps the first four requests and the last two;
- what you said that memory keeps verbatim, with the message number: corrections, decisions, preferences;
- the goal, the jj revision descriptions, the todos, the files changed and the agent's final answer.

A digest is at most 1,800 bytes. It is built from the thread's own log, and it is **not** a copy of the conversation:
the raw messages are indexed separately and read back from the log only when someone asks for them.

## When one is written

Nothing to do by hand; all of it is automatic.

| when                     | what happens                                                                   |
| ------------------------ | ------------------------------------------------------------------------------ |
| 60 s after a turn ends   | the digest is built, or updated if the thread already had one (`idleMs`)       |
| a new turn starts        | that wait is cancelled; the digest is rewritten at the next turn end           |
| DSH starts (+30 s)       | up to 25 sessions memory has never seen are digested, newest first             |
| blank or trivial threads | never digested: no user request, or one short request and no tool calls at all |

There is no button, tool or command that forces a digest, and that is deliberate: a digest is only useful once the
thread has stopped moving. `dshx sessions digest <id>` prints a summary of the same kind for a session you are
debugging, but it is a read-only view and stores nothing.

The **Digest** button in the Memory panel (sidebar → Memory → Threads) does not trigger anything either: it expands
the stored text. The line under a thread says when it was last digested and who wrote it, "from the thread record"
for the normal case or "written by a cheap model" when the thread left no trace of its own.

## If a thread is never digested

You lose three things: `memory_search` cannot find it, `memory_read("t:<id>")` has nothing to open, and later threads
get no pointer to it in the start block.

You keep the session log: the thread is still in the sidebar, `dshx sessions show` and `tail` still read it, and
nothing about the conversation is deleted.

It usually fixes itself, because the next turn end on that thread digests it and every DSH start catches up 25 older
sessions. Digests also expire: after `retentionDays` (365) a digest and its message index are pruned and the thread
becomes invisible to memory again, while its log stays.

## What it costs

- **A normal digest costs no tokens.** It is a local read of the session log inside the DSH process.
- **A thread with no trace of its own** needs one model call: no goal, no todos, no jj revision, no correction and no
  final answer worth 80 bytes. It runs with reasoning off, on the thread's provider and its first configured cheap
  model, which `summarizerProvider` / `summarizerModel` / `summarizerEffort` override. The Memory panel's Usage tab
  counts these as "Digest calls" and "Digest cost". Measured on the author's store on 2026-10-16: 530 digests, 26
  model calls, 16 of them stored, 12.7k input and 4.3k output tokens in total.
- **The start block is the real cost.** Every request, subagents included, carries up to `blockBytes` (1,600) of notes
  and thread pointers at the end of the system prompt — about 400 tokens. It is frozen per thread and byte-identical
  for every thread of a project until memory changes, so it sits in the provider's cached prefix instead of being paid
  for at full price. The Usage tab reports its size and how many requests carried it.
- **Nothing is injected while a thread runs.** The block is frozen at the thread's first prompt assembly, so a digest
  written during a thread reaches later threads, never the one that produced it.

## The knobs

On the Plugins page, namespace `dshfiles-memory`: `enabled` turns all of it off; `idleMs` (60,000) is how long a thread
waits before its digest; `blockBytes` (1,600) bounds the start block; `retentionDays` (365) is when digests are pruned;
`retrieval` (`bm25`, or `hybrid` with an `embeddingProvider` you install) picks the ranker; `jevEnabled` adds the
optional classifier.

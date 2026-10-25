# fff search

Agent `grep` and `glob` backed by a resident [fff](https://github.com/dmtrKovalenko/fff)
index (`@ff-labs/fff-node`, MIT, prebuilt per-platform libraries) instead of
the stock `@deepseek-ai/dsh-tool-fs-search`, which spawns ripgrep for every
call.

Why: on DeepSeek V4.1 Flash through DSH, with three Agents searching at once,
stock `grep` took 3-4 s median per call (9.4 s p90) on the welii corpus; this
bundle measured 0.36 s median (1.1 s p90), and search time per session fell
from 5.5 s to 0.7 s. See [plans/fff-search](../../../plans/fff-search/README.md).

## How it replaces the stock tools

The stock tools stay registered globally; the standard preset is untouched. On
every `agent/created` this bundle registers its own `grep` and `glob` through
`agent.ctx`, and an Agent-scoped tool shadows the global one of the same name.
The model sees the same names and arguments (`pattern`, `path`, `include`), so
the stock system-prompt guidance ("use the grep tool, not shell grep") still
applies. Agents created before the bundle loaded keep the stock tools until
their next start.

## Behavior

- fff-node queries are synchronous FFI calls, so every index lives in one
  worker thread (`dist/fff-worker.js`); the Host only posts messages and never
  blocks on a search. A crashed worker fails its pending calls and the next
  search starts a fresh one.
- One index per search root, built when an Agent starts (so the first search is
  usually warm) and dropped after 30 minutes without a search. Every jj thread
  workspace is its own root. A search that arrives before the content index is
  ready waits for it (about 5 s on 11.5k files).
- `grep` takes a Rust regular expression. fff reads path- or glob-shaped tokens
  (`src/`, `*.yml`, `!test/`) as constraints, so a pattern containing one is sent
  as a non-capturing group and stays a pattern. Other patterns go bare: the
  group defeats fff's literal prefilter (3-10x slower). An invalid expression is
  an error, not a literal search.
- `grep` returns up to 250 matches, most relevant files first (fff frecency),
  plus the total (counted up to 8 pages, then "more than N"). `glob` returns up
  to 100 paths plus the total.
- Both respect `.gitignore` and include hidden files that are not ignored.
  Stock `grep` skips hidden files; stock `glob` includes ignored ones.
- `path` expands `~`, and a path that does not exist is answered
  `path does not exist: <path>` instead of creating an index. A root outside the
  workspace that _contains_ it (`~/dev` from a thread workspace, `~`, `/`) is
  refused for the same reason fff refuses a home root: one search would index
  every checkout under it. Sibling checkouts and other outside roots still work.
- Frecency and query history live in `$DSH_HOME/plugins/fff-search/<root hash>/`.

## Verify

```sh
pnpm typecheck && pnpm test && pnpm build
fnm exec --using=22.23.3 node -e "import('./dist/index.js')"
```

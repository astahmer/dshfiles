# @dshfiles/mentions

One `@` menu for files and threads. It replaces the native `ui-reference`
source (disabled in `cordis.patch.yml`), which lists every file before any
thread.

- **Ranking:** match quality on the thread title or file basename (exact or
  exact stem, prefix, substring, then a path substring or fuzzy match), then
  recency (a file counts as touched today, so only a thread from the last hour
  outranks it), then the same workspace, then the same project. Ties
  alternate between the Host's own file order and the thread order, so
  neither kind always wins. Blank threads are hidden; the menu shows 40 rows.
- **Scopes:** `@thread:` / `@t:` lists threads only, `@file:` / `@f:` files
  only, plain `@` both. The section heading names the scope and the other
  prefixes. A directory drill keeps the typed prefix.
- **Native chips:** candidates come from `remote.fileReferences.list` and
  `remote.sessionReferenceResolver.candidates`, and picks insert
  `source: "reference"` chips, so copy, paste, preview and send-time
  serialization stay native. A scoped lookup skips the other Host call.
- **Timing:** each lookup records a `dshfiles-mentions:candidates`
  performance measure (`performance.getEntriesByName(...)` in the console).

The `@path` grammar and file address helpers are ported from
`@deepseek-ai/dsh-file-reference` and `@deepseek-ai/dsh-util-workspace-path`
(MIT): neither is a DSH Client module, so a plugin cannot import them.

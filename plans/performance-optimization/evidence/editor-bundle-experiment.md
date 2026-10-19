# Editor client bundle experiment — 2026-10-19

## Question

`@dshfiles/editor` ships the largest owned client bundle: **5,664,733 bytes** (5.66 MB), and the live profile loads
it at boot inside the 14.5 MB module request. Can it be cut without losing capability?

## Where the bytes are

`dist/client.js.map` (sourcemap build) carries 11.46 MB of `sourcesContent`:

| Source group                   | Sources  | Share |
| ------------------------------ | -------- | ----- |
| `monaco-editor`                | 11.24 MB | 98 %  |
| this plugin's own `src/`       | 118 KB   | 1 %   |
| dshx runtime + everything else | ~100 KB  | 1 %   |

Inside monaco: `editor/contrib` 2.89 MB, `editor/common` 2.22 MB, `editor/browser` 1.71 MB, `platform` 1.19 MB,
`base/browser` 1.14 MB, `base/common` 0.97 MB, `editor/standalone` 0.26 MB. An import-graph walk over monaco's ESM
confirms `editor/editor.api` alone reaches 7.36 MB of sources, `features/register.all` 9.60 MB,
`languages/definitions/register.all` 8.04 MB and `languages/features/json/register` 10.83 MB, and that `editor.api`
registers none of find, folding, hover or suggest — they only arrive through `features/register.all`.

The plugin already lazy-imports the engine (`const loadEngine = () => import('./monaco-engine.js')`), which changes
nothing: dshx emits one client chunk.

## What was measured

Each variant was built with `dshx build` in this thread's workspace; the number is `dist/client.js` on disk.

| Variant                                                                                                                                                                                                                                                                                                                                                                                      | Bytes                                  | Delta       | Cost                                                                                                                                   |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- | ----------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| As shipped                                                                                                                                                                                                                                                                                                                                                                                   | 5,664,733                              | —           | —                                                                                                                                      |
| Curated feature registration: drop 24 provider-driven or dev-only contributions (code actions, code lens, rename, format, parameter/inlay hints, inline completions, semantic tokens, diff editor, colour picker, document symbols, go-to-definition, reference search, dev token inspector, iPad keyboard, linked editing, in-place replace, floating menu, inline progress, anchor select) | 5,664,565                              | **−168 B**  | none visible; but the JSON service and the language definitions already pull almost everything those contributions pulled              |
| No JSON language service and no inline JSON worker (`languages/features/json/register` + `json.worker?worker&inline`)                                                                                                                                                                                                                                                                        | 5,174,809                              | **−490 KB** | monaco has no JSON grammar under `languages/definitions`, so JSON files lose highlighting **and** validation                           |
| Language definitions trimmed to 36 of 84 (`languages/definitions/<lang>/register`)                                                                                                                                                                                                                                                                                                           | build failed on an invalid language id | —           | the whole `register.all` set is only ~0.7 MB of sources (~0.35 MB minified); dropping languages costs colouring for every dropped type |

Conclusion: the bundle is **capability**, not waste. The feature-registration trim is churn for 168 bytes, so it was
reverted; no change ships from this experiment.

## Why lazy loading is not an option yet

1. dshx pins the client output to a single chunk — `codeSplitting: false` in
   `tooling/dshx/packages/dshx/src/compiler/client/build.ts` (and the kernel boundary rejects `manualChunks`).
2. The Host serves no per-file plugin route: `GET /plugins/@dshfiles/editor/client.js` and
   `/plugins/@dshfiles/editor/dist/client.js` both answer **404** on the live instance; only
   `/plugins/??<comma-separated ids>&rev=<rev>` concatenates the modules a page needs.

So a second chunk would have nowhere to be fetched from. Recorded as a Host gap in
[`../../dsh-host-gaps.md`](../../dsh-host-gaps.md).

## What this leaves

- A product call, not an engineering one: dropping JSON support saves 490 KB (8.6 %) and costs JSON highlighting and
  validation. Not worth it in this repository, whose files are mostly JSON/YAML/TS.
- The next measured lever is duplication _between_ plugins rather than inside one: 28 of 48 owned plugin directories
  declare `client.shared: '@dshfiles/shared-runtime'`; the rest bundle their own copies of what that supplier already
  serves (plan entry C-series). That is the next investigation, not another Monaco trim.

# Bundle weight: lazy-loading what-if and shared-runtime dedup — 2026-10-19

All numbers measured on this machine on 2026-10-19; byte counts are `stat`/`curl`/`gzip -9` results, not estimates,
unless a line says "extrapolated".

## 1. What lazy-loading a heavy plugin would save

The live page loads the client roster in three requests (decoded sizes from `curl`, transfer sizes from the server's
own compressed response):

| Request                                                           | Decoded  | Server transfer |
| ----------------------------------------------------------------- | -------- | --------------- |
| `/plugins/??…` bundle 1 (core clients + our light plugins)        | 10.29 MB | 4.57 MB         |
| `/plugins/??…` bundle 2 (39 modules, includes `@dshfiles/editor`) | 14.49 MB | 4.23 MB         |
| `/plugins/??…` bundle 3 (`dsh-client-modules`)                    | 46 KB    | 15 KB           |

`@dshfiles/editor/client.js` alone:

| Measure   | Value       | Share of bundle 2                   |
| --------- | ----------- | ----------------------------------- |
| decoded   | 5,664,733 B | **39.1 %**                          |
| `gzip -9` | 1,515,831 B | **35.9 %** of the server's transfer |

So fetching the editor's code only when its surface first opens would remove about **5.66 MB decoded and 1.52 MB of
transfer from first paint** — the single largest lever found in this audit. The engine's _evaluation_ is already
deferred (`import('./monaco-engine.js')` compiles to a lazy initializer in the emitted chunk); what is not deferred is
the transfer and parse of its 5.66 MB, because dshx inlines every dynamic import into the one `client.js`.

It cannot be built today:

- dshx sets `codeSplitting: false` for the client output (`tooling/dshx/packages/dshx/src/compiler/client/build.ts`)
  and the compiler kernel rejects `manualChunks`.
- The Host serves no per-file or per-module route. Measured against the live instance: a single-module request
  (`/plugins/??@dshfiles/editor/client.js&rev=…`) and a roster with one id removed both answer **404**; the roster and
  its `rev` are validated together, so a second chunk could not be fetched even by hand.
  `/plugins/@dshfiles/editor/client.js` answers 404 as well.

Recorded as a Host gap (chunk emission plus a route that serves chunks).

## 2. Shared-runtime duplication between plugins

`@dshfiles/shared-runtime` provides 55 third-party modules (radix, tanstack, zod, xstate, clsx, tailwind-merge, cmdk)
for consumers that declare `client.shared`. Of the 43 owned plugins with a client sourcemap, **28 declare it and 15 do
not**; those 15 inline their own copies.

Measured from the sourcemaps: non-declaring plugins inline **4.26 MB of source bytes** of modules the supplier already
provides, of which 1.56 MB is the supplier's own legitimate copy — about **2.70 MB of duplicated sources** across 14
plugins. Biggest offenders: privacy-controls 630 KB, workspace-folder-picker 613 KB, pulls-review 532 KB,
rich-composer 295 KB, frame-layout 270 KB, model-effort-picker 241 KB.

Build deltas after adding `client.shared` + the dependency (measured with `dshx build` in this thread's workspace, then
reverted):

| Plugin           | Before      | After       | Delta                  |
| ---------------- | ----------- | ----------- | ---------------------- |
| privacy-controls | 220,688 B   | 58,764 B    | **−161,924 B (−73 %)** |
| rich-composer    | 536,731 B   | 456,233 B   | **−80,498 B (−15 %)**  |
| pulls-review     | 1,646,346 B | 1,512,914 B | **−133,432 B (−8 %)**  |

Three of fourteen plugins: **−375,854 B**. The remaining eleven inline less of the provided set (the sourcemap ranking
puts them at roughly half of those three), so the whole change is worth about **0.5–0.8 MB off the 24.8 MB decoded
payload (~3 %)**, or roughly 0.2 MB of transfer. Cost: a dependency, a `dsh.client.external` entry and a `shared` field
per plugin, a lockfile update and a rebuild.

## 3. Ranked outcome

1. **1.52 MB of transfer at first paint** — lazy chunk for a heavy plugin; needs the Host chunk route (core/dshx).
2. **0.5–0.8 MB decoded (~0.2 MB transfer)** — declare `client.shared` in the 14 stragglers; config-only but a lockfile
   and 14 manifests change for ~3 %.
3. **Nothing** — trimming Monaco's registration (168 B) or dropping its JSON service (490 KB) both cost capability; the
   editor's 5.66 MB is feature weight, not waste.

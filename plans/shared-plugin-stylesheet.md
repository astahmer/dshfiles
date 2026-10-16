# One shared plugin-ui stylesheet, one injection point

Owner docs: [`docs/e2e-testing.md`](../docs/e2e-testing.md#cached-browser-tasks)
(cached browser tasks), [`plugins/@dshfiles/plugin-ui/src/styles.css`](../plugins/@dshfiles/plugin-ui/src/styles.css)
(the sheet contract), [`.agents/skills/plugin-ui/SKILL.md`](../.agents/skills/plugin-ui/SKILL.md)
("Rebuild every UI plugin after any class change").

This plan is about **build and check fan-out**, not about how the sheet looks.
The runtime already injects one sheet; the problem is that every UI bundle
still carries a byte that changes with its content.

## Problem

Measured: adding one otherwise-unused Tailwind class (`dshx:contrast-125`) to
`plugins/@dshfiles/tool-meta/src/tool-call-tree.tsx` changed
`plugins/@dshfiles/usage/dist/client.js` (sha256 prefix `552705dcf2c3209c` →
`1145aa4c002f73b8`); restoring the source restored the original bytes exactly.

Consequences today, per the caching design these bytes feed:

- `tooling/dshx/scripts/browser-tasks.mjs` keys every `test:boot` /
  `test:e2e` task on a digest of each booted bundle's runtime `dist`
  (`.turbo/browser-dist/dshfiles__<name>.sha256`). A class change anywhere
  moves 29 of the 37 built `dist/client.js` files, so all 41 boot checks and
  every journey task invalidate: measured at ~4m16s serial for the boot gate,
  and 2m15s–3m31s at the default concurrency of 3 on the same machine.
- Every UI package's build re-runs (`@dshfiles/plugin-ui#build` is configured
  with `$TURBO_ROOT$/plugins/@dshfiles/**` as inputs precisely because
  "plugin-ui's build reads every plugin's sources for the shared stylesheet,
  so build hashes all move together" — `turbo.json`,
  `tooling/dshx/scripts/browser-tasks.mjs:8`).
- `docs/e2e-testing.md` documents the opposite of what is true: "every build
  hash moves together while most bundles' `dist` does not". A class change is
  exactly the case where most bundles' `dist` *does* move.

## Mechanism (established from source)

1. Every UI plugin's client entry does `import './client.css'`, and each
   `src/client.css` is `@import '@dshfiles/plugin-ui/styles.css';` plus
   `@source './'`. 32 plugins match this, 37 have `dist/client.js`.
2. `plugin-ui/styles.css` itself adds `@source '../..'` — read relative to
   `plugins/@dshfiles/plugin-ui/src/`, that is **every owned plugin**. So all
   32 copies compile to the same union sheet containing every class used
   anywhere under `plugins/@dshfiles`. That is deliberate (see the quoted
   constraint below).
3. `@tailwindcss/vite` (via `pluginUiVite()`) emits one CSS asset per client
   build (`cssCodeSplit: false`). `dshx`'s
   `tooling/dshx/packages/dshx/src/compiler/client/css.ts` folds it into
   `dist/client.js`: the asset is deleted from the bundle and a materializer
   snippet is written just before the lazy factory's return.
4. The materializer hashes the compiled sheet
   (`sha256(css).slice(0,16)`) and, on load:
   - always appends an ownership marker `<style data-plugin="<pkg>"
     data-plugin-css="<pkg>/client.css" data-dshx-css="<hash>">`;
   - appends the shared sheet `<style data-plugin="dshx:shared-css"
     data-dshx-shared-css="<hash>">` with the **full CSS text** only if it is
     not already in the DOM;
   - a `MutationObserver` on `document.head` removes a shared sheet once no
     marker with its hash remains.
5. `@dshfiles/shared-runtime` is the shared-runtime supplier
   (`client.sharedRuntime.provide`, `plugins/@dshfiles/shared-runtime/dshx.config.ts`).
   It writes `dist/shared-runtime.json` with `{ supplier, modules, cssHash }`.
   28 consumers set `client: { shared: '@dshfiles/shared-runtime' }`; their
   `css.ts` `suppliedHash` matches, so **they do not inline the sheet text** —
   only the marker (which embeds the hash) plus observer bootstrap.

Measured on the current `dist` (37 built `client.js`):

- **8** bundles carry sheet text (a top-level `@layer` rule): `shared-runtime`,
  `attachment-gallery`, `jujutsu`, `memory`, `model-effort-picker`,
  `privacy-controls`, `thread-sidebar`, `workspace-folder-picker`;
- the other **29** carry no sheet text, only the 16-hex literal
  `173f364fc565fe2e` — once in `usage/dist/client.js` — which
  `shared-runtime/dist/shared-runtime.json` records as `cssHash`.

So the deviation from "CSS text inlined into each client.js" matters: the
sheet payload is already deduplicated. **The remaining coupling is the 16-hex
content hash literal in every consumer bundle.** One class anywhere changes
the union sheet → every consumer's hash literal changes → every
`dist/client.js` changes → every cached browser task invalidates.

## The cascade constraint (must be preserved)

From `plugins/@dshfiles/plugin-ui/src/styles.css:10-14`:

> Every plugin injects its own copy of this sheet, and same-specificity rules
> resolve by sheet order. Scanning every owned plugin makes all copies
> identical, so a later plugin's base rule can never override an earlier
> plugin's responsive/state variant (e.g. `max-w-[…]` beating `sm:max-w-2xl`).

And from the skill, the failure mode: "Change a class in one plugin and
rebuild only that one → the hashes diverge, several sheets load, and
same-specificity rules resolve by sheet order".

Any option below must keep **the union of all plugin sources in exactly one
ordered rule set**. Two divergent sheet copies in the DOM is the regression.

## Design options

### A. Keep per-plugin sheets, stop embedding the hash (small, dshx-only)

When a consumer's compiled hash equals the supplier's manifest `cssHash`,
`css.ts` emits **nothing for the sheet and no marker**; the supplier owns
injection and, because its own marker plus sheet are disposed together, owns
removal. The consumer bundle then contains no sheet-derived bytes at all.

- Cascade: unchanged in the steady state — one sheet, one owner, the same
  union ordering. The observer/per-plugin disposal bookkeeping becomes
  unnecessary for consumers and is deleted only on that path.
- Stale-supplier case (hash mismatch): keep today's fallback (inline + marker)
  or make it a build error; either way it is visible instead of silent.
- Win: 29 of the 37 bundles become byte-stable across sheet changes → 29 boot
  tasks replay from cache, and only the supplier + the edited plugin rebuild
  *outputs*. Builds still all re-run (Tailwind still compiles the union sheet
  32 times), so build wall time is unchanged.
- The 8 inliners keep the full sheet and keep invalidating; ≈8 × 6 s ≈ 16 s at
  concurrency 3, down from ≈1m30s.

### B. One artifact owns the sheet; every other plugin ships no CSS

Same as A, but also remove the union compile from consumers: they drop
`import './client.css'` (or the file keeps only plugin-specific
`@source './'` if ever needed), and the supplier — or a dedicated
`@dshfiles/ui-styles` bundle that only compiles + injects the sheet — is the
single artifact. The 8 inliners become sheet consumers too
(`client.shared: '@dshfiles/shared-runtime'` is one config line, or
`client.external` + dep for a dedicated styles bundle).

- Cascade: strongest form. Exactly one compiled sheet exists, so "all copies
  identical" is true by construction rather than by build discipline; the
  `max-w-[…]` vs `sm:max-w-2xl` hazard cannot arise.
- Win: all 37 UI bundles byte-stable across sheet changes; 32 Tailwind union
  passes become 1; a class change rebuilds one package. Boot gate fully
  cached except the supplier.
- Cost/risk: every UI plugin now depends on the sheet owner being loaded
  first. In an isolated composition (`bootPluginProfile('@dshfiles/x')`,
  `tooling/dshx/e2e/support/boot.ts:172`) a consumer would have **no styles at
  all** unless the composition adds the sheet owner. That is a dshx-side fix
  (`prepareComposedBootProfile` already accepts `additionalBundleIds`), not a
  Host one, but it must land with the first consumer or the boot gate stops
  covering anything visual.
- The 28 existing consumers of `shared-runtime` are modules consumers; a
  dedicated styles bundle keeps style ownership separate from the module
  table (which is large and rebuilt for unrelated reasons).

### C. Host-served stylesheet

One `<link rel="stylesheet">` (or a Host-injected `<style>`) served once per
boot instead of per bundle. It is the only option that removes the sheet from
every client bundle *and* the hash from every fingerprint, and it is the only
one that needs a capability we do not have: DSH exposes no plugin API to
register a global stylesheet or to add a Host route for one, and no shell-level
"core CSS" contribution point. This belongs in
[`plans/dsh-host-gaps.md`](dsh-host-gaps.md) as a concrete gap ("no
plugin-contributed global stylesheet / Host-served static asset") if we want
it, not as a workaround (a plugin could ship an injected `<link>` to a data:
URL, but that is still one bundle owning it — i.e. option B with extra
steps). **No core patch.**

### D. Keep today's design and accept the cost

Nothing changes; every class change costs a full rebuild plus all 41 boots and
every journey task. Mitigations that already exist: `--force`-free normal runs
replay *unchanged* tasks, `check:diff` scopes lint/format, and the boot gate
runs 3 at a time. This is the honest baseline, and it is not crazy — but the
measured cascade is exactly the case the caching design claims to avoid, and
the docs state the opposite of reality, which will keep mislead agents into
"it's cached, I don't need to rebuild".

### Recommendation

**A now, B next, C only if the gap is filed.** A is a change inside one dshx
file plus its tests: it restores the premise `docs/e2e-testing.md` already
assumes (bundle bytes stable unless the bundle's own code changed) and removes
~1.5 min of boot-gate re-runs per class change without touching plugin sources
or the composition. B is the real fix (one compile, one owner) but it changes
what an isolated boot means, so it needs the composition work in the same
step. C is not available on stock DSH; file it, do not fake it.

## dshx-side vs Host/core-side

- **We own (tooling/dshx)**: `compiler/client/css.ts` (marker/emission
  policy), `compiler/client/build.ts` (passing `suppliedHash`), the shared
  runtime manifest and consumer wiring, `browser-tasks.mjs` and the generated
  per-package `turbo.json` keys, `e2e/support/boot.ts` composition.
- **We own (plugin-ui / plugins)**: `styles.css` `@source` set, the per-plugin
  `client.css` imports, `dshx.config.ts` `client.shared` /
  `client.external` declarations, `plugins/@dshfiles/shared-runtime`.
- **Host/core (do not patch)**: anything that would let a plugin contribute a
  global stylesheet to the shell. Not needed by A or B; C requires it and is a
  gap entry, not an implementation.

## Expected effects

| | turbo build keys | client payload | boot gate |
|---|---|---|---|
| today | every UI build key moves | 8 bundles carry the sheet, 29 carry one 16-hex hash | 41/41 boot tasks rerun, ~4m16s serial |
| A | still every UI build key moves (fingerprint unchanged); only supplier + edited plugin rewrite `dist` | 29 bundles lose the hash literal; 8 unchanged | ~8/41 rerun (supplier + the 8 inliners), ~16 s at concurrency 3 |
| B | only the sheet owner's key should move — drop/replace the `@dshfiles/plugin-ui#build` fingerprint | sheet text once, in one bundle; no hash anywhere else | 1/41 rerun |

Payload note: A removes one 16-character literal per consumer bundle — well
under a kilobyte in total; the sheet text was already single-copy. The win is
fingerprints, not bytes — do not sell it as a bundle-size change.

## Phases

### Phase 0 — pin the current behaviour with a test (no policy change)

- [ ] Add a dshx unit test (next to
  `tooling/dshx/packages/dshx/tests/client-build.spec.ts`) that builds a
  fixture consumer twice — once with an unrelated plugin source class added —
  and asserts the current outcome (consumer `client.js` differs only in the
  hash literals; supplier differs in sheet text). This is the regression
  receipt for Phase 1.
  - Verify: `pnpm --dir tooling/dshx test --run client-build` passes, and
    fails if the brittle behaviour is later re-introduced silently.
- [ ] Record a baseline: `node scripts/check-browser.mjs boot` wall time and
  the number of rerun tasks after toggling one class in an unrelated plugin.
  - Verify: the number matches the 41-rerun expectation or the plan is wrong.

### Phase 1 — hash-free consumers (option A)

- [ ] In `compiler/client/css.ts`, when `suppliedHash === hash`, emit neither
  the shared sheet nor a consumer marker: the supplier owns both. Keep a
  fallback for the mismatch case (current behaviour, or a `DSHX11xx` build
  error suggesting "rebuild the supplier" — decide by whether any real
  workspace can legitimately be stale).
  - Verify: with the supplier built, `sha256sum plugins/@dshfiles/usage/dist/client.js`
    is unchanged after adding/removing a class in `tool-meta`; with the
    supplier manifest deleted or stale, the mismatch path is exercised and
    reported.
- [ ] Update the shared-sheet disposal logic so the supplier's own marker is
  the only owner and the observer never removes a sheet another live marker
  needs. Keep the observer version key (`dshx.sharedCss.v1`) or bump it,
  documenting what changes across versions so an old Host client and a new
  bundle can coexist (HMR runs old + new clients side by side).
  - Verify: existing `palette-performance.feature` "exactly one shared plugin
    stylesheet" assertion still passes in a composed scratch boot.
- [ ] Keep the 8 inliners honest: assert in a test that at most those bundles
  inline sheet text, so a new plugin silently opting out is caught.
  - Verify: the assertion lists exactly the non-consumer set; adding a UI
    plugin without `client.shared` and without a deliberate inline makes it
    fail (then either give it the supplier or extend the allowlist on purpose).

### Phase 2 — one owner for the sheet (option B), only after Phase 1 is measured

- [ ] Pick the owner: the existing `@dshfiles/shared-runtime` (no new row,
  but couples style to the module table) or a dedicated
  `@dshfiles/ui-styles` bundle (new row, new contract surface, cleaner
  ownership). Recommendation: the dedicated bundle, because rebuilding the
  module table's 950 KB bundle for a CSS change is the wrong blast radius.
- [ ] Drop the sheet import from every other UI plugin and make the composed
  boot include the owner automatically (`prepareComposedBootProfile` /
  `additionalBundleIds`) so `bootPluginProfile('@dshfiles/x')` stays styled.
  - Verify: `pnpm check:e2e <plugin>` green for a plugin booted isolated, with
    a screenshot/`getComputedStyle` check on a plugin-ui component (the
    browser-debugging skill pattern), not just "it mounted".
- [ ] Remove the `@dshfiles/plugin-ui#build` `$TURBO_ROOT$/plugins/@dshfiles/**`
  fingerprint from `turbo.json` (its justification disappears once one package
  compiles the sheet) and regenerate `browser-tasks.mjs --write` output.
  - Verify: toggling a class in `tool-meta` changes only the owner's
    `dist`, only `dshfiles__ui-styles.sha256`, and re-runs exactly one boot
    task plus `tool-meta`'s own.

### Phase 3 — docs

- [ ] Update `docs/e2e-testing.md` and the `browser-tasks.mjs` header to the
  owner model once Phase 2 lands: the measured coupling is already stated
  there, but the "rebuild after a class change" instruction still names every
  UI plugin.
- [ ] Update the plugin-ui skill: the "rebuild every UI plugin after a class
  change" loop becomes "rebuild the sheet owner (and the plugin you changed)"
  once Phase 2 lands.

## Risks

1. **Two sheets, order-dependent cascade** — the documented failure
   (`max-w-[…]` beating `sm:max-w-2xl`). Phase 1's mismatch fallback *keeps*
   the old inline path, so a stale supplier still produces two sheets; Phase 2
   removes the second compile entirely. Detection: the existing
   `palette-performance.feature` one-sheet assertion, plus a targeted check on
   a component whose utility has a base/`sm:` pair, computed-style compared in
   both sheet-order directions.
2. **Unstyled isolated boots** — Phase 2 without the composition fix makes a
   single-plugin scratch profile unstyled. Detection: an isolated boot
   screenshot + `getComputedStyle` assertion, and a boot-gate step that fails
   when a client plugin resolves to zero stylesheets.
3. **Old-Host/new-client coexistence (HMR)** — the live DSH keeps the old Host
   with new bundles. Any change to the marker/observer protocol must tolerate
   both directions; bump or keep the `dshx.sharedCss.v1` key deliberately.
4. **Cache staleness masquerading as success** — turbo may replay a consumer
   build whose compiled union sheet is stale, producing a hash mismatch and
   the fallback path. Today that is silent; Phase 0's receipt plus a
   mismatch-error option makes it loud.
5. **Over-claiming the win** — A's payload saving is ~1.4 KB total. The win is
   cached browser tasks; if the measured boot-gate rerun count does not drop,
   stop and re-measure before doing Phase 2.

## Non-goals

- Changing how the sheet looks, its `@source` union, or the `dshx:` prefix
  rules.
- Replacing Tailwind or the shadcn kit, or introducing a runtime CSS-in-JS
  theme layer.
- Any DSH core patch, plugin-side Host route, or `as unknown as` shim to get a
  served stylesheet (option C is a gap entry, nothing else).
- Removing the per-plugin sheet contract before Phase 1's test proves the
  current coupling, so the receipt exists either way.

## Open questions

1. Is a stale-supplier hash mismatch ever legitimate across a normal
   `turbo`/`profile:sync` run? If never, make it a build error in Phase 1;
   if sometimes, keep the fallback and accept 2 sheets transiently.
2. `@dshfiles/shared-runtime` vs a dedicated `@dshfiles/ui-styles` bundle —
   the answer changes the profile/contract surface, so decide with the Phase 1
   measurement in hand.
3. Does the boot gate need a stronger assertion than "it mounted" so an
   unstyled plugin cannot pass Phase 2?

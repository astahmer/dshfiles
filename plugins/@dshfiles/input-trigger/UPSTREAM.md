# Upstream provenance

This plugin vendors DSH's `packages/client/ui-input-trigger` from the `dsh-v0.2.0-rc.2` tag of [deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness), commit `639ed015397290b3745d163aafe02ffee4aa3f84`. The upstream package is MIT-licensed; the corresponding license text is retained in [`UPSTREAM-LICENSE`](./UPSTREAM-LICENSE).

The behavioral delta is intentionally narrow: the unquoted `@` detector resolves the caret token with Codex's completion-target rules (`src/caret-token.ts`, ported from openai/codex, Apache-2.0) and spans the whole token, while keeping the existing quoted grammar, `@` token boundary, slash-token behavior, controller lifecycle, menu, keyboard routing, and source contract. Relative TypeScript imports are normalized to `.js` for this workspace's NodeNext build and published type surface. The client bundles browser-safe `dsh-util-values` locally because that utility is not materialized by every DSH profile's client module table.

## Carried from a later upstream revision

`InputTriggerController.resolveClaim` and `InputTriggerSource.matchClaim` were ported from the installed `@deepseek-ai/dsh-client-ui-input-trigger` (0.2.1-rc.2). The vendored `dsh-v0.2.0-rc.2` snapshot predates them, and the conversation input shell calls `resolveClaim` unguarded when it restores a persisted command chip — without it, seeding any draft whose leading token is a `/` command throws `TypeError: inputTriggers.resolveClaim is not a function` inside a `client-store` subscriber and the chip never rebuilds. Sources that answer `matchEnter` for a bare token should answer `matchClaim` for the same spelling; a source that would act on the token must answer `undefined` (see the hook's doc in [`src/types.ts`](./src/types.ts)).

## Warm on first input

Upstream warms every source when an `InputTriggerController` is born, and one is born with every Session scope: each
thread switch fetched every catalog (`skills/list`, `commands/list`, …) whether or not the reader typed a trigger.
`controller.ts` warms the roster on the first non-empty draft instead (`warmOnce`), and a source registered before
that is warmed with the rest; `tests/warm.test.ts` covers it.

## Update policy

When the profile moves to another DSH release, compare this package against that release's `packages/client/ui-input-trigger` tree. Carry upstream fixes and contract changes first, then reapply the documented detector delta and its regression tests. Do not silently replace the fork with the native Loader row; validate all registered `/` and `@` sources before changing the pinned upstream version.

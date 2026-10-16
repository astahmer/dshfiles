# Upstream provenance

This plugin vendors DSH's `packages/client/ui-input-trigger` from the `dsh-v0.2.0-rc.2` tag of [deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness), commit `639ed015397290b3745d163aafe02ffee4aa3f84`. The upstream package is MIT-licensed; the corresponding license text is retained in [`UPSTREAM-LICENSE`](./UPSTREAM-LICENSE).

The behavioral delta is intentionally narrow: the `@` detector accepts an unquoted same-line query containing spaces, while keeping the existing quoted grammar, `@` token boundary, slash-token behavior, controller lifecycle, menu, keyboard routing, and source contract. Relative TypeScript imports are normalized to `.js` for this workspace's NodeNext build and published type surface. The client bundles browser-safe `dsh-util-values` locally because that utility is not materialized by every DSH profile's client module table.

## Update policy

When the profile moves to another DSH release, compare this package against that release's `packages/client/ui-input-trigger` tree. Carry upstream fixes and contract changes first, then reapply the documented detector delta and its regression tests. Do not silently replace the fork with the native Loader row; validate all registered `/` and `@` sources before changing the pinned upstream version.

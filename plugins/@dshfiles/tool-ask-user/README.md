# @dshfiles/tool-ask-user

Owned Host fork of DSH's `@deepseek-ai/dsh-tool-ask-user` package, the model-facing `ask_user_question` tool. Its
only change is description text: the model learns that questions and option descriptions are Markdown and how to embed
a sandboxed ` ```html preview ` view, which the [`@dshfiles/user-questions`](../user-questions) form renders
(b:6). The schema, validation, timed wait and answer encoding are upstream's, byte for byte.

- Upstream: [`deepseek-ai/deepseek-harness`](https://github.com/deepseek-ai/deepseek-harness), `packages/interaction/tool-ask-user`
- Package: `@deepseek-ai/dsh-tool-ask-user@0.2.1-rc.2`
- Pinned revision: tag `dsh-v0.2.1-rc.2` (`687f282e8625c6b8d11ff58211a90524be2e4317`)
- License: MIT, see [LICENSE](LICENSE)

## Why a fork

The tool's description lives in its own package and DSH has no hook to amend a registered tool's description. The
`question` text is the only rich field that survives every path to the form: the timed tool forwards known fields
only and the Host `userQuestions` projection keeps `question` and option `description` while stripping anything else,
so a separate `preview` field could not reach a continued form. Markdown in those two fields needs no schema change.

## Local delta

| File                       | Change                                                                                                                |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `src/native/index.ts`      | legacy tool: description and the `question` / option `description` field descriptions from `src/markdown-guidance.ts` |
| `src/native/timed.ts`      | timed tool: the same three description texts                                                                          |
| `src/markdown-guidance.ts` | owned: the description text (Markdown fields, `html preview` fences, no network, no same-origin)                      |

`src/schema.test.ts` proves the timed tool the web profile runs registers upstream's schema once descriptions are
removed, and carries the markdown text; the legacy tool reads the same three constants.

## Wiring

The tool is a child of the `preset-standard` agent preset, not a global Loader row (mounting it globally would add it
to every agent whatever its preset), so this bundle's `cordis.patch.yml` inserts nothing. `profiles/web/cordis.patch.yml`
names `@dshfiles/tool-ask-user` for the preset's `tool-ask-user` child. That row sits outside the managed region, so an
existing profile keeps the native tool until its own `preset-standard` row gets the same one-line `name` edit; the
Host must restart for either change.

## Updating from DSH

```sh
node scripts/native-fork-diff.mjs tool-ask-user --to <new-tag>
```

Copy the files listed under `copy`, reapply the three description replacements to the files under `reapplyDelta`,
update this pin and `native-fork.json`, then type-check, test (the schema-equality test catches a changed upstream
schema), build and boot-check in a scratch profile. Drop the fork when upstream documents markdown questions itself.

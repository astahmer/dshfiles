# @dshfiles/rich-composer

Owned fork of DSH's native Conversation client plugin. It preserves the full native shell, services, Slots and composer, while recognizing canonical session-reference wire text on paste and inserting it as a structured reference chip. Plain text is preferred; when only HTML is available, session-link anchors are converted to canonical mention text and other markup is reduced to safe text.

## Upstream and license

- Upstream: [`deepseek-ai/deepseek-harness`](https://github.com/deepseek-ai/deepseek-harness)
- Package: `@deepseek-ai/dsh-client-ui-conversation@0.2.0-rc.2` (MIT)
- Client source: `packages/client/ui-conversation/src/client`
- Shared settings source: `packages/client/ui-conversation/src/submission-settings.ts`
- Pinned revision: [`c1b47e41fcd54d20a0f061df28683bfc29ee24e5`](https://github.com/deepseek-ai/deepseek-harness/commit/c1b47e41fcd54d20a0f061df28683bfc29ee24e5), `release(dsh): 0.2.0-rc.2`
- The complete client source is vendored in [`src/native`](./src/native) (upstream `src/client`) plus [`src/submission-settings.ts`](./src/submission-settings.ts) (upstream `src/submission-settings.ts`), keeping the upstream relative layout.

### Local delta

Every other vendored file is byte-identical to the pinned revision, so an upstream update starts from a real `diff`. The whole delta is:

| File                                      | Change                                                                       |
| ----------------------------------------- | ---------------------------------------------------------------------------- |
| `src/native/contract/slots.ts`            | `ComposerBarInjected` gains `insertReference`                                |
| `src/native/apply.ts`                     | injects that action from the session's `conversation.input` facade           |
| `src/native/skeleton/InputBar.tsx`        | paste converts canonical mentions into reference chips, falling back to text |
| `src/native/input/editor/keymap.ts`       | reads `text/html` when the clipboard has no plain text                       |
| `src/native/input/editor/view-binding.ts` | routes the paste handler through the bar's live handler                      |
| `src/paste-references.ts`                 | new: canonical wire-text parser and reference builder                        |
| `src/clipboard-text.ts`                   | new: markup-free clipboard text and `dsh-session:` link conversion           |

`src/native` is excluded from Oxlint, Oxfmt and ast-grep (see [native plugin overrides](../../../docs/native-plugin-overrides.md)); the files above that live outside it are linted normally.

The native `conversation.composer.bar` slot requires package-private injection state (`ComposerBarInjected`) to provide its keyboard, uploads, notices, hooks and session input actions. That callback is created inside the native plugin and is not exposed as a reusable public service. A separate slot occupant cannot safely rebuild those props, so this fork replaces the whole `ui-conversation` Loader row while retaining its complete shell and service implementation. The stock row is disabled in this package's patch; other DSH core packages remain unchanged. Its composer Slot still registers at priority 0, so the higher-priority remote-composer takeover at -100 keeps its existing behavior.

## Paste behavior

The upstream editor handles clipboard `text/plain` as editable text. This fork parses canonical `@[label](dsh-session:<base64url>)` values in that text and inserts each through the native session-scoped reference action, preserving surrounding text and selection. Unsupported or invalid wire values remain ordinary text. HTML clipboard data is never inserted into the DOM; when plain text is absent, it is reduced to text and valid `dsh-session:` anchors are converted to the same canonical wire format.

## Updating from DSH

When the installed DSH package changes:

1. Compare the entire upstream package (`src/client` and `src/submission-settings.ts`) at the exact new release commit against the pinned revision above; the table lists the only files that should differ.
2. Re-apply the local delta on top of the new upstream files rather than porting your own edits forward.
3. Recheck the Loader row identity, native service dependencies, slot props/priorities and plugin peer ranges against the installed release.
4. Update package pins, source revision and this document together; run typecheck, tests, build, import check, boot check, and the paste browser journey. Never overwrite the fork from upstream without reviewing its diff.

## Verify

```sh
pnpm --dir plugins/@dshfiles/rich-composer typecheck
pnpm --dir plugins/@dshfiles/rich-composer test
pnpm --dir plugins/@dshfiles/rich-composer build
```

The web profile seed includes this package. Its patch replaces the loaded native plugin, so only the user's restart of the live `web` profile can activate the change. Do not restart it from plugin work.

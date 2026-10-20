# @dshfiles/rich-composer

Owned fork of DSH's native Conversation client plugin. It preserves the full native shell, services, Slots and composer, while recognizing canonical session-reference wire text on paste and inserting it as a structured reference chip. Plain text is preferred; when only HTML is available, session-link anchors are converted to canonical mention text and other markup is reduced to safe text.

## Upstream and license

- Upstream: [`deepseek-ai/deepseek-harness`](https://github.com/deepseek-ai/deepseek-harness)
- Package: `@deepseek-ai/dsh-client-ui-conversation@0.2.1-rc.2` (MIT)
- Client source: `packages/client/ui-conversation/src/client`
- Shared settings source: `packages/client/ui-conversation/src/submission-settings.ts`
- Pinned revision: [`687f282e8625c6b8d11ff58211a90524be2e4317`](https://github.com/deepseek-ai/deepseek-harness/commit/687f282e8625c6b8d11ff58211a90524be2e4317), tag `dsh-v0.2.1-rc.2`
- Previous pin: `c1b47e41fcd54d20a0f061df28683bfc29ee24e5` (`0.2.0-rc.2`); the 0.2.1 update was a three-way merge (`git merge-file`, base `dsh-v0.2.0-rc.2`) of the upstream delta onto this fork
- The complete client source is vendored in [`src/native`](./src/native) (upstream `src/client`) plus [`src/submission-settings.ts`](./src/submission-settings.ts) (upstream `src/submission-settings.ts`), keeping the upstream relative layout.

### Local delta

Every other vendored file is byte-identical to the pinned revision, so an upstream update starts from a real `diff`. The whole delta is:

| File                                               | Change                                                                                                                                                                                                      |
| -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/native/contract/slots.ts`                     | `ComposerBarInjected` gains `insertReference`; `ConversationSessionHeaderInjected` gains `rename`                                                                                                           |
| `src/native/apply.ts`                              | injects those actions; workspace switch hands the draft over through `transferComposerDraft`; renames through `remote.session.rename`                                                                       |
| `src/native/locales.ts`                            | `workspace.draftTransferRefused` notice for a refused handoff; title-edit labels and failure copy                                                                                                           |
| `src/native/skeleton/InputBar.tsx`                 | paste converts canonical mentions into reference chips, falling back to text                                                                                                                                |
| `src/native/input/editor/keymap.ts`                | reads `text/html` when the clipboard has no plain text                                                                                                                                                      |
| `src/native/input/editor/view-binding.ts`          | routes the paste handler through the bar's live handler                                                                                                                                                     |
| `src/native/input/editor/runtime.ts`               | logs the Lexical error stack before rethrowing; reuses the content half of the projection while no commit dirtied the document (selection-only commits skip the walk)                                       |
| `src/native/input/editor/projection.ts`            | splits `$projectComposer` into a content half (`$composerProjectionContent`) and a selection half (`$composerSelection`) so the reusable half can be recomputed independently                               |
| `src/native/user-text/session-reference-rule.ts`   | imports and augments `../index.ts` instead of the package's own `/client` self-reference                                                                                                                    |
| `src/native/conversation/location-index.ts`        | `import type` instead of inline `type` specifiers, so the bundle no longer requires the stock Session client module, which the browser does not serve once `@dshfiles/session-controller` replaces that row |
| `src/native/input/hub.ts`                          | each Session input shell starts `AgentWarmup.onFirstEdit`, so the first draft edit resumes the thread's Agent (`@dshfiles/session-controller` no longer resumes it on open)                                 |
| `src/native/skeleton/ConversationSession.tsx`      | the current Session title is a click-to-edit input; Enter or blur renames through the injected `rename`, Escape cancels                                                                                     |
| `src/native/skeleton/ConversationRoot.module.css`  | styles for that in-place title editor and its failure message                                                                                                                                               |
| `src/composer-draft-handoff.ts`                    | new: refusing, rollback-safe draft handoff carrying the semantic `DraftSnapshot`                                                                                                                            |
| `src/paste-references.ts`                          | new: canonical wire-text parser and reference builder                                                                                                                                                       |
| `src/clipboard-text.ts`                            | new: markup-free clipboard text and `dsh-session:` link conversion                                                                                                                                          |
| `src/composer-controls-settings.ts`, `src/host.ts` | new: Host settings namespace `dshfiles-rich-composer` (`hidePermissionSelector`)                                                                                                                            |
| `src/agent-warmup.ts`, `src/agent-warmup-api.ts`   | new: `agent-warmup` Host API (`warm` resolves the Session's Agent through `sessionController`) and its first-edit client trigger                                                                            |
| `src/client-entry.tsx`                             | shadows `conversation.input.permission` with an empty occupant while `hidePermissionSelector` is on                                                                                                         |

`src/native` is excluded from Oxlint, Oxfmt and ast-grep (see [native plugin overrides](../../../docs/native-plugin-overrides.md)); the files above that live outside it are linted normally.

The native `conversation.composer.bar` slot requires package-private injection state (`ComposerBarInjected`) to provide its keyboard, uploads, notices, hooks and session input actions. That callback is created inside the native plugin and is not exposed as a reusable public service. A separate slot occupant cannot safely rebuild those props, so this fork replaces the whole `ui-conversation` Loader row while retaining its complete shell and service implementation. The stock row is disabled in this package's patch; other DSH core packages remain unchanged. Its composer Slot still registers at priority 0, so the higher-priority remote-composer takeover at -100 keeps its existing behavior.

## Paste behavior

The upstream editor handles clipboard `text/plain` as editable text. This fork parses canonical `@[label](dsh-session:<base64url>)` values in that text and inserts each through the native session-scoped reference action, preserving surrounding text and selection. Unsupported or invalid wire values remain ordinary text. HTML clipboard data is never inserted into the DOM; when plain text is absent, it is reduced to text and valid `dsh-session:` anchors are converted to the same canonical wire format.

## Composer settings

`hidePermissionSelector` (Plugins page, off by default) hides the permission mode selector. The seat is a single Slot, so an empty occupant at priority -1 shadows the native selector while the setting is on and is disposed when it turns off; the change applies live.

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

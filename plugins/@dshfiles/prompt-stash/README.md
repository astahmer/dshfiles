# Prompt Stash

![Manage reusable prompt snippets](docs/screenshots/prompt-library.png)

![Shared prompt library in the composer](docs/screenshots/prompt-library.png)

Prompt Stash provides one composer action for reusable prompts: **Saved prompts…** and **Recent messages here…** in the
composer bar's More (⋯) menu, `/prompts` in the composer, or a Prompts button in the bar when the user pins it back
(`dshfiles-rich-composer.showComposerExtras`). It uses DSH's revision-guarded insertion API and never submits a message. The Host owns the shared prompt library, so it is available in every browser.

## Prompts

The Prompts action manages up to 50 reusable text prompts, with up to 20,000 characters per prompt and 450,000 total prompt characters. Save current copies the plain-text composer draft into the library without changing or sending it; references, attachments, busy drafts, and oversized text are excluded. A label is optional; when omitted, the first line of the prompt text labels it. Edits are versioned and validated. Per-prompt revision ids detect concurrent edits from another browser tab; the local editor remains available and can be saved as a separate copy.

Its Recent tab reads up to 20 direct user-text messages from the loaded Chat snapshot, scanning no more than 1,000 nodes. Recent messages are not persisted. Unsupported content, references, and attachments are excluded.

## Prompt history

![Search every prompt sent across threads](docs/screenshots/prompt-history.png)

The **All threads** tab searches every prompt you sent in a top-level thread, newest first, each text once. Open it from the composer's **⋯** menu (**Prompt history… ⌃R**, beside Saved prompts and Recent messages), with **Ctrl+R** while a composer has focus (elsewhere Ctrl+R stays the browser's reload), or with **Search prompt history** in the command palette. Each row says when it was sent ("5 minutes ago", "yesterday", then the date). Enter inserts the prompt at the cursor without sending it; the star saves it to the shared library (unstar by deleting it under Saved). The agent reads the same results with `prompt_history_search` (read-only).

No second copy is stored: the rows come from `@dshfiles/session-search`'s index ([Prompt history](../session-search/README.md#prompt-history)), which leaves out subagent threads and messages a plugin or agent sent. Without that plugin the tab says so.

| Setting (`dshfiles-prompt-stash`) | Default | Effect                                                           |
| --------------------------------- | ------- | ---------------------------------------------------------------- |
| `promptHistory`                   | on      | Turns the tab, Ctrl+R and the palette entry's results on or off. |
| `historyRetention`                | 5,000   | How many of your newest prompts are searched.                    |
| `historyMaxChars`                 | 8,000   | Longer prompts (pasted logs, large inline content) are skipped.  |

Settings apply live; the Host method, tool and settings need a DSH restart after an update.

## Composer drafts

Unsaved text remains owned by DSH's native per-thread composer. The plugin does not keep a second stash of in-progress drafts. Older saved-draft records and browser-local fallback data are left untouched; the plugin no longer reads or writes them.

## Draft attachments

DSH keeps a thread's composer text when you leave the thread, but its draft attachments live in the thread's session scope and are dropped once nothing holds that scope. While a composer holds attachments, Prompt Stash holds its session (reference source `composerDraftAttachments`), so leaving the thread and coming back, for example with the sidebar's Back, keeps the files and images with the text. Sending or removing them lets the session go. A page reload still loses them: DSH persists only the text ([Host gap](../../../plans/dsh-host-gaps.md)).

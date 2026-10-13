# Home

Owns the New thread screen's top: the DeepSeek mark and headline are replaced,
and a compact row above the composer lets you resume one of the project's
recent threads or jump to thread workspaces that still hold work to land.

## Settings (`dshfiles-home`)

| Key | Default | Meaning |
|---|---|---|
| `mark` | `none` | `none`, `text` (`markText`, e.g. an emoji) or `image` (`markImageUrl`, https or data URL). |
| `headline` | `{project}` | Headline text; `{project}` is the selected project. Empty keeps the DeepSeek headline. |
| `showPreviewBadge` | `false` | Keep the DeepSeek "Preview" badge. |
| `showAgentPresetPicker` | `true` | Show the agent preset picker; hidden, new threads use the native "New task default" preset. |
| `showRecentThreads` | `true` | Up to three unarchived threads of the selected project. |
| `showUnlandedWork` | `true` | Count of the project's thread workspaces with work to land (needs jj-integration). |

## Limits

DSH 0.2.0-rc.2 has a slot for the mark but not for the headline, so the native
headline and badge are hidden by their CSS-module class suffixes
(`_titleGroup`, `_previewBadge`). A DSH update that renames them shows the
native headline again next to this one.

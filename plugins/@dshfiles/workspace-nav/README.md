# @dshfiles/workspace-nav

Owned fork of `@deepseek-ai/dsh-client-ui-workspace` (the Workspace picker and the `uiWorkspace` navigation
service). New thread opens a fresh **local blank**. No Host Session or log is created until the composer
contains real text or attachments, and multiple unsent drafts in one project keep independent identities.

Without the fork, `UiWorkspace.startSession` awaited `session/create` before revealing the composer: 1.7 s on a
quiet Host, up to 9.5 s under load ([performance](../../../docs/performance.md#first-send-no-longer-waits-for-its-thread-workspace)).
Text typed during that wait landed in the previous Session's draft. The landed jj-integration change removed the
first-send wait, not the click wait; this fork removes the click wait.

## What changes

Every ordinary New thread entry point funnels into `UiWorkspace.startSession`:

1. `ctx.sessionDrafts.create` allocates a fresh identity through the canonical
   `@dshfiles/session-controller/draft-client` service. It never reuses another typed draft.
2. `replaceMain` binds the composer immediately. Blank identities are not persisted; typed/attachment drafts
   keep metadata and the composer's existing conversation buffer for reload and later reopening.
3. The first content update materializes that exact identity once. Creation failures leave the draft selected
   and intact; the Session shows the error, and another Send retries.
4. Startup restores saved typed-draft metadata before considering Host blanks. A missing selection's ordinary
   fallback is another local blank, not a Host creation.

`openWorkspace` uses the same local lifecycle for the hero and project picker, while preserving its
synchronous `beforeOpen` draft-transfer hook. `connectWorkspace` keeps real Host creation/reuse on purpose:
jj-integration resolves a thread workspace's Session before sending into it. `newThreadRequest`
(`tests/new-thread-request.test.ts`) still owns blank reuse for those explicit flows.

## Provenance

|                     |                                                                                             |
| ------------------- | ------------------------------------------------------------------------------------------- |
| Upstream package    | `@deepseek-ai/dsh-client-ui-workspace`                                                      |
| Pinned              | `0.2.1-rc.2`, ref `dsh-v0.2.1-rc.2`                                                         |
| Upstream path       | `packages/client/ui-workspace`                                                              |
| Loader row replaced | `ui-workspace` (disabled in `cordis.patch.yml`, stock row stays off in profile composition) |
| Delta               | `src/native/navigation.ts` only; new logic lives in `src/new-thread-request.ts`             |
| Verification        | `node scripts/native-fork-diff.mjs workspace-nav`, `tests/new-thread-request.test.ts`       |

Update policy: bump with `node scripts/native-fork-diff.mjs workspace-nav --to <new-tag>`, re-apply the
`navigation.ts` delta (local draft navigation and `blankRequest` for explicit Host connections), and re-run the journeys below.

## Journeys

- `thread-sidebar.new-thread-composer-instant` — the sidebar `+` reaches a usable composer before the Host
  answers.
- `main-tabs.start-page-new-thread` — the Start page's New thread suggestion takes the composer's place.

## Screenshot

![New thread composer opened from the sidebar +](docs/screenshots/new-thread-composer.png)

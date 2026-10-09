# Queue attachment editing plan

## Context

### Findings from this conversation

- The screenshot warning came from `queue-reorder` calling a composer queue-edit API that current DSH does not expose. The plugin was changed in JJ revision `6f01c6ec` to edit text inline through the existing `updateQueue({ kind: 'edit' })` Host action.
- That patch deliberately disables editing when a queue item has a non-text block. It does not drop attachments through the UI; it leaves those queue items uneditable.
- DSH `0.2.0-rc.2`'s built-in queue UI has the same limit: it derives editable text only when every content block is text.
- Host `QueueAction.edit` accepts text-only content, and `SessionCommandController.updateQueue` replaces the entire queued message content with the request content. A client that sent only edited text for a mixed text/image/file message would therefore erase its attachments. Simply enabling the pencil is unsafe.

### Findings from JJ history and existing plans

- Queue dock history includes the original editable-row work (`175570d9`), a later “queue rich edit” iteration (`100ffead`), and the composer-based attempt (`9c6d959d` / follow-up `37e949fd`). The earlier inline editor extracted text blocks and sent a text-only replacement. That implementation shape is unsafe for mixed content under Host's replace semantics; history does not prove it was deployed or that any user lost attachments.
- [Plugin E2E coverage plan](./plugin-e2e-coverage.md#L34) already labels queue editing as a **text-only editor**, but does not identify attachment preservation as a product gap or data-loss hazard.
- [Reference feature triage](./reference-feature-additions.md#L153) broadly lists queue operations and attachments, but does not distinguish editing text on an attached message from editing/replacing the attachment itself.
- Host tests currently prove that callers cannot submit attachment blocks as edit payloads; they do not prove preservation of attachments already on the queued message: [queue Host tests](../tooling/dsh-core/api-session-controller/tests/commands-queue-attachment.host.spec.ts#L143).

### Current ownership boundary

- [Queue action contract](../tooling/dsh-core/api-session-controller/src/types.ts#L186) defines edit payloads as text-only.
- [Queue mutation Host path](../tooling/dsh-core/api-session-controller/src/commands.ts#L468) owns validation, queue-item lookup, and replacement. This is the only safe place to retain the selected message's existing durable attachment references.
- [Queue reorder client](../plugins/@dshfiles/queue-reorder/src/client.tsx#L249) owns the editor affordance; [its current edit decoder](../plugins/@dshfiles/queue-reorder/src/queue-edit.ts#L6) rejects mixed content.

## Goal

Allow users to edit text on queued messages that already contain images or files, without removing, re-uploading, or changing those attachments.

The first increment edits message text only. Replacing or removing attachments is separate scope.

## What

Keep the wire edit request text-only. When Host applies it, Host replaces the queued message's text blocks while preserving every original non-text content block from that same queued message. The Client never submits attachment references as part of an edit.

Support both mixed messages and attachment-only messages:

- Mixed text plus attachments: editor starts with existing text; save updates text and retains attachments.
- Attachments only: editor starts blank; saving nonblank text adds text and retains attachments.
- Text-only: existing edit behavior remains.
- Blank text-only edit: rejected, preserving existing nonempty-message validation.

## Why

Queued image/file context is durable user work. Refusing all edits to attached messages is a meaningful product gap; sending a text-only replacement without Host preservation risks silently deleting that context. Host-side preservation fixes both without asking the browser to fetch and re-submit file bytes or durable references.

## How

### Conceptual model

```mermaid
flowchart LR
    UI[Editor sends text-only edit] --> HOST[Host validates session and pending item]
    HOST --> MERGE[Replace text; retain original non-text blocks]
    MERGE --> INBOX[Replace same inbox occurrence]
    INBOX --> PROJECTION[Publish updated queue projection]
```

### Operations / behavior

1. Keep authorization, subagent ownership, stale-item, and target checks in `updateQueue` unchanged.
2. Continue rejecting any non-text block supplied by the Client. Do not accept client-provided `ImageAttachmentRef`, `FileAttachmentRef`, paths, receipts, or bearer URLs.
3. After locating the pending message, merge the submitted text blocks into its original content. Replace text at the first existing text position, discard old text blocks, and preserve all original non-text blocks in their original relative order. If no text existed, insert new text before the preserved blocks.
4. Preserve the message ID, source metadata, queue destination, and original attachment references. Keep the operation in-place; do not remove and re-enqueue.
5. In the plugin, extract only text blocks for the draft. Allow opening the editor when content has text or attachments; attachment-only messages start with an empty draft. Keep save disabled for blank content.
6. Render the existing attachments while editing, or keep a clear attachment count/preview beside the text editor. Do not make them appear editable when this increment cannot change them.

### Tech choices

| Choice              | Decision                                                   | Rationale                                                                                     |
| ------------------- | ---------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Attachment handling | Host preserves references from the located pending message | Client-supplied references are untrusted; Host already owns the authoritative message.        |
| API shape           | Keep current text-only edit payload                        | Avoid unnecessary wire/API redesign; payload is a text patch, not a full replacement message. |
| Mutation            | Replace text in-place, preserve occurrence identity        | Retains queue ordering, source metadata, and existing durable attachment identities.          |
| Attachment changes  | Out of scope                                               | New uploads/replacements need explicit staged-upload and authorization semantics.             |

### Architecture

```text
queue-reorder Client
  └─ text-only QueueAction.edit
       └─ api-session-controller Host
            ├─ validates caller payload is text-only
            ├─ resolves and authorizes exact pending item
            ├─ merges new text with that item's original attachment blocks
            └─ replaces same inbox item and publishes projection
```

## What this allows

- Edit text on messages containing existing images or files.
- Add text to an attachment-only queued message.
- Preserve exact durable attachment IDs, metadata, order, and message identity through text edits.
- Continue rejecting arbitrary attachment references from Client edit payloads.

## What this does not allow

- Add, remove, replace, reorder, or rename attachments while editing.
- Edit attachment bytes or file contents.
- Edit a message that is no longer pending or is outside the caller's authorized session/subagent scope.
- Convert attachment references into client-readable paths or upload receipts.

## UI & UX

### Desktop

Keep text editor inline in queue row. Show attachment thumbnails or file-name chips next to the draft, visually distinct from editable text. For attachment-only items, show an empty editor and retain the attachment preview.

### Mobile

Use same editor and attachment summary, allowing the row to grow vertically; save and cancel controls must remain reachable without horizontal overflow.

### Common interactions

| Action                                     | Result                                                                       |
| ------------------------------------------ | ---------------------------------------------------------------------------- |
| Edit text+image/file item                  | Draft contains text only; attachment preview remains visible.                |
| Edit attachment-only item                  | Empty text draft opens; user can add instructions without losing attachment. |
| Save nonblank text                         | Host merges text into existing item and preserves original attachments.      |
| Save blank text-only item                  | Rejected; draft remains available.                                           |
| Cancel                                     | No Host mutation; original queued content remains unchanged.                 |
| Queue item disappears or Host rejects save | Keep draft until user retries/cancels; show non-sensitive error.             |

## Data model

No new durable table or attachment format is needed. The current durable `UserMessage` already holds ordered text/image/file blocks and the queue action already addresses an exact message ID. The Host computes the resulting content from:

- text blocks supplied by the caller, after strict text-only validation;
- non-text blocks copied from the exact authorized pending message.

Do not persist editor drafts or attachment bytes in the queue plugin for this increment.

## Implementation steps

1. Add a Host-owned content merge helper at the narrowest queue-mutation boundary; keep caller payload validation text-only and merge only after exact pending-item lookup.
2. Add Host tests for mixed image/text and file/text items, attachment-only items, stable ID/source/queue destination, order preservation, blank text-only rejection, stale IDs, and rejection of client-supplied attachment refs.
3. Update `queue-reorder` text extraction and editor gating so mixed and attachment-only rows can open without serializing attachment refs.
4. Add Client tests for initial draft extraction, attachment-only empty draft, and cancel/save/error behavior; add a composed DSH journey for a mixed queued item.
5. Build/typecheck/test `api-session-controller` and `queue-reorder`; import-check Host bundle; run the queue workflow in a scratch/probe profile. Check attachment preview and bytes/refs before and after edit.
6. Treat Host bundle update as a runtime change: verify on a second instance/profile, then let the user decide whether to reload the live DSH instance. Do not rely on Client HMR alone for the Host behavior change.
7. Update [Plugin E2E coverage plan](./plugin-e2e-coverage.md) to distinguish text editing with preserved attachments from attachment replacement.

## Open questions

1. Should future scope allow attachment replacement/removal, or should the queue editor remain text-only and preserve attachments immutably? **Recommendation:** keep attachment changes separate until a safe upload/edit workflow is designed.
2. Should editing a message containing only attachments allow adding text? **Recommendation:** yes; existing queue prompts may be attachment-only, and Host already accepts attachment-only prompt content.

## Acceptance criteria

- [ ] Editing a mixed text/image queue item changes text, preserves exact image reference and non-text order, and inserts replacement text at the first prior text position.
- [ ] Editing a mixed text/file queue item changes text, preserves exact file reference and non-text order, and inserts replacement text at the first prior text position.
- [ ] Editing an attachment-only item adds text without changing any attachment metadata.
- [ ] Client cannot inject or substitute attachment refs through `QueueAction.edit`.
- [ ] Blank text-only edit is rejected; cancel or rejected save never mutates queued content.
- [ ] Queue identity, source metadata, destination, and relative ordering remain unchanged after edit.
- [ ] Existing remove, steer, and reorder behavior remains unchanged.
- [ ] Tests and scratch-profile verification pass; live instance is not restarted without user approval.

## Decisions log

| Date       | Decision                                                                   | Rationale                                                                                                                                             |
| ---------- | -------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-10-10 | Treat attachment preservation as Host-owned merge, not Client resubmission | Host has authoritative durable refs; accepting refs from Client creates an unnecessary trust boundary and text-only replacement can lose attachments. |
| 2026-10-10 | First increment edits text only and preserves attachments immutably        | Solves the data-loss risk without designing attachment upload/replacement semantics.                                                                  |

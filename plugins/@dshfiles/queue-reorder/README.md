# @dshfiles/queue-reorder

Adds drag-to-reorder for queued DSH messages using the Host's move API. This preserves the queued item; it does not remove and resend it.

The separate queued-message editor is a client workflow: it removes the item, hydrates its contents into the composer, then resubmits on save. Cancel reconstructs the original message and restores its prior queue position. It is not an atomic Host edit, and does not promise to preserve message identity or attachment metadata across save. The proposed Host-level attachment-preserving edit remains an [active plan](../../../plans/queue-attachment-editing.md).

This is an owned DSH bundle. Run `pnpm build`, `pnpm test`, and `pnpm typecheck` from this package.

# @dshfiles/send-after-upload

Native DSH refuses Enter while a file attachment uploads (a "still uploading"
toast) and disables Send. This plugin queues the send instead: a pill above
the composer reads "Sending when upload finishes…" with Cancel in its menu, and the
message sends by itself once every upload is ready.

- **Hook:** a window `keydown` capture listener runs before the editor's own
  Enter handler (Lexical's `KEY_ENTER_COMMAND`, which no plugin slot or event
  can intercept). It acts only on a plain Enter inside a composer card whose
  draft has a file still uploading, and leaves Enter alone while an `@` or `/`
  menu is open. A `pointerdown` capture does the same for the disabled Send
  button, which receives no click.
- **Cancel:** any edit to the text or the attachments, Escape, or Cancel.
  A failed upload, or five minutes without finishing, leaves the message
  unsent with a notice.
- **State:** one xstate actor per session composer
  (`pending-send-machine.ts`); the upload watcher lives only while waiting,
  so a late upload event cannot send a cancelled message.
- **Send:** `SessionInput.submit('queue', 'enter')`; a deferred send queues
  behind a running turn rather than steering it.

Core change that would replace it: a composer submit guard that waits for
pending attachments (`installDraftKeymap` in `dsh-client-ui-conversation`).

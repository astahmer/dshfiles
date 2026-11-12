import assert from 'node:assert/strict'
import { test } from 'vitest'
import { SessionQueueEditorModel, useQueueClientForEditing } from './session-queue-editor.js'

class Composer {
  restored = 0
  private readonly deps = { inputTriggers: () => ({ restore: () => 1 }) }

  restoreReferences(): boolean {
    this.restored += this.deps.inputTriggers().restore()
    return true
  }
}

test('restoring reference chips runs on the composer itself, keeping its own state', () => {
  const composer = new Composer()
  SessionQueueEditorModel.restoreComposerReferences(composer)
  assert.equal(composer.restored, 1)
})

test('a queued image read waits for the dock client and comes from the Host once the native read refuses it', async () => {
  const session = { readAttachment: async () => ({ ok: false, error: { message: 'attachment is not cited by this session' } }) }
  // SAFETY: the image reader reads only `sessions.binding(id).session.readAttachment` from the Client context.
  const ctx = { sessions: { binding: () => ({ session }) } } as never
  const read = SessionQueueEditorModel.imageReader(ctx, 'session-a' as never)
  assert.ok(read !== undefined)
  const image = read({ attachmentId: 'shot', mediaType: 'image/png', bytes: 4, width: 1, height: 1, name: 'shot.png' })
  await Promise.resolve()
  // SAFETY: the reader calls only `readImage` on the Host API client.
  useQueueClientForEditing({ readImage: async () => ({ name: 'shot.png', mediaType: 'image/png', data: btoa('png!') }) } as never)
  const file = await image
  assert.equal(file.type, 'image/png')
  assert.equal(await file.text(), 'png!')
})

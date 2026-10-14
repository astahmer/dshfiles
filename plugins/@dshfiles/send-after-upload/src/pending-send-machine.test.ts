import { afterEach, describe, expect, it, vi } from 'vitest'
import { startPendingSend, type ComposerView, type UploadStatus } from './pending-send-machine.js'

const fakeComposer = (initial: { readonly draft: string; readonly attachmentIds: readonly string[]; readonly upload: UploadStatus }) => {
  let view: ComposerView = { draft: initial.draft, attachmentIds: initial.attachmentIds }
  let upload = initial.upload
  const composerListeners = new Set<() => void>()
  const uploadListeners = new Set<() => void>()
  const submit = vi.fn(async () => {})
  const actor = startPendingSend({
    composer: {
      getSnapshot: () => view,
      subscribe: listener => {
        composerListeners.add(listener)
        return () => composerListeners.delete(listener)
      },
    },
    uploads: {
      status: () => upload,
      subscribe: listener => {
        uploadListeners.add(listener)
        return () => uploadListeners.delete(listener)
      },
    },
    submit,
  })
  return {
    actor,
    submit,
    edit: (next: Partial<ComposerView>) => {
      view = { ...view, ...next }
      for (const listener of composerListeners) listener()
    },
    finishUpload: (status: UploadStatus) => {
      upload = status
      for (const listener of uploadListeners) listener()
    },
    listeners: () => composerListeners.size + uploadListeners.size,
  }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('pending send', () => {
  it('sends once the uploads finish', async () => {
    const composer = fakeComposer({ draft: 'see attached', attachmentIds: ['a'], upload: 'uploading' })
    composer.actor.send({ type: 'request' })
    expect(composer.actor.getSnapshot().value).toBe('waiting')
    composer.finishUpload('ready')
    await vi.waitFor(() => expect(composer.actor.getSnapshot().value).toBe('idle'))
    expect(composer.submit).toHaveBeenCalledTimes(1)
  })

  it('cancels when the text or the attachments change, and a later upload does not send', () => {
    const edited = fakeComposer({ draft: 'see attached', attachmentIds: ['a'], upload: 'uploading' })
    edited.actor.send({ type: 'request' })
    edited.edit({ draft: 'see attached!' })
    edited.finishUpload('ready')
    expect(edited.actor.getSnapshot().value).toBe('idle')
    expect(edited.submit).not.toHaveBeenCalled()
    expect(edited.listeners()).toBe(0)

    const removed = fakeComposer({ draft: 'see attached', attachmentIds: ['a', 'b'], upload: 'uploading' })
    removed.actor.send({ type: 'request' })
    removed.edit({ attachmentIds: ['a'] })
    expect(removed.actor.getSnapshot().value).toBe('idle')
  })

  it('cancels on Cancel or Escape', () => {
    const composer = fakeComposer({ draft: 'x', attachmentIds: ['a'], upload: 'uploading' })
    composer.actor.send({ type: 'request' })
    composer.actor.send({ type: 'cancel' })
    composer.finishUpload('ready')
    expect(composer.submit).not.toHaveBeenCalled()
    expect(composer.actor.getSnapshot().value).toBe('idle')
  })

  it('reports a failed upload instead of sending, and can be dismissed', () => {
    const composer = fakeComposer({ draft: 'x', attachmentIds: ['a'], upload: 'uploading' })
    composer.actor.send({ type: 'request' })
    composer.finishUpload('failed')
    expect(composer.actor.getSnapshot().value).toBe('failed')
    expect(composer.actor.getSnapshot().context.failure).toBe('upload')
    expect(composer.submit).not.toHaveBeenCalled()
    composer.actor.send({ type: 'dismiss' })
    expect(composer.actor.getSnapshot().value).toBe('idle')
  })

  it('gives up after five minutes of uploading', () => {
    vi.useFakeTimers()
    const composer = fakeComposer({ draft: 'x', attachmentIds: ['a'], upload: 'uploading' })
    composer.actor.send({ type: 'request' })
    vi.advanceTimersByTime(5 * 60_000)
    expect(composer.actor.getSnapshot().context.failure).toBe('timeout')
    expect(composer.submit).not.toHaveBeenCalled()
  })
})

import assert from 'node:assert/strict'
import { setFlagsFromString } from 'node:v8'
import { runInNewContext } from 'node:vm'
import type { Context } from '@deepseek-ai/cordis'
import type { SessionFace } from '@deepseek-ai/dsh-api-session-controller/client'
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

const store = <T>(value: T) => ({ getSnapshot: () => value, subscribe: () => () => {} })

/** The Session Controller's bindings as the dock reads them: a Session is bound until the controller releases it. */
const controller = () => {
  const bound = new Map<string, { readonly session: object }>()
  const conversation = {
    createDrafts: () => [],
    releaseDraftAttachment: () => {},
    resolveDraftAttachments: () => [],
    serializeDraftAttachments: async () => ({ attachments: [] }),
    fileUploads: store({}),
    input: { for: () => ({ state: store({ draft: '', attachmentIds: [], phase: 'plain' }) }) },
  }
  const sessions = {
    binding: (sessionId: string) => bound.get(sessionId),
    scope: (sessionId: string) => (bound.has(sessionId) ? { get: () => conversation } : undefined),
    retain: () => ({ release: () => {} }),
  }
  // SAFETY: the editor reads only ctx.sessions.{binding,scope,retain} and ctx.get; no other Context member is called.
  const ctx = { sessions, get: () => undefined } as unknown as Context
  const bind = (sessionId: string): WeakRef<object> => {
    const session = { projections: { faceOf: () => store(undefined) }, ...store({ pendingSubmissions: [] }) }
    bound.set(sessionId, { session })
    return new WeakRef(session)
  }
  // SAFETY: fixture identities for Sessions the fake controller binds.
  const id = (sessionId: string) => sessionId as SessionFace['sessionId']
  return { ctx, bind, release: (sessionId: string) => bound.delete(sessionId), id }
}

setFlagsFromString('--expose-gc')
const gc: () => void = runInNewContext('gc')
const collected = async (ref: WeakRef<object>): Promise<boolean> => {
  for (let attempt = 0; attempt < 10 && ref.deref() !== undefined; attempt++) {
    await new Promise(resolve => setTimeout(resolve, 0))
    gc()
  }
  return ref.deref() === undefined
}

test('the dock lets go of a visited thread once the controller releases its Session', async () => {
  const sessions = controller()
  const visited = sessions.bind('visited')
  assert.ok(SessionQueueEditorModel.editor(sessions.ctx, sessions.id('visited')))
  assert.ok(SessionQueueEditorModel.transfer(sessions.ctx, sessions.id('visited')))
  sessions.release('visited')
  sessions.bind('next')
  assert.ok(SessionQueueEditorModel.editor(sessions.ctx, sessions.id('next')))
  assert.equal(await collected(visited), true)
})

test('the dock keeps the editor of a thread the controller still holds', () => {
  const sessions = controller()
  sessions.bind('kept')
  const editor = SessionQueueEditorModel.editor(sessions.ctx, sessions.id('kept'))
  sessions.bind('next')
  SessionQueueEditorModel.editor(sessions.ctx, sessions.id('next'))
  assert.equal(SessionQueueEditorModel.editor(sessions.ctx, sessions.id('kept')), editor)
})

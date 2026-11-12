import { setFlagsFromString } from 'node:v8'
import { runInNewContext } from 'node:vm'
import type { Context } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { afterEach, expect, it } from 'vitest'
import { disposeSessionComposers, sessionComposer } from './session-composer.js'

afterEach(disposeSessionComposers)

const store = <T>(value: T) => ({ getSnapshot: () => value, subscribe: () => () => {} })

/** The Session Controller as the composer reads it: a Session is bound, with its own composer, until it is released. */
const controller = () => {
  const bound = new Map<string, { readonly session: object; readonly input: object }>()
  const conversation = {
    resolveDraftAttachments: () => [],
    fileUploads: store({}),
    input: { for: (scoped: { readonly sessionId: string }) => bound.get(scoped.sessionId)?.input },
  }
  const sessions = {
    binding: (sessionId: string) => bound.get(sessionId),
    scope: (sessionId: string) => (bound.has(sessionId) ? { sessionId, get: () => conversation } : undefined),
  }
  // SAFETY: sessionComposer reads only ctx.sessions.{binding,scope}; no other Context member is called.
  const ctx = { sessions } as unknown as Context
  const bind = (sessionId: string): WeakRef<object> => {
    const session = {}
    bound.set(sessionId, { session, input: { session, state: store({ draft: '', attachmentIds: [], phase: 'plain' }) } })
    return new WeakRef(session)
  }
  // SAFETY: fixture identities for Sessions the fake controller binds.
  const id = (sessionId: string) => sessionId as SessionId
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

it('lets go of a visited thread once the controller releases its Session', async () => {
  const sessions = controller()
  const visited = sessions.bind('visited')
  expect(sessionComposer(sessions.ctx, sessions.id('visited'))).toBeDefined()
  sessions.release('visited')
  sessions.bind('next')
  expect(sessionComposer(sessions.ctx, sessions.id('next'))).toBeDefined()
  expect(await collected(visited)).toBe(true)
})

it('keeps the pending send of a thread the controller still holds', () => {
  const sessions = controller()
  sessions.bind('kept')
  const composer = sessionComposer(sessions.ctx, sessions.id('kept'))
  sessions.bind('next')
  sessionComposer(sessions.ctx, sessions.id('next'))
  expect(sessionComposer(sessions.ctx, sessions.id('kept'))).toBe(composer)
})

it('keeps a send still waiting for its uploads after the controller releases the Session', () => {
  const sessions = controller()
  sessions.bind('waiting')
  const composer = sessionComposer(sessions.ctx, sessions.id('waiting'))
  composer?.actor.send({ type: 'request' })
  expect(composer?.actor.getSnapshot().matches('idle')).toBe(false)
  sessions.release('waiting')
  sessions.bind('next')
  sessionComposer(sessions.ctx, sessions.id('next'))
  expect(composer?.actor.getSnapshot().status).toBe('active')
})

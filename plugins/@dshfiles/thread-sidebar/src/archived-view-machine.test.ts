import { SessionId } from '@deepseek-ai/dsh-session/types'
import { createActor, waitFor } from '@dshfiles/plugin-ui/machine'
import { describe, expect, it } from 'vitest'
import { archivedViewMachine, type ArchivedViewClient } from './archived-view-machine.js'

const sessionA = SessionId('session-a')

/** `dropsAfterOpen` plays DSH clearing the archived main Session as soon as its lists change. */
const startView = (options: { readonly dropsAfterOpen?: number; readonly ready?: ArchivedViewClient['ready'] } = {}) => {
  const opened: SessionId[] = []
  const failures: { readonly failure: string; readonly error: string | null }[] = []
  let drops = options.dropsAfterOpen ?? 0
  const actor = createActor(archivedViewMachine, {
    input: {
      client: {
        open: sessionId => {
          opened.push(sessionId)
          queueMicrotask(() => {
            actor.send({ type: 'selection.changed', sessionId })
            if (drops === 0) return
            drops -= 1
            actor.send({ type: 'selection.changed', sessionId: null })
          })
        },
        ready: options.ready ?? (() => new Promise(resolve => setTimeout(resolve, 1))),
        now: () => 0,
      },
    },
  }).start()
  actor.on('failed', event => failures.push({ failure: event.failure, error: event.error }))
  return { actor, opened, failures }
}

describe('archivedViewMachine', () => {
  it('reopens an archived thread that DSH drops from the main view, then stays on it', async () => {
    const view = startView({ dropsAfterOpen: 2 })
    view.actor.send({ type: 'open', sessionId: sessionA, archived: true })
    await waitFor(view.actor, snapshot => snapshot.matches('viewing'))
    expect(view.opened).toEqual([sessionA, sessionA, sessionA])
    expect(view.failures).toEqual([])
  })

  it('stops reopening and reports the thread when DSH keeps closing it', async () => {
    const view = startView({ dropsAfterOpen: 10 })
    view.actor.send({ type: 'open', sessionId: sessionA, archived: true })
    await waitFor(view.actor, snapshot => snapshot.matches('failed'))
    expect(view.failures).toEqual([{ failure: 'keeps-closing', error: null }])
    expect(view.opened).toHaveLength(4)
  })

  it('reports a Session that fails to load instead of leaving a blank view', async () => {
    const view = startView({ ready: async () => Promise.reject(new Error('Session reference "session-a" is released')) })
    view.actor.send({ type: 'open', sessionId: sessionA, archived: true })
    await waitFor(view.actor, snapshot => snapshot.matches('failed'))
    expect(view.failures).toEqual([{ failure: 'load-failed', error: 'Session reference "session-a" is released' }])
  })

  it('lets go once the user opens another thread, and ignores active threads', async () => {
    const view = startView()
    view.actor.send({ type: 'open', sessionId: sessionA, archived: true })
    await waitFor(view.actor, snapshot => snapshot.matches('viewing'))
    view.actor.send({ type: 'selection.changed', sessionId: SessionId('session-b') })
    await waitFor(view.actor, snapshot => snapshot.matches('idle'))
    view.actor.send({ type: 'open', sessionId: SessionId('session-c'), archived: false })
    view.actor.send({ type: 'selection.changed', sessionId: null })
    expect(view.actor.getSnapshot().matches('idle')).toBe(true)
    expect(view.opened).toEqual([sessionA])
  })
})

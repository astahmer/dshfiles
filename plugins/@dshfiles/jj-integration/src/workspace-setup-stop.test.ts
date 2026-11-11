import { recordSpans } from '@dshfiles/dshx/tracing'
import { DshxEffect } from '@dshfiles/dshx/effect'
import { describe, expect, it } from '@effect/vitest'
import { Effect } from 'effect'
import { defaultJjIntegrationSettings } from './settings.js'
import { stopOpenProjectActions } from './workspace-setup.js'

const tasksBySession = {
  dev: [
    { id: 'server', status: 'running' },
    { id: 'install', status: 'queued' },
    { id: 'lint', status: 'passed' },
    { id: 'stopping', status: 'cancel-requested' },
  ],
  idle: [{ id: 'old', status: 'cancelled' }],
} satisfies Readonly<Record<string, readonly { readonly id: string; readonly status: string }[]>>

const tasksOf = (sessionId: string) => (sessionId === 'dev' || sessionId === 'idle' ? tasksBySession[sessionId] : [])

describe('stopOpenProjectActions', () => {
  it('is off by default, so a settle keeps project actions running as before', () => {
    expect(defaultJjIntegrationSettings.stopProjectActionsOnSettle).toBe(false)
    expect(defaultJjIntegrationSettings.stopWorkspaceProcesses).toBe(true)
  })

  it.effect('cancels only the queued and running actions of the settled Sessions and records a span', () =>
    Effect.gen(function* () {
      using recorder = recordSpans()
      const cancelled: string[] = []
      const stopped = yield* stopOpenProjectActions({
        sessionIds: ['dev', 'idle'],
        tasks: sessionId => Effect.succeed(tasksOf(sessionId)),
        cancel: (sessionId, taskId) => Effect.sync(() => cancelled.push(`${sessionId}/${taskId}`)),
      }).pipe(Effect.provide(DshxEffect.tracerLayer))
      expect(stopped).toBe(2)
      expect(cancelled).toEqual(['dev/server', 'dev/install'])
      expect(recorder.span('jj-integration project actions stop on settle').attributes['dshx.settle.actions_stopped']).toBe(2)
    }),
  )

  it.effect('skips a Session whose queue cannot be read and still stops the others', () =>
    Effect.gen(function* () {
      const cancelled: string[] = []
      const stopped = yield* stopOpenProjectActions({
        sessionIds: ['broken', 'dev'],
        tasks: sessionId => (sessionId === 'broken' ? Effect.fail('project-checks unavailable') : Effect.succeed(tasksOf(sessionId))),
        cancel: (sessionId, taskId) => Effect.sync(() => cancelled.push(`${sessionId}/${taskId}`)),
      })
      expect(stopped).toBe(2)
      expect(cancelled).toEqual(['dev/server', 'dev/install'])
    }),
  )
})

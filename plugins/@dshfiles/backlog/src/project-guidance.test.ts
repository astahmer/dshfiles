import { describe, expect, it } from '@effect/vitest'
import { Context, Effect, Layer } from 'effect'
import { TestClock } from 'effect/testing'
import { ProjectGuidance } from './project-guidance.js'
import { BacklogStore } from './store.js'
import { backlogRows, backlogStoreLayer } from './test-support.js'

const user = { kind: 'user' } as const

describe('project guidance', () => {
  it('keys guidance by project, folds thread workspaces, and removes it when emptied', () => {
    const entries = ProjectGuidance.withGuidance([], '/work/dshfiles-threads/thread-1a2b3c', '  Run pnpm fmt before describing.  ')
    expect(entries).toEqual([{ project: '/work/dshfiles', guidance: 'Run pnpm fmt before describing.' }])
    expect(ProjectGuidance.mapOf(entries).get('/work/dshfiles')).toBe('Run pnpm fmt before describing.')
    expect(ProjectGuidance.withGuidance(entries, '/work/dshfiles', '')).toEqual([])
    expect(ProjectGuidance.preamble([{ project: '/work/dshfiles', guidance: 'Use jj.' }])).toBe('Project guidance for /work/dshfiles:\n\nUse jj.')
  })

  it.effect('returns the guidance of the item project with its detail', () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(1_000)
      const store = yield* Effect.map(
        Layer.build(backlogStoreLayer({ rows: backlogRows(), settings: { projectGuidance: [{ project: '/work/dshfiles', guidance: 'Never push.' }] } })),
        context => Context.get(context, BacklogStore),
      )
      const guided = (yield* store.capture({ text: 'guided', project: '/work/dshfiles', actor: user })).item.id
      const other = (yield* store.capture({ text: 'unguided', project: '/work/other', actor: user })).item.id
      const many = yield* store.getMany([guided, other])
      expect(many.items.map(detail => detail.guidance)).toEqual(['Never push.', null])
    }).pipe(Effect.scoped),
  )
})

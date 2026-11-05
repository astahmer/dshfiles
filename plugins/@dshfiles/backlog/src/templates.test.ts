import { describe, expect, it } from '@effect/vitest'
import { Context, Effect, Layer } from 'effect'
import { TestClock } from 'effect/testing'
import { backlogSettings } from './settings.js'
import { BacklogStore } from './store.js'
import { BacklogTemplates } from './templates.js'
import { backlogRows, backlogStoreLayer } from './test-support.js'

const openStore = Effect.map(Layer.build(backlogStoreLayer({ rows: backlogRows() })), context => Context.get(context, BacklogStore))
const user = { kind: 'user' } as const

describe('templates', () => {
  it('ships defaults in the settings and finds a template by name or by /template', () => {
    const templates = backlogSettings.schema({}).templates
    expect(templates.map(template => template.name)).toEqual(['Bug report', 'Feature spec', 'Research question'])
    expect(BacklogTemplates.find(templates, ' bug REPORT ')?.kind).toBe('bug')
    expect(BacklogTemplates.extract('login fails on Safari /template Bug report', templates)).toEqual({
      template: expect.objectContaining({ name: 'Bug report' }),
      text: 'login fails on Safari',
    })
    expect(BacklogTemplates.extract('/template nope', templates)).toBeNull()
  })

  it.effect('fills kind, prefix, tags, body and unchecked criteria where the capture left them out', () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(1_000)
      const store = yield* openStore
      const bug = BacklogTemplates.find(BacklogTemplates.defaults, 'Bug report')
      if (bug === undefined) throw new Error('the default bug template is missing')
      const template = { ...bug, titlePrefix: '[Bug] ', priority: 'high' as const }
      const created = yield* store.capture({ text: 'login fails on Safari #auth\nOnly after a reload.', template, actor: user })
      expect(created.item).toEqual(
        expect.objectContaining({
          title: '[Bug] login fails on Safari',
          kind: 'bug',
          priority: 'high',
          tags: ['auth', 'bug'],
        }),
      )
      expect(created.item.body.startsWith('Only after a reload.\n\n## Steps to reproduce')).toBe(true)
      expect(created.item.criteria?.map(criterion => [criterion.text, criterion.done])).toEqual([
        ['Reproduced', false],
        ['Root cause named', false],
        ['Regression test added', false],
      ])
    }).pipe(Effect.scoped),
  )
})

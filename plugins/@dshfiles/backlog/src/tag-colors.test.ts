import { describe, expect, it } from '@effect/vitest'
import { Effect, Result, Schema } from 'effect'
import { backlogApi } from './api.js'
import { BacklogSettingsTag, backlogSettingsTestLayer } from './backlog-settings.js'
import { TagColorSettings } from './tag-color-settings.js'
import { TagColors } from './tag-colors.js'

describe('tag colours', () => {
  it('keys a slot by the tag as stored, replaces it, and drops it on null', () => {
    const entries = TagColors.withSlot([], 'billing', 3)
    expect(entries).toEqual([{ tag: 'billing', slot: 3 }])
    expect(TagColors.withSlot(entries, 'billing', 1)).toEqual([{ tag: 'billing', slot: 1 }])
    expect(TagColors.withSlot(entries, 'Billing', 0)).toEqual([
      { tag: 'billing', slot: 3 },
      { tag: 'Billing', slot: 0 },
    ])
    expect(TagColors.withSlot(entries, 'billing', null)).toEqual([])
    // A slot outside the palette (hand-edited settings) is ignored, so the tag keeps its default.
    expect(TagColors.mapOf([{ tag: 'docs', slot: 9 }, { tag: 'ux', slot: 2 }])).toEqual(new Map([['ux', 2]]))
  })

  it.effect('the write tool path sets a slot, backlog_list reports it, and clearing reverses it', () =>
    Effect.gen(function* () {
      const items = [{ tags: ['ux', 'billing'] }, { tags: ['docs'] }]
      expect(yield* TagColorSettings.set({ tag: 'billing', slot: 4 })).toEqual({ tag: 'billing', slot: 4 })
      expect((yield* BacklogSettingsTag.use(settings => settings.get)).tagColors).toEqual([{ tag: 'billing', slot: 4 }])
      expect(yield* TagColorSettings.listed(items)).toEqual([{ tag: 'billing', slot: 4 }])
      // A chosen colour of a tag no listed item carries stays out of the answer.
      yield* TagColorSettings.set({ tag: 'infra', slot: 0 })
      expect(yield* TagColorSettings.listed(items)).toEqual([{ tag: 'billing', slot: 4 }])
      expect(yield* TagColorSettings.set({ tag: 'billing', slot: null })).toEqual({ tag: 'billing', slot: null })
      expect(yield* TagColorSettings.listed(items)).toEqual([])
    }).pipe(Effect.provide(backlogSettingsTestLayer())),
  )

  it('the tool takes a slot 0–5 or null, a non-empty tag, and says the user must have asked', () => {
    const method = backlogApi.methods.setTagColor
    expect(method.tool).toEqual({ name: 'backlog_set_tag_color', readOnly: false })
    expect(method.description).toMatch(/only when the user asked/u)
    expect(method.description).toMatch(/null/u)
    const input = method.input
    if (input === undefined) throw new Error('setTagColor input schema is missing')
    const decode = Schema.decodeUnknownResult(input)
    for (const slot of [0, 5, null]) expect(Result.isSuccess(decode({ tag: 'ux', slot }))).toBe(true)
    for (const slot of [-1, 6, 1.5, '2']) expect(Result.isFailure(decode({ tag: 'ux', slot }))).toBe(true)
    expect(Result.isFailure(decode({ tag: '', slot: 1 }))).toBe(true)
    expect(Result.isFailure(decode({ tag: 'ux' }))).toBe(true)
  })
})

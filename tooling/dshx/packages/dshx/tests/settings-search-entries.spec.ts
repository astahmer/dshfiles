import { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { defineSlot, publishSettingsSearchEntries, settingsSearchEntries, subscribeSettingsSearchEntries } from '../src/client/index.js'
import type { SettingsSectionSearchProps } from '../src/client/index.js'
import { createClientPlugin } from '../src/client/runtime.js'
import { settingsSectionMetadataSchema } from '../src/settings/index.js'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    'test.entries.slot': { kind: 'list'; scope: 'root' }
  }
}

const Section = (_props: PropsRuntime<'settings.section'> & SettingsSectionSearchProps) => null

const recordingSlots = () => {
  const registered: Array<Record<string, unknown>> = []
  const disposed: string[] = []
  const ctx = new Context()
  ctx.provide('slots', {
    inject: (_name: string, register: () => unknown) => register(),
    register: (options: Record<string, unknown>) => {
      registered.push(options)
      return () => disposed.push(String(options.id))
    },
  })
  return { ctx, registered, disposed }
}

afterEach(() => {
  globalThis.__dshxSettingsSearchEntriesV1 = undefined
})

describe('settings.section search entries', () => {
  it('types metadata on settings.section only', () => {
    defineSlot('settings.section', {
      id: 'typed',
      metadata: { settingsTargets: ['typed-entry'], searchEntries: [{ id: 'theme', title: 'Theme', keywords: 'dark light' }] },
      component: Section,
    })
    defineSlot('settings.section', {
      id: 'missing-title',
      // @ts-expect-error a search entry needs a title
      metadata: { searchEntries: [{ id: 'theme' }] },
      component: Section,
    })
    defineSlot('test.entries.slot', {
      id: 'other',
      // @ts-expect-error only settings.section declares registration metadata
      metadata: { searchEntries: [] },
      component: () => null,
    })
  })

  it('publishes a section’s entries while it is registered and keeps metadata out of the ledger', () => {
    const slots = recordingSlots()
    const section = defineSlot('settings.section', {
      id: 'appearance',
      label: 'Appearance',
      metadata: { searchEntries: [{ id: 'theme', title: 'Theme', description: 'Light or dark' }] },
      component: Section,
    })
    const plain = defineSlot('settings.section', { id: 'plain', component: Section })
    const listener = vi.fn()
    subscribeSettingsSearchEntries(listener)
    const dispose = createClientPlugin({ slots: [section, plain] }, { packageId: '@test/plugin' }).apply(slots.ctx)

    expect(slots.registered.map(options => [options.id, 'metadata' in options])).toEqual([
      ['appearance', false],
      ['plain', false],
    ])
    expect([...settingsSearchEntries()]).toEqual([['appearance', [{ id: 'theme', title: 'Theme', description: 'Light or dark' }]]])
    expect(listener).toHaveBeenCalledTimes(1)
    expect(dispose).toBeUndefined()
  })

  it('removes entries with the registration and ignores a stale disposer', () => {
    const first = publishSettingsSearchEntries({ sectionId: 'models', entries: [{ id: 'default', title: 'Default model' }] })
    const second = publishSettingsSearchEntries({ sectionId: 'models', entries: [{ id: 'fallback', title: 'Fallback chain' }] })
    first()
    expect(settingsSearchEntries().get('models')).toEqual([{ id: 'fallback', title: 'Fallback chain' }])
    second()
    expect(settingsSearchEntries().has('models')).toBe(false)
  })

  it('accepts valid metadata', () => {
    const metadata = { settingsTargets: ['a'], searchEntries: [{ id: 'a', title: 'A', keywords: 'x y' }] }
    expect(settingsSectionMetadataSchema.parse(metadata)).toEqual(metadata)
    expect(settingsSectionMetadataSchema.parse({})).toEqual({})
  })

  it.each([
    [
      'duplicate ids',
      {
        searchEntries: [
          { id: 'a', title: 'A' },
          { id: 'a', title: 'B' },
        ],
      },
    ],
    ['an empty title', { searchEntries: [{ id: 'a', title: ' ' }] }],
    ['an empty id', { searchEntries: [{ id: '', title: 'A' }] }],
    ['an unknown entry field', { searchEntries: [{ id: 'a', title: 'A', path: ['x'] }] }],
    ['an unknown metadata field', { searchEntry: [] }],
    ['a non-array entry list', { searchEntries: { id: 'a', title: 'A' } }],
  ])('rejects settings.section metadata with %s', (_label, metadata) => {
    expect(settingsSectionMetadataSchema.safeParse(metadata).success).toBe(false)
  })

  it('publishes untyped metadata as given: the reader decodes it', () => {
    const slots = recordingSlots()
    // JSON round-trips to `any`, as metadata from a JavaScript plugin arrives untyped.
    const slot = defineSlot('settings.section', { id: 'loose', metadata: JSON.parse('{"searchEntries":[{"id":"a"}]}'), component: Section })
    createClientPlugin({ slots: [slot] }, { packageId: '@test/plugin' }).apply(slots.ctx)
    expect(settingsSearchEntries().get('loose')).toEqual([{ id: 'a' }])
  })
})

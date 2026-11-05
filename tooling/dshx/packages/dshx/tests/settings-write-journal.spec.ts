import * as Schema from 'effect/Schema'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { decodeJson } from '../src/json.js'
import { SettingsWriteJournal, type JournalSettingsForm } from '../src/settings/write-journal.js'

const memory = new Map<string, string>()

interface FakeForm extends JournalSettingsForm {
  readonly calls: unknown[][]
  ready(): void
  settle(result: boolean): void
}

const fakeForm = (options: { readonly ready: boolean }): FakeForm => {
  let snapshot = { status: options.ready ? ('ready' as const) : ('loading' as const), writable: options.ready }
  const listeners = new Set<() => void>()
  const calls: unknown[][] = []
  const pending: Array<(result: boolean) => void> = []
  return {
    calls,
    getSnapshot: () => snapshot,
    subscribe: listener => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    mutate: ops => {
      calls.push(ops)
      return new Promise(resolve => pending.push(resolve))
    },
    ready: () => {
      snapshot = { status: 'ready', writable: true }
      for (const listener of [...listeners]) listener()
    },
    settle: result => pending.shift()?.(result),
  }
}

const storedSchema = Schema.Array(Schema.Struct({ id: Schema.String, namespace: Schema.String, ops: Schema.Array(Schema.Json) }))

const stored = () => decodeJson(storedSchema, memory.get(SettingsWriteJournal.storageKey) ?? '[]')

describe('SettingsWriteJournal', () => {
  beforeEach(() => {
    memory.clear()
    globalThis.__dshxReplayedSettingsNamespacesV1 = undefined
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => memory.get(key) ?? null,
      setItem: (key: string, value: string) => memory.set(key, value),
    })
  })
  afterEach(() => vi.unstubAllGlobals())

  it('keeps a write recorded until the Host settles it', async () => {
    const form = fakeForm({ ready: true })
    const writes = SettingsWriteJournal.wrap('sidebar', form)
    const result = writes.set('density', 'compact')
    expect(stored()).toEqual([expect.objectContaining({ namespace: 'sidebar', ops: [{ op: 'set', path: ['density'], value: 'compact' }] })])
    form.settle(true)
    await expect(result).resolves.toBe(true)
    expect(stored()).toEqual([])
  })

  it('forgets a refused write instead of replaying it forever', async () => {
    const form = fakeForm({ ready: true })
    const result = SettingsWriteJournal.wrap('sidebar', form).unset('density')
    form.settle(false)
    await expect(result).resolves.toBe(false)
    expect(stored()).toEqual([])
  })

  it('replays writes an unloaded page left unsettled as one mutation once the namespace is writable', () => {
    const earlier = SettingsWriteJournal.wrap('sidebar', fakeForm({ ready: true }))
    void earlier.set('density', 'compact')
    void earlier.mutate([
      { op: 'set', path: ['sound'], value: { preset: 'chime' } },
      { op: 'unset', path: ['volume'] },
    ])
    void SettingsWriteJournal.wrap('other', fakeForm({ ready: true })).set('x', 1)
    globalThis.__dshxReplayedSettingsNamespacesV1 = undefined

    const reloaded = fakeForm({ ready: false })
    SettingsWriteJournal.wrap('sidebar', reloaded)
    expect(reloaded.calls).toEqual([])
    reloaded.ready()
    expect(reloaded.calls).toEqual([
      [
        { op: 'set', path: ['density'], value: 'compact' },
        { op: 'set', path: ['sound'], value: { preset: 'chime' } },
        { op: 'unset', path: ['volume'] },
      ],
    ])
    expect(stored()).toEqual([expect.objectContaining({ namespace: 'other' }), expect.objectContaining({ namespace: 'sidebar', ops: reloaded.calls[0] })])
  })

  it('replays a namespace once per page', () => {
    void SettingsWriteJournal.wrap('sidebar', fakeForm({ ready: true })).set('density', 'compact')
    globalThis.__dshxReplayedSettingsNamespacesV1 = undefined
    const first = fakeForm({ ready: true })
    SettingsWriteJournal.wrap('sidebar', first)
    const second = fakeForm({ ready: true })
    SettingsWriteJournal.wrap('sidebar', second)
    expect(first.calls).toHaveLength(1)
    expect(second.calls).toEqual([])
  })

  it('refuses a value that is not JSON before recording it', async () => {
    await expect(SettingsWriteJournal.wrap('sidebar', fakeForm({ ready: true })).set('when', () => undefined)).rejects.toThrow('Settings values must be JSON.')
    expect(stored()).toEqual([])
  })
})

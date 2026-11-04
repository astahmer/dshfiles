import { describe, expect, it } from '@effect/vitest'
import { Effect } from 'effect'

import { SharedJevKey, type SharedJevKeySettings } from './jev-key.js'

/** In-memory settings with a real revision check, like DSH's settings forms. */
const memorySettings = (initial: string, options: { readonly failWrites?: boolean } = {}) => {
  let state = { value: { jevSecret: initial }, revision: 0 }
  const settings: SharedJevKeySettings = {
    snapshot: Effect.sync(() => state),
    update: (patch, expectedRevision) =>
      Effect.suspend(() => {
        if (options.failWrites === true) return Effect.fail(new Error('settings unavailable'))
        if (expectedRevision !== undefined && expectedRevision !== state.revision) return Effect.fail(new Error('conflict'))
        state = { value: { ...state.value, ...patch }, revision: state.revision + 1 }
        return Effect.void
      }),
  }
  return { settings, current: () => state }
}

describe('SharedJevKey.reference', () => {
  it('prefers the shared key, falls back to the plugin key, and leaves both empty to the environment', () => {
    expect(SharedJevKey.reference({ shared: 'secret:SHARED', legacy: 'secret:OLD' })).toBe('secret:SHARED')
    expect(SharedJevKey.reference({ shared: '  ', legacy: ' secret:OLD ' })).toBe('secret:OLD')
    expect(SharedJevKey.reference({ shared: '', legacy: '' })).toBe('')
  })
})

describe('SharedJevKey.adopt', () => {
  it.effect('copies a plugin key into an empty shared key once', () =>
    Effect.gen(function* () {
      const store = memorySettings('')
      expect(yield* SharedJevKey.adopt(store.settings, 'secret:BACKLOG_KEY')).toEqual({ kind: 'adopted' })
      expect(store.current().value.jevSecret).toBe('secret:BACKLOG_KEY')
      // The second plugin finds it set and changes nothing.
      expect(yield* SharedJevKey.adopt(store.settings, 'secret:MEMORY_KEY')).toEqual({ kind: 'kept' })
      expect(store.current()).toEqual({ value: { jevSecret: 'secret:BACKLOG_KEY' }, revision: 1 })
    }),
  )

  it.effect('never overwrites a shared key that is already set', () =>
    Effect.gen(function* () {
      const store = memorySettings('secret:SHARED')
      expect(yield* SharedJevKey.adopt(store.settings, 'secret:OLD')).toEqual({ kind: 'kept' })
      expect(store.current()).toEqual({ value: { jevSecret: 'secret:SHARED' }, revision: 0 })
    }),
  )

  it.effect('loses a race to a concurrent write instead of overwriting it', () =>
    Effect.gen(function* () {
      const store = memorySettings('')
      const stale = store.current()
      // The user saves a key between this plugin's read and its write.
      yield* store.settings.update({ jevSecret: 'secret:USER_KEY' })
      const racing: SharedJevKeySettings = { snapshot: Effect.succeed(stale), update: store.settings.update }
      expect((yield* SharedJevKey.adopt(racing, 'secret:OLD')).kind).toBe('deferred')
      expect(store.current().value.jevSecret).toBe('secret:USER_KEY')
    }),
  )

  it.effect('keeps nothing to adopt when the plugin had no key', () =>
    Effect.gen(function* () {
      const store = memorySettings('')
      expect(yield* SharedJevKey.adopt(store.settings, '   ')).toEqual({ kind: 'kept' })
      expect(store.current().revision).toBe(0)
    }),
  )

  it.effect('defers instead of failing when the write is refused', () =>
    Effect.gen(function* () {
      const store = memorySettings('', { failWrites: true })
      const result = yield* SharedJevKey.adopt(store.settings, 'secret:OLD')
      expect(result.kind).toBe('deferred')
      expect(store.current().value.jevSecret).toBe('')
    }),
  )
})

import { describe, expect, it, vi } from 'vitest'
import type { SavedPrompt } from './library.js'
import { LocalLibraryStore } from './local-library-store.js'

const PRIMARY_KEY = 'dshfiles.prompt-stash.library-local.v2'
const LEGACY_KEY = 'dshfiles.prompt-stash.v1'

const prompt = (index: number, text = `Text ${index}`): SavedPrompt => ({
  id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
  revision: `10000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
  title: `Prompt ${index}`,
  text,
  updatedAt: index,
})

const serializedLibrary = (...prompts: SavedPrompt[]): string => JSON.stringify({ version: 1, prompts })

/** A minimal in-memory Storage; a method that should fail is overridden by the test. */
const memoryStorage = (entries: Record<string, string> = {}) => {
  const map = new Map(Object.entries(entries))
  return {
    map,
    getItem: (key: string): string | null => map.get(key) ?? null,
    setItem: (key: string, value: string): void => {
      map.set(key, value)
    },
    removeItem: (key: string): void => {
      map.delete(key)
    },
  }
}

describe('local prompt library store', () => {
  it('serves a legacy library as the library and remembers its captured copy', () => {
    const legacy = prompt(1)
    const storage = memoryStorage({ [LEGACY_KEY]: serializedLibrary(legacy) })
    const store = new LocalLibraryStore()

    expect(store.readLegacy(storage, LEGACY_KEY)).toBe(serializedLibrary(legacy))
    expect(store.getSnapshot()).toMatchObject({
      status: { read: 'ready', writable: true },
      primary: null,
      legacy: { kind: 'imported', copy: { serialized: serializedLibrary(legacy) } },
    })
  })

  it('keeps an unreadable legacy payload unresolved with no copy to migrate', () => {
    const storage = memoryStorage({ [LEGACY_KEY]: '{not json' })
    const store = new LocalLibraryStore()

    expect(store.readLegacy(storage, LEGACY_KEY)).toBe('{not json')
    expect(store.getSnapshot().legacy).toStrictEqual({ kind: 'unresolved' })
    expect(store.getSnapshot().status.read).toBe('invalid')
  })

  it('serves the primary library and keeps the legacy copy still waiting for migration', () => {
    const primary = prompt(1)
    const legacy = prompt(2)
    const storage = memoryStorage({ [PRIMARY_KEY]: serializedLibrary(primary), [LEGACY_KEY]: serializedLibrary(legacy) })
    const store = new LocalLibraryStore()

    expect(store.readPrimary(storage, LEGACY_KEY, serializedLibrary(primary))).toBe(serializedLibrary(primary))
    expect(store.getSnapshot()).toMatchObject({
      status: { read: 'ready' },
      primary: { serialized: serializedLibrary(primary) },
      legacy: { kind: 'imported', copy: { serialized: serializedLibrary(legacy) } },
    })
  })

  it('keeps an unreadable primary unreadable without claiming the legacy copy', () => {
    const storage = memoryStorage({ [PRIMARY_KEY]: '{not json', [LEGACY_KEY]: serializedLibrary(prompt(2)) })
    const store = new LocalLibraryStore()

    expect(store.readPrimary(storage, LEGACY_KEY, '{not json')).toBe('{not json')
    expect(store.getSnapshot()).toMatchObject({ status: { read: 'invalid' }, primary: null, legacy: { kind: 'unresolved' } })
  })

  it('moves the primary copy on write and remove without touching the legacy copy', () => {
    const primary = prompt(1)
    const legacy = prompt(2)
    const storage = memoryStorage({ [PRIMARY_KEY]: serializedLibrary(primary), [LEGACY_KEY]: serializedLibrary(legacy) })
    const store = new LocalLibraryStore()
    store.readPrimary(storage, LEGACY_KEY, serializedLibrary(primary))

    store.write(serializedLibrary(primary, prompt(3)))
    expect(store.getSnapshot()).toMatchObject({ primary: { serialized: serializedLibrary(primary, prompt(3)) }, legacy: { kind: 'imported' } })

    store.remove()
    expect(store.getSnapshot()).toMatchObject({ primary: null, legacy: { kind: 'imported' }, status: { read: 'ready', writable: true } })
  })

  it('clears the legacy copy first, then the primary copy it migrated', () => {
    const library = prompt(1)
    const serialized = serializedLibrary(library)
    const storage = memoryStorage({ [PRIMARY_KEY]: serialized, [LEGACY_KEY]: serialized })
    const store = new LocalLibraryStore()
    store.readPrimary(storage, LEGACY_KEY, serialized)

    const reload = store.completeMigration({ storage, primaryKey: PRIMARY_KEY, legacyKey: LEGACY_KEY, expectedStore: { version: 1, prompts: [library] } })

    expect(reload).toBe(true)
    expect(storage.map.has(PRIMARY_KEY)).toBe(false)
    expect(storage.map.has(LEGACY_KEY)).toBe(false)
    expect(store.getSnapshot()).toMatchObject({ primary: null, legacy: { kind: 'absent' }, status: { read: 'ready', writable: true } })
  })

  it('leaves both copies when the legacy key changed after it was captured', () => {
    const library = prompt(1)
    const primarySerialized = serializedLibrary(library)
    const capturedLegacy = serializedLibrary(prompt(9))
    const storage = memoryStorage({ [PRIMARY_KEY]: primarySerialized, [LEGACY_KEY]: capturedLegacy })
    const store = new LocalLibraryStore()
    store.readPrimary(storage, LEGACY_KEY, primarySerialized)
    storage.setItem(LEGACY_KEY, serializedLibrary(prompt(9), prompt(10)))

    const reload = store.completeMigration({ storage, primaryKey: PRIMARY_KEY, legacyKey: LEGACY_KEY, expectedStore: { version: 1, prompts: [library] } })

    expect(reload).toBe(false)
    expect(storage.map.has(PRIMARY_KEY)).toBe(true)
    expect(storage.map.has(LEGACY_KEY)).toBe(true)
    expect(store.getSnapshot().legacy.kind).toBe('imported')
  })

  it('reports the library unavailable when the storage refuses the clear', () => {
    const library = prompt(1)
    const serialized = serializedLibrary(library)
    const storage = memoryStorage({ [PRIMARY_KEY]: serialized, [LEGACY_KEY]: serialized })
    const store = new LocalLibraryStore()
    store.readPrimary(storage, LEGACY_KEY, serialized)
    storage.removeItem = vi.fn(() => {
      throw new Error('storage denied')
    })

    expect(store.completeMigration({ storage, primaryKey: PRIMARY_KEY, legacyKey: LEGACY_KEY, expectedStore: { version: 1, prompts: [library] } })).toBe(true)
    expect(store.getSnapshot().status).toEqual({ read: 'unavailable', writable: false })
  })
})

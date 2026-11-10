import type { PromptLibraryLocalStatus } from './library-migration-machine.js'
import { PromptLibrary, type PromptLibraryStore } from './library.js'

export interface LocalLibraryStatus {
  readonly read: PromptLibraryLocalStatus
  readonly writable: boolean
}

/** One stored copy of a library: the exact serialized text and the store it decodes to. */
interface LibraryCopy {
  readonly serialized: string
  readonly storeFingerprint: string
}

/** The legacy key, as far as local migration is concerned: nothing to migrate, its captured copy, or an unusable payload. */
export type LegacyLibrary = { readonly kind: 'absent' } | { readonly kind: 'imported'; readonly copy: LibraryCopy } | { readonly kind: 'unresolved' }

export interface LocalLibraryState {
  readonly status: LocalLibraryStatus
  /** The primary key's copy; an imported legacy copy always carries its fingerprints, and an unresolved one carries none. */
  readonly primary: LibraryCopy | null
  readonly legacy: LegacyLibrary
}

type ReadableStorage = Pick<Storage, 'getItem'>
type ClearableStorage = Pick<Storage, 'getItem' | 'removeItem'>

const copyOf = (serialized: string, store: PromptLibraryStore): LibraryCopy => ({ serialized, storeFingerprint: JSON.stringify(store) })

const legacyFrom = (serialized: string | null): LegacyLibrary => {
  const result = PromptLibrary.readStoredWithSource(serialized)
  if (result.kind === 'library' && serialized !== null) return { kind: 'imported', copy: copyOf(serialized, result.store) }
  return result.kind === 'invalid' ? { kind: 'unresolved' } : { kind: 'absent' }
}

/**
 * The saved-prompt library's browser copy beside the Host: one union, so "legacy fingerprints captured while unresolved"
 * cannot be described. The storage adapter feeds it and `usePromptLibrary` subscribes to its status.
 */
export class LocalLibraryStore {
  private state: LocalLibraryState = { status: { read: 'ready', writable: true }, primary: null, legacy: { kind: 'absent' } }
  private readonly listeners = new Set<() => void>()

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  readonly getSnapshot = (): LocalLibraryState => this.state

  private set(next: LocalLibraryState): void {
    this.state = next
    for (const listener of this.listeners) listener()
  }

  setStatus(read: PromptLibraryLocalStatus, writable: boolean): void {
    if (this.state.status.read === read && this.state.status.writable === writable) return
    this.set({ ...this.state, status: { read, writable } })
  }

  /** The primary key is missing: serve the legacy library's own store and remember it for migration. */
  readLegacy(storage: ReadableStorage, legacyKey: string): string {
    const serialized = storage.getItem(legacyKey)
    const result = PromptLibrary.readStoredWithSource(serialized)
    if (result.kind === 'library' && serialized !== null) {
      this.set({
        status: { read: 'ready', writable: this.state.status.writable },
        primary: null,
        legacy: { kind: 'imported', copy: copyOf(serialized, result.store) },
      })
      return JSON.stringify(result.store)
    }
    this.set({
      status: { read: result.kind === 'invalid' ? 'invalid' : 'ready', writable: this.state.status.writable },
      primary: null,
      legacy: result.kind === 'invalid' ? { kind: 'unresolved' } : { kind: 'absent' },
    })
    return result.kind === 'invalid' && serialized !== null ? serialized : JSON.stringify(PromptLibrary.emptyStore())
  }

  /** The primary key is present: serve it, and keep the legacy copy only while it can still be migrated. */
  readPrimary(storage: ReadableStorage, legacyKey: string, serialized: string): string {
    const result = PromptLibrary.readStoredWithSource(serialized)
    if (result.kind !== 'library') {
      this.set({
        status: { read: 'invalid', writable: this.state.status.writable },
        primary: null,
        legacy: result.kind === 'legacy-drafts' ? { kind: 'absent' } : { kind: 'unresolved' },
      })
      return serialized
    }
    this.set({
      status: { read: 'ready', writable: this.state.status.writable },
      primary: copyOf(serialized, result.store),
      legacy: legacyFrom(storage.getItem(legacyKey)),
    })
    return JSON.stringify(result.store)
  }

  /** The adapter wrote the primary key: its serialized text is the current copy. */
  write(serialized: string): void {
    this.set({ status: { read: 'ready', writable: true }, primary: { serialized, storeFingerprint: serialized }, legacy: this.state.legacy })
  }

  /** The adapter removed the primary key. */
  remove(): void {
    this.set({ status: { read: 'ready', writable: true }, primary: null, legacy: this.state.legacy })
  }

  /** Clear both local copies once the Host holds them; the caller reloads the stored value when something was cleared. */
  completeMigration(input: {
    readonly storage: ClearableStorage
    readonly primaryKey: string
    readonly legacyKey: string
    readonly expectedStore: PromptLibraryStore
  }): boolean {
    const legacy = this.state.legacy
    try {
      const legacyCleared =
        legacy.kind === 'imported' &&
        PromptLibrary.clearStoredIfUnchanged({
          storage: input.storage,
          key: input.legacyKey,
          serialized: legacy.copy.serialized,
          storeFingerprint: legacy.copy.storeFingerprint,
          expectedStore: input.expectedStore,
        })
      const remainingLegacy: LegacyLibrary = legacyCleared ? { kind: 'absent' } : legacy
      const primary = this.state.primary
      const primaryCleared =
        remainingLegacy.kind === 'absent' &&
        primary !== null &&
        PromptLibrary.clearStoredIfUnchanged({
          storage: input.storage,
          key: input.primaryKey,
          serialized: primary.serialized,
          storeFingerprint: primary.storeFingerprint,
          expectedStore: input.expectedStore,
        })
      this.set({
        status: { read: 'ready', writable: true },
        primary: primaryCleared ? null : primary,
        legacy: remainingLegacy,
      })
      return legacyCleared || primaryCleared
    } catch {
      this.setStatus('unavailable', false)
      return true
    }
  }
}

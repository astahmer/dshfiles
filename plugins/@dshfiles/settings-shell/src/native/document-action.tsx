/**
 * Ported from @deepseek-ai/dsh-client-ui-settings-general@0.2.0-rc.2 (MIT): `settings-document-store.js`. Whether the
 * provider owns a local settings document, and its pathless native open. The action that renders it is
 * `open-config-action.tsx`, a split button in place of the native single button.
 */
import type { SettingsDescribeFace } from '@deepseek-ai/dsh-client-ui-settings/client'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'

/** Mutable: the snapshot store hands updates an immer draft. */
export interface SettingsDocumentState {
  status: 'idle' | 'loading' | 'ready' | 'unavailable'
  opening: boolean
  error: string | null
}

type OpenDocument = () => Promise<{ readonly ok: true } | { readonly ok: false; readonly error: { readonly message: string } }>

/** Derives local-document availability from the shared mirror and invokes the pathless Host-owned open operation. */
export class SettingsDocumentStore {
  readonly store = createSnapshotStore<SettingsDocumentState>({ status: 'idle', opening: false, error: null })
  private following: (() => void) | undefined

  constructor(
    private readonly describeFace: SettingsDescribeFace,
    private readonly openDocument: OpenDocument,
  ) {}

  /** Begin following the mirror (idempotent) and reflect whether the current provider owns a local document. */
  async load(): Promise<void> {
    this.following ??= this.describeFace.subscribe(() => this.derive())
    this.store.update(state => {
      state.status = 'loading'
      state.error = null
    })
    await this.describeFace.ensure()
    this.derive()
  }

  /** Open the loaded document once; concurrent gestures collapse behind the in-flight action. */
  async open(): Promise<void> {
    const current = this.store.getSnapshot()
    if (current.status !== 'ready' || current.opening) return
    this.store.update(state => {
      state.opening = true
      state.error = null
    })
    try {
      const result = await this.openDocument()
      if (!result.ok) {
        const message = result.error.message
        this.store.update(state => {
          state.error = message
        })
      }
    } finally {
      this.store.update(state => {
        state.opening = false
      })
    }
  }

  dispose(): void {
    this.following?.()
    this.following = undefined
  }

  private derive(): void {
    const mirrored = this.describeFace.getSnapshot()
    if (mirrored.view === undefined) {
      if (mirrored.error !== null) {
        const error = mirrored.error
        this.store.update(state => {
          state.status = 'unavailable'
          state.error = error
        })
      }
      return
    }
    const hasDocument = mirrored.view.hasDocument
    this.store.update(state => {
      state.status = hasDocument ? 'ready' : 'unavailable'
      state.error = null
    })
  }
}

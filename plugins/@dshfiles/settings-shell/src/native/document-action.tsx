/**
 * Ported from @deepseek-ai/dsh-client-ui-settings-general@0.2.0-rc.2 (MIT): `SettingsDocumentAction.js` and
 * `settings-document-store.js`. Opens the provider-owned local settings document on a loopback browser.
 */
import type { SettingsDescribeFace } from '@deepseek-ai/dsh-client-ui-settings/client'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import { useEffect } from 'react'
import type { ShellTranslate } from './locales.js'
import { useObservable } from './use-observable.js'

/** Mutable: the snapshot store hands updates an immer draft. */
interface DocumentState {
  status: 'idle' | 'loading' | 'ready' | 'unavailable'
  opening: boolean
  error: string | null
}

type OpenDocument = () => Promise<{ readonly ok: true } | { readonly ok: false; readonly error: { readonly message: string } }>

/** Derives local-document availability from the shared mirror and invokes the pathless Host-owned open operation. */
export class SettingsDocumentStore {
  readonly store = createSnapshotStore<DocumentState>({ status: 'idle', opening: false, error: null })
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

/** The open-document action, rendered only after Host metadata confirms the document exists. */
export const SettingsDocumentAction = (props: { readonly controller: SettingsDocumentStore; readonly t: ShellTranslate }): JSX.Element | null => {
  const state = useObservable(props.controller.store)
  useEffect(() => {
    void props.controller.load()
  }, [props.controller])
  if (state.status !== 'ready') return null
  return (
    <div className="dshx:flex dshx:min-w-0 dshx:items-center dshx:gap-2">
      {state.error !== null && (
        <span className="dshx:max-w-[180px] dshx:truncate dshx:text-[12px] dshx:leading-[18px] dshx:text-[var(--dsw-alias-state-error-primary)]" role="alert">
          {props.t('openDocument.error')}
        </span>
      )}
      <Button disabled={state.opening} onClick={() => void props.controller.open()} size="sm" variant="outline">
        {props.t('openDocument')}
      </Button>
    </div>
  )
}

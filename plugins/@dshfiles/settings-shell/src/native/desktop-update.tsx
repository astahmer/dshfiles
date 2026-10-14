/**
 * Ported from @deepseek-ai/dsh-client-ui-settings-general@0.2.0-rc.2 (MIT): `DesktopUpdateIndicator.js` and
 * `desktop-update-source.js`. Optional Electron update status; the native shell owns actions and Web owns copy.
 */
import type { DesktopUpdateBridge, DesktopUpdatePresentation, DesktopUpdateView } from '@deepseek-ai/dsh-client-ui-settings-general/types'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { IconDownloadOutlineRegular, IconLoadingOutlineRegular, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import { useSyncExternalStore } from 'react'
import { z } from 'zod'
import type { ShellTranslate } from './locales.js'

const BUSY_PHASES: ReadonlySet<DesktopUpdatePresentation['phase']> = new Set(['checking', 'downloading', 'verifying', 'installing'])

interface DesktopGlobal {
  readonly dshDesktop: { readonly protocolVersion: 1; readonly updates: DesktopUpdateBridge }
}

const desktopGlobalShape = z.object({
  dshDesktop: z.object({
    protocolVersion: z.literal(1),
    updates: z.object({ status: z.function(), open: z.function(), subscribe: z.function() }),
  }),
})
/** `z.custom` keeps the preload's own objects: the bridge methods may rely on their `this`. */
const desktopGlobalSchema = z.custom<DesktopGlobal>(value => desktopGlobalShape.safeParse(value).success)

/** The Desktop preload's update carrier, or undefined in a browser or an unknown protocol. */
export const desktopUpdateBridge = (): DesktopUpdateBridge | undefined => {
  const desktop = desktopGlobalSchema.safeParse(globalThis)
  return desktop.success ? desktop.data.dshDesktop.updates : undefined
}

interface UpdateCopy {
  readonly label: string
  readonly detail: string
}

const updateCopy = (state: DesktopUpdatePresentation, t: ShellTranslate): UpdateCopy => {
  const label = {
    idle: '',
    checking: t('desktop.update.checking'),
    available: t('desktop.update.available'),
    downloading: t('desktop.update.progress', { percent: state.percent ?? 0 }),
    verifying: t('desktop.update.verifying'),
    installing: t('desktop.update.installing'),
    ready: t('desktop.update.ready'),
    error: t('desktop.update.retry'),
  }[state.phase]
  if (state.phase === 'checking' || state.phase === 'verifying' || state.phase === 'installing') return { label, detail: state.version ?? label }
  if (state.phase === 'error') {
    return {
      label,
      detail: {
        check: t('desktop.update.checkFailed'),
        'check-network': t('desktop.update.checkNetworkFailed'),
        download: t('desktop.update.downloadFailed'),
        'download-network': t('desktop.update.downloadNetworkFailed'),
        install: t('desktop.update.installFailed'),
        'install-network': t('desktop.update.installNetworkFailed'),
        'stop-failed': t('desktop.update.stopFailed'),
        'tasks-changed': t('desktop.update.tasksChanged'),
        'tasks-unavailable': t('desktop.update.tasksUnavailable'),
      }[state.failure ?? 'install'],
    }
  }
  if (state.phase === 'downloading' && state.version !== undefined) {
    return { label, detail: t('desktop.update.downloadDetail', { percent: state.percent ?? 0, version: state.version }) }
  }
  return { label, detail: state.version === undefined ? label : t('desktop.update.versionDetail', { label, version: state.version }) }
}

/** Owns one preload subscription across both sidebar locations. */
export class DesktopUpdateSource {
  /** Framework-observed carrier status shared by both sidebar controls. */
  readonly store = createSnapshotStore<DesktopUpdateView>({ failed: false, opening: false })
  private live = true
  private received = false
  private readonly unsubscribe: (() => void) | undefined

  constructor(private readonly bridge: DesktopUpdateBridge | undefined) {
    this.unsubscribe = bridge?.subscribe(presentation => {
      if (!this.live) return
      this.received = true
      this.store.set({ ...this.store.getSnapshot(), presentation, failed: false })
    })
    bridge?.status().then(
      presentation => {
        if (this.live && !this.received) this.store.set({ ...this.store.getSnapshot(), presentation })
      },
      () => {
        if (this.live && !this.received) this.store.set({ ...this.store.getSnapshot(), failed: true })
      },
    )
  }

  /** Invoke one user action; subsequent clicks join the shell-owned operation. */
  open(): void {
    if (!this.live || this.bridge === undefined) return
    const state = this.store.getSnapshot()
    if (state.opening || (state.presentation !== undefined && BUSY_PHASES.has(state.presentation.phase))) return
    this.store.set({ ...state, opening: true })
    this.bridge
      .open()
      .catch(() => {
        if (this.live) this.store.set({ ...this.store.getSnapshot(), failed: true })
      })
      .finally(() => {
        if (this.live) this.store.set({ ...this.store.getSnapshot(), opening: false })
      })
  }

  /** Detach the carrier and ignore any pending status or action completion. */
  dispose(): void {
    this.live = false
    this.unsubscribe?.()
  }
}

const useUpdateView = (source: DesktopUpdateSource): DesktopUpdateView =>
  useSyncExternalStore(
    listener => source.store.subscribe(listener),
    () => source.store.getSnapshot(),
  )

/** Update status beside the account button with connection-indicator geometry, including retries; nothing in browsers. */
export const DesktopUpdateIndicator = (props: {
  readonly wide: boolean
  readonly hidden: boolean
  readonly t: ShellTranslate
  readonly source: DesktopUpdateSource
}): JSX.Element | null => {
  const { presentation: state, failed, opening } = useUpdateView(props.source)
  if (!props.wide || props.hidden || (!failed && (state === undefined || state.phase === 'idle'))) return null
  const retryLabel = props.t('desktop.update.retry')
  const copy: UpdateCopy = state === undefined ? { label: retryLabel, detail: retryLabel } : updateCopy(state, props.t)
  const label = failed ? retryLabel : copy.label
  const error = failed || state?.phase === 'error'
  const busy = opening || (state !== undefined && BUSY_PHASES.has(state.phase))
  return (
    <Tooltip label={failed ? retryLabel : copy.detail} side="top">
      <button
        aria-disabled={busy}
        aria-label={label}
        className="dshx:box-border dshx:inline-grid dshx:h-7 dshx:flex-none dshx:cursor-pointer dshx:grid-cols-[14px_max-content] dshx:items-center dshx:gap-x-1 dshx:rounded-[var(--dsw-radius-sm)] dshx:border dshx:border-[color-mix(in_srgb,var(--dsw-alias-brand-primary-new-colorprimary-new-color)_20%,transparent)] dshx:bg-[color-mix(in_srgb,var(--dsw-alias-brand-primary-new-colorprimary-new-color)_8%,transparent)] dshx:px-2 dshx:text-left dshx:text-[12px] dshx:leading-[18px] dshx:font-medium dshx:whitespace-nowrap dshx:text-[var(--dsw-alias-brand-primary-new-colorprimary-new-color)] dshx:aria-disabled:cursor-default"
        onClick={() => {
          if (!busy) props.source.open()
        }}
        type="button"
      >
        <span aria-hidden="true" className="dshx:grid dshx:size-3.5 dshx:place-items-center">
          {error ? (
            <span className="dshx:size-1.5 dshx:rounded-full dshx:bg-current" />
          ) : busy ? (
            <IconLoadingOutlineRegular className="dshx:animate-spin dshx:motion-reduce:animate-none" size={14} />
          ) : (
            <IconDownloadOutlineRegular size={14} />
          )}
        </span>
        <span>{label}</span>
      </button>
    </Tooltip>
  )
}

/** A non-interactive brand-blue notification on the collapsed sidebar's expand button. */
export const DesktopUpdateBadge = (props: {
  readonly t: ShellTranslate
  readonly source: DesktopUpdateSource
  readonly connectionState: string | undefined
}): JSX.Element | null => {
  const { presentation: state, failed } = useUpdateView(props.source)
  const offline = props.connectionState === 'disconnected' || props.connectionState === 'connecting'
  if ((offline && state?.phase !== 'installing') || (!failed && (state === undefined || state.phase === 'idle'))) return null
  const retryLabel = props.t('desktop.update.retry')
  const copy: UpdateCopy = state === undefined ? { label: retryLabel, detail: retryLabel } : updateCopy(state, props.t)
  const label = failed ? retryLabel : copy.label
  return (
    <Tooltip label={failed ? label : copy.detail} side="right">
      <span
        aria-label={label}
        className="dshx:absolute dshx:end-0.5 dshx:top-0.5 dshx:size-1.5 dshx:rounded-full dshx:bg-[var(--dsw-alias-brand-primary-new-colorprimary-new-color)]"
        role="img"
      />
    </Tooltip>
  )
}

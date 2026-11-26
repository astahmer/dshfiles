import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import type {} from '@deepseek-ai/dsh-client-ui-plugin-manager/client'
import { createApiClient, defineClient } from '@dshfiles/dshx/client'
import { PendingRestartSources } from '@dshfiles/thread-sidebar/restart-sources'
import * as Schema from 'effect/Schema'
import { useSyncExternalStore } from 'react'
import { hmrGateApi } from './api.js'
import { decodeFrame, type DeferredPackage, type HmrFrame } from './frames.js'
import { createPendingReread } from './reread.js'
import { rowSummary } from './row-summary.js'
import { SlotCrashRecovery } from './slot-crash-recovery.js'
import { createQuietReload, SwapGuard } from './swap-guard.js'
import { HeldUpdates, UpdateDeferral, type ApplyUpdates, type HeldFrame, type PageMoment } from './update-deferral.js'

/**
 * The browser half of the gate: the stock `/plugins/events` subscriber, plus the
 * Plugins-page row that names what a Host restart would apply.
 *
 * `graph` and `rebuilt` frames do exactly what `@deepseek-ai/dsh-client-hmr` does
 * with them; `deferred` frames only move the notice. The page uses a same-origin
 * EventSource (this repository's Web profile) and reopens a short-lived one when
 * it comes back, so a slept tab or a reset stream cannot hide a restart.
 */

const EVENTS_ROUTE = 'plugins/events'
const ROW_ID = 'dshfiles-hmr-gate'
// A probe stream the Host never answers must not stay open past one connect round trip.
const REREAD_TIMEOUT_MS = 10_000
// How often a page holding updates checks whether the reader went idle.
const IDLE_CHECK_MS = 5_000

/** The slice of the Client `connection` service the gate reads: whether the Host connection is live. */
const connectionStateSchema = Schema.declare<Pick<ConnectionHandle, 'state'>>(
  (value): value is Pick<ConnectionHandle, 'state'> =>
    typeof value === 'object' &&
    value !== null &&
    'state' in value &&
    typeof value.state === 'object' &&
    value.state !== null &&
    'getSnapshot' in value.state &&
    typeof value.state.getSnapshot === 'function' &&
    'subscribe' in value.state &&
    typeof value.state.subscribe === 'function',
)

const phonePage = (): boolean => window.matchMedia('(pointer: coarse)').matches || /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent)

type GraphFrame = Extract<HmrFrame, { readonly type: 'graph' }>

let current: readonly DeferredPackage[] = []
let currentIds: readonly string[] = []
const listeners = new Set<() => void>()

const publish = (next: readonly DeferredPackage[]): void => {
  if (next.length === current.length && next.every((entry, index) => entry.id === current[index]?.id)) return
  current = next
  currentIds = next.map(entry => entry.id)
  for (const listener of listeners) listener()
}

const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

const snapshot = (): readonly DeferredPackage[] => current

const HmrGateRow = (props: { readonly view: 'summary' | 'page' }): JSX.Element | null => {
  const packages = useSyncExternalStore(subscribe, snapshot, snapshot)

  if (props.view === 'summary') {
    return <span className="dshx:text-muted-foreground dshx:text-sm">{rowSummary(packages.map(entry => entry.id))}</span>
  }

  return (
    <section className="dshx-root dshx:flex dshx:flex-col dshx:gap-3">
      <p className="dshx:min-w-0 dshx:text-muted-foreground dshx:text-sm">
        These plugins were rebuilt. The page keeps their previous version until DSH restarts, so both sides stay in step.
      </p>
      {packages.length === 0 ? (
        <p className="dshx:text-muted-foreground dshx:text-sm">Nothing is waiting for a restart.</p>
      ) : (
        <ul className="dshx:flex dshx:flex-col dshx:gap-1">
          {packages.map(entry => (
            <li className="dshx:flex dshx:min-w-0 dshx:items-baseline dshx:gap-2 dshx:text-sm" key={entry.id}>
              <span className="dshx:font-mono dshx:text-xs">{entry.id}</span>
              <span className="dshx:min-w-0 dshx:truncate dshx:text-muted-foreground">Needs a DSH restart</span>
            </li>
          ))}
        </ul>
      )}
      {packages.length === 0 ? null : <p className="dshx:text-muted-foreground dshx:text-sm">Restart DSH, then refresh this page.</p>}
    </section>
  )
}

export default defineClient({
  name: '@dshfiles/hmr-gate',
  // `modules` is the client module table the frames drive; `slots` seats the row; `connection` holds updates while the
  // Host is unreachable; `remote` reads the row's `applyUpdates`.
  inject: ['modules', 'slots', 'connection', 'remote'],
  setup(ctx, _decorate, metadata) {
    const plugin = metadata?.plugin
    if (plugin !== undefined) {
      // thread-sidebar's one restart status item lists these beside the Host files it watches and owns the restart verbs.
      ctx.effect(
        () => plugin.add(PendingRestartSources, { id: '@dshfiles/hmr-gate', subscribe, packages: () => currentIds }),
        'hmr-gate: pending restart source',
      )
    }
    const editing = (): boolean => {
      const active = document.activeElement
      return active instanceof HTMLElement && (active.isContentEditable || active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement)
    }
    // A swap the renderer cannot survive becomes one planned reload, taken when it loses nothing.
    const reloadQuietly = createQuietReload({
      hidden: () => document.visibilityState === 'hidden',
      editing,
      onSettle: listener => {
        document.addEventListener('focusout', listener)
        document.addEventListener('visibilitychange', listener)
        return () => {
          document.removeEventListener('focusout', listener)
          document.removeEventListener('visibilitychange', listener)
        }
      },
      reload: () => window.location.reload(),
    })
    const currentRows = () => ctx.modules.manifest.modules
    const guardState = () => ({ rows: currentRows(), release: ctx.modules.manifest.release?.version })
    /** Take one code update now: a live swap, or the planned reload when the renderer cannot survive it. */
    const applyUpdate = (update: HeldFrame<GraphFrame>): void => {
      if (update.type === 'graph') {
        if (SwapGuard.graphNeedsReload(guardState(), update.frame)) {
          reloadQuietly()
          return
        }
        void ctx.modules.entries.sync(update.frame.graph).catch((error: unknown) => {
          ctx.logger.warn(error)
        })
        return
      }
      if (SwapGuard.rebuiltNeedsReload(currentRows(), update.id)) {
        reloadQuietly()
        return
      }
      void ctx.modules.entries.reload(update.id, update.rev).catch((error: unknown) => {
        ctx.logger.warn(error)
      })
    }

    // Updates wait for a moment the reader cannot see: the page hidden, or the reader idle (src/update-deferral.ts).
    const connection = Schema.decodeUnknownSync(connectionStateSchema)(ctx.get('connection'))
    const phone = phonePage()
    let applyUpdates: ApplyUpdates = 'auto'
    let visibleSince = Date.now()
    let lastInputAt = 0
    let pointerActive = false
    const held = new HeldUpdates<GraphFrame>()
    const moment = (): PageMoment => {
      const state = connection.state.getSnapshot()
      return {
        now: Date.now(),
        hidden: document.visibilityState === 'hidden',
        focused: document.hasFocus(),
        connected: state !== 'disconnected' && state !== 'connecting',
        phone,
        visibleSince,
        lastInputAt,
        editing: editing(),
        pointerActive,
      }
    }
    const flush = (): void => {
      if (held.size === 0 || !UpdateDeferral.canApply({ mode: applyUpdates, page: moment(), ids: held.ids() })) return
      for (const update of held.take()) applyUpdate(update)
    }
    const offer = (update: HeldFrame<GraphFrame>): void => {
      held.add(update)
      flush()
    }

    /** Handles one frame; returns true when it moved the deferred notice. */
    const receive = (data: string): boolean => {
      const frame = decodeFrame(data)
      if (frame === undefined) return false
      if (frame.type === 'graph') {
        const ids = SwapGuard.graphChanges(guardState(), frame)
        // The connect frame repeats the graph the page already runs: nothing to swap, nothing to hold.
        if (ids.length === 0 && held.size === 0) applyUpdate({ type: 'graph', frame, ids })
        else offer({ type: 'graph', frame, ids })
        return false
      }
      if (frame.type === 'rebuilt') {
        offer({ type: 'rebuilt', id: frame.id, rev: frame.rev })
        return false
      }
      publish(frame.packages)
      return true
    }

    const api = createApiClient(ctx, hmrGateApi, metadata?.packageId)
    void api.safe.status({}).then(result => {
      if (result.ok && result.value.applyUpdates !== undefined) applyUpdates = result.value.applyUpdates
      flush()
    })

    ctx.effect(() => {
      const input = (): void => {
        lastInputAt = Date.now()
      }
      const pointerDown = (): void => {
        pointerActive = true
        input()
      }
      const pointerUp = (): void => {
        pointerActive = false
        input()
      }
      const visibility = (): void => {
        if (document.visibilityState === 'visible') visibleSince = Date.now()
        flush()
      }
      const inputs = ['keydown', 'wheel', 'touchstart', 'scroll'] as const
      for (const type of inputs) document.addEventListener(type, input, { capture: true, passive: true })
      document.addEventListener('pointerdown', pointerDown, { capture: true, passive: true })
      document.addEventListener('pointerup', pointerUp, { capture: true, passive: true })
      document.addEventListener('pointercancel', pointerUp, { capture: true, passive: true })
      document.addEventListener('visibilitychange', visibility)
      document.addEventListener('focusout', flush)
      window.addEventListener('pagehide', flush)
      window.addEventListener('blur', flush)
      const offConnection = connection.state.subscribe(flush)
      const idleCheck = setInterval(() => {
        if (held.size > 0) flush()
      }, IDLE_CHECK_MS)
      return () => {
        for (const type of inputs) document.removeEventListener(type, input, { capture: true })
        document.removeEventListener('pointerdown', pointerDown, { capture: true })
        document.removeEventListener('pointerup', pointerUp, { capture: true })
        document.removeEventListener('pointercancel', pointerUp, { capture: true })
        document.removeEventListener('visibilitychange', visibility)
        document.removeEventListener('focusout', flush)
        window.removeEventListener('pagehide', flush)
        window.removeEventListener('blur', flush)
        offConnection()
        clearInterval(idleCheck)
      }
    }, 'hmr-gate: hold updates for a hidden or idle moment')

    let storage: Storage | undefined
    try {
      storage = window.sessionStorage
    } catch {}
    SlotCrashRecovery.installOnce({
      addEventListener: (type, listener) => window.addEventListener(type, listener),
      storage,
      setTimeout: (run, ms) => void window.setTimeout(run, ms),
      reload: () => window.location.reload(),
      now: () => Date.now(),
    })

    ctx.effect(() => {
      const source = new EventSource(EVENTS_ROUTE)
      source.addEventListener('message', event => {
        receive(event.data)
      })
      return () => {
        source.close()
      }
    }, 'hmr-gate: event source')

    // A sleeping tab and a reset stream both lose `deferred` frames, and the notice keeps its last list until the next
    // one arrives. Borrow one short-lived stream when the page comes back: its connect frames carry the Host's current
    // list, and the live stream keeps running meanwhile.
    ctx.effect(() => {
      const pending = createPendingReread({
        open: () => {
          const source = new EventSource(EVENTS_ROUTE)
          return {
            onMessage: listener => source.addEventListener('message', event => listener(event.data)),
            onError: listener => source.addEventListener('error', () => listener()),
            close: () => source.close(),
          }
        },
        receive,
        timeoutMs: REREAD_TIMEOUT_MS,
      })
      const onVisibilityChange = (): void => {
        if (document.visibilityState === 'visible') pending.reread()
      }
      pending.reread()
      window.addEventListener('focus', pending.reread)
      document.addEventListener('visibilitychange', onVisibilityChange)
      return () => {
        window.removeEventListener('focus', pending.reread)
        document.removeEventListener('visibilitychange', onVisibilityChange)
        pending.dispose()
      }
    }, 'hmr-gate: re-read the pending list')

    ctx.slots.inject('plugins.item', () =>
      ctx.slots.register(
        {
          name: 'plugins.item',
          id: ROW_ID,
          order: 40,
          label: 'HMR updates',
        },
        HmrGateRow,
      ),
    )
  },
})

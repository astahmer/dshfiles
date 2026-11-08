import type {} from '@deepseek-ai/dsh-client-ui-plugin-manager/client'
import { defineClient } from '@dshfiles/dshx/client'
import { PendingRestartSources } from '@dshfiles/thread-sidebar/restart-sources'
import { decodeJson, jsonValueSchema, type JsonValue } from '@dshfiles/dshx/json'
import { Option } from 'effect'
import * as Schema from 'effect/Schema'
import { useSyncExternalStore } from 'react'
import { createPendingReread } from './reread.js'

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
const RECOVERY_KEY = 'dshfiles.hmr-gate.slot-recovery-at'
const RECOVERY_INTERVAL_MS = 30_000
// Lets the rest of a rebuild burst arrive before the reload picks up the bundles.
const RECOVERY_DELAY_MS = 1_500
// A probe stream the Host never answers must not stay open past one connect round trip.
const REREAD_TIMEOUT_MS = 10_000

const deferredPackageSchema = Schema.Struct({ id: Schema.NonEmptyString, reason: Schema.NonEmptyString })

const frameSchema = Schema.Union([
  Schema.Struct({ type: Schema.Literal('graph'), graph: Schema.Unknown }),
  Schema.Struct({ type: Schema.Literal('rebuilt'), id: Schema.NonEmptyString, rev: Schema.NonEmptyString }),
  Schema.Struct({ type: Schema.Literal('deferred'), packages: Schema.Array(deferredPackageSchema).check(Schema.isMaxLength(64)) }),
])

type DeferredPackage = typeof deferredPackageSchema.Type

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

/** One line that says what a restart would apply; undefined while nothing is pending. */
const summaryText = (packages: readonly DeferredPackage[]): string | undefined => {
  if (packages.length === 0) return undefined
  if (packages.length === 1) return `${packages[0]?.id ?? 'A plugin'} waits for a Host restart to apply.`
  return `${String(packages.length)} plugins wait for a Host restart to apply.`
}

const HmrGateRow = (props: { readonly view: 'summary' | 'page' }): JSX.Element | null => {
  const packages = useSyncExternalStore(subscribe, snapshot, snapshot)
  const summary = summaryText(packages)

  if (props.view === 'summary') {
    return summary === undefined ? null : <span className="dshx:text-muted-foreground dshx:text-sm">{summary}</span>
  }

  return (
    <section className="dshx-root dshx:flex dshx:flex-col dshx:gap-3">
      <p className="dshx:min-w-0 dshx:text-muted-foreground dshx:text-sm">
        A plugin's browser half rebuilt while its Host half still runs from before the rebuild. The browser keeps the last-good code until the Host loads the
        new half, so nothing runs out of step.
      </p>
      {packages.length === 0 ? (
        <p className="dshx:text-muted-foreground dshx:text-sm">Nothing is waiting. Every rebuilt plugin is in step with the Host.</p>
      ) : (
        <ul className="dshx:flex dshx:flex-col dshx:gap-1">
          {packages.map(entry => (
            <li className="dshx:flex dshx:min-w-0 dshx:items-baseline dshx:gap-2 dshx:text-sm" key={entry.id}>
              <span className="dshx:font-mono dshx:text-xs">{entry.id}</span>
              <span className="dshx:min-w-0 dshx:truncate dshx:text-muted-foreground">Host half changed</span>
            </li>
          ))}
        </ul>
      )}
      {packages.length === 0 ? null : <p className="dshx:text-muted-foreground dshx:text-sm">Restart DSH to load the new Host code, then reload this page.</p>}
    </section>
  )
}

export default defineClient({
  name: '@dshfiles/hmr-gate',
  // `modules` is the client module table the frames drive; `slots` seats the row.
  inject: ['modules', 'slots'],
  setup(ctx, _decorate, metadata) {
    const plugin = metadata?.plugin
    if (plugin !== undefined) {
      // thread-sidebar's one restart status item lists these beside the Host files it watches and owns the restart verbs.
      ctx.effect(
        () => plugin.add(PendingRestartSources, { id: '@dshfiles/hmr-gate', subscribe, packages: () => currentIds }),
        'hmr-gate: pending restart source',
      )
    }
    /** Handles one frame; returns true when it moved the deferred notice. */
    const receive = (data: string): boolean => {
      let decoded: JsonValue
      try {
        decoded = decodeJson(jsonValueSchema, data)
      } catch {
        return false
      }
      const frame = Schema.decodeUnknownOption(frameSchema)(decoded)
      if (Option.isNone(frame)) return false
      const frameValue = frame.value
      if (frameValue.type === 'graph') {
        void ctx.modules.entries.sync(frameValue.graph).catch((error: unknown) => {
          ctx.logger.warn(error)
        })
        return false
      }
      if (frameValue.type === 'rebuilt') {
        void ctx.modules.entries.reload(frameValue.id, frameValue.rev).catch((error: unknown) => {
          ctx.logger.warn(error)
        })
        return false
      }
      publish(frameValue.packages)
      return true
    }

    // A recomposition can leave a slot with no adapter or registration for one render; the stock renderer then throws
    // SlotAssemblyError past every error boundary and the shell has none, so React unmounts the page. Reload once the
    // swap settles instead of leaving it blank; the timestamp keeps a deterministic failure from looping.
    ctx.effect(() => {
      let pending: ReturnType<typeof setTimeout> | undefined
      const onError = (event: ErrorEvent): void => {
        if (!(event.error instanceof Error) || event.error.name !== 'SlotAssemblyError' || pending !== undefined) return
        let last = 0
        try {
          last = Number(sessionStorage.getItem(RECOVERY_KEY) ?? 0)
        } catch {}
        if (Date.now() - last < RECOVERY_INTERVAL_MS) return
        pending = setTimeout(() => {
          try {
            sessionStorage.setItem(RECOVERY_KEY, String(Date.now()))
          } catch {}
          window.location.reload()
        }, RECOVERY_DELAY_MS)
      }
      window.addEventListener('error', onError)
      return () => {
        window.removeEventListener('error', onError)
        if (pending !== undefined) clearTimeout(pending)
      }
    }, 'hmr-gate: recover from a slot assembly crash')

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

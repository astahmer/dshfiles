import type {} from '@deepseek-ai/dsh-client-ui-plugin-manager/client'
import { defineClient } from '@dshfiles/dshx/client'
import { decodeJson, jsonValueSchema, type JsonValue } from '@dshfiles/dshx/json'
import { useSyncExternalStore } from 'react'
import { z } from 'zod'

/**
 * The browser half of the gate: the stock `/plugins/events` subscriber, plus the
 * Plugins-page row that names what a Host restart would apply.
 *
 * `graph` and `rebuilt` frames do exactly what `@deepseek-ai/dsh-client-hmr` does
 * with them; `deferred` frames only move the notice. The page uses a same-origin
 * EventSource (this repository's Web profile); a carrier-only shell that exposes
 * `__DSH_TRANSPORT__` without same-origin EventSource would need the fetch path
 * the stock client also carries.
 */

const EVENTS_ROUTE = 'plugins/events'
const ROW_ID = 'dshfiles-hmr-gate'

const deferredPackageSchema = z.object({ id: z.string().min(1), reason: z.string().min(1) })

const frameSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('graph'), graph: z.unknown() }),
  z.object({ type: z.literal('rebuilt'), id: z.string().min(1), rev: z.string().min(1) }),
  z.object({ type: z.literal('deferred'), packages: z.array(deferredPackageSchema).max(64) }),
])

type DeferredPackage = z.infer<typeof deferredPackageSchema>

let current: readonly DeferredPackage[] = []
const listeners = new Set<() => void>()

const publish = (next: readonly DeferredPackage[]): void => {
  if (next.length === current.length && next.every((entry, index) => entry.id === current[index]?.id)) return
  current = next
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
  setup(ctx) {
    const receive = (data: string): void => {
      let decoded: JsonValue
      try {
        decoded = decodeJson(jsonValueSchema, data)
      } catch {
        return
      }
      const frame = frameSchema.safeParse(decoded)
      if (!frame.success) return
      if (frame.data.type === 'graph') {
        void ctx.modules.entries.sync(frame.data.graph).catch((error: unknown) => {
          ctx.logger.warn(error)
        })
        return
      }
      if (frame.data.type === 'rebuilt') {
        void ctx.modules.entries.reload(frame.data.id, frame.data.rev).catch((error: unknown) => {
          ctx.logger.warn(error)
        })
        return
      }
      publish(frame.data.packages)
    }

    ctx.effect(() => {
      const source = new EventSource(EVENTS_ROUTE)
      source.addEventListener('message', event => {
        receive(event.data)
      })
      return () => {
        source.close()
      }
    }, 'hmr-gate: event source')

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

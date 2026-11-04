import type { Context } from '@deepseek-ai/cordis'
import { attentionApi, type AttentionDraft } from '@dshfiles/activity-timeline/attention-api'
import { createHostApiClient, isApiServed } from '@dshfiles/dshx/host'
import type { DeferredPackage } from '../api.js'

/** The inbox source of plugin updates that wait for a DSH restart. */
export const DEFERRED_UPDATE_SOURCE = 'hmr-gate.deferred-update'

const PACKAGE_ID = '@dshfiles/hmr-gate'
const clamp = (value: string, max: number): string => (value.length <= max ? value : `${value.slice(0, max - 1)}…`)

/**
 * Every held-back rebuild as one Ready item about this DSH. It names what waits and how to apply it; it offers no
 * restart verb, because restarting is the user's decision and may interrupt running agents. A changed set of packages
 * is a changed item, so a new update shows again after the user marked the last one done.
 */
const draftsOf = (deferred: readonly DeferredPackage[]): readonly AttentionDraft[] => {
  if (deferred.length === 0) return []
  const ids = [...new Set(deferred.map(entry => entry.id))].sort()
  const count = ids.length === 1 ? '1 plugin update waits' : `${String(ids.length)} plugin updates wait`
  return [
    {
      dedupeKey: 'host-restart',
      subject: { kind: 'host', id: 'local', label: 'This DSH' },
      reason: `${count} for a DSH restart.`,
      detail: clamp(
        `Waiting: ${ids.join(', ')}. Their new Host code is built but not loaded, so their pages keep the last matching version. ` +
          'Restart DSH when no agent is working (Restart when idle in the sidebar when the supervisor runs it, or your own launcher); nothing restarts by itself.',
        2000,
      ),
      severity: 'ready',
      verbs: ['Done', 'Snooze', 'MuteSource'],
    },
  ]
}

/**
 * hmr-gate as an inbox provider. `changed` is called whenever the deferred set may have changed; the inbox hears the
 * whole set once a burst settles, and again whenever it announces it is ready.
 */
const install = (ctx: Context, deferred: () => readonly DeferredPackage[]) => {
  const inbox = createHostApiClient(ctx, attentionApi, PACKAGE_ID)
  let disposed = false
  // A build rewrites several bundles in a burst: changes that arrive while a reconcile runs collapse into one rerun.
  let running = false
  let dirty = false

  const reconcile = async (): Promise<void> => {
    if (disposed || !isApiServed(ctx, attentionApi, PACKAGE_ID)) return
    await inbox.reconcile({ source: DEFERRED_UPDATE_SOURCE, items: [...draftsOf(deferred())] })
  }

  const drain = async (): Promise<void> => {
    while (dirty && !disposed) {
      dirty = false
      await reconcile().catch((error: unknown) =>
        ctx.logger.warn('hmr-gate: inbox reconcile failed (%s)', error instanceof Error ? error.message : 'unknown error'),
      )
    }
    running = false
  }

  const changed = (): void => {
    if (disposed) return
    dirty = true
    if (running) return
    running = true
    queueMicrotask(() => void drain())
  }

  const offReady = ctx.on('dshfiles/attention/ready', changed)
  changed()
  return {
    changed,
    dispose: () => {
      disposed = true
      offReady()
    },
  }
}

export class DeferredUpdateAttention {
  static readonly install = install
  static readonly draftsOf = draftsOf
}

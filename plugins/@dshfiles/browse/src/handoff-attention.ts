import { attentionApi, type AttentionDraft } from '@dshfiles/activity-timeline/attention-api'
import { DshxPlugin, HostEvents } from '@dshfiles/dshx/effect'
import { HostApis } from '@dshfiles/dshx/effect/host-apis'
import { Duration, Effect, Layer, Stream } from 'effect'
import { browseSettingsTag } from './browse-cli.js'
import { BrowseOutput, type BrowseStatus } from './model.js'
import { Browse } from './service.js'

/** The inbox source of agent browser tabs waiting on the user (sign-in, captcha, 2FA). */
export const BROWSE_HANDOFF_SOURCE = 'browse.handoff'

const MAX_ITEMS = 50

/** Each tab whose agent call waits on the user is one blocking item about that tab's page. */
const draftsOf = (status: BrowseStatus): readonly AttentionDraft[] => {
  if (status.kind !== 'ready') return []
  return status.tabs.flatMap(tab => {
    if (tab.handoff === null) return []
    const page = tab.title.length > 0 ? tab.title : tab.url
    return [
      {
        dedupeKey: BrowseOutput.clamp(`tab:${tab.tab}:${tab.handoff.startedAt ?? 'unknown'}`, 256),
        subject: {
          kind: 'url',
          id: BrowseOutput.clamp(tab.url.length > 0 ? tab.url : `browse-tab:${tab.tab}`, 512),
          ...(page.length > 0 && { label: BrowseOutput.clamp(page, 200) }),
        },
        reason: BrowseOutput.clamp(`A browser tab waits for you: ${tab.handoff.message}`, 500),
        detail: BrowseOutput.clamp(
          `Tab ${tab.tab}${tab.url.length > 0 ? ` (${tab.url})` : ''} shows a card with this message. Do it in the browser, then click Continue on that card or the browse toolbar button; the agent resumes by itself.`,
          2_000,
        ),
        severity: 'blocking',
        verbs: ['Done', 'Snooze', 'MuteSource'],
      } satisfies AttentionDraft,
    ]
  })
}

const make = Effect.gen(function* () {
  const settings = yield* browseSettingsTag
  const browse = yield* Browse
  const apis = yield* HostApis
  const inbox = apis.client(attentionApi)

  const reconcile = Effect.fn('browse handoff reconcile')(function* (watching: boolean) {
    if (!(yield* apis.isServed(attentionApi))) return
    const items = watching ? draftsOf(yield* browse.status).slice(0, MAX_ITEMS) : []
    yield* Effect.annotateCurrentSpan({ 'attention.items': items.length, 'dshx.browse.watching': watching })
    yield* inbox.reconcile({ source: BROWSE_HANDOFF_SOURCE, items: [...items] })
  })

  const pass = (watching: boolean) => reconcile(watching).pipe(Effect.catchCause(cause => Effect.logWarning('browse: handoff inbox reconcile failed', cause)))

  /** Off: one pass resolves what an earlier run left open, then nothing runs until the setting turns back on. */
  const watch = settings.changes.pipe(
    Stream.changesWith((left, right) => left.notifyHandoffs === right.notifyHandoffs && left.pollIntervalMs === right.pollIntervalMs),
    Stream.switchMap(value =>
      value.notifyHandoffs
        ? Stream.merge(
            Stream.tick(Duration.millis(value.pollIntervalMs)),
            Stream.map(HostEvents.stream('dshfiles/attention/ready'), () => undefined),
          ).pipe(Stream.mapEffect(() => pass(true)))
        : Stream.fromEffect(pass(false)),
    ),
  )
  yield* watch.pipe(Stream.runDrain, DshxPlugin.detached, Effect.forkScoped)
})

/** browse as an inbox provider: tabs waiting on a person are Needs you until the agent's call continues. */
export class HandoffAttention {
  static readonly layer = Layer.effectDiscard(make)
  static readonly draftsOf = draftsOf
}

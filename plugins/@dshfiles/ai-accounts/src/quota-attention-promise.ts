/**
 * The Promise edge between the attention inbox and the imperative quota-continuation service: listing and resuming
 * continuations are Promise calls, and the inbox act event is a Cordis serial handler.
 */
import type { Context as CordisContext } from '@deepseek-ai/cordis'
import {
  attentionApi,
  type AttentionActOutcome,
  type AttentionActRequest,
  type AttentionDraft,
  type AttentionItem,
} from '@dshfiles/activity-timeline/attention-api'
import { DshxPlugin, HostContext, HostEvents } from '@dshfiles/dshx/effect'
import { HostApis } from '@dshfiles/dshx/effect/host-apis'
import { Effect, Layer, Queue, Stream } from 'effect'
import { accountRuntime } from './account-runtime.js'
import type { QuotaContinuationSummary } from './quota-continuation-model.js'
import type { QuotaContinuationService } from './quota-continuation.js'

/** The inbox source of threads stopped by an exhausted account quota, waiting for the user to resume them. */
export const QUOTA_CONTINUATION_SOURCE = 'ai-accounts.quota-continuation'

const RECONCILE_DEBOUNCE = '300 millis'
/** A quota failure ends a turn, so Session events settle shortly after a continuation is recorded. */
const SESSION_SETTLE = '2 seconds'
/** Schedules, resets and resumes from another page change continuations without a Session event. */
const RECONCILE_SAFETY_INTERVAL = '60 seconds'

const clamp = (value: string, max: number): string => (value.length <= max ? value : `${value.slice(0, max - 1)}…`)

const routeOf = (summary: QuotaContinuationSummary): string =>
  summary.failedModel === undefined ? summary.accountId : `${summary.failedModel} on ${summary.failedProvider ?? summary.accountId}`

const detailOf = (summary: QuotaContinuationSummary): string => {
  const reset =
    summary.resetAt === null
      ? `The account did not report when its quota resets, so the thread retries on a growing backoff from 30 seconds up to every 10 minutes.`
      : summary.ready
        ? 'The quota window has reset.'
        : `The quota resets at ${new Date(summary.resetAt).toISOString()}.`
  const retry = summary.autoRetry ? ' It resumes by itself then.' : ''
  return `${reset}${retry} Resume continues the stopped turn now; open the thread to switch it to another account or model first.`
}

/** One waiting continuation as a blocking item about its thread; a queued one is already resuming. */
const draftOf = (summary: QuotaContinuationSummary): AttentionDraft => ({
  dedupeKey: summary.continuationId,
  subject:
    summary.title === undefined ? { kind: 'session', id: summary.sessionId } : { kind: 'session', id: summary.sessionId, label: clamp(summary.title, 200) },
  reason: clamp(`Stopped by the ${routeOf(summary)} usage limit.`, 500),
  detail: clamp(detailOf(summary), 2000),
  severity: 'blocking',
  verbs: ['Resume', 'Open', 'Done', 'Snooze', 'MuteSource'],
})

const openDrafts = (continuations: readonly QuotaContinuationSummary[]): readonly AttentionDraft[] =>
  continuations.filter(continuation => continuation.state === 'waiting').map(draftOf)

/** Inbox items the user already set aside, whose continuation must therefore leave the waiting set. */
const doneContinuationKeys = (items: readonly AttentionItem[]): readonly string[] =>
  items.filter(item => item.source === QUOTA_CONTINUATION_SOURCE && item.doneAt !== null && item.resolvedAt === null).map(item => item.dedupeKey)

const refused = (message: string): AttentionActOutcome => ({ ok: false, message })

/** The live continuation service, which the imperative accounts Host starts after this layer is built. */
type ServiceRead = (ctx: CordisContext) => QuotaContinuationService | undefined

const make = (read: ServiceRead) =>
  Effect.gen(function* () {
    const host = yield* HostContext
    const apis = yield* HostApis
    const inbox = apis.client(attentionApi)
    const pokes = yield* Queue.sliding<void>(1)
    let repairedDone = false

    /**
     * Done in the inbox is durable, so one boot retires continuations an earlier build left waiting under a done item:
     * otherwise their thread keeps a Needs you row with a Resume the user already set aside.
     */
    const repairDoneContinuations = Effect.fn('ai-accounts attention repair done')(function* () {
      const service = read(host.ctx)
      if (service === undefined || !(yield* apis.isServed(attentionApi))) return
      const closed = yield* inbox.list({ view: 'closed', limit: 200 })
      const keys = doneContinuationKeys(closed.items)
      for (const key of keys) yield* Effect.promise(() => service.dismiss(key))
      repairedDone = true
      yield* Effect.annotateCurrentSpan({ 'quota.done_repaired': keys.length })
    })

    const reconcile = Effect.fn('ai-accounts attention reconcile')(function* () {
      if (!repairedDone)
        yield* repairDoneContinuations().pipe(Effect.catchCause(cause => Effect.logWarning('ai-accounts: done quota items were not repaired', cause)))
      const service = read(host.ctx)
      if (service === undefined || !(yield* apis.isServed(attentionApi))) return
      const listed = yield* Effect.promise(() => service.list())
      const items = openDrafts(listed.continuations)
      yield* Effect.annotateCurrentSpan({ 'attention.items': items.length })
      yield* inbox.reconcile({ source: QUOTA_CONTINUATION_SOURCE, items: [...items] })
    })

    /** Resume runs the same stored continuation the Usage page's Resume runs, only because the user chose it. */
    const act = Effect.fn('ai-accounts attention act')(function* (request: AttentionActRequest) {
      if (request.verb !== 'Resume') return refused('Usage-limit items take Resume here; open the thread to switch its account or model.')
      const service = read(host.ctx)
      if (service === undefined) return refused('Quota recovery is not running on this Host yet. Reload the page in a moment and try again.')
      const outcome = yield* Effect.promise(() => service.resume(request.item.dedupeKey))
      yield* Queue.offer(pokes, undefined)
      return outcome.accepted
        ? { ok: true, message: 'Resumed: the stopped turn is queued on its thread.' }
        : refused('This thread cannot resume from here: it has newer work, was dismissed, or its Session is unavailable. Open the thread to continue it.')
    })

    /**
     * Done in the inbox says the user does not want this recovery (plan §4.8, both ways): the continuation is
     * dismissed too, so the thread stops showing a Resume the usage-limit row would otherwise keep offering.
     */
    const dismissOnDone = Effect.fn('ai-accounts attention done')(function* (item: AttentionItem) {
      if (item.source !== QUOTA_CONTINUATION_SOURCE) return
      const service = read(host.ctx)
      if (service === undefined) return
      const outcome = yield* Effect.promise(() => service.dismiss(item.dedupeKey))
      yield* Effect.annotateCurrentSpan({ 'quota.dismissed': outcome.dismissed })
      if (outcome.dismissed) yield* Queue.offer(pokes, undefined)
    })
    yield* HostEvents.stream('dshfiles/attention/done').pipe(
      Stream.runForEach(([payload]) =>
        dismissOnDone(payload.item).pipe(Effect.catchCause(cause => Effect.logWarning('ai-accounts: inbox done not applied', cause))),
      ),
      DshxPlugin.detached,
      Effect.forkScoped,
    )

    const services = yield* Effect.context<never>()
    const runAct = Effect.runPromiseWith(services)
    yield* Effect.acquireRelease(
      Effect.sync(() =>
        host.ctx.on('dshfiles/attention/act', request =>
          request.item.source === QUOTA_CONTINUATION_SOURCE
            ? runAct(act(request).pipe(Effect.catchCause(() => Effect.succeed(refused('Resuming failed on the Host. Open Usage › Quota and resume there.')))))
            : Promise.resolve(undefined),
        ),
      ),
      dispose => Effect.sync(dispose),
    )

    yield* Stream.mergeAll(
      [
        Stream.succeed(undefined),
        Stream.map(HostEvents.stream('dshfiles/attention/ready'), () => undefined),
        Stream.map(HostEvents.stream('session/event').pipe(Stream.debounce(SESSION_SETTLE)), () => undefined),
        Stream.fromQueue(pokes),
        Stream.map(Stream.tick(RECONCILE_SAFETY_INTERVAL), () => undefined),
      ],
      { concurrency: 'unbounded' },
    ).pipe(
      Stream.debounce(RECONCILE_DEBOUNCE),
      Stream.runForEach(() => reconcile().pipe(Effect.catchCause(cause => Effect.logWarning('ai-accounts: inbox reconcile failed', cause)))),
      DshxPlugin.detached,
      Effect.forkScoped,
    )
  })

/** ai-accounts as an inbox provider: every quota-blocked continuation is a blocking item, resumable in place. */
export class QuotaAttention {
  static readonly layerFor = (read: ServiceRead) => Layer.effectDiscard(make(read))
  static readonly layer = QuotaAttention.layerFor(ctx => accountRuntime(ctx)?.quotaContinuations)
  static readonly openDrafts = openDrafts
}

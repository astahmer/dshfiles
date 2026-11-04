import { Api, DshxPlugin, HostContext } from '@dshfiles/dshx/effect'
import { Clock, Effect, Layer, Option, Schema, Stream } from 'effect'
import { workspaceActivity } from './adapters.js'
import { ActivityTimeline } from './activity-timeline.js'
import { attentionActOutcomeSchema, attentionApi, type AttentionActOutcome, type AttentionActRequest } from './attention-api.js'
import { AttentionInbox } from './attention-store.js'

/** Announce at most four changes a second; badges read the counts the event carries. */
const CHANGE_EVENT_INTERVAL = '250 millis'
const DEFAULT_LIST_LIMIT = 100

export class AttentionProviderOnly extends Schema.TaggedError<AttentionProviderOnly>()(
  'AttentionProviderOnly',
  { method: Schema.String },
  { dshxWireCode: 'attention-provider-only' },
) {
  override get message(): string {
    return `attention.${this.method} is for Host providers only. Use Done, Snooze or Mute source on the item instead.`
  }
}

const decodeOutcome = Schema.decodeUnknownOption(attentionActOutcomeSchema)

/** Publish, resolve and reconcile come from another plugin's Host half, never from a browser or an agent. */
const providerOnly = (call: Api.ApiCall, method: string) => (call.caller.kind === 'plugin' ? Effect.void : Effect.fail(new AttentionProviderOnly({ method })))

const unhandled = (source: string): AttentionActOutcome => ({
  ok: false,
  message: `No loaded plugin acts on ${source} items right now. Open the item's thread to act there, or mark it done.`,
})

/** Hand one provider verb to the plugin that owns the item's source, through the `dshfiles/attention/act` serial event. */
const act = Effect.fn('attention act')(function* (input: { readonly id: string; readonly verb: AttentionActRequest['verb']; readonly choiceId?: string }) {
  const host = yield* HostContext
  const item = yield* AttentionInbox.use(inbox => inbox.get(input.id))
  yield* Effect.annotateCurrentSpan({ 'attention.source': item.source, 'attention.verb': input.verb })
  if (item.resolvedAt !== null) return { ok: false, message: 'This item was already resolved by its source; nothing is left to do.' } satisfies AttentionActOutcome
  if (!item.verbs.includes(input.verb)) return { ok: false, message: `This item does not offer ${input.verb}. Use one of: ${item.verbs.join(', ')}.` } satisfies AttentionActOutcome
  const request: AttentionActRequest = { item, verb: input.verb, ...(input.choiceId !== undefined && { choiceId: input.choiceId }) }
  const answered = yield* Effect.tryPromise({
    try: () => host.ctx.serial('dshfiles/attention/act', request),
    catch: cause => cause,
  }).pipe(
    Effect.map(value => Option.getOrUndefined(decodeOutcome(value))),
    Effect.catch(cause =>
      Effect.as(Effect.logWarning('attention: a provider failed to act', cause), {
        ok: false,
        message: 'The plugin that owns this item failed to act. Open the thread to act there; the DSH Host log has the error.',
      } satisfies AttentionActOutcome),
    ),
  )
  return answered ?? unhandled(item.source)
})

export const attentionHandlers = Api.handlers(attentionApi, {
  list: input => AttentionInbox.use(inbox => inbox.list({ view: input.view ?? 'needs-you', limit: input.limit ?? DEFAULT_LIST_LIMIT })),
  publish: (input, call) =>
    Effect.gen(function* () {
      yield* providerOnly(call, 'publish')
      if (input.severity === 'info') {
        // Info never reaches the inbox (plan §4.8): it is one Activity log entry.
        const at = yield* Clock.currentTimeMillis
        yield* ActivityTimeline.use(timeline =>
          timeline.enqueue(
            workspaceActivity({
              id: `attention:${input.source}:${input.dedupeKey}:${String(at)}`,
              at,
              type: `attention.${input.source}`,
              level: 'notable',
              summary: input.reason,
              detail: input.detail ?? null,
              sessionId: input.subject.kind === 'session' ? input.subject.id : null,
              workspaceId: input.subject.kind === 'workspace' ? input.subject.id : null,
              workspaceName: input.subject.kind === 'workspace' ? (input.subject.label ?? null) : null,
            }),
          ),
        )
        return { item: null, changed: false }
      }
      return yield* AttentionInbox.use(inbox => inbox.publish(input))
    }),
  resolve: (input, call) =>
    Effect.gen(function* () {
      yield* providerOnly(call, 'resolve')
      return { resolved: yield* AttentionInbox.use(inbox => inbox.resolve(input)) }
    }),
  reconcile: (input, call) =>
    Effect.gen(function* () {
      yield* providerOnly(call, 'reconcile')
      return yield* AttentionInbox.use(inbox => inbox.reconcile({ source: input.source, items: input.items.filter(item => item.severity !== 'info') }))
    }),
  done: input => AttentionInbox.use(inbox => inbox.done(input)),
  snooze: input => AttentionInbox.use(inbox => inbox.snooze(input)),
  reopen: input => AttentionInbox.use(inbox => inbox.reopen(input)),
  muteSource: input => AttentionInbox.use(inbox => inbox.muteSource(input)),
  act: input => act(input),
})

/** Live `changed` events for browsers, and the one-time `ready` signal that asks every provider to reconcile. */
const make = Effect.gen(function* () {
  const host = yield* HostContext
  const inbox = yield* AttentionInbox
  yield* inbox.changes.pipe(
    Stream.groupedWithin(Number.MAX_SAFE_INTEGER, CHANGE_EVENT_INTERVAL),
    Stream.runForEach(batch =>
      Option.match(Option.fromUndefinedOr(batch.at(-1)), {
        onNone: () => Effect.void,
        onSome: change =>
          Api.publish({
            contract: attentionApi,
            event: 'changed',
            payload: { revision: change.revision, needsYou: change.counts.needsYou, blocking: change.counts.blocking },
          }).pipe(Effect.catchTag('PublishEventError', error => Effect.logWarning('attention: change event refused', error.message))),
      }),
    ),
    DshxPlugin.detached,
    Effect.forkScoped,
  )
  yield* Effect.sync(() => host.ctx.emit('dshfiles/attention/ready', { version: 1 }))
})

export class AttentionHost {
  static readonly layer = Layer.effectDiscard(make)
}

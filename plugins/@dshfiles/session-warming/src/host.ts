import { isAgentLoopRequest } from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-session'
import { defineApi, method } from '@dshfiles/dshx/api'
import { Api, DshxPlugin, HostEvents } from '@dshfiles/dshx/effect'
import { Llm } from '@dshfiles/dshx/effect/llm'
import { Settings } from '@dshfiles/dshx/effect/settings'
import { Effect, Layer, Queue, Schema } from 'effect'
import { sessionWarmingSettings } from './settings.js'
import { SessionWarming, type WarmingEvent } from './warming.js'

const sessionWarmingApi = defineApi({
  id: 'session-warming',
  version: 1,
  owner: '@dshfiles/session-warming',
  methods: {
    status: method({
      input: Schema.Struct({}),
      output: Schema.Struct({
        enabled: Schema.Boolean,
        warmupsLastHour: Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)),
        sessions: Schema.Array(SessionWarming.sessionStatusSchema),
      }),
      description:
        'Prompt-cache warming: whether it is on, warm-ups spent in the last hour, and per thread its model, warm-ups since its last prompt, the next one, the last cache reads and why it stopped. Read-only.',
      tool: {
        name: 'session_warming_status',
        readOnly: true,
        render: output =>
          [
            `Warming ${output.enabled ? 'on' : 'off'} · ${String(output.warmupsLastHour)} warm-up(s) in the last hour`,
            ...output.sessions.map(
              session =>
                `${session.sessionId} · ${session.provider}/${session.model} · ${String(session.warmups)} since last prompt${
                  session.last === null
                    ? ''
                    : ` · last read ${String(session.last.cacheReadTokens)}/${String(session.last.inputTokens + session.last.cacheReadTokens)} from cache`
                }${session.stopped === null ? '' : ` · stopped: ${session.stopped}`}${session.error === null ? '' : ` (${session.error})`}`,
            ),
          ].join('\n'),
      },
    }),
  },
})

/**
 * Feeds agent-loop requests and turn boundaries to SessionWarming in emission order: both handlers offer to one
 * unbounded queue synchronously while the Host dispatches.
 */
const WarmingEvents = Layer.effectDiscard(
  Effect.gen(function* () {
    const warming = yield* SessionWarming
    const events = yield* Queue.unbounded<WarmingEvent>()
    yield* HostEvents.intercept('llm/stream', ({ args: [options], next }) =>
      options.sessionId !== undefined && options.purpose === undefined && isAgentLoopRequest(options)
        ? Effect.andThen(Queue.offer(events, { kind: 'request', sessionId: String(options.sessionId), request: options }), next)
        : next,
    )
    yield* HostEvents.on('session/event', (session, event) => {
      if (event.type === 'turn/start') return Effect.asVoid(Queue.offer(events, { kind: 'turn-start', sessionId: String(session.header.id) }))
      if (event.type === 'turn/end') return Effect.asVoid(Queue.offer(events, { kind: 'turn-end', sessionId: String(session.header.id) }))
      return Effect.void
    })
    yield* DshxPlugin.worker(Queue.take(events).pipe(Effect.flatMap(warming.handle), Effect.forever))
  }),
)

export default DshxPlugin.make({
  name: '@dshfiles/session-warming',
  inject: ['llm'],
  settings: [sessionWarmingSettings],
  layer: WarmingEvents.pipe(Layer.provideMerge(SessionWarming.layer), Layer.provide(Layer.mergeAll(Settings.layer(sessionWarmingSettings), Llm.layer))),
  apis: [Api.bind(sessionWarmingApi, { status: () => SessionWarming.use(warming => warming.status) })],
})

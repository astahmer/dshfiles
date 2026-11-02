import type { Context as CordisContext } from '@deepseek-ai/cordis'
import { isAgentLoopRequest } from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-session'
import { DshxEffect } from '@dshfiles/dshx/effect'
import { defineApi, method } from '@dshfiles/dshx/api'
import { defineHost } from '@dshfiles/dshx/host'
import type { SettingsScope, SettingsValue } from '@dshfiles/dshx/settings'
import { Effect, Queue, Schema } from 'effect'
import { sessionWarmingSettings } from './settings.js'
import { SessionWarming } from './warming.js'

type WarmingSettingsValue = SettingsValue<typeof sessionWarmingSettings.schema>

const defaults: WarmingSettingsValue = sessionWarmingSettings.schema({})
let settingsScope: SettingsScope<WarmingSettingsValue> | undefined

const readSettings = (): WarmingSettingsValue => {
  try {
    return settingsScope?.get() ?? defaults
  } catch {
    return defaults
  }
}

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

const { hostApi, ...effectPlugin } = DshxEffect.plugin({
  layer: (ctx: CordisContext) => SessionWarming.layer({ settings: readSettings, llm: ctx.llm }),
  setup: (ctx: CordisContext) =>
    Effect.gen(function* () {
      const active = yield* SessionWarming
      yield* Effect.acquireRelease(
        Effect.sync(() => [
          ctx.on('llm/stream', (options, next) => {
            if (options.sessionId !== undefined && options.purpose === undefined && isAgentLoopRequest(options))
              Queue.offerUnsafe(active.requests, { kind: 'request', sessionId: String(options.sessionId), request: options })
            return next()
          }),
          ctx.on('session/event', (session, event) => {
            if (event.type === 'turn/start') Queue.offerUnsafe(active.requests, { kind: 'turn-start', sessionId: String(session.header.id) })
            if (event.type === 'turn/end') Queue.offerUnsafe(active.requests, { kind: 'turn-end', sessionId: String(session.header.id) })
          }),
        ]),
        disposers => Effect.sync(() => disposers.forEach(dispose => dispose())),
      )
    }),
})

export default defineHost({
  ...effectPlugin,
  name: '@dshfiles/session-warming',
  inject: ['llm'],
  settings: [
    sessionWarmingSettings.host({
      setup: scope => {
        settingsScope = scope
        return () => {
          if (settingsScope === scope) settingsScope = undefined
        }
      },
    }),
  ],
  apis: [
    hostApi(sessionWarmingApi, {
      status: Effect.fn('session-warming status')(function* () {
        const active = yield* SessionWarming
        return yield* active.status()
      }),
    }),
  ],
})

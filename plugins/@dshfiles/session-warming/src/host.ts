import type { Context } from '@deepseek-ai/cordis'
import { isAgentLoopRequest, type GenerateOptions } from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-session'
import { defineApi, method } from '@dshfiles/dshx/api'
import { defineHost } from '@dshfiles/dshx/host'
import type { SettingsScope, SettingsValue } from '@dshfiles/dshx/settings'
import { z } from 'zod'
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

let scheduler: ReturnType<typeof SessionWarming.scheduler<GenerateOptions>> | undefined

const sessionWarmingApi = defineApi({
  id: 'session-warming',
  version: 1,
  owner: '@dshfiles/session-warming',
  methods: {
    status: method({
      input: z.object({}).strict(),
      output: z
        .object({ enabled: z.boolean(), warmupsLastHour: z.number().int().nonnegative(), sessions: z.array(SessionWarming.sessionStatusSchema) })
        .strict(),
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

const api = sessionWarmingApi.host({
  status: () => ({ enabled: readSettings().enabled, ...(scheduler?.status() ?? { sessions: [], warmupsLastHour: 0 }) }),
})

export default defineHost({
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
  apis: [api],
  setup: (ctx: Context) => {
    const active = SessionWarming.scheduler<GenerateOptions>({ settings: readSettings, warm: request => SessionWarming.warm(ctx.llm, request) })
    scheduler = active
    ctx.on('llm/stream', (options, next) => {
      if (options.sessionId !== undefined && options.purpose === undefined && isAgentLoopRequest(options))
        active.recordRequest(String(options.sessionId), options)
      return next()
    })
    ctx.on('session/event', (session, event) => {
      if (event.type === 'turn/start') active.turnStarted(String(session.header.id))
      if (event.type === 'turn/end') active.turnEnded(String(session.header.id))
    })
    ctx.effect(
      () => () => {
        active.dispose()
        if (scheduler === active) scheduler = undefined
      },
      'session-warming: timers',
    )
  },
})

import Schema from '@deepseek-ai/schemastery'
import { Settings } from '@dshfiles/dshx/effect/settings'
import { defineSettings, type SettingsValue } from '@dshfiles/dshx/settings'

export const agentCommunicationSettings = defineSettings({
  namespace: 'agent-communication',
  schema: Schema.object({
    wakeOnRequest: Schema.boolean()
      .default(true)
      .description(
        'A peer request wakes its recipient: the thread gets a pointer message ("read your inbox") and starts a turn when idle. Notices stay passive. Turn this off to keep every message passive.',
      ),
    wakeCooldownMinutes: Schema.natural()
      .min(1)
      .max(120)
      .default(5)
      .description(
        'At most one wake per recipient in this window, and none back to the sender of a recent wake; later requests wait for the turn already started.',
      ),
    wakePerHour: Schema.natural()
      .min(1)
      .max(120)
      .default(12)
      .description('Maximum wakes per recipient per hour, so two Agents cannot wake each other in an endless loop.'),
  }),
})

export type AgentCommunicationSettings = SettingsValue<typeof agentCommunicationSettings.schema>

export const defaultAgentCommunicationSettings: AgentCommunicationSettings = agentCommunicationSettings.schema({})

/** The live `agent-communication` settings; a Host without the namespace runs on the schema defaults. */
export const CommSettings = Settings.Tag<AgentCommunicationSettings>(agentCommunicationSettings.namespace)

export const CommSettingsLive = Settings.layer(agentCommunicationSettings)

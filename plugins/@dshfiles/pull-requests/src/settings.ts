import Schema from '@deepseek-ai/schemastery'
import { Settings } from '@dshfiles/dshx/effect/settings'
import { defineSettings, type SettingsValue } from '@dshfiles/dshx/settings'

export const pullRequestSettings = defineSettings({
  namespace: 'dshfiles-pull-requests',
  schema: Schema.object({
    refreshOnThreadEvents: Schema.boolean()
      .default(true)
      .description(
        'Refresh a thread’s pull requests after a push, at turn end and when a link is added.',
      ),
    eventDebounceSeconds: Schema.natural()
      .min(1)
      .max(60)
      .default(3)
      .description('How long thread events are gathered before one refresh, so a push and the turn end after it cost one gh call.'),
    sweepMinutes: Schema.natural()
      .min(1)
      .max(120)
      .default(10)
      .description('How often every watched pull request is polled anyway, for changes made outside DSH. Lower it when event refresh is off.'),
    githubPointsFloor: Schema.natural()
      .max(4_900)
      .default(500)
      .description(
        'GitHub GraphQL points left for other gh calls before polling waits for the hourly reset (0 never waits).',
      ),
  }),
  applies: 'live',
})

export type PullRequestSettingsValue = SettingsValue<typeof pullRequestSettings.schema>

export const PullRequestSettings = Settings.Tag<PullRequestSettingsValue>(pullRequestSettings.namespace)

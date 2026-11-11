import Schema from '@deepseek-ai/schemastery'
import { Settings } from '@dshfiles/dshx/effect/settings'
import { defineSettings, type SettingsValue } from '@dshfiles/dshx/settings'

export const pullRequestSettings = defineSettings({
  namespace: 'dshfiles-pull-requests',
  schema: Schema.object({
    refreshOnThreadEvents: Schema.boolean()
      .default(true)
      .description(
        'Refresh a thread’s watched pull requests when its push command (jj git push, git push, gh pr …) returns, its turn ends or a link is added. Off leaves only the sweep below.',
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
  }),
  applies: 'live',
})

export type PullRequestSettingsValue = SettingsValue<typeof pullRequestSettings.schema>

export const PullRequestSettings = Settings.Tag<PullRequestSettingsValue>(pullRequestSettings.namespace)

import Schema from '@deepseek-ai/schemastery'
import { defineSettings, type SettingsValue } from '@dshfiles/dshx/settings'

export const onboardingSettings = defineSettings({
  namespace: 'dshfiles-onboarding',
  schema: Schema.object({
    wizard: Schema.boolean()
      .default(true)
      .description(
        'Open the setup wizard on its own while an AI account or a project is missing.',
      ),
    starterTasks: Schema.boolean()
      .default(true)
      .description(
        'Suggest three tasks for the project on the new-thread screen, with a line that explains them until your first thread has a message.',
      ),
    checklist: Schema.boolean()
      .default(true)
      .description('Show the setup checklist on Getting started. Off skips every check, GitHub included.'),
    githubCheck: Schema.boolean()
      .default(true)
      .description('Tick the GitHub item by running `gh auth status` on this host, at most once a minute.'),
    packs: Schema.boolean().default(true).description('Show plugin packs on Getting started with each plugin enabled, disabled or not installed.'),
    curatedOnly: Schema.boolean().default(true).description('List only the curated major features on Getting started until you search.'),
    whatsNew: Schema.boolean()
      .default(true)
      .description(
        'Show What\'s new on Getting started, read from the dshfiles checkout’s history.',
      ),
    suggestions: Schema.boolean()
      .default(false)
      .description(
        'Suggest features you have not used yet, from local usage counts only.',
      ),
    tryIt: Schema.boolean()
      .default(false)
      .description(
        'Offer Try it, which starts a demo thread on your default model and spends tokens.',
      ),
  }),
  applies: 'live',
})

export type OnboardingSettings = SettingsValue<typeof onboardingSettings.schema>

/** Schema defaults, for a Client that renders before the namespace loads or on a Host that predates it. */
export const ONBOARDING_DEFAULTS: OnboardingSettings = {
  wizard: true,
  starterTasks: true,
  checklist: true,
  githubCheck: true,
  packs: true,
  curatedOnly: true,
  whatsNew: true,
  suggestions: false,
  tryIt: false,
}

import Schema from '@deepseek-ai/schemastery'
import { defineSettings, type SettingsValue } from '@dshfiles/dshx/settings'

export const onboardingSettings = defineSettings({
  namespace: 'dshfiles-onboarding',
  schema: Schema.object({
    wizard: Schema.boolean().default(true).description('Show the three-step setup wizard (account, project, first task) while no thread is open.'),
    checklist: Schema.boolean()
      .default(true)
      .description('Show the self-ticking setup checklist on Getting started. Off skips every Host check, the GitHub one included.'),
    githubCheck: Schema.boolean()
      .default(true)
      .description('Tick the GitHub item by running `gh auth status` on the Host, at most once a minute while Getting started or the agent asks.'),
    packs: Schema.boolean().default(true).description('Show plugin packs on Getting started with each plugin enabled, disabled or not installed.'),
    curatedOnly: Schema.boolean().default(true).description('List only the curated major features on Getting started until you search.'),
  }),
  applies: 'live',
})

export type OnboardingSettings = SettingsValue<typeof onboardingSettings.schema>

/** Schema defaults, for a Client that renders before the namespace loads or on a Host that predates it. */
export const ONBOARDING_DEFAULTS: OnboardingSettings = { wizard: true, checklist: true, githubCheck: true, packs: true, curatedOnly: true }

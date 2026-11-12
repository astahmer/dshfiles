import Schema from '@deepseek-ai/schemastery'
import { defineSettings, type SettingsValue } from '@dshfiles/dshx/settings'

export const onboardingSettings = defineSettings({
  namespace: 'dshfiles-onboarding',
  schema: Schema.object({
    wizard: Schema.boolean()
      .default(true)
      .description(
        'Open the three-step setup wizard (account, project, first task) by itself while an AI account or a project is still missing. A profile that has both never gets it on its own; ⌘K Show the setup wizard replays it.',
      ),
    checklist: Schema.boolean()
      .default(true)
      .description('Show the self-ticking setup checklist on Getting started. Off skips every Host check, the GitHub one included.'),
    githubCheck: Schema.boolean()
      .default(true)
      .description('Tick the GitHub item by running `gh auth status` on the Host, at most once a minute while Getting started or the agent asks.'),
    packs: Schema.boolean().default(true).description('Show plugin packs on Getting started with each plugin enabled, disabled or not installed.'),
    curatedOnly: Schema.boolean().default(true).description('List only the curated major features on Getting started until you search.'),
    whatsNew: Schema.boolean()
      .default(true)
      .description(
        "Show What's new on Getting started: feat and fix changes to owned plugins, read from the dshfiles checkout's jj or git history while the page or the agent asks. Off hides it and reads no history.",
      ),
    suggestions: Schema.boolean()
      .default(false)
      .description(
        'Suggest features you have not used yet from your local tool use (aggregate counts from the Usage plugin, read at most every 10 minutes while Getting started or the agent asks). No network or model request. Off reads nothing.',
      ),
    tryIt: Schema.boolean()
      .default(false)
      .description(
        'Offer Try it on Getting started features and packs, and allow the onboarding_try_it agent tool: after you confirm, it starts a new thread that sends a demo prompt to your default model, which spends tokens on your account. Off shows no Try it control and the tool refuses.',
      ),
  }),
  applies: 'live',
})

export type OnboardingSettings = SettingsValue<typeof onboardingSettings.schema>

/** Schema defaults, for a Client that renders before the namespace loads or on a Host that predates it. */
export const ONBOARDING_DEFAULTS: OnboardingSettings = {
  wizard: true,
  checklist: true,
  githubCheck: true,
  packs: true,
  curatedOnly: true,
  whatsNew: true,
  suggestions: false,
  tryIt: false,
}

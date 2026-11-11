import { defineApi, method } from '@dshfiles/dshx/api'
import * as Schema from 'effect/Schema'
import { OnboardingOverview, overviewInputSchema, overviewSchema } from './overview-model.js'
import { PACK_ACTIONS, PackPlan, packOutcomeSchema } from './pack-plan.js'
import { ReachModel, reachInputSchema, reachOutputSchema } from './reach-model.js'
import { SuggestionsModel, suggestionsInputSchema, suggestionsSchema } from './suggestions-model.js'
import { TryItModel, tryItInputSchema, tryItOutputSchema } from './try-it-model.js'
import { WhatsNewModel, whatsNewInputSchema, whatsNewSchema } from './whats-new-model.js'

const shortName = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(64))

export const applyPackInputSchema = Schema.Struct({
  pack: shortName,
  action: Schema.Literals(PACK_ACTIONS),
  /** No default: a request without it is refused before anything changes. */
  confirm: Schema.Literal(true),
  /** Only these plugins of the plan, in plan order; absent works through the whole plan. */
  plugins: Schema.optional(Schema.Array(shortName).check(Schema.isMaxLength(16))),
})

export const onboardingApi = defineApi({
  id: 'onboarding',
  version: 1,
  owner: '@dshfiles/onboarding',
  methods: {
    overview: method({
      input: overviewInputSchema,
      output: overviewSchema,
      description:
        'What this DSH setup can do and what is still missing: the setup checklist (an AI account connected, project added, project is a jj or git repository, GitHub CLI signed in) read live from the Host, each plugin pack with every plugin enabled, disabled or not installed, and the catalogued features grouped by destination with where each lives and how to open it. Search with `query` (every word must match), narrow with `destination`; curated features only until a query is given unless `curatedOnly` says otherwise. `preview: { pack, action }` adds exactly what enabling or disabling that pack would install, switch, keep and need, and whether a restart follows. Changes nothing. Read-only.',
      tool: { name: 'onboarding_overview', readOnly: true, render: OnboardingOverview.render },
    }),
    reach: method({
      input: reachInputSchema,
      output: reachOutputSchema,
      description:
        'How to get to one catalogued feature in the app, step by step: each `reach` step with its action (click, hover, fill, press, expect…), the control it targets (an ARIA role, or text, label or title) and its accessible name, plus which steps this app cannot replay (seed, attach, right-click and shift-click are E2E-only) and why. Also names the destination the feature lives in, its Open route and its docs. Find `key` (`<plugin>#<feature>`) with onboarding_overview. The same data drives Show me where on Getting started. Changes nothing. Read-only.',
      tool: { name: 'onboarding_reach', readOnly: true, render: ReachModel.render },
    }),
    whatsNew: method({
      input: whatsNewInputSchema,
      output: whatsNewSchema,
      description:
        "What changed in the owned dshfiles plugins, newest first: every `feat(<plugin>)` and `fix(<plugin>)` change in the jj (or git) history of the dshfiles checkout this profile links Getting started from, each with its plugin, date and commit, plus the plugins' catalog descriptions. `upstream` lists, per remote whose bookmark of the same name differs from the local one, the changes there not yet in local history, as of the last fetch; this method never fetches. `since` (ISO 8601) keeps changes that landed after an instant, `plugin` one plugin, `limit` bounds the list (default 50). `no-checkout` means a registry install with no history on this Host (the same changes are at `commitsUrl`); `off` means the onboarding `whatsNew` setting is off. No network or model request. Read-only.",
      tool: { name: 'onboarding_whats_new', readOnly: true, render: WhatsNewModel.render },
    }),
    suggestions: method({
      input: suggestionsInputSchema,
      output: suggestionsSchema,
      description:
        'Catalogued features the user has not used yet whose usage pattern suggests value, from the last 30 days of local tool use: each with the counts that triggered it (e.g. many jj shell commands and no thread workspace), why it helps, and its feature row (find it with onboarding_reach). Reads only aggregate counts from the Usage plugin (tool names, the executable of each shell command, request counts), cached for 10 minutes; never prompts, paths or command arguments. `no-usage` means the Usage plugin is not running. Refused while the onboarding `suggestions` setting is off (the default), and nothing is read then. No network or model request. Read-only.',
      tool: { name: 'onboarding_suggestions', readOnly: true, render: SuggestionsModel.render },
    }),
    applyPack: method({
      input: applyPackInputSchema,
      output: packOutcomeSchema,
      description:
        "Enable or disable one plugin pack of the active profile. Call only when the user asked to enable or disable that pack, after showing them onboarding_overview's preview; `confirm: true` is required and a call without it changes nothing. Existing plugin rows switch through the plugin manager (its applied / restart-required / overridden verdict is relayed); missing owned bundles install one at a time with the dshfiles checkout's dshx add, or come back as the exact command to run when this Host cannot reach that toolchain. The Core pack is never disabled, a disable keeps plugins another fully enabled pack shares, and nothing restarts DSH: the result says what waits for a restart. Reverse it with the other action.",
      tool: { name: 'onboarding_pack_apply', render: PackPlan.renderOutcome },
    }),
    tryIt: method({
      input: tryItInputSchema,
      output: tryItOutputSchema,
      description:
        "Start a demo of one catalogued feature (`feature`, its key from onboarding_overview) or one plugin pack (`pack`): a new thread whose first message, built only from the feature catalog, asks the agent there to show that feature in this setup with read-only tools and to ask before any write. The message is sent at once, so the new thread runs on the user's default model and spends tokens on their account. Call only when the user asked for this demo; `confirm: true` is required and a call without it starts nothing. Refused while the onboarding `tryIt` setting is off (the default). Returns the new thread's id; stop or archive that thread to end the demo.",
      tool: { name: 'onboarding_try_it', render: TryItModel.render },
    }),
  },
})

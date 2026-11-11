import { Api, DshxPlugin, HostContext } from '@dshfiles/dshx/effect'
import { DshChildProcessSpawner } from '@dshfiles/dshx/effect/child-process-spawner'
import { HostApis } from '@dshfiles/dshx/effect/host-apis'
import { Settings } from '@dshfiles/dshx/effect/settings'
import { NodeFileSystem, NodePath } from '@effect/platform-node'
import { Effect, Layer } from 'effect'
import { onboardingApi } from './api.js'
import { FEATURE_CATALOG } from './generated/feature-catalog.js'
import { OnboardingOverview } from './overview-model.js'
import { PackControls } from './pack-controls.js'
import { PackPlan } from './pack-plan.js'
import { ReachModel } from './reach-model.js'
import { onboardingSettings } from './settings.js'
import { SetupFacts } from './setup-facts.js'
import { SUGGESTIONS_OFF_MESSAGE, SuggestionsOffError } from './suggestions-model.js'
import { UsageSuggestions } from './usage-suggestions.js'
import { WhatsNewHistory } from './whats-new-history.js'

const platform = Layer.mergeAll(NodeFileSystem.layer, NodePath.layer)

const facts = SetupFacts.layer({ githubExecutable: 'gh' }).pipe(Layer.provide(Layer.mergeAll(Settings.layer(onboardingSettings), platform, HostApis.layer)))

const packs = Layer.unwrap(
  Effect.map(HostContext, host =>
    PackControls.layerFrom({
      manager: () => host.ctx.get('pluginManager') ?? undefined,
      profile: () => {
        const profile = host.ctx.get('profileContext')
        return profile === undefined || profile === null ? undefined : { name: profile.name, home: profile.home }
      },
      homeFromEnv: (process.env.DSH_HOME?.trim() ?? '') !== '',
      nodeExecutable: process.execPath,
    }),
  ),
).pipe(Layer.provide(Layer.mergeAll(platform, DshChildProcessSpawner.layer)))

const whatsNew = Layer.unwrap(
  Effect.map(HostContext, host =>
    WhatsNewHistory.layerFrom({
      manager: () => host.ctx.get('pluginManager') ?? undefined,
      plugins: FEATURE_CATALOG.plugins,
      jjExecutable: 'jj',
      gitExecutable: 'git',
    }),
  ),
).pipe(Layer.provide(Layer.mergeAll(platform, DshChildProcessSpawner.layer)))

const suggestions = UsageSuggestions.layerFrom({ catalog: FEATURE_CATALOG }).pipe(Layer.provide(HostApis.layer))

/** Prerequisite states for a pack plan, from the same checklist read the page shows. */
const prerequisitesNow = SetupFacts.use(setup =>
  Effect.gen(function* () {
    const settings = yield* setup.settings
    if (!settings.checklist) return new Map<string, 'done' | 'todo' | 'unknown' | 'off'>()
    return new Map(OnboardingOverview.checklist(yield* setup.checklist).map(item => [item.id, item.state] as const))
  }),
)

/** Serves the build-time feature catalog with the live setup facts, and switches packs only when asked to. */
export default DshxPlugin.make({
  name: 'dshfiles-onboarding',
  inject: ['subprocess'],
  settings: [onboardingSettings],
  layer: Layer.mergeAll(facts, packs, whatsNew, suggestions),
  apis: [
    Api.bind(onboardingApi, {
      overview: request =>
        Effect.gen(function* () {
          const setup = yield* SetupFacts
          const controls = yield* PackControls
          const settings = yield* setup.settings
          const [checklistFacts, entries] = yield* Effect.all([settings.checklist ? setup.checklist : Effect.succeed(null), controls.entries], {
            concurrency: 'unbounded',
          })
          const items = checklistFacts === null ? [] : OnboardingOverview.checklist(checklistFacts)
          const preview =
            request.preview === undefined
              ? null
              : yield* controls.preview({ ...request.preview, prerequisites: new Map(items.map(item => [item.id, item.state] as const)) })
          return OnboardingOverview.overview({
            catalog: FEATURE_CATALOG,
            facts: checklistFacts,
            states: entries === null ? null : PackPlan.statesOf(entries),
            request,
            curatedDefault: settings.curatedOnly,
            preview,
          })
        }),
      reach: request =>
        Effect.succeed(ReachModel.reach({ catalog: FEATURE_CATALOG, key: request.key, routeOf: feature => OnboardingOverview.rowOf(feature).route })),
      whatsNew: request =>
        Effect.gen(function* () {
          const settings = yield* SetupFacts.use(setup => setup.settings)
          if (!settings.whatsNew) return { state: 'off' } as const
          return yield* WhatsNewHistory.use(history => history.read(request))
        }),
      suggestions: () =>
        Effect.gen(function* () {
          const settings = yield* SetupFacts.use(setup => setup.settings)
          if (!settings.suggestions) return yield* new SuggestionsOffError({ message: SUGGESTIONS_OFF_MESSAGE })
          return yield* UsageSuggestions.use(usage => usage.read)
        }),
      applyPack: request =>
        Effect.gen(function* () {
          const controls = yield* PackControls
          return yield* controls.apply({ pack: request.pack, action: request.action, plugins: request.plugins, prerequisites: yield* prerequisitesNow })
        }),
    }),
  ],
})

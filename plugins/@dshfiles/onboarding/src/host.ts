import { Api, DshxPlugin } from '@dshfiles/dshx/effect'
import { Settings } from '@dshfiles/dshx/effect/settings'
import { NodeFileSystem, NodePath } from '@effect/platform-node'
import { Effect, Layer } from 'effect'
import { onboardingApi } from './api.js'
import { FEATURE_CATALOG } from './generated/feature-catalog.js'
import { OnboardingOverview } from './overview-model.js'
import { onboardingSettings } from './settings.js'
import { SetupFacts } from './setup-facts.js'

const facts = SetupFacts.layer({ githubExecutable: 'gh' }).pipe(
  Layer.provide(Layer.mergeAll(Settings.layer(onboardingSettings), NodeFileSystem.layer, NodePath.layer)),
)

/** Serves the build-time feature catalog with the live setup facts; it changes nothing. */
export default DshxPlugin.make({
  name: 'dshfiles-onboarding',
  settings: [onboardingSettings],
  layer: facts,
  apis: [
    Api.bind(onboardingApi, {
      overview: request =>
        SetupFacts.use(setup =>
          Effect.gen(function* () {
            const settings = yield* setup.settings
            const [checklist, states] = yield* Effect.all([settings.checklist ? setup.checklist : Effect.succeed(null), setup.pluginStates], {
              concurrency: 'unbounded',
            })
            return OnboardingOverview.overview({ catalog: FEATURE_CATALOG, facts: checklist, states, request, curatedDefault: settings.curatedOnly })
          }),
        ),
    }),
  ],
})

import type { Context as CordisContext } from '@deepseek-ai/cordis'
import { DshxEffect } from '@dshfiles/dshx/effect'
import { defineHost } from '@dshfiles/dshx/host'
import { Context, Effect, Layer, Schema } from 'effect'
import { privacyControlsApi } from './api/privacy-controls.js'
import { createPrivacyControlsService, type PrivacyControlsEnvironment } from './controls.js'

class PrivacyControlsFailure extends Schema.TaggedError<PrivacyControlsFailure>()('PrivacyControlsFailure', {
  message: Schema.String,
}) {}

class PrivacyControlsRuntime extends Context.Service<PrivacyControlsRuntime, ReturnType<typeof createPrivacyControlsService>>()(
  '@dshfiles/privacy-controls/Runtime',
) {}

const privacyControlsLayer = (ctx: CordisContext) => {
  const loader = ctx.get('loader')
  const environment: PrivacyControlsEnvironment = {
    patchPath: ctx.get('profileContext')?.patchPath,
    entries: () => (loader === undefined ? undefined : [...loader.entries()]),
    hmr: ctx.get('hmr'),
  }
  return Layer.succeed(PrivacyControlsRuntime, createPrivacyControlsService(environment))
}

const { hostApi, ...effectPlugin } = DshxEffect.plugin({ layer: privacyControlsLayer, setup: () => Effect.void })

const tryControls = <Value>(run: () => Promise<Value>) =>
  Effect.tryPromise({
    try: run,
    catch: cause => new PrivacyControlsFailure({ message: cause instanceof Error ? cause.message : String(cause) }),
  })

const privacyControlsHostApi = hostApi(privacyControlsApi, {
  read: Effect.fn('privacy controls read')(() => PrivacyControlsRuntime.use(runtime => tryControls(() => runtime.read()))),
  setFeature: Effect.fn('privacy feature set')(({ input }) => PrivacyControlsRuntime.use(runtime => tryControls(() => runtime.setFeature(input)))),
  setAll: Effect.fn('privacy features set all')(({ input }) => PrivacyControlsRuntime.use(runtime => tryControls(() => runtime.setAll(input.enabled)))),
})

export default defineHost({
  ...effectPlugin,
  name: 'dshfiles-privacy-controls',
  inject: ['profileContext', 'loader', 'hmr'],
  apis: [privacyControlsHostApi],
})

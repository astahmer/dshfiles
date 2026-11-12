import { Api, DshxPlugin } from '@dshfiles/dshx/effect'
import { Settings } from '@dshfiles/dshx/effect/settings'
import { Effect, Layer } from 'effect'
import { compatApi } from './api.js'
import { Runtime } from './runtime-promise.js'
import { compatSettings } from './settings.js'

export default DshxPlugin.make({
  name: '@dshfiles/opencode-compat',
  settings: [compatSettings],
  layer: Runtime.layer.pipe(Layer.provide(Settings.layer(compatSettings))),
  apis: [Api.bind(compatApi, { status: () => Runtime.use(runtime => Effect.map(runtime.status, plugins => ({ plugins: [...plugins] }))) })],
})

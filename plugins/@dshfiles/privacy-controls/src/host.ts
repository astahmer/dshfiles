import { Api, DshxPlugin } from '@dshfiles/dshx/effect'
import { layer as nodeFileSystemLayer } from '@effect/platform-node/NodeFileSystem'
import { Layer } from 'effect'
import { privacyControlsApi } from './api/privacy-controls.js'
import { PrivacyControls } from './controls.js'
import { profileLayer } from './profile-promise.js'

export default DshxPlugin.make({
  name: 'dshfiles-privacy-controls',
  inject: ['profileContext', 'loader', 'hmr'],
  layer: PrivacyControls.layer.pipe(Layer.provide([profileLayer, nodeFileSystemLayer])),
  apis: [
    Api.bind(privacyControlsApi, {
      read: () => PrivacyControls.use(controls => controls.read),
      setFeature: input => PrivacyControls.use(controls => controls.setFeature(input)),
      setAll: input => PrivacyControls.use(controls => controls.setAll(input.enabled)),
    }),
  ],
})

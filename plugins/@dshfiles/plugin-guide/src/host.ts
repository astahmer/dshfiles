import { DshxPlugin } from '@dshfiles/dshx/effect'
import { pluginGuideApi } from './api.js'

// The generated catalog is most of this row's Host bundle and only the guide page or its tools read it, so it loads on
// the first call instead of at boot.
export default DshxPlugin.facade({
  name: 'dshfiles-plugin-guide',
  apis: [pluginGuideApi],
  load: () => import('./host-implementation.js'),
})

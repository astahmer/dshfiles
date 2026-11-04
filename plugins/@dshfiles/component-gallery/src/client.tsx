import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import { defineClientPlugin } from '@dshfiles/dshx/client'
import { ShapesIcon } from '@dshfiles/plugin-ui/icons'
import { GalleryPage } from './gallery.js'
import { galleryCategories } from './demos/index.js'

const PANEL_ID = 'component-gallery'

export default defineClientPlugin({
  id: 'dshfiles-component-gallery',
  name: 'Component gallery',
  uses: ['ui'],
  setup(api) {
    const RootPanel = (): JSX.Element => <GalleryPage categories={galleryCategories} />
    api.ui.register({ name: 'sidebar.panellist', id: PANEL_ID, order: 90, label: () => 'Component Gallery: Components' }, () => (
      <ShapesIcon aria-hidden size={18} />
    ))
    api.ui.register({ name: 'main', key: PANEL_ID }, RootPanel)
  },
})

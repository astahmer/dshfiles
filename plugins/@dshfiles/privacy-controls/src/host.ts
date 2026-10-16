import { definePlugin } from '@dshfiles/dshx/host'
import { privacyControlsApi } from './api/privacy-controls.js'
import { createPrivacyControlsService } from './controls.js'

const privacyControlsHostApi = privacyControlsApi.host({
  read: async ({ ctx }) => createPrivacyControlsService(ctx).read(),
  setFeature: async ({ input, ctx }) => createPrivacyControlsService(ctx).setFeature(input),
  setAll: async ({ input, ctx }) => createPrivacyControlsService(ctx).setAll(input.enabled),
})

export default definePlugin({
  id: 'dshfiles-privacy-controls',
  name: 'Feedback & privacy',
  apis: [privacyControlsHostApi],
})

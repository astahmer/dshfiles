import { definePlugin } from '@dshfiles/dshx/host'
import { privacyControlsApi } from './api/privacy-controls.js'
import { readPrivacyControls, setAllPrivacyFeaturesEnabled, setPrivacyFeatureEnabled } from './controls.js'

const privacyControlsHostApi = privacyControlsApi.host({
  read: async ({ ctx }) => readPrivacyControls(ctx),
  setFeature: async ({ input, ctx }) => setPrivacyFeatureEnabled(ctx, input),
  setAll: async ({ input, ctx }) => setAllPrivacyFeaturesEnabled(ctx, input.enabled),
})

export default definePlugin({
  id: 'dshfiles-privacy-controls',
  name: 'Feedback & privacy',
  apis: [privacyControlsHostApi],
})

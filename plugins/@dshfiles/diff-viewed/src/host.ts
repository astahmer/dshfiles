import type {} from '@deepseek-ai/dsh-storage-domain'
import { defineHost } from '@dshfiles/dshx/host'
import { diffViewedApiHost, diffViewedEffectPlugin } from './marks-host.js'

export default defineHost({
  ...diffViewedEffectPlugin,
  name: '@dshfiles/diff-viewed',
  inject: ['storageDomain'],
  apis: [diffViewedApiHost],
})

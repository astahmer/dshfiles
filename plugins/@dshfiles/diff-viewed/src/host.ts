import type {} from '@deepseek-ai/dsh-storage-domain'
import { defineHost } from '@dshfiles/dshx/host'
import { closeViewedMarks, diffViewedApiHost, viewedMarksFor } from './marks-host.js'

export default defineHost({
  name: '@dshfiles/diff-viewed',
  inject: ['storageDomain'],
  apis: [diffViewedApiHost],
  // The review progress lives on the Host so every browser, plugin and CLI reads the same marks.
  setup: ctx => {
    ctx.effect(() => {
      const opening = viewedMarksFor(ctx)
      void opening.catch(() => undefined)
      return async () => {
        await closeViewedMarks()
      }
    }, 'diff-viewed: viewed marks store')
  },
})

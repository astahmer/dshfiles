import type {} from '@deepseek-ai/dsh-subprocess'
import { definePlugin } from '@dshfiles/dshx/host'
import { pullsReviewApi } from './api.js'
import { createJjRun } from './jj.js'
import { reviewWorkspace } from './review.js'

export default definePlugin({
  id: 'dshfiles-pulls-review',
  uses: ['rpc'],
  inject: ['subprocess'],
  setup(api) {
    const run = createJjRun(api.raw.ctx)
    void api.rpc.register(
      pullsReviewApi.host({
        review: ({ input, signal }) => reviewWorkspace({ run, path: input.path, base: input.base, signal }),
      }),
    )
  },
})

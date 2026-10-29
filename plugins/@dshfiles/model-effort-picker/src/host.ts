import type {} from '@deepseek-ai/dsh-llm'
import { definePlugin } from '@dshfiles/dshx/host'
import { modelHandoffApi } from './model-handoff-api.js'
import { modelEffortPickerSettings } from './settings.js'

const modelHandoffHost = modelHandoffApi.host({
  contextWindow: async ({ ctx, input }) => {
    const model = await ctx.llm.resolveModelInfo(input.provider, input.model)
    return model.context?.contextWindow ?? null
  },
})

export default definePlugin({
  id: 'dshfiles-model-effort-picker',
  inject: ['llm'],
  apis: [modelHandoffHost],
  settings: [modelEffortPickerSettings],
})

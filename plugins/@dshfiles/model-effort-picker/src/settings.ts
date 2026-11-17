import Schema from '@deepseek-ai/schemastery'
import { defineSettings } from '@dshfiles/dshx/settings'

export const modelEffortPickerSettings = defineSettings({
  namespace: 'dshfiles-model-effort-picker',
  schema: Schema.object({
    accountSwap: Schema.boolean()
      .default(false)
      .description(
        'Show a button beside the model picker that moves the thread to the next account with the same model.',
      ),
    accountSwapRoutes: Schema.array(Schema.string())
      .default([])
      .description(
        'Routes the swap button rotates through, in catalog order (empty: every route with the model).',
      ),
  }),
  applies: 'live',
})

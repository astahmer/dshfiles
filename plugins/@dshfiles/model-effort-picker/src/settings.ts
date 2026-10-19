import Schema from '@deepseek-ai/schemastery'
import { defineSettings } from '@dshfiles/dshx/settings'

export const modelEffortPickerSettings = defineSettings({
  namespace: 'dshfiles-model-effort-picker',
  schema: Schema.object({
    accountSwap: Schema.boolean()
      .default(true)
      .description(
        'Show a swap button beside the model picker that moves the Session to the next account offering the same model. It only appears when another account offers it.',
      ),
    accountSwapRoutes: Schema.array(Schema.string())
      .default([])
      .description(
        'Provider routes the swap button rotates through, in model catalog order (for example codex-alex1). Leave empty to rotate through every route that offers the selected model.',
      ),
  }),
  applies: 'live',
})

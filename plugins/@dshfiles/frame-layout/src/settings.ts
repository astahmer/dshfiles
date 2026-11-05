import Schema from '@deepseek-ai/schemastery'
import { defineSettings } from '@dshfiles/dshx/settings'

/**
 * The Status bar section draws these as a list of the registered items, so the generated page shows none of them.
 * Two fields, not one object: hiding and moving write separately, so one write never overwrites the other's change.
 */
export const frameLayoutSettings = defineSettings({
  namespace: 'dshfiles-frame-layout',
  schema: Schema.object({
    hiddenStatusItems: Schema.array(Schema.string())
      .default([])
      .hidden()
      .description('Status item ids (the providing package) the status bar leaves out. Unknown ids are ignored.'),
    statusItemOrder: Schema.array(Schema.string())
      .default([])
      .hidden()
      .description('Status item ids in the order the user arranged them; unlisted items keep their default place.'),
  }),
  applies: 'live',
})

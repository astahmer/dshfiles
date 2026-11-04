import { createStoredValue } from '@dshfiles/plugin-ui/hooks/stored-value'
import * as Schema from 'effect/Schema'

// `createStoredValue` (plugin-ui) is typed to `ZodType`, so the Effect schema reaches it through the published view.
export const openFileLinksPreference = createStoredValue({
  key: 'dshfiles-editor:open-file-links',
  schema: Schema.Boolean,
  fallback: true,
})

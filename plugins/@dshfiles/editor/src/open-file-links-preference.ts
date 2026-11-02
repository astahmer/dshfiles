import { zodSchemaFromEffect } from '@dshfiles/dshx/api'
import { createStoredValue } from '@dshfiles/plugin-ui/hooks/stored-value'
import * as Schema from 'effect/Schema'

// `createStoredValue` (plugin-ui) is typed to `ZodType`, so the Effect schema reaches it through the published view.
export const openFileLinksPreference = createStoredValue({
  key: 'dshfiles-editor:open-file-links',
  schema: zodSchemaFromEffect(Schema.Boolean),
  fallback: true,
})

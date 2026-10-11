import { createStoredValue } from '@dshfiles/plugin-ui/hooks/stored-value'
import { z } from 'zod'

export const openFileLinksPreference = createStoredValue({
  key: 'dshfiles-editor:open-file-links',
  schema: z.boolean(),
  fallback: true,
})

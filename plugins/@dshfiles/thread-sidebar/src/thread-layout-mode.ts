import { createStoredValue } from '@dshfiles/plugin-ui/hooks/stored-value'
import { z } from 'zod'

export type ThreadLayoutMode = 'list' | 'board'

const threadLayoutModeSchema = z.enum(['list', 'board'])

export const storedThreadLayoutMode = createStoredValue({
  key: 'dshfiles.thread-sidebar.layout-mode.v1',
  schema: threadLayoutModeSchema,
  fallback: 'list',
})

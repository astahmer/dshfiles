import Schema from '@deepseek-ai/schemastery'
import { defineSettings } from '@dshfiles/dshx/settings'

export const queueReorderSettings = defineSettings({
  namespace: 'queue-reorder',
  schema: Schema.object({
    expandByDefault: Schema.boolean().default(true).description('Show the queued messages expanded when the queue grows past one message.'),
    previewLength: Schema.natural().min(40).max(1000).default(200).description('Characters of each queued message shown before it is truncated.'),
  }),
  applies: 'live',
})

import Schema from '@deepseek-ai/schemastery'
import { defineSettings, type SettingsValue } from '@dshfiles/dshx/settings'

export const sessionUndoSettings = defineSettings({
  namespace: 'dshfiles-session-undo',
  schema: Schema.object({
    turnRevisions: Schema.boolean()
      .default(true)
      .description(
        'Name each turn’s jj revision and offer Restore to here under the turn.',
      ),
  }),
})

export type SessionUndoSettings = SettingsValue<typeof sessionUndoSettings.schema>

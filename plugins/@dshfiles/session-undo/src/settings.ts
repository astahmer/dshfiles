import Schema from '@deepseek-ai/schemastery'
import { defineSettings, type SettingsValue } from '@dshfiles/dshx/settings'

export const sessionUndoSettings = defineSettings({
  namespace: 'dshfiles-session-undo',
  schema: Schema.object({
    turnRevisions: Schema.boolean()
      .default(true)
      .description(
        'At each turn end in a jj workspace, name the revision the turn produced and show it under the turn with Restore to here. Off skips the turn-end snapshot and hides the action.',
      ),
  }),
})

export type SessionUndoSettings = SettingsValue<typeof sessionUndoSettings.schema>

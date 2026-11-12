import Schema from '@deepseek-ai/schemastery'
import { defineSettings } from '@dshfiles/dshx/settings'

/** The namespace is the plugin's Loader entry id in cordis.patch.yml, as Host settings require. */
export const composerControlsSettings = defineSettings({
  namespace: 'dshfiles-rich-composer',
  schema: Schema.object({
    hidePermissionSelector: Schema.boolean().default(false).description('Hide the permission mode selector (Full access, Ask, …) from the composer controls.'),
    showComposerExtras: Schema.boolean()
      .default(false)
      .description(
        'Show undo, history and saved prompts in the composer bar (with the side-question button). Off: they are rows of the bar’s More (⋯) menu, with their keys.',
      ),
    showAgentPresetPicker: Schema.boolean()
      .default(false)
      .description(
        'Show the agent mode picker in the composer (Standard mode, Creator, …). Off: it shows only when a new thread will start with a non-default agent mode; ⌘K “Agent mode” and the composer’s ⋯ menu still choose one.',
      ),
  }),
  applies: 'live',
})

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
        'Show undo, history and saved prompts in the composer bar instead of its ⋯ menu.',
      ),
    showAgentPresetPicker: Schema.boolean()
      .default(false)
      .description(
        'Always show the agent mode picker in the composer.',
      ),
    sendWhenUploaded: Schema.boolean()
      .default(true)
      .description(
        'Send pressed while attachments upload waits and sends once they finish; editing the message, a failed upload or pressing Send again cancels it. Off: Send refuses with a notice until the uploads finish.',
      ),
  }),
  applies: 'live',
})

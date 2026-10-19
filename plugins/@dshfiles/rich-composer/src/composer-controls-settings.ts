import Schema from '@deepseek-ai/schemastery'
import { defineSettings } from '@dshfiles/dshx/settings'

/** The namespace is the plugin's Loader entry id in cordis.patch.yml, as Host settings require. */
export const composerControlsSettings = defineSettings({
  namespace: 'dshfiles-rich-composer',
  schema: Schema.object({
    hidePermissionSelector: Schema.boolean().default(false).description('Hide the permission mode selector (Full access, Ask, …) from the composer controls.'),
  }),
  applies: 'live',
})

import Schema from '@deepseek-ai/schemastery'
import { defineSettings } from '@dshfiles/dshx/settings'

export const compatSettings = defineSettings({
  namespace: 'dshfiles-opencode-compat',
  schema: Schema.object({
    plugins: Schema.array(
      Schema.object({
        specifier: Schema.string().default('').description('Absolute path to a plugin module or directory.'),
        options: Schema.string().default('{}').description('JSON object passed to the plugin as options.'),
        enabled: Schema.boolean().default(true),
      }),
    ).default([]),
    onUnsupported: Schema.union([Schema.const('report'), Schema.const('fail')]).default('report'),
  }),
})

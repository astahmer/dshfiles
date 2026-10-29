import Schema from '@deepseek-ai/schemastery'
import { defineSettings } from '@dshfiles/dshx/settings'

export const policiesSettings = defineSettings({
  namespace: 'dshfiles-policies',
  schema: Schema.object({
    rules: Schema.array(
      Schema.object({
        name: Schema.string().default('').description('Short name shown in the refusal, such as “no force push”.'),
        tool: Schema.string()
          .default('*')
          .description('Tool name the rule covers; `*` matches any run of characters, so `mcp__*` covers every MCP tool and `*` every tool.'),
        match: Schema.string()
          .default('')
          .description('Regular expression tested against the call’s arguments as JSON, such as `git push.*--force`. Empty denies every call of the tool.'),
        reason: Schema.string().default('').description('Why it is denied; the agent reads it in the refusal.'),
        enabled: Schema.boolean().default(true),
      }),
    )
      .default([])
      .description('Calls a matching rule denies outright, after permissions and approvals: no approval can allow them.'),
  }),
})

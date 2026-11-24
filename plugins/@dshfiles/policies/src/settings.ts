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
      .description(
        [
          'When: an enabled rule matches both the tool name and its arguments. The tool pattern checks the whole name (* is a wildcard). The match pattern checks JSON arguments as a case-sensitive regular expression.',
          'Then: deny the call. Approval cannot override a denial. An empty or invalid match pattern denies every call whose tool matches.',
          'Edit a JSON array. The defaults are enabled: true, tool: *, and an empty match. Set enabled to false to keep a rule inactive. Name and reason appear in the refusal. Leaving the field submits valid JSON for saving.',
          'Past impact: unknown. This editor does not check past calls; unknown is not zero matches.',
        ].join('\n'),
      ),
  }),
})

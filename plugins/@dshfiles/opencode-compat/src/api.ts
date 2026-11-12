import { defineApi, method } from '@dshfiles/dshx/api'
import { Schema } from 'effect'

const unsupported = Schema.Struct({ pluginId: Schema.String, api: Schema.String, firstSeenAt: Schema.String, count: Schema.Number })
const plugin = Schema.Struct({
  specifier: Schema.String,
  id: Schema.NullOr(Schema.String),
  state: Schema.Literals(['loaded', 'failed', 'disabled']),
  error: Schema.NullOr(Schema.String),
  contributions: Schema.Struct({ tools: Schema.Array(Schema.String), skills: Schema.Array(Schema.String), hooks: Schema.Array(Schema.String) }),
  unsupported: Schema.Array(unsupported),
})

export const compatApi = defineApi({
  id: 'opencode-compat',
  version: 1,
  owner: '@dshfiles/opencode-compat',
  methods: {
    status: method({
      input: Schema.Struct({}),
      output: Schema.Struct({ plugins: Schema.Array(plugin) }),
      description: 'List configured OpenCode plugins, load errors, contributions and unsupported API calls. Read-only.',
      tool: { name: 'opencode_plugins_status', readOnly: true, render: output => JSON.stringify(output, null, 2) },
    }),
  },
})

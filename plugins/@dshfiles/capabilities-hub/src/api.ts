import { defineApi, method } from '@dshfiles/dshx/api'
import * as Schema from 'effect/Schema'
import { CapabilitiesHub } from './hub-model.js'

const managerSchema = Schema.Struct({ panelId: Schema.String, label: Schema.String, owner: Schema.String })

const sectionSchema = Schema.Struct({
  id: Schema.Literals(['skills', 'mcp', 'plugins']),
  label: Schema.String,
  summary: Schema.String,
  trust: Schema.Literals(['agent-instructions', 'tools-and-credentials', 'executable-code']),
  trustLabel: Schema.String,
  trustDetail: Schema.String,
  manager: managerSchema,
  agentTools: Schema.Array(Schema.String),
})

export const hubOverviewSchema = Schema.Struct({
  sections: Schema.Array(sectionSchema),
  skillsSh: Schema.Struct({
    url: Schema.String,
    docsUrl: Schema.String,
    cliVersion: Schema.String,
    command: Schema.String,
    telemetryDisabled: Schema.Literal(true),
    inAppSearch: Schema.Literal('unavailable'),
    inAppSearchReason: Schema.String,
  }),
})

export const capabilitiesHubApi = defineApi({
  id: 'capabilities-hub',
  version: 1,
  owner: '@dshfiles/capabilities-hub',
  methods: {
    overview: method({
      input: Schema.Struct({}),
      output: hubOverviewSchema,
      description:
        'Where each kind of capability is managed in DSH: agent skills, MCP servers and DSH plugins, with the trust each grants, the page and agent tools that own it, and the skills.sh link plus the telemetry-off CLI command a user can run. Makes no network call and installs nothing. Read-only.',
      tool: { name: 'capabilities_hub_overview', readOnly: true, render: CapabilitiesHub.render },
    }),
  },
})

import { defineApi, method } from '@dshfiles/dshx/api'
import { Schema } from 'effect'

const versionsInput = Schema.Struct({
  packages: Schema.Array(Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(240))).check(Schema.isMaxLength(500)),
})
const versionsInputStandard = Schema.toStandardSchemaV1(versionsInput, { parseOptions: { onExcessProperty: 'error' } })
const versionsInputJsonSchema = Schema.toStandardJSONSchemaV1(versionsInput)['~standard'].jsonSchema
const versionsInputApiSchema = {
  ...versionsInputStandard,
  '~standard': {
    ...versionsInputStandard['~standard'],
    jsonSchema: {
      input: (options: Parameters<typeof versionsInputJsonSchema.input>[0]) => ({ ...versionsInputJsonSchema.input(options), additionalProperties: false }),
      output: (options: Parameters<typeof versionsInputJsonSchema.output>[0]) => ({ ...versionsInputJsonSchema.output(options), additionalProperties: false }),
    },
  },
}

export const agentToolkitApi = defineApi({
  id: 'agent-toolkit',
  version: 1,
  owner: '@dshfiles/agent-toolkit',
  methods: {
    versions: method({
      input: versionsInputApiSchema,
      output: Schema.Record(Schema.String, Schema.NullOr(Schema.String)),
      description: 'The installed version of each package as the current DSH profile resolves it; null when it cannot be found.',
    }),
  },
})

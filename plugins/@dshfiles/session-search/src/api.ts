import { defineApi, method as defineMethod } from '@dshfiles/dshx/api'
import type { ApiMethodOptions, ApiToolExposure } from '@dshfiles/dshx/api'
import * as Schema from 'effect/Schema'
import { indexHealthSchema } from './protocol.js'
import { strictStandardSchema } from './schema.js'

const compactJson = <Output>(output: Output): string => JSON.stringify(output)

const method = <const Input extends Schema.ConstraintDecoder<unknown>, const Output extends Schema.ConstraintDecoder<unknown>>(
  options: Omit<ApiMethodOptions<Input, Output>, 'tool'> & {
    readonly input: Input
    readonly output: Output
    readonly tool?: ApiToolExposure<Output['Type']>
  },
) =>
  defineMethod({
    ...options,
    input: strictStandardSchema(options.input),
    output: strictStandardSchema(options.output),
  })

/**
 * The one user-visible capability this plugin adds on top of search itself: the state of its own derived index. Every
 * method is a read, and each carries the matching agent tool.
 */
export const sessionSearchApi = defineApi({
  id: 'session-search',
  version: 1,
  owner: '@dshfiles/session-search',
  methods: {
    health: method({
      input: Schema.Record(Schema.String, Schema.Never),
      output: Schema.Struct({ ...indexHealthSchema.fields, ownsService: Schema.Boolean }),
      description:
        'Read the owned session-search index health: indexed sessions and documents, index bytes, how many log sessions and bytes are still behind, whether an ingest pass is running, how long the last pass took, and the last error. `ownsService` is false when another plugin owns the sessionQuery service, in which case content search runs on that backend and these counters stay zero. Read-only.',
      tool: { name: 'session_search_health', readOnly: true, render: compactJson },
    }),
  },
})

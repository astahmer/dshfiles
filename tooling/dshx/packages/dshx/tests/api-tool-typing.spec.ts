import * as Schema from 'effect/Schema'
import { describe, expectTypeOf, it } from 'vitest'
import { defineApi, method } from '../src/api/index.js'

describe('tool exposure typing', () => {
  it('types render with the method output', () => {
    const api = defineApi({
      id: 'typed',
      version: 1,
      methods: {
        status: method({
          input: Schema.Struct({ path: Schema.String }),
          output: Schema.Struct({ summary: Schema.String, count: Schema.Number.check(Schema.isFinite()) }),
          description: 'Status.',
          tool: {
            name: 'typed_status',
            render: output => {
              expectTypeOf(output).toEqualTypeOf<{ readonly summary: string; readonly count: number }>()
              return output.summary
            },
          },
        }),
      },
    })
    expectTypeOf(api.methods.status.tool).toMatchTypeOf<{ readonly name: string } | undefined>()
  })
})

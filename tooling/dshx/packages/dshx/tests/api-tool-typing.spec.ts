import { z } from 'zod'
import { describe, expectTypeOf, it } from 'vitest'
import { defineApi, method } from '../src/api/index.js'

describe('tool exposure typing', () => {
  it('types render with the method output', () => {
    const api = defineApi({
      id: 'typed',
      version: 1,
      methods: {
        status: method({
          input: z.object({ path: z.string() }),
          output: z.object({ summary: z.string(), count: z.number() }),
          description: 'Status.',
          tool: {
            name: 'typed_status',
            render: output => {
              expectTypeOf(output).toEqualTypeOf<{ summary: string; count: number }>()
              return output.summary
            },
          },
        }),
      },
    })
    expectTypeOf(api.methods.status.tool).toMatchTypeOf<{ readonly name: string } | undefined>()
  })
})

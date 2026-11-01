import { z } from 'zod'
import * as Schema from 'effect/Schema'

export { z, Schema }
export const fixtures = [
  { name: 'string', zod: z.string(), effect: Schema.String, input: 'sample' },
  { name: 'boolean', zod: z.boolean(), effect: Schema.Boolean, input: true },
  { name: 'literal-union', zod: z.enum(['ready', 'done']), effect: Schema.Literals(['ready', 'done']), input: 'ready' },
]

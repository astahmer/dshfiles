import * as Schema from 'effect/Schema'
import { dateTimeString, uuidSchema } from './schema.js'

export const legacySavedDraftSchema = Schema.Struct({
  id: uuidSchema,
  title: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(120)),
  text: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(24_000)),
  createdAt: dateTimeString,
  updatedAt: dateTimeString,
})

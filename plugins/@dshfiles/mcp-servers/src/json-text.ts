import * as Result from 'effect/Result'
import * as Schema from 'effect/Schema'
import type * as SchemaTypes from 'effect/Schema'

/** A JSON text field the user typed: invalid JSON and a refused value both reach the form as one message. */
export class McpJsonTextError extends Schema.TaggedError<McpJsonTextError>()('McpJsonTextError', { message: Schema.String }) {}

/** JSON text parsed once and decoded by the schema that gives it a type. */
export const decodeJsonText = <S extends SchemaTypes.ConstraintDecoder<unknown>>(text: unknown, schema: S, message: string) => {
  if (typeof text !== 'string') return Result.fail(new McpJsonTextError({ message }))
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return Result.fail(new McpJsonTextError({ message }))
  }
  const decoded = Schema.decodeUnknownResult(schema, { onExcessProperty: 'error' })(parsed)
  return decoded._tag === 'Success' ? decoded : Result.fail(new McpJsonTextError({ message }))
}

import * as Schema from 'effect/Schema'

/**
 * The `session/new` config options every ACP agent answers with: one selectable value list per setting (`model`,
 * `agent`, a CLI's own thought-level option), which the ACP client picks from with `session/set_config_option`.
 */

export const configOptionSchema = Schema.Struct({
  id: Schema.String,
  currentValue: Schema.optional(Schema.Unknown),
  options: Schema.optional(Schema.Array(Schema.Struct({ value: Schema.String, name: Schema.optional(Schema.String) }))),
})

export const configOptionsSchema = Schema.Array(configOptionSchema)
export type AcpConfigOptions = typeof configOptionsSchema.Type

/** The values one option offers; an absent option offers none. */
export const optionValues = (options: AcpConfigOptions | undefined, id: string): readonly string[] =>
  options?.find(option => option.id === id)?.options?.map(choice => choice.value) ?? []

/**
 * The value to select when the caller asked for `requested`: the value itself when the CLI offers it, else the
 * closest lower one in `order`, else the lowest offered. Undefined when the CLI offers nothing to choose.
 */
export const clampOptionValue = <Value extends string>(requested: Value, offered: readonly Value[], order: readonly string[]): Value | undefined => {
  if (offered.includes(requested)) return requested
  const rank = order.indexOf(requested)
  return [...offered].reverse().find(value => order.indexOf(value) < rank) ?? offered[0]
}

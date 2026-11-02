import { Effect, Schema } from 'effect'

/** Opaque native ids keep case, paths and punctuation; the registry never rewrites a resource's native content. */
const slugSchema = Schema.String.check(Schema.isPattern(/^[a-z][a-z0-9._-]{0,79}$/u))
const boundedText = (minimum: number, maximum: number) => Schema.String.check(Schema.isMinLength(minimum), Schema.isMaxLength(maximum))
const trimmedText = (minimum: number, maximum: number) => Schema.Trim.check(Schema.isMinLength(minimum), Schema.isMaxLength(maximum))
const positiveInt = Schema.Number.check(Schema.isFinite(), Schema.isInt(), Schema.isGreaterThan(0))
const countInt = Schema.Number.check(Schema.isFinite(), Schema.isInt(), Schema.isGreaterThanOrEqualTo(0))

/** A decoded value fills an absent field, so a stored record carries every declared property. */
const defaultedText = (maximum: number, fallback: string) =>
  Schema.String.check(Schema.isMaxLength(maximum)).pipe(Schema.withDecodingDefaultKey(Effect.succeed(fallback)))
const defaultedBoolean = (fallback: boolean) => Schema.Boolean.pipe(Schema.withDecodingDefaultKey(Effect.succeed(fallback)))

export const resourceRefSchema = Schema.Struct({
  provider: slugSchema,
  kind: slugSchema,
  id: boundedText(1, 2_000),
})

export const propertyValueSchema = Schema.Union([
  Schema.String.check(Schema.isMaxLength(20_000)),
  Schema.Number.check(Schema.isFinite()),
  Schema.Boolean,
  Schema.Null,
  Schema.Array(Schema.String.check(Schema.isMaxLength(200))).check(Schema.isMaxLength(100)),
  resourceRefSchema,
  Schema.Array(resourceRefSchema).check(Schema.isMaxLength(100)),
])
export const propertyValuesSchema = Schema.Record(slugSchema, propertyValueSchema)

export const propertyTypes = ['text', 'number', 'checkbox', 'date', 'datetime', 'select', 'multiselect', 'reference', 'references'] as const

const propertyBase = {
  id: slugSchema,
  label: trimmedText(1, 100),
  description: defaultedText(500, ''),
  /** A stored owner-written value, NOT an arbitrary computed JavaScript callback. */
  readOnly: defaultedBoolean(false),
}
export const optionSchema = Schema.Struct({ id: slugSchema, label: trimmedText(1, 100) })
const choices = Schema.Array(optionSchema).check(Schema.isMinLength(1), Schema.isMaxLength(100))
const propertyType = <Type extends string>(type: Type) => Schema.Struct({ ...propertyBase, type: Schema.Literal(type) })

export const propertyDefinitionSchema = Schema.Union([
  propertyType('text'),
  propertyType('number'),
  propertyType('checkbox'),
  propertyType('date'),
  propertyType('datetime'),
  Schema.Struct({ ...propertyBase, type: Schema.Literal('select'), options: choices }),
  Schema.Struct({ ...propertyBase, type: Schema.Literal('multiselect'), options: choices }),
  propertyType('reference'),
  propertyType('references'),
])

export const packDefinitionSchema = Schema.Struct({
  id: slugSchema,
  version: positiveInt,
  label: trimmedText(1, 100),
  description: defaultedText(1_000, ''),
  properties: Schema.Array(propertyDefinitionSchema).check(Schema.isMinLength(1), Schema.isMaxLength(40)),
})

export const storedPackSchema = Schema.Struct({
  definition: packDefinitionSchema,
  owner: boundedText(1, 200),
  createdAt: countInt,
  updatedAt: countInt,
})
export const attachmentSchema = Schema.Struct({
  packId: slugSchema,
  values: propertyValuesSchema,
  attached: Schema.Boolean,
})
export const resourceLabelSchema = trimmedText(1, 200)
export const resourceSchema = Schema.Struct({
  id: Schema.String.check(Schema.isUUID()),
  ref: resourceRefSchema,
  label: resourceLabelSchema,
  revision: positiveInt,
  attachments: Schema.Array(attachmentSchema).check(Schema.isMaxLength(40)),
  createdAt: countInt,
  updatedAt: countInt,
})
export const resourceEventSchema = Schema.Struct({
  id: Schema.String.check(Schema.isUUID()),
  resourceId: Schema.String.check(Schema.isUUID()),
  revision: positiveInt,
  actor: boundedText(1, 200),
  action: Schema.Literals(['created', 'attached', 'detached', 'values-updated']),
  packId: Schema.NullOr(slugSchema),
  at: countInt,
})

export type ResourceRef = typeof resourceRefSchema.Type
export type PropertyValue = typeof propertyValueSchema.Type
export type PropertyValues = typeof propertyValuesSchema.Type
export type PropertyDefinition = typeof propertyDefinitionSchema.Type
export type PackDefinition = typeof packDefinitionSchema.Type
export type StoredPack = typeof storedPackSchema.Type
export type ResourceAttachment = typeof attachmentSchema.Type
export type ResourceRecord = typeof resourceSchema.Type
export type ResourceEvent = typeof resourceEventSchema.Type

export const trackingPack: PackDefinition = {
  id: 'tracking',
  version: 1,
  label: 'Tracking',
  description: 'Local metadata only. Changing status never runs an agent.',
  properties: [
    {
      id: 'status',
      label: 'Status',
      type: 'select',
      description: '',
      readOnly: false,
      options: [
        { id: 'todo', label: 'To do' },
        { id: 'doing', label: 'In progress' },
        { id: 'done', label: 'Done' },
      ],
    },
    { id: 'assignee', label: 'Assignee', type: 'text', description: 'An explicit label; not an inferred Notion or Discord identity.', readOnly: false },
    { id: 'due', label: 'Due date', type: 'date', description: '', readOnly: false },
    { id: 'related', label: 'Related resource', type: 'reference', description: '', readOnly: false },
  ],
}

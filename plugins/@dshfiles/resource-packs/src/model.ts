import { z } from 'zod'

/** Opaque native ids keep case, paths and punctuation; the registry never rewrites a resource's native content. */
const slugSchema = z.string().regex(/^[a-z][a-z0-9._-]{0,79}$/)
export const resourceRefSchema = z
  .object({
    provider: slugSchema,
    kind: slugSchema,
    id: z.string().min(1).max(2_000),
  })
  .strict()

export const propertyValueSchema = z.union([
  z.string().max(20_000),
  z.number().finite(),
  z.boolean(),
  z.null(),
  z.array(z.string().max(200)).max(100),
  resourceRefSchema,
  z.array(resourceRefSchema).max(100),
])
export const propertyValuesSchema = z.record(slugSchema, propertyValueSchema)

const propertyBase = {
  id: slugSchema,
  label: z.string().trim().min(1).max(100),
  description: z.string().max(500).default(''),
  /** A stored owner-written value, NOT an arbitrary computed JavaScript callback. */
  readOnly: z.boolean().default(false),
}
export const optionSchema = z.object({ id: slugSchema, label: z.string().trim().min(1).max(100) }).strict()
const choices = z.array(optionSchema).min(1).max(100)
export const propertyDefinitionSchema = z.discriminatedUnion('type', [
  z.object({ ...propertyBase, type: z.literal('text') }).strict(),
  z.object({ ...propertyBase, type: z.literal('number') }).strict(),
  z.object({ ...propertyBase, type: z.literal('checkbox') }).strict(),
  z.object({ ...propertyBase, type: z.literal('date') }).strict(),
  z.object({ ...propertyBase, type: z.literal('datetime') }).strict(),
  z.object({ ...propertyBase, type: z.literal('select'), options: choices }).strict(),
  z.object({ ...propertyBase, type: z.literal('multiselect'), options: choices }).strict(),
  z.object({ ...propertyBase, type: z.literal('reference') }).strict(),
  z.object({ ...propertyBase, type: z.literal('references') }).strict(),
])
export const packDefinitionSchema = z
  .object({
    id: slugSchema,
    version: z.number().int().positive(),
    label: z.string().trim().min(1).max(100),
    description: z.string().max(1_000).default(''),
    properties: z.array(propertyDefinitionSchema).min(1).max(40),
  })
  .strict()

export const storedPackSchema = z
  .object({
    definition: packDefinitionSchema,
    owner: z.string().min(1).max(200),
    createdAt: z.number().int().nonnegative(),
    updatedAt: z.number().int().nonnegative(),
  })
  .strict()
export const attachmentSchema = z
  .object({
    packId: slugSchema,
    values: propertyValuesSchema,
    attached: z.boolean(),
  })
  .strict()
export const resourceSchema = z
  .object({
    id: z.string().uuid(),
    ref: resourceRefSchema,
    label: z.string().trim().min(1).max(200),
    revision: z.number().int().positive(),
    attachments: z.array(attachmentSchema).max(40),
    createdAt: z.number().int().nonnegative(),
    updatedAt: z.number().int().nonnegative(),
  })
  .strict()
export const resourceEventSchema = z
  .object({
    id: z.string().uuid(),
    resourceId: z.string().uuid(),
    revision: z.number().int().positive(),
    actor: z.string().min(1).max(200),
    action: z.enum(['created', 'attached', 'detached', 'values-updated']),
    packId: slugSchema.nullable(),
    at: z.number().int().nonnegative(),
  })
  .strict()

export type ResourceRef = z.infer<typeof resourceRefSchema>
export type PropertyValue = z.infer<typeof propertyValueSchema>
export type PropertyValues = z.infer<typeof propertyValuesSchema>
export type PropertyDefinition = z.infer<typeof propertyDefinitionSchema>
export type PackDefinition = z.infer<typeof packDefinitionSchema>
export type StoredPack = z.infer<typeof storedPackSchema>
export type ResourceAttachment = z.infer<typeof attachmentSchema>
export type ResourceRecord = z.infer<typeof resourceSchema>
export type ResourceEvent = z.infer<typeof resourceEventSchema>

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

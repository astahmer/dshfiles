import * as Schema from 'effect/Schema'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { promptStashMutationSchema, promptStashStateSchema } from './library-api.js'
import { promptSchema } from './library.js'
import { dateTimeString, uuidSchema } from './schema.js'

/**
 * The published contracts were zod before this conversion. These are the zod
 * pre-images they must still match keyword for keyword, and the inputs both
 * sides must accept or reject alike.
 */
const zodUuid = z.string().uuid()
const zodPrompt = z
  .object({
    id: zodUuid,
    revision: zodUuid,
    title: z.string().trim().min(1).max(100),
    text: z.string().min(1).max(20_000),
    updatedAt: z.number().int().nonnegative(),
  })
  .strict()
const zodRevision = z.number().int().positive()
const zodPromptList = z.array(zodPrompt).max(50)
const zodState = z.object({ revision: zodRevision, prompts: zodPromptList }).strict()
const zodMutation = z.object({ kind: z.enum(['applied', 'conflict', 'limit']), revision: zodRevision, prompts: zodPromptList }).strict()
const zodSaveInput = z.object({ prompt: zodPrompt, expectedRevision: zodUuid.nullable() }).strict()
const zodRemoveInput = z.object({ id: zodUuid, expectedRevision: zodUuid }).strict()
const zodLegacyDraft = z
  .object({
    id: zodUuid,
    title: z.string().min(1).max(120),
    text: z.string().min(1).max(24_000),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .strict()

const effectSaveInput = Schema.Struct({ prompt: promptSchema, expectedRevision: Schema.NullOr(uuidSchema) })
const effectRemoveInput = Schema.Struct({ id: uuidSchema, expectedRevision: uuidSchema })
const effectLegacyDraft = Schema.Struct({
  id: uuidSchema,
  title: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(120)),
  text: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(24_000)),
  createdAt: dateTimeString,
  updatedAt: dateTimeString,
})

type JsonSchemaValue = null | boolean | number | string | JsonSchemaValue[] | { readonly [key: string]: JsonSchemaValue }

const isJsonSchemaRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

const normalize = (value: unknown): JsonSchemaValue => {
  if (Array.isArray(value)) return value.map(normalize)
  if (value === null || typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string') return value
  if (!isJsonSchemaRecord(value)) throw new TypeError('Expected a JSON Schema value.')
  const entries = Object.entries(value).filter(
    ([key, child]) => key !== '$schema' && !(key === 'definitions' && isJsonSchemaRecord(child) && Object.keys(child).length === 0) && key !== 'dialect',
  )
  const normalized = Object.fromEntries(entries.map(([key, child]) => [key, normalize(child)]))
  if ('const' in normalized) {
    const constant = normalized.const
    delete normalized.const
    normalized.enum = [constant]
  }
  return Object.fromEntries(Object.entries(normalized).sort(([left], [right]) => left.localeCompare(right)))
}

const document = (schema: z.ZodType | Schema.ConstraintDecoder<unknown>) =>
  'toJSONSchema' in schema ? normalize(schema.toJSONSchema({})) : normalize(Schema.toJsonSchemaDocument(schema, { onExcessProperty: 'error' }).schema)

const expects = (zodSchema: z.ZodType, effectSchema: Schema.ConstraintDecoder<unknown>, valid: readonly unknown[], invalid: readonly unknown[]) => {
  for (const input of valid) {
    const zodResult = zodSchema.safeParse(input)
    const effectResult = Schema.decodeUnknownResult(effectSchema, { onExcessProperty: 'error' })(input)
    expect(zodResult.success).toBe(true)
    expect(effectResult._tag).toBe('Success')
    expect(effectResult._tag === 'Success' ? effectResult.success : undefined).toEqual(zodResult.success ? zodResult.data : undefined)
  }
  for (const input of invalid) {
    expect(zodSchema.safeParse(input).success).toBe(false)
    expect(Schema.decodeUnknownResult(effectSchema, { onExcessProperty: 'error' })(input)._tag).toBe('Failure')
  }
}

const prompt = {
  id: '00000000-0000-4000-8000-000000000001',
  revision: '10000000-0000-4000-8000-000000000001',
  title: '  Saved title  ',
  text: 'Prompt text',
  updatedAt: 1_700_000_000_000,
}

describe('published prompt-stash schemas', () => {
  it('emits the same JSON Schema as the zod pre-image', () => {
    expect(document(promptStashStateSchema)).toEqual(document(zodState))
    expect(document(promptStashMutationSchema)).toEqual(document(zodMutation))
    expect(document(effectSaveInput)).toEqual(document(zodSaveInput))
    expect(document(effectRemoveInput)).toEqual(document(zodRemoveInput))
  })

  it('accepts and trims the same prompt payloads', () => {
    expects(
      zodPrompt,
      promptSchema,
      [prompt],
      [
        { ...prompt, id: 'not-a-uuid' },
        { ...prompt, title: '   ' },
        { ...prompt, text: '' },
        { ...prompt, updatedAt: -1 },
        { ...prompt, extra: true },
      ],
    )
  })

  it('accepts and rejects the same state, mutation and input payloads', () => {
    const state = { revision: 4, prompts: [prompt] }
    expects(
      zodState,
      promptStashStateSchema,
      [state],
      [
        { ...state, revision: 0 },
        { ...state, prompts: [], extra: 1 },
      ],
    )
    const mutation = { kind: 'applied' as const, revision: 4, prompts: [prompt] }
    expects(
      zodMutation,
      promptStashMutationSchema,
      [mutation],
      [
        { ...mutation, kind: 'other' },
        { ...mutation, extra: 1 },
      ],
    )
    expects(
      zodSaveInput,
      effectSaveInput,
      [
        { prompt, expectedRevision: null },
        { prompt, expectedRevision: prompt.revision },
      ],
      [
        { prompt, expectedRevision: 'nope' },
        { prompt, extra: true },
      ],
    )
    expects(
      zodRemoveInput,
      effectRemoveInput,
      [{ id: prompt.id, expectedRevision: prompt.revision }],
      [{ id: prompt.id }, { id: 'nope', expectedRevision: prompt.revision }],
    )
  })

  it('keeps the legacy draft domain schema byte-identical', () => {
    expect(document(effectLegacyDraft)).toEqual(document(zodLegacyDraft))
    const draft = { id: prompt.id, title: 'Title', text: 'Text', createdAt: '2026-11-01T12:00:00Z', updatedAt: '2026-11-01T12:00:00Z' }
    expects(
      zodLegacyDraft,
      effectLegacyDraft,
      [draft],
      [
        { ...draft, createdAt: '2026-11-01T12:00:00+01:00' },
        { ...draft, extra: 1 },
      ],
    )
  })
})

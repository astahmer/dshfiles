import { secretScopeSchema } from '@dshfiles/credential-port'
import * as EffectSchema from 'effect/Schema'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import {
  createInputSchema,
  deleteItemInputSchema,
  listInputSchema,
  listOutputSchema,
  machineOutputSchema,
  referenceStatusInputSchema,
  removeAliasInputSchema,
  revealInputSchema,
  updateInputSchema,
} from '../src/api-effect-schemas.js'
import { secretMetadataSchema } from '../src/secret-metadata.js'
import { secretReferenceStatusSchema } from '../src/secret-reference-status-schema.js'
import { standardSchema, strictStandardSchema } from '../src/schema.js'

/** The normalization `scripts/effect-schema-parity.mjs` applies: drop the dialect markers, fold `const` into `enum`, sort keys. */
const normalize = value => {
  if (Array.isArray(value)) return value.map(normalize)
  if (value === null || typeof value !== 'object') return value
  const entries = Object.entries(value).filter(
    ([key, child]) => key !== '$schema' && !(key === 'definitions' && Object.keys(child).length === 0) && key !== 'dialect',
  )
  const normalized = Object.fromEntries(entries.map(([key, child]) => [key, normalize(child)]))
  if ('const' in normalized) {
    const constant = normalized.const
    delete normalized.const
    normalized.enum = [constant]
  }
  return Object.fromEntries(Object.entries(normalized).sort(([left], [right]) => left.localeCompare(right)))
}

const zodDocument = (schema, io) => normalize(schema['~standard'].jsonSchema[io]({ target: 'draft-2020-12' }))
/** dshx drops `additionalProperties: true` before publishing, so the comparison does the same. */
const omitDefaultAdditionalProperties = value => {
  if (Array.isArray(value)) return value.map(omitDefaultAdditionalProperties)
  if (value === null || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key, child]) => !(key === 'additionalProperties' && child === true))
      .map(([key, child]) => [key, omitDefaultAdditionalProperties(child)]),
  )
}

const zodRawDocument = (schema, io) => schema['~standard'].jsonSchema[io]({ target: 'draft-2020-12' })
const effectRawDocument = (schema, io, publication) =>
  omitDefaultAdditionalProperties(
    (publication === 'strict' ? strictStandardSchema(schema) : standardSchema(schema))['~standard'].jsonSchema[io]({ target: 'draft-2020-12' }),
  )

const effectDocument = (schema, io, publication) =>
  normalize(
    omitDefaultAdditionalProperties(
      (publication === 'strict' ? strictStandardSchema(schema) : standardSchema(schema))['~standard'].jsonSchema[io]({ target: 'draft-2020-12' }),
    ),
  )

const aliasSchema = z
  .string()
  .min(1, { error: 'Enter an alias.', abort: true })
  .max(128, 'An alias is at most 128 characters.')
  .regex(/^[A-Za-z_][A-Za-z0-9_-]*$/, 'Start with a letter or _, then use letters, digits, _ or -.')
const environmentSchema = z
  .string()
  .min(1, { error: 'Enter an environment.', abort: true })
  .max(256, 'An environment is at most 256 characters.')
  .regex(/^[A-Za-z0-9_-]+$/, 'Use letters, digits, _ or -.')
const cwdSchema = z.string().max(4096).nullable()
const freeTextSchema = (maxLength: number) =>
  z
    .string()
    .max(maxLength)
    .refine(value => !value.startsWith('-'), { message: 'A value cannot start with "-".' })
const updateMetadataSchema = z.object({
  name: freeTextSchema(512).optional(),
  source: freeTextSchema(2048).optional(),
  tags: freeTextSchema(1024).optional(),
})
const createMetadataSchema = updateMetadataSchema.extend({
  type: freeTextSchema(64).optional(),
  field: freeTextSchema(256).optional(),
})

const zodMetadata = z.object({
  id: z.string(),
  alias: z.string(),
  scope: z.string(),
  environment: z.string(),
  variableName: z.string(),
  item: z.string(),
  field: z.string(),
  service: z.string(),
  description: z.string(),
})

const zodElsewhere = z.object({ scope: secretScopeSchema, folder: z.string().max(4096), environment: z.string().max(256) })
const zodGlobalConfig = z.object({ path: z.string().max(4096).nullable(), linkedTo: z.string().max(4096).nullable() })
const zodReferenceStatus = z.object({
  state: z.enum([
    'resolved',
    'empty',
    'invalid-reference',
    'alias-missing',
    'environment-missing',
    'ambiguous',
    'value-unreadable',
    'value-empty',
    'cli-missing',
    'cli-timeout',
    'cli-failed',
  ]),
  reference: z.string().max(4096).nullable(),
  alias: z.string().max(256).nullable(),
  environment: z.string().max(256).nullable(),
  cwd: z.string().max(4096).nullable(),
  scope: secretScopeSchema.nullable(),
  environments: z.array(z.string().max(256)).max(64),
  scopes: z.array(z.string().max(64)).max(16),
  elsewhere: z.array(zodElsewhere).max(64),
  writeScope: secretScopeSchema,
  globalConfig: zodGlobalConfig,
})

const zodReferenceStatusInput = z
  .object({
    reference: z.string().max(4096).describe('The stored reference text, e.g. secret:ALIAS or secret:ALIAS@env.'),
    cwd: z
      .string()
      .max(4096)
      .nullable()
      .describe('Folder whose project and machine-local aliases also count; null checks global aliases only, as settings resolve.'),
    probeFolders: z
      .array(z.string().max(4096))
      .max(16)
      .optional()
      .describe('Project folders to search when the alias is missing, so the answer can say it exists only there.'),
  })
  .strict()

const metadataRow = {
  id: '["global","API_KEY","prod","",""]',
  alias: 'API_KEY',
  scope: 'global',
  environment: 'prod',
  variableName: 'API_KEY',
  item: '',
  field: '',
  service: '',
  description: '',
}

const referenceStatus = {
  state: 'resolved',
  reference: 'secret:API_KEY',
  alias: 'API_KEY',
  environment: 'prod',
  cwd: null,
  scope: 'global',
  environments: ['prod'],
  scopes: ['global'],
  elsewhere: [{ scope: 'project', folder: '/tmp/project', environment: 'prod' }],
  writeScope: 'global',
  globalConfig: { path: '/tmp/.config/secret/config.json', linkedTo: null },
}

const fixtures = [
  { name: 'list input', zod: z.object({ cwd: cwdSchema }), effect: listInputSchema, input: { cwd: '/tmp' } },
  { name: 'list output', zod: z.array(zodMetadata).max(5000), effect: listOutputSchema, input: [metadataRow] },
  { name: 'secret metadata', zod: zodMetadata, effect: secretMetadataSchema, input: metadataRow },
  {
    name: 'create input',
    zod: z
      .object({
        alias: aliasSchema,
        cwd: cwdSchema,
        scope: secretScopeSchema,
        environment: environmentSchema,
        valueMode: z.enum(['generate', 'manual']),
        value: z.string().max(262_144).nullable(),
        ...createMetadataSchema.shape,
      })
      .refine(input => (input.valueMode === 'generate' ? input.value === null : input.value !== null && input.value.length > 0)),
    effect: createInputSchema,
    input: { alias: 'API_KEY', cwd: null, scope: 'global', environment: 'prod', valueMode: 'generate', value: null },
  },
  {
    name: 'reveal input',
    zod: z.object({ alias: aliasSchema, cwd: cwdSchema, scope: secretScopeSchema, environment: environmentSchema.optional() }),
    effect: revealInputSchema,
    input: { alias: 'API_KEY', cwd: null, scope: 'global', environment: 'prod' },
  },
  {
    name: 'update input',
    zod: z.object({
      alias: aliasSchema,
      cwd: cwdSchema,
      scope: secretScopeSchema,
      value: z.string().max(262_144).nullable(),
      environment: environmentSchema,
      newAlias: aliasSchema.optional(),
      ...updateMetadataSchema.shape,
    }),
    effect: updateInputSchema,
    input: { alias: 'API_KEY', cwd: null, scope: 'global', value: null, environment: 'prod' },
  },
  {
    name: 'remove alias input',
    zod: z.object({ alias: aliasSchema, cwd: cwdSchema, scope: secretScopeSchema }),
    effect: removeAliasInputSchema,
    input: { alias: 'API_KEY', cwd: null, scope: 'global' },
  },
  {
    name: 'delete item input',
    zod: z.object({ alias: aliasSchema, cwd: cwdSchema, scope: secretScopeSchema, environment: environmentSchema }),
    effect: deleteItemInputSchema,
    input: { alias: 'API_KEY', cwd: null, scope: 'global', environment: 'prod' },
  },
  {
    name: 'machine output',
    zod: z.object({ id: z.string().max(256), name: z.string().max(256) }),
    effect: machineOutputSchema,
    input: { id: 'machine-1', name: 'laptop' },
  },
  {
    name: 'reference status input',
    zod: zodReferenceStatusInput,
    effect: referenceStatusInputSchema,
    publication: 'strict',
    input: { reference: 'secret:API_KEY', cwd: null },
  },
  { name: 'reference status output', zod: zodReferenceStatus, effect: secretReferenceStatusSchema, input: referenceStatus },
]

describe('secret catalog Effect schema parity', () => {
  for (const fixture of fixtures) {
    it(`publishes the same JSON Schema as zod for ${fixture.name}`, () => {
      expect(effectDocument(fixture.effect, 'input', fixture.publication)).toEqual(zodDocument(fixture.zod, 'input'))
      expect(effectDocument(fixture.effect, 'output', fixture.publication)).toEqual(zodDocument(fixture.zod, 'output'))
    })

    it(`publishes byte-identical JSON Schema text for ${fixture.name}`, () => {
      expect(JSON.stringify(effectRawDocument(fixture.effect, 'input', fixture.publication))).toBe(JSON.stringify(zodRawDocument(fixture.zod, 'input')))
      expect(JSON.stringify(effectRawDocument(fixture.effect, 'output', fixture.publication))).toBe(JSON.stringify(zodRawDocument(fixture.zod, 'output')))
    })

    it(`decodes the same values as zod for ${fixture.name}`, () => {
      const zodResult = fixture.zod.safeParse(fixture.input)
      const effectResult = EffectSchema.decodeUnknownOption(fixture.effect)(fixture.input)
      expect(zodResult.success).toBe(true)
      expect(effectResult._tag).toBe('Some')
      expect(effectResult._tag === 'Some' ? effectResult.value : undefined).toEqual(zodResult.success ? zodResult.data : undefined)
    })
  }
})

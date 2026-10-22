import { defineApi, method } from '@dshfiles/dshx/api'
import { z } from 'zod'
import { aliasSchema, createMetadataSchema, environmentSchema, updateMetadataSchema } from './secret-arguments.js'
import { secretMetadataSchema, secretScopeSchema } from './secret-metadata.js'

const cwdSchema = z.string().max(4096).nullable()
const listInputSchema = z.object({ cwd: cwdSchema })
const listOutputSchema = z.array(secretMetadataSchema).max(5000)
const createInputSchema = z
  .object({
    alias: aliasSchema,
    cwd: cwdSchema,
    scope: secretScopeSchema,
    environment: environmentSchema,
    valueMode: z.enum(['generate', 'manual']),
    value: z.string().max(262_144).nullable(),
    ...createMetadataSchema.shape,
  })
  .refine(input => (input.valueMode === 'generate' ? input.value === null : input.value !== null && input.value.length > 0), {
    message: 'A manual value is required only for manual creation.',
  })
const createOutputSchema = z.object({ created: z.literal(true) })

export const secretCatalogApi = defineApi({
  id: 'secret-catalog',
  version: 1,
  methods: {
    list: method({ input: listInputSchema, output: listOutputSchema }),
    reveal: method({
      input: z.object({ alias: aliasSchema, cwd: cwdSchema, scope: secretScopeSchema, environment: environmentSchema.optional() }),
      output: z.string().max(1_000_000),
    }),
    copy: method({
      input: z.object({ alias: aliasSchema, cwd: cwdSchema, scope: secretScopeSchema, environment: environmentSchema.optional() }),
      output: z.object({ copied: z.literal(true) }),
    }),
    machine: method({ input: z.object({}), output: z.object({ id: z.string().max(256), name: z.string().max(256) }) }),
    create: method({ input: createInputSchema, output: createOutputSchema }),
    update: method({
      input: z.object({
        alias: aliasSchema,
        cwd: cwdSchema,
        scope: secretScopeSchema,
        value: z.string().max(262_144).nullable(),
        environment: environmentSchema,
        newAlias: aliasSchema.optional(),
        ...updateMetadataSchema.shape,
      }),
      output: z.object({ updated: z.literal(true) }),
    }),
    removeAlias: method({
      input: z.object({ alias: aliasSchema, cwd: cwdSchema, scope: secretScopeSchema }),
      output: z.object({ removed: z.literal(true) }),
    }),
    deleteItem: method({
      input: z.object({ alias: aliasSchema, cwd: cwdSchema, scope: secretScopeSchema, environment: environmentSchema }),
      output: z.object({ deleted: z.literal(true) }),
    }),
  },
})

export const secretSetupApi = defineApi({
  id: 'secret-catalog-setup',
  version: 1,
  owner: '@dshfiles/secret-catalog',
  methods: {
    list: method({
      input: listInputSchema,
      output: listOutputSchema,
      description: 'List alias metadata for a setup picker; never returns secret values.',
    }),
    create: method({
      input: createInputSchema,
      output: createOutputSchema,
      description: 'Store a Secret Catalog alias for an explicit setup flow; manual values never return to the Client.',
    }),
  },
})

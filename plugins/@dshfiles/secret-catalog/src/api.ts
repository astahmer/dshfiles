import { defineApi, method } from '@dshfiles/dshx/api'
import { z } from 'zod'
import { secretMetadataSchema } from './secret-metadata.js'

const cwdSchema = z.string().max(4096).nullable()
const aliasSchema = z.string().min(1).max(128).regex(/^[A-Za-z_][A-Za-z0-9_-]*$/)
const scopeSchema = z.enum(['global', 'project', 'local'])
const environmentSchema = z.string().min(1).max(256).regex(/^[A-Za-z0-9_-]+$/)
const createMetadataInput = {
  name: z.string().max(512).optional(),
  source: z.string().max(2048).optional(),
  tags: z.string().max(1024).optional(),
  type: z.string().max(64).optional(),
  field: z.string().max(256).optional(),
}
const updateMetadataInput = {
  name: z.string().max(512).optional(),
  source: z.string().max(2048).optional(),
  tags: z.string().max(1024).optional(),
}

export const secretCatalogApi = defineApi({
  id: 'secret-catalog',
  version: 1,
  methods: {
    list: method({ input: z.object({ cwd: cwdSchema }), output: z.array(secretMetadataSchema).max(5000) }),
    reveal: method({
      input: z.object({ alias: aliasSchema, cwd: cwdSchema, scope: scopeSchema, environment: environmentSchema.optional() }),
      output: z.string().max(1_000_000),
    }),
    copy: method({
      input: z.object({ alias: aliasSchema, cwd: cwdSchema, scope: scopeSchema, environment: environmentSchema.optional() }),
      output: z.object({ copied: z.literal(true) }),
    }),
    machine: method({ input: z.object({}), output: z.object({ id: z.string().max(256), name: z.string().max(256) }) }),
    create: method({
      input: z.object({
        alias: aliasSchema,
        cwd: cwdSchema,
        scope: scopeSchema,
        environment: environmentSchema,
        valueMode: z.enum(['generate', 'manual']),
        value: z.string().max(262_144).nullable(),
        ...createMetadataInput,
      }).refine(input => input.valueMode === 'generate' ? input.value === null : input.value !== null && input.value.length > 0, {
        message: 'A manual value is required only for manual creation.',
      }),
      output: z.object({ created: z.literal(true) }),
    }),
    update: method({
      input: z.object({
        alias: aliasSchema,
        cwd: cwdSchema,
        scope: scopeSchema,
        value: z.string().max(262_144).nullable(),
        environment: environmentSchema,
        ...updateMetadataInput,
      }),
      output: z.object({ updated: z.literal(true) }),
    }),
    removeAlias: method({
      input: z.object({ alias: aliasSchema, cwd: cwdSchema, scope: scopeSchema }),
      output: z.object({ removed: z.literal(true) }),
    }),
    deleteItem: method({
      input: z.object({ alias: aliasSchema, cwd: cwdSchema, scope: scopeSchema, environment: environmentSchema }),
      output: z.object({ deleted: z.literal(true) }),
    }),
  },
})

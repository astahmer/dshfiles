import type { ApiMethodOptions, ApiToolExposure } from '@dshfiles/dshx/api'
import { defineApi, method as defineMethod } from '@dshfiles/dshx/api'
import { Schema } from 'effect'
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
} from './api-effect-schemas.js'
import { secretReferenceStatusSchema } from './secret-reference-status-schema.js'
import { standardSchema, strictStandardSchema } from './schema.js'

const method = <const Input extends Schema.ConstraintDecoder<unknown>, const Output extends Schema.ConstraintDecoder<unknown>>(
  options: Omit<ApiMethodOptions<Input, Output>, 'input' | 'output' | 'tool'> & {
    readonly input: Input
    readonly output: Output
    readonly tool?: ApiToolExposure<Output['Type']>
  },
) => defineMethod({ ...options, input: standardSchema(options.input), output: standardSchema(options.output) })

const createdOutputSchema = Schema.Struct({ created: Schema.Literal(true) })
const copiedOutputSchema = Schema.Struct({ copied: Schema.Literal(true) })
const updatedOutputSchema = Schema.Struct({ updated: Schema.Literal(true) })
const removedOutputSchema = Schema.Struct({ removed: Schema.Literal(true) })
const deletedOutputSchema = Schema.Struct({ deleted: Schema.Literal(true) })

export const secretCatalogApi = defineApi({
  id: 'secret-catalog',
  version: 1,
  methods: {
    list: method({ input: listInputSchema, output: listOutputSchema }),
    reveal: method({ input: revealInputSchema, output: Schema.String.check(Schema.isMaxLength(1_000_000)) }),
    copy: defineMethod({ input: standardSchema(revealInputSchema), output: standardSchema(copiedOutputSchema) }),
    machine: method({ input: Schema.Struct({}), output: machineOutputSchema }),
    create: defineMethod({ input: standardSchema(createInputSchema), output: standardSchema(createdOutputSchema) }),
    update: defineMethod({ input: standardSchema(updateInputSchema), output: standardSchema(updatedOutputSchema) }),
    removeAlias: defineMethod({ input: standardSchema(removeAliasInputSchema), output: standardSchema(removedOutputSchema) }),
    deleteItem: defineMethod({ input: standardSchema(deleteItemInputSchema), output: standardSchema(deletedOutputSchema) }),
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
    create: defineMethod({
      input: standardSchema(createInputSchema),
      output: standardSchema(createdOutputSchema),
      description: 'Store a Secret Catalog alias for an explicit setup flow; manual values never return to the Client.',
    }),
    referenceStatus: defineMethod({
      input: strictStandardSchema(referenceStatusInputSchema),
      output: standardSchema(secretReferenceStatusSchema),
      description:
        'Check whether one secret:ALIAS[@env] reference resolves on this Host and, when it does not, name the reason (alias missing from every scope or only in a project, environment missing, several scopes, unreadable or empty vault value, secret CLI missing, timed out or failing) and whether a global write would land in a symlinked (e.g. Nix-managed) config. Reads the value on the Host to prove it, never returns it. Read-only.',
      tool: {
        name: 'secret_reference_status',
        readOnly: true,
        render: status => `${status.reference ?? '(no reference)'}: ${status.state}${status.scope === null ? '' : ` · ${status.scope}`}`,
      },
    }),
  },
})

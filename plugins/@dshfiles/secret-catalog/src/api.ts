import { defineApi, event, method } from '@dshfiles/dshx/api'
import { secretAliasSchemaEffect, secretEnvironmentSchemaEffect, secretReferenceTextSchemaEffect, secretScopeSchemaEffect } from '@dshfiles/credential-port/effect'
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
    copy: method({ input: revealInputSchema, output: copiedOutputSchema }),
    machine: method({ input: Schema.Struct({}), output: machineOutputSchema }),
    create: method({ input: createInputSchema, output: createdOutputSchema }),
    update: method({ input: updateInputSchema, output: updatedOutputSchema }),
    removeAlias: method({ input: removeAliasInputSchema, output: removedOutputSchema }),
    deleteItem: method({ input: deleteItemInputSchema, output: deletedOutputSchema }),
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
      output: createdOutputSchema,
      description: 'Store a Secret Catalog alias for an explicit setup flow; manual values never return to the Client.',
    }),
    referenceStatus: method({
      input: referenceStatusInputSchema,
      output: secretReferenceStatusSchema,
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

const requestIdSchema = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(64))

export const secretRequestViewSchema = Schema.Struct({
  requestId: requestIdSchema,
  sessionId: Schema.NullOr(Schema.String.check(Schema.isMaxLength(256))),
  alias: secretAliasSchemaEffect,
  environment: secretEnvironmentSchemaEffect,
  scope: secretScopeSchemaEffect,
  cwd: Schema.NullOr(Schema.String.check(Schema.isMaxLength(4096))),
  purpose: Schema.String.check(Schema.isMaxLength(500)),
  createdAt: Schema.Number,
  expiresAt: Schema.Number,
})

/** Secrets an Agent asked the user to store with `request_secret`; the user answers with a reference, never a value. */
export const secretRequestsApi = defineApi({
  id: 'secret-catalog-requests',
  version: 1,
  owner: '@dshfiles/secret-catalog',
  methods: {
    pending: method({
      input: Schema.Struct({
        sessionId: Schema.NullOr(Schema.String.check(Schema.isMaxLength(256))).annotate({
          description: 'Only requests made in this Session; null lists every pending request.',
        }),
      }),
      output: Schema.Struct({ requests: Schema.Array(secretRequestViewSchema).check(Schema.isMaxLength(64)) }),
      description:
        'List the secrets Agents are waiting for the user to store (alias, environment, scope and stated purpose). Never returns values. Read-only.',
      tool: {
        name: 'secret_requests_pending',
        readOnly: true,
        render: output =>
          output.requests.length === 0
            ? 'No secret requests are waiting.'
            : output.requests.map(request => `${request.alias}@${request.environment} · ${request.scope} — ${request.purpose}`).join('\n'),
      },
    }),
    complete: method({
      input: Schema.Struct({ requestId: requestIdSchema, reference: secretReferenceTextSchemaEffect }),
      output: Schema.Struct({ reference: secretReferenceTextSchemaEffect }),
      description: 'Answer a pending request with the reference of a value the user just stored in the Secret Catalog form.',
    }),
    decline: method({
      input: Schema.Struct({ requestId: requestIdSchema }),
      output: Schema.Struct({ declined: Schema.Literal(true) }),
      description: 'Decline a pending request; the waiting Agent receives a declined result and no value.',
    }),
  },
  events: {
    changed: event({
      schema: Schema.Struct({}),
      description: 'A secret request was added, answered, declined, expired or cancelled. Read the pending list again.',
    }),
  },
})

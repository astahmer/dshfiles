/**
 * The references Host API, published as the `@dshfiles/references/api` dshx module so another plugin (agent-toolkit's
 * Context facet) can read which references a thread has attached without restating these schemas.
 */
import { defineApi, method } from '@dshfiles/dshx/api'
import { Schema } from 'effect'

import { nameSchema, referenceSchema } from './reference-schema.js'

type Reference = typeof referenceSchema.Type

const describe = (reference: Reference): string =>
  `${reference.name} · ${reference.path}${reference.kind === 'git' ? ` (${reference.source}${reference.ref === null ? '' : ` @ ${reference.ref}`})` : ''}`

const sessionInput = Schema.optional(
  Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(256)).annotate({
    description: 'Session to change; defaults to the calling agent’s own Session.',
  }),
)

export const referencesApi = defineApi({
  id: 'references',
  version: 1,
  owner: '@dshfiles/references',
  methods: {
    list: method({
      input: Schema.Struct({ sessionId: sessionInput }),
      output: Schema.Struct({ references: Schema.Array(referenceSchema), attached: Schema.Array(nameSchema) }),
      description: 'List saved references (named outside directories and git clones) and which are attached to a Session. Read-only.',
      tool: {
        name: 'references_list',
        readOnly: true,
        render: output =>
          output.references.map(reference => `${output.attached.includes(reference.name) ? '[attached] ' : ''}${describe(reference)}`).join('\n') ||
          'No saved references.',
      },
    }),
    save: method({
      input: Schema.Struct({
        name: nameSchema,
        source: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(2048)).annotate({ description: 'Absolute directory path (or ~/…) or git URL.' }),
        ref: Schema.optional(
          Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(256)).annotate({ description: 'Branch or tag to clone a git reference at.' }),
        ),
        description: Schema.optional(Schema.String.check(Schema.isMaxLength(500))),
      }),
      output: referenceSchema,
      description:
        'Save a named reference: an outside directory read in place, or a git URL shallow-cloned under $DSH_HOME/references. Saving an existing name replaces it (a git reference is cloned again). Call only when the user asked to add a reference.',
      tool: { name: 'reference_save', render: output => `Saved reference ${describe(output)}.` },
    }),
    remove: method({
      input: Schema.Struct({ name: nameSchema, confirm: Schema.Literal(true) }),
      output: Schema.Struct({ removed: Schema.Boolean }),
      description:
        'Forget a saved reference and detach it from every Session; a git clone is deleted, a directory is left untouched. Requires confirm: true. Call only when the user asked to remove it.',
      tool: { name: 'reference_remove', render: output => (output.removed ? 'Removed that reference.' : 'No reference had that name.') },
    }),
    attach: method({
      input: Schema.Struct({ name: nameSchema, sessionId: sessionInput }),
      output: Schema.Struct({ attached: Schema.Array(nameSchema) }),
      description:
        'Attach a saved reference to a Session, so its path and origin are part of that Session’s runtime context from the next model request. Call only when the user asked to attach it.',
      tool: { name: 'reference_attach', render: output => `Attached references: ${output.attached.join(', ')}.` },
    }),
    detach: method({
      input: Schema.Struct({ name: nameSchema, sessionId: sessionInput }),
      output: Schema.Struct({ attached: Schema.Array(nameSchema) }),
      description: 'Detach a reference from a Session; the saved reference stays. Call only when the user asked to detach it.',
      tool: {
        name: 'reference_detach',
        render: output => (output.attached.length === 0 ? 'No references attached.' : `Attached references: ${output.attached.join(', ')}.`),
      },
    }),
  },
})


export class ReferencesWire {
  static readonly describe = describe
}

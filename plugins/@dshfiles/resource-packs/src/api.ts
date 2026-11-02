import { defineApi, method } from '@dshfiles/dshx/api'
import { Schema } from 'effect'
import { exactSchema, openSchema } from './contract-schema.js'
import {
  packDefinitionSchema,
  propertyValuesSchema,
  resourceEventSchema,
  resourceLabelSchema,
  resourceRefSchema,
  resourceSchema,
  storedPackSchema,
} from './model.js'

const identity = {
  resourceId: Schema.String.check(Schema.isUUID()),
  expectedRevision: Schema.Number.check(Schema.isFinite(), Schema.isInt(), Schema.isGreaterThan(0)),
}
const attachmentIdentity = { ...identity, packId: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(80)) }
const writeNote =
  'Call only when the user asked, or to record this thread’s explicitly authorized work. This edits local metadata only; it never changes native content or executes an agent.'

/** The single public contract for GUI, installed Host contributors and agent tools. */
export const resourcePacksApi = defineApi({
  id: 'resource-packs',
  version: 1,
  owner: '@dshfiles/resource-packs',
  methods: {
    catalog: method({
      input: openSchema(Schema.Void),
      output: openSchema(Schema.Struct({ packs: Schema.Array(storedPackSchema) })),
      description: 'Read the persisted, versioned property packs. Definitions survive contributor unload. Read-only.',
      tool: { name: 'resource_packs_catalog', readOnly: true },
    }),
    list: method({
      input: exactSchema(
        Schema.Struct({
          query: Schema.optionalKey(Schema.String.check(Schema.isMaxLength(500))),
          kind: Schema.optionalKey(Schema.String.check(Schema.isMaxLength(80))),
          packId: Schema.optionalKey(Schema.String.check(Schema.isMaxLength(80))),
          limit: Schema.optionalKey(Schema.Number.check(Schema.isFinite(), Schema.isInt(), Schema.isGreaterThanOrEqualTo(1), Schema.isLessThanOrEqualTo(200))),
        }),
      ),
      output: openSchema(
        Schema.Struct({
          resources: Schema.Array(resourceSchema),
          total: Schema.Number.check(Schema.isFinite(), Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)),
        }),
      ),
      description:
        'List registered resource metadata, optionally filtered by text, kind or attached pack. Native file contents and conversations are never read. Read-only.',
      tool: { name: 'resource_packs_list', readOnly: true },
    }),
    get: method({
      input: exactSchema(Schema.Struct({ resourceId: Schema.String.check(Schema.isUUID()) })),
      output: openSchema(Schema.Struct({ resource: resourceSchema, events: Schema.Array(resourceEventSchema) })),
      description: 'Read one registered resource with its attached/detached values and recent metadata audit events. Read-only.',
      tool: { name: 'resource_packs_get', readOnly: true },
    }),
    registerPack: method({
      input: exactSchema(Schema.Struct({ definition: packDefinitionSchema })),
      output: openSchema(storedPackSchema),
      description: `Register a property pack, or publish a compatible new version owned by the same caller. IDs are stable; destructive changes require migration and are refused. ${writeNote}`,
      tool: { name: 'resource_packs_register_pack' },
    }),
    registerResource: method({
      input: exactSchema(Schema.Struct({ ref: resourceRefSchema, label: resourceLabelSchema })),
      output: openSchema(resourceSchema),
      description: `Register a reference to a conversation, file, record or other resource. Repeating the exact reference returns the existing resource without overwriting it. File paths are current-path references, not rename tracking. ${writeNote}`,
      tool: { name: 'resource_packs_register_resource' },
    }),
    attach: method({
      input: exactSchema(Schema.Struct(attachmentIdentity)),
      output: openSchema(resourceSchema),
      description: `Attach a persisted property pack. Reattaching restores retained values; it never resets them. Supply the current resource revision. ${writeNote}`,
      tool: { name: 'resource_packs_attach' },
    }),
    setValues: method({
      input: exactSchema(Schema.Struct({ ...attachmentIdentity, values: propertyValuesSchema })),
      output: openSchema(resourceSchema),
      description: `Set only the named properties of an attached pack. Validation and read-only owner rules run on the Host; a stale revision is refused instead of overwriting newer values. Null clears a value. ${writeNote}`,
      tool: { name: 'resource_packs_set_values' },
    }),
    detach: method({
      input: exactSchema(Schema.Struct({ ...attachmentIdentity, confirm: Schema.Literal(true) })),
      output: openSchema(resourceSchema),
      description: `Detach a pack only with explicit confirmation. Stored values are retained for reattachment; neither the native resource nor its metadata is deleted. ${writeNote}`,
      tool: { name: 'resource_packs_detach' },
    }),
  },
})

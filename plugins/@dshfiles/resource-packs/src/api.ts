import { defineApi, method } from '@dshfiles/dshx/api'
import { z } from 'zod'
import { packDefinitionSchema, propertyValuesSchema, resourceEventSchema, resourceRefSchema, resourceSchema, storedPackSchema } from './model.js'

const identity = { resourceId: z.string().uuid(), expectedRevision: z.number().int().positive() }
const attachmentIdentity = { ...identity, packId: z.string().min(1).max(80) }
const writeNote =
  'Call only when the user asked, or to record this thread’s explicitly authorized work. This edits local metadata only; it never changes native content or executes an agent.'

/** The single public contract for GUI, installed Host contributors and agent tools. */
export const resourcePacksApi = defineApi({
  id: 'resource-packs',
  version: 1,
  owner: '@dshfiles/resource-packs',
  methods: {
    catalog: method({
      input: z.void(),
      output: z.object({ packs: z.array(storedPackSchema) }).strict(),
      description: 'Read the persisted, versioned property packs. Definitions survive contributor unload. Read-only.',
      tool: { name: 'resource_packs_catalog', readOnly: true },
    }),
    list: method({
      input: z
        .object({
          query: z.string().max(500).optional(),
          kind: z.string().max(80).optional(),
          packId: z.string().max(80).optional(),
          limit: z.number().int().min(1).max(200).optional(),
        })
        .strict(),
      output: z.object({ resources: z.array(resourceSchema), total: z.number().int().nonnegative() }).strict(),
      description:
        'List registered resource metadata, optionally filtered by text, kind or attached pack. Native file contents and conversations are never read. Read-only.',
      tool: { name: 'resource_packs_list', readOnly: true },
    }),
    get: method({
      input: z.object({ resourceId: z.string().uuid() }).strict(),
      output: z.object({ resource: resourceSchema, events: z.array(resourceEventSchema) }).strict(),
      description: 'Read one registered resource with its attached/detached values and recent metadata audit events. Read-only.',
      tool: { name: 'resource_packs_get', readOnly: true },
    }),
    registerPack: method({
      input: z.object({ definition: packDefinitionSchema }).strict(),
      output: storedPackSchema,
      description: `Register a property pack, or publish a compatible new version owned by the same caller. IDs are stable; destructive changes require migration and are refused. ${writeNote}`,
      tool: { name: 'resource_packs_register_pack' },
    }),
    registerResource: method({
      input: z.object({ ref: resourceRefSchema, label: z.string().trim().min(1).max(200) }).strict(),
      output: resourceSchema,
      description: `Register a reference to a conversation, file, record or other resource. Repeating the exact reference returns the existing resource without overwriting it. File paths are current-path references, not rename tracking. ${writeNote}`,
      tool: { name: 'resource_packs_register_resource' },
    }),
    attach: method({
      input: z.object(attachmentIdentity).strict(),
      output: resourceSchema,
      description: `Attach a persisted property pack. Reattaching restores retained values; it never resets them. Supply the current resource revision. ${writeNote}`,
      tool: { name: 'resource_packs_attach' },
    }),
    setValues: method({
      input: z.object({ ...attachmentIdentity, values: propertyValuesSchema }).strict(),
      output: resourceSchema,
      description: `Set only the named properties of an attached pack. Validation and read-only owner rules run on the Host; a stale revision is refused instead of overwriting newer values. Null clears a value. ${writeNote}`,
      tool: { name: 'resource_packs_set_values' },
    }),
    detach: method({
      input: z.object({ ...attachmentIdentity, confirm: z.literal(true) }).strict(),
      output: resourceSchema,
      description: `Detach a pack only with explicit confirmation. Stored values are retained for reattachment; neither the native resource nor its metadata is deleted. ${writeNote}`,
      tool: { name: 'resource_packs_detach' },
    }),
  },
})

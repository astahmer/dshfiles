import { Schema } from 'effect'
import { propertyTypes } from './model.js'

export class PackNotFound extends Schema.TaggedError<PackNotFound>()('PackNotFound', {}, { dshxWireCode: 'unknown-pack' }) {
  override get message(): string {
    return 'This pack is not registered.'
  }
}

export class ResourceNotFound extends Schema.TaggedError<ResourceNotFound>()('ResourceNotFound', {}, { dshxWireCode: 'unknown-resource' }) {
  override get message(): string {
    return 'This resource is not registered.'
  }
}

export class PackOwnerConflict extends Schema.TaggedError<PackOwnerConflict>()('PackOwnerConflict', {}, { dshxWireCode: 'owner-conflict' }) {
  override get message(): string {
    return 'This pack ID belongs to another owner. Choose a different namespace.'
  }
}

export class StaleResourceRevision extends Schema.TaggedError<StaleResourceRevision>()('StaleResourceRevision', {}, { dshxWireCode: 'stale-revision' }) {
  override get message(): string {
    return 'This resource changed. Reload it before editing its metadata.'
  }
}

export class AttachmentLimitReached extends Schema.TaggedError<AttachmentLimitReached>()(
  'AttachmentLimitReached',
  { limit: Schema.Int },
  { dshxWireCode: 'attachment-limit' },
) {
  override get message(): string {
    return `A resource may retain at most ${String(this.limit)} packs, including detached packs.`
  }
}

export class PackNotAttached extends Schema.TaggedError<PackNotAttached>()('PackNotAttached', {}, { dshxWireCode: 'pack-not-attached' }) {
  override get message(): string {
    return 'Attach this pack before setting its properties.'
  }
}

const payloadSubjects = { 'pack-definition': 'The pack definition', resource: 'The resource metadata', 'property-patch': 'The property patch' } as const

export class MetadataTooLarge extends Schema.TaggedError<MetadataTooLarge>()(
  'MetadataTooLarge',
  { subject: Schema.Literals(['pack-definition', 'resource', 'property-patch']), limitBytes: Schema.Int },
  { dshxWireCode: 'payload-too-large' },
) {
  override get message(): string {
    return `${payloadSubjects[this.subject]} exceeds its serialized metadata size limit. Reduce the metadata before retrying.`
  }
}

export class InvalidCaller extends Schema.TaggedError<InvalidCaller>()('InvalidCaller', {}, { dshxWireCode: 'invalid-caller' }) {
  override get message(): string {
    return 'The contributing plugin must have a valid package identity distinct from the reserved user owner.'
  }
}

const definitionProblems = {
  shape: 'Invalid pack definition. Use bounded, typed properties without required fields or defaults.',
  'duplicate-property': 'Pack property IDs must be unique.',
  'duplicate-option': 'Select option IDs must be unique within each property.',
} as const

export class InvalidPackDefinition extends Schema.TaggedError<InvalidPackDefinition>()(
  'InvalidPackDefinition',
  { reason: Schema.Literals(['shape', 'duplicate-property', 'duplicate-option']), cause: Schema.optional(Schema.Defect()) },
  { dshxWireCode: 'invalid-definition' },
) {
  override get message(): string {
    return definitionProblems[this.reason]
  }
}

export class PackVersionConflict extends Schema.TaggedError<PackVersionConflict>()('PackVersionConflict', {}, { dshxWireCode: 'version-conflict' }) {
  override get message(): string {
    return 'Publish a higher pack version to change its definition.'
  }
}

const migrationProblems = {
  'property-changed': 'Removing properties, changing types or changing read-only rules requires an explicit migration.',
  'option-removed': 'Removing option IDs requires an explicit migration. Rename labels without changing IDs instead.',
} as const

export class PackMigrationRequired extends Schema.TaggedError<PackMigrationRequired>()(
  'PackMigrationRequired',
  { reason: Schema.Literals(['property-changed', 'option-removed']) },
  { dshxWireCode: 'migration-required' },
) {
  override get message(): string {
    return migrationProblems[this.reason]
  }
}

export class InvalidPropertyValues extends Schema.TaggedError<InvalidPropertyValues>()(
  'InvalidPropertyValues',
  { propertyType: Schema.optional(Schema.Literals(propertyTypes)), cause: Schema.optional(Schema.Defect()) },
  { dshxWireCode: 'invalid-value' },
) {
  override get message(): string {
    if (this.propertyType === undefined) return 'Invalid property values. Use the declared property types and bounded values.'
    return `The value does not match the declared ${this.propertyType} property type or options.`
  }
}

export class UnknownProperty extends Schema.TaggedError<UnknownProperty>()('UnknownProperty', {}, { dshxWireCode: 'unknown-property' }) {
  override get message(): string {
    return 'The pack does not define one of these property IDs.'
  }
}

export class ReadOnlyProperty extends Schema.TaggedError<ReadOnlyProperty>()('ReadOnlyProperty', {}, { dshxWireCode: 'read-only' }) {
  override get message(): string {
    return 'Only the plugin that owns this pack may write its read-only properties.'
  }
}

export class ResourceStoreFailed extends Schema.TaggedError<ResourceStoreFailed>()(
  'ResourceStoreFailed',
  {
    operation: Schema.Literals(['open', 'catalog', 'list', 'get', 'register-pack', 'register-resource', 'attach', 'set-values', 'detach']),
    cause: Schema.optional(Schema.Defect()),
  },
  { dshxWireCode: 'resource-store-failure' },
) {
  override get message(): string {
    return 'The local resource metadata store could not complete this request. See Host diagnostics.'
  }
}

export class UnsafeResourceStorage extends Schema.TaggedError<UnsafeResourceStorage>()(
  'UnsafeResourceStorage',
  { reason: Schema.Literals(['symbolic-link', 'not-directory', 'not-file']) },
  { dshxWireCode: 'unsafe-storage' },
) {
  override get message(): string {
    return 'The resource metadata directory must be a private directory, not a symbolic link.'
  }
}

export type ResourceDomainError =
  | PackNotFound
  | ResourceNotFound
  | PackOwnerConflict
  | StaleResourceRevision
  | AttachmentLimitReached
  | PackNotAttached
  | MetadataTooLarge
  | InvalidCaller
  | InvalidPackDefinition
  | PackVersionConflict
  | PackMigrationRequired
  | InvalidPropertyValues
  | UnknownProperty
  | ReadOnlyProperty

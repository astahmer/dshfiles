import * as Effect from 'effect/Effect'
import * as Schema from 'effect/Schema'
import semver from 'semver'

/**
 * Registry format 1; docs/registry.md is the normative description.
 *
 * Field names follow DSH's own plugin market index where the two overlap
 * (`engines.dsh`, `source.type`), so one package can be listed by both.
 */
export const REGISTRY_SCHEMA_VERSION = 1 as const

/** A failure the user can act on: `hint` is the recovery the CLI prints. */
export class RegistryError extends Error {
  readonly hint: string
  constructor(message: string, hint: string) {
    super(message)
    this.name = 'RegistryError'
    this.hint = hint
  }
}

const schemaVersion = Schema.Literal(REGISTRY_SCHEMA_VERSION)
const itemNamePattern = /^[a-z0-9][a-z0-9-]*$/u
const itemName = Schema.String.check(Schema.isPattern(itemNamePattern, { message: 'Item names are lowercase letters, digits and dashes.' }))
const packageName = Schema.String.check(Schema.isPattern(/^(?:@[a-z0-9][a-z0-9._~-]*\/)?[a-z0-9][a-z0-9._~-]*$/u, { message: 'Expected an npm package name.' }))
const exactVersion = Schema.String.check(Schema.makeFilter(value => semver.valid(value) !== null, { message: 'Expected an exact semver version.' }))
const semverRange = Schema.String.check(Schema.makeFilter(value => semver.validRange(value) !== null, { message: 'Expected a semver range.' }))
const integrity = Schema.String.check(Schema.isPattern(/^sha512-[A-Za-z0-9+/]{86}==$/u, { message: 'Expected a sha512 SRI value (sha512-<base64>).' }))

const emptyStrings: readonly string[] = []
const emptyVersions: Readonly<Record<string, string>> = {}

/** Absent `dsh` means any DSH version, as in the market index. */
const enginesSchema = Schema.Struct({ dsh: Schema.optional(semverRange) })

const npmSourceSchema = Schema.Struct({ type: Schema.Literal('npm'), registry: Schema.optional(Schema.String) })
const tarballSourceSchema = Schema.Struct({ type: Schema.Literal('tarball'), url: Schema.String.check(Schema.isMinLength(1)), integrity })
export type TarballSource = Schema.Schema.Type<typeof tarballSourceSchema>

const displayFields = {
  title: Schema.optional(Schema.String),
  description: Schema.optional(Schema.String),
  author: Schema.optional(Schema.String),
  license: Schema.optional(Schema.String),
  homepage: Schema.optional(Schema.String),
}

const itemFields = {
  schemaVersion,
  name: itemName,
  version: exactVersion,
  ...displayFields,
  engines: enginesSchema.pipe(Schema.withDecodingDefault(Effect.succeed({}))),
  /** Sibling item names, or absolute URLs. A local alias means nothing to another machine, so it is refused here. */
  registryDependencies: Schema.Array(Schema.String).pipe(Schema.withDecodingDefault(Effect.succeed(emptyStrings))),
}

const pluginItemSchema = Schema.Struct({
  ...itemFields,
  type: Schema.Literal('dsh:plugin'),
  package: packageName,
  source: Schema.Union([npmSourceSchema, tarballSourceSchema]),
})
export type PluginItem = Schema.Schema.Type<typeof pluginItemSchema>

const sourceFileSchema = Schema.Struct({ target: Schema.String.check(Schema.isMinLength(1)), content: Schema.String })

const sourceItemSchema = Schema.Struct({
  ...itemFields,
  type: Schema.Literal('dsh:source'),
  /** Written into the project's `dependencies`; exact versions, as every workspace manifest here names them. */
  dependencies: Schema.Record(Schema.String, exactVersion).pipe(Schema.withDecodingDefault(Effect.succeed(emptyVersions))),
  files: Schema.Array(sourceFileSchema).check(Schema.isMinLength(1)),
  /** Printed after install: the wiring a source copy cannot do by itself. */
  docs: Schema.optional(Schema.String),
})
export type SourceItem = Schema.Schema.Type<typeof sourceItemSchema>

export const registryItemSchema = Schema.Union([pluginItemSchema, sourceItemSchema])
export type RegistryItem = Schema.Schema.Type<typeof registryItemSchema>

const indexEntrySchema = Schema.Struct({
  name: itemName,
  type: Schema.Literals(['dsh:plugin', 'dsh:source']),
  version: exactVersion,
  title: Schema.optional(Schema.String),
  description: Schema.optional(Schema.String),
  engines: enginesSchema.pipe(Schema.withDecodingDefault(Effect.succeed({}))),
  /** Item document, relative to this index. */
  url: Schema.String.check(Schema.isMinLength(1)),
})
export type RegistryIndexEntry = Schema.Schema.Type<typeof indexEntrySchema>

export const registryIndexSchema = Schema.Struct({
  schemaVersion,
  name: itemName,
  homepage: Schema.optional(Schema.String),
  items: Schema.Array(indexEntrySchema),
})
export type RegistryIndex = Schema.Schema.Type<typeof registryIndexSchema>

const buildPluginSchema = Schema.Struct({
  type: Schema.Literal('dsh:plugin'),
  /** Package directory, relative to the build source file. */
  path: Schema.String.check(Schema.isMinLength(1)),
  distribution: Schema.Literals(['tarball', 'npm']),
  name: Schema.optional(itemName),
  title: Schema.optional(Schema.String),
  author: Schema.optional(Schema.String),
  npmRegistry: Schema.optional(Schema.String),
  registryDependencies: Schema.Array(Schema.String).pipe(Schema.withDecodingDefault(Effect.succeed(emptyStrings))),
})

const buildSourceSchema = Schema.Struct({
  ...itemFields,
  schemaVersion: Schema.optional(schemaVersion),
  type: Schema.Literal('dsh:source'),
  dependencies: Schema.Record(Schema.String, exactVersion).pipe(Schema.withDecodingDefault(Effect.succeed(emptyVersions))),
  /** `path` is relative to the build source file; its content is inlined into the built item. */
  files: Schema.Array(Schema.Struct({ path: Schema.String.check(Schema.isMinLength(1)), target: Schema.String.check(Schema.isMinLength(1)) })).check(
    Schema.isMinLength(1),
  ),
  docs: Schema.optional(Schema.String),
})

/** `dshx.registry.json`, the file a registry author writes; `dshx registry build` turns it into the documents above. */
export const registryBuildSchema = Schema.Struct({
  name: itemName,
  homepage: Schema.optional(Schema.String),
  items: Schema.Array(Schema.Union([buildPluginSchema, buildSourceSchema])),
})
export type RegistryBuildSource = Schema.Schema.Type<typeof registryBuildSchema>

/** Local alias file, one per DSH home. */
export const registryAliasesSchema = Schema.Struct({
  schemaVersion,
  registries: Schema.Record(Schema.String, Schema.String),
})

const pluginRecordSchema = Schema.Struct({
  item: itemName,
  address: Schema.String,
  itemUrl: Schema.String,
  version: exactVersion,
  /** Tarball items only: the hash the install was verified against, and the file kept in the profile. */
  integrity: Schema.NullOr(integrity),
  tarball: Schema.NullOr(Schema.String),
  /** Package names of this item's registry dependencies. */
  requires: Schema.Array(Schema.String),
})
export type PluginRecord = Schema.Schema.Type<typeof pluginRecordSchema>

/** What a profile got from registries; the profile's package.json cannot say where a `file:` tarball came from. */
export const profileRecordsSchema = Schema.Struct({
  schemaVersion,
  plugins: Schema.Record(Schema.String, pluginRecordSchema),
})
export type ProfileRecords = Schema.Schema.Type<typeof profileRecordsSchema>

const sourceRecordSchema = Schema.Struct({
  address: Schema.String,
  itemUrl: Schema.String,
  version: exactVersion,
  /** sha256 of what was written, so local edits are told apart from the registry's content. */
  files: Schema.Array(Schema.Struct({ target: Schema.String, sha256: Schema.String })),
  requires: Schema.Array(Schema.String),
})
export type SourceRecord = Schema.Schema.Type<typeof sourceRecordSchema>

/** Committed with the plugin project, like a lockfile. */
export const projectRecordsSchema = Schema.Struct({
  schemaVersion,
  items: Schema.Record(Schema.String, sourceRecordSchema),
})
export type ProjectRecords = Schema.Schema.Type<typeof projectRecordsSchema>

/** Item name for a package: the scope stays, as it does in Loader row ids. */
export const itemNameForPackage = (name: string): string => name.replace(/^@/u, '').replace(/\//gu, '-')

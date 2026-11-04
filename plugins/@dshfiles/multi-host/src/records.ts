import * as Effect from 'effect/Effect'
import * as Schema from 'effect/Schema'
import { SchemaFields } from './schema.js'

const idSchema = Schema.Trim.check(Schema.isMinLength(1), Schema.isMaxLength(64), Schema.isPattern(/^[A-Za-z0-9][A-Za-z0-9._-]*$/))

export const sshTargetSchema = Schema.Trim.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(255),
  Schema.isPattern(/^(?:[A-Za-z0-9._-]+@)?[A-Za-z0-9][A-Za-z0-9._-]*$/),
)

const profileSchema = Schema.Trim.check(Schema.isMinLength(1), Schema.isMaxLength(64), Schema.isPattern(/^[A-Za-z0-9][A-Za-z0-9._-]*$/))
const originPortSchema = Schema.Number.check(Schema.isFinite(), Schema.isInt(), Schema.isGreaterThanOrEqualTo(40_000), Schema.isLessThanOrEqualTo(59_999))

const localLaunchUrlSchema = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(2048)).check(
  Schema.makeFilter(value => {
    let url: URL
    try {
      url = new URL(value)
    } catch {
      return 'The launch URL is invalid.'
    }
    const addressParts = url.hostname.split('.')
    const loopbackIpv4 = addressParts.length === 4 && addressParts[0] === '127' && addressParts.every(part => /^\d{1,3}$/.test(part) && Number(part) <= 255)
    const loopback = url.hostname === 'localhost' || url.hostname === '[::1]' || url.hostname === '::1' || loopbackIpv4
    const issues: string[] = []
    if (url.protocol !== 'http:' || !loopback || url.username || url.password) {
      issues.push('A local runtime URL must use HTTP loopback without user information.')
    }
    const token = url.searchParams.get('token')
    if (url.pathname !== '/' || token === null || !/^[A-Za-z0-9._~-]{8,512}$/.test(token) || url.searchParams.size !== 1 || url.hash) {
      issues.push('A local runtime URL must be the tokenized root launch URL.')
    }
    return issues
  }),
)

export const hostConnectorSchema = Schema.Union([
  Schema.Struct({ kind: Schema.Literal('local') }),
  Schema.Struct({ kind: Schema.Literal('ssh'), sshTarget: sshTargetSchema }),
])

export const runtimeLocatorSchema = Schema.Union([
  Schema.Struct({ kind: Schema.Literal('local'), launchUrl: localLaunchUrlSchema }),
  Schema.Struct({
    kind: Schema.Literal('ssh'),
    /** Ignored since discovery reads the launch file; kept so directories written before that still decode. */
    unit: Schema.optional(Schema.Trim.check(Schema.isMinLength(1), Schema.isMaxLength(128), Schema.isPattern(/^[A-Za-z0-9][A-Za-z0-9_.@-]*$/))),
    remoteHome: Schema.Trim.check(Schema.isMinLength(2), Schema.isMaxLength(1024), Schema.isPattern(/^\/(?!.*(?:^|\/)\.\.(?:\/|$)).+$/)),
  }),
])

export const runtimeIdentitySchema = Schema.Struct({
  protocolVersion: Schema.Literal(1),
  runtimeId: Schema.String.check(Schema.isUUID()),
  profile: profileSchema,
  homeLeaf: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(128)),
  dshVersion: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(80)),
  capabilities: Schema.Array(Schema.Literals(['workspace', 'session', 'agent'])).check(Schema.isMaxLength(8)),
})

export const hostWeightSchema = Schema.Number.check(Schema.isFinite(), Schema.isInt(), Schema.isGreaterThanOrEqualTo(1), Schema.isLessThanOrEqualTo(10))

export const hostRecordSchema = Schema.Struct({
  schemaVersion: Schema.Literal(2),
  id: idSchema,
  name: Schema.Trim.check(Schema.isMinLength(1), Schema.isMaxLength(120)),
  connector: hostConnectorSchema,
  /** Hidden hosts stay registered and keep their threads; only the destination picker leaves them out. */
  hidden: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(false))),
  /** Directory order, lowest first; the store fills it in for records written before it existed. */
  position: Schema.optional(Schema.Number.check(Schema.isFinite(), Schema.isInt(), Schema.isGreaterThanOrEqualTo(0))),
  /** Auto divides this host's resource pressure by its weight, so a weight-2 host takes about twice the load. Absent is 1. */
  weight: Schema.optional(hostWeightSchema),
  /** Run `jj git fetch` in a thread's folder on this host before the thread starts. */
  fetchBeforeThread: Schema.optional(Schema.Boolean),
  createdAt: SchemaFields.dateTimeString,
})

export const runtimeRecordSchema = Schema.Struct({
  schemaVersion: Schema.Literal(2),
  id: idSchema,
  hostId: idSchema,
  name: Schema.Trim.check(Schema.isMinLength(1), Schema.isMaxLength(120)),
  locator: runtimeLocatorSchema,
  identity: Schema.NullOr(runtimeIdentitySchema),
  originPort: Schema.optional(originPortSchema),
  createdAt: SchemaFields.dateTimeString,
  lastSeenAt: Schema.optional(SchemaFields.dateTimeString),
})

export const hostDirectorySchema = Schema.Struct({
  schemaVersion: Schema.Literal(2),
  hosts: Schema.Array(hostRecordSchema).check(Schema.isMaxLength(64)),
  runtimes: Schema.Array(runtimeRecordSchema).check(Schema.isMaxLength(128)),
  retiredPorts: Schema.Array(originPortSchema)
    .check(Schema.isMaxLength(20_000))
    .pipe(Schema.withDecodingDefault(Effect.succeed([]))),
}).check(
  Schema.makeFilter(directory => {
    const issues: string[] = []
    if (new Set(directory.retiredPorts).size !== directory.retiredPorts.length) {
      issues.push('Duplicate retired runtime origin port.')
    }
    const hostIds = new Set<string>()
    for (const host of directory.hosts) {
      if (hostIds.has(host.id)) issues.push(`Duplicate host id ${host.id}.`)
      hostIds.add(host.id)
    }
    const runtimeIds = new Set<string>()
    const originPorts = new Set(directory.retiredPorts)
    for (const runtime of directory.runtimes) {
      if (runtimeIds.has(runtime.id)) issues.push(`Duplicate runtime id ${runtime.id}.`)
      runtimeIds.add(runtime.id)
      if (runtime.originPort !== undefined) {
        if (originPorts.has(runtime.originPort)) issues.push(`Duplicate runtime origin port ${runtime.originPort}.`)
        originPorts.add(runtime.originPort)
      }
      if (!hostIds.has(runtime.hostId)) issues.push(`Runtime ${runtime.id} refers to missing host ${runtime.hostId}.`)
    }
    return issues
  }),
)

export const runtimeOriginPort = (runtimeId: string, occupied: readonly number[] = []): number => {
  const occupiedPorts = new Set(occupied)
  let hash = 2_166_136_261
  for (const character of runtimeId.toLowerCase()) {
    hash ^= character.charCodeAt(0)
    hash = Math.imul(hash, 16_777_619) >>> 0
  }
  const portCount = 20_000
  const firstPortIndex = hash % portCount
  for (let attempt = 0; attempt < portCount; attempt += 1) {
    const port = 40_000 + ((firstPortIndex + attempt) % portCount)
    if (!occupiedPorts.has(port)) return port
  }
  throw new Error('The runtime browser origin port range is exhausted.')
}

export type HostConnector = Schema.Schema.Type<typeof hostConnectorSchema>
export type RuntimeLocator = Schema.Schema.Type<typeof runtimeLocatorSchema>
export type RuntimeIdentity = Schema.Schema.Type<typeof runtimeIdentitySchema>
export type HostRecord = Schema.Schema.Type<typeof hostRecordSchema>
export type RuntimeRecord = Schema.Schema.Type<typeof runtimeRecordSchema>
export type HostDirectory = Schema.Schema.Type<typeof hostDirectorySchema>

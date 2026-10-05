import { z } from 'zod'

const idSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/)

const sshTargetSchema = z
  .string()
  .trim()
  .min(1)
  .max(255)
  .regex(/^(?:[A-Za-z0-9._-]+@)?[A-Za-z0-9][A-Za-z0-9._-]*$/)

const profileSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/)
const originPortSchema = z.number().int().safe().min(40_000).max(59_999)

const localLaunchUrlSchema = z
  .string()
  .min(1)
  .max(2048)
  .superRefine((value, context) => {
    let url: URL
    try {
      url = new URL(value)
    } catch {
      context.addIssue({ code: 'custom', message: 'The launch URL is invalid.' })
      return
    }
    const addressParts = url.hostname.split('.')
    const loopbackIpv4 = addressParts.length === 4 && addressParts[0] === '127' && addressParts.every(part => /^\d{1,3}$/.test(part) && Number(part) <= 255)
    const loopback = url.hostname === 'localhost' || url.hostname === '[::1]' || url.hostname === '::1' || loopbackIpv4
    if (url.protocol !== 'http:' || !loopback || url.username || url.password) {
      context.addIssue({ code: 'custom', message: 'A local runtime URL must use HTTP loopback without user information.' })
    }
    const token = url.searchParams.get('token')
    if (url.pathname !== '/' || token === null || !/^[A-Za-z0-9._~-]{8,512}$/.test(token) || url.searchParams.size !== 1 || url.hash) {
      context.addIssue({ code: 'custom', message: 'A local runtime URL must be the tokenized root launch URL.' })
    }
  })

export const hostConnectorSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('local') }).strict(),
  z.object({ kind: z.literal('ssh'), sshTarget: sshTargetSchema }).strict(),
])

export const runtimeLocatorSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('local'), launchUrl: localLaunchUrlSchema }).strict(),
  z
    .object({
      kind: z.literal('ssh'),
      unit: z
        .string()
        .trim()
        .min(1)
        .max(128)
        .regex(/^[A-Za-z0-9][A-Za-z0-9_.@-]*$/),
      remoteHome: z
        .string()
        .trim()
        .min(2)
        .max(1024)
        .regex(/^\/(?!.*(?:^|\/)\.\.(?:\/|$)).+$/),
    })
    .strict(),
])

export const runtimeIdentitySchema = z
  .object({
    protocolVersion: z.literal(1),
    runtimeId: z.string().uuid(),
    profile: profileSchema,
    homeLeaf: z.string().min(1).max(128),
    dshVersion: z.string().min(1).max(80),
    capabilities: z.array(z.enum(['workspace', 'session', 'agent'])).max(8),
  })
  .strict()

export const hostRecordSchema = z
  .object({
    schemaVersion: z.literal(2),
    id: idSchema,
    name: z.string().trim().min(1).max(120),
    connector: hostConnectorSchema,
    createdAt: z.string().datetime(),
  })
  .strict()

export const runtimeRecordSchema = z
  .object({
    schemaVersion: z.literal(2),
    id: idSchema,
    hostId: idSchema,
    name: z.string().trim().min(1).max(120),
    locator: runtimeLocatorSchema,
    identity: runtimeIdentitySchema.nullable(),
    originPort: originPortSchema.optional(),
    createdAt: z.string().datetime(),
    lastSeenAt: z.string().datetime().optional(),
  })
  .strict()

export const hostDirectorySchema = z
  .object({
    schemaVersion: z.literal(2),
    hosts: z.array(hostRecordSchema).max(64),
    runtimes: z.array(runtimeRecordSchema).max(128),
    retiredPorts: z.array(originPortSchema).max(20_000).default([]),
  })
  .strict()
  .superRefine((directory, context) => {
    if (new Set(directory.retiredPorts).size !== directory.retiredPorts.length) {
      context.addIssue({ code: 'custom', message: 'Duplicate retired runtime origin port.' })
    }
    const hostIds = new Set<string>()
    for (const host of directory.hosts) {
      if (hostIds.has(host.id)) context.addIssue({ code: 'custom', message: `Duplicate host id ${host.id}.` })
      hostIds.add(host.id)
    }
    const runtimeIds = new Set<string>()
    const originPorts = new Set(directory.retiredPorts)
    for (const runtime of directory.runtimes) {
      if (runtimeIds.has(runtime.id)) context.addIssue({ code: 'custom', message: `Duplicate runtime id ${runtime.id}.` })
      runtimeIds.add(runtime.id)
      if (runtime.originPort !== undefined) {
        if (originPorts.has(runtime.originPort)) context.addIssue({ code: 'custom', message: `Duplicate runtime origin port ${runtime.originPort}.` })
        originPorts.add(runtime.originPort)
      }
      if (!hostIds.has(runtime.hostId)) context.addIssue({ code: 'custom', message: `Runtime ${runtime.id} refers to missing host ${runtime.hostId}.` })
    }
  })

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

export type HostConnector = z.infer<typeof hostConnectorSchema>
export type RuntimeLocator = z.infer<typeof runtimeLocatorSchema>
export type RuntimeIdentity = z.infer<typeof runtimeIdentitySchema>
export type HostRecord = z.infer<typeof hostRecordSchema>
export type RuntimeRecord = z.infer<typeof runtimeRecordSchema>
export type HostDirectory = z.infer<typeof hostDirectorySchema>
